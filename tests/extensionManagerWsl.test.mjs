import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function transpile(filePath) {
	return ts.transpileModule(readFileSync(filePath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
}

function loadWslPaths() {
	const sandbox = { exports: {}, require };
	vm.runInNewContext(transpile("src/main/wsl/WslPaths.ts"), sandbox, { filename: "WslPaths.ts" });
	return sandbox.exports;
}

function loadPiAgentPaths(pathModule = require("node:path")) {
	const sandbox = {
		exports: {},
		require: (id) => id === "node:path" ? pathModule : require(id),
		process,
	};
	vm.runInNewContext(transpile("src/main/pi/PiAgentPaths.ts"), sandbox, { filename: "PiAgentPaths.ts" });
	return sandbox.exports;
}

function loadExtensionManager(fsOverrides = {}, piAgentPaths, pathModule = require("node:path")) {
	const resolvedPiAgentPaths = piAgentPaths ?? loadPiAgentPaths(pathModule);
	const wslPaths = loadWslPaths();
	const sandbox = {
		exports: {},
			require: (id) => {
			if (id === "../../shared/types") {
				return {
					MAESTRO_EXTENSION_PACKAGES: [
						{ name: "pi-maestro-flow", source: "npm:pi-maestro-flow" },
						{ name: "pi-maestro-teammate", source: "npm:pi-maestro-teammate" },
					],
				};
			}
			if (id === "node:fs/promises") {
				return { ...require(id), ...fsOverrides };
			}
			if (id === "node:path") return pathModule;
			if (id === "../wsl/WslPaths") return wslPaths;
			if (id === "../pi/PiAgentPaths") return resolvedPiAgentPaths;
			return require(id);
		},
	};
	vm.runInNewContext(transpile("src/main/extensions/ExtensionManager.ts"), sandbox, {
		filename: "ExtensionManager.ts",
	});
	return { ...sandbox.exports, wslPaths };
}

test("legacy built-ins are removable and no longer auto-deployed", () => {
	const manager = readFileSync("src/main/extensions/ExtensionManager.ts", "utf8");
	const main = readFileSync("src/main/index.ts", "utf8");
	const tab = readFileSync("src/renderer/src/config/ExtensionsTab.tsx", "utf8");
	const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");

	assert.match(manager, /await rm\(target, \{ force: true \}\)/);
	assert.match(manager, /await this\.ensureBuiltInDefaultsDisabled\(merged\)/);
	assert.doesNotMatch(main, /function ensurePiDeckExtension/);
	assert.doesNotMatch(main, /deployExtensionsTo/);
	assert.doesNotMatch(tab, /!extension\.builtIn && \(\s*<button[\s\S]*?config-icon-btn danger/);
	assert.doesNotMatch(configModal, /if \(target\.builtIn\)/);
	assert.match(configModal, /await api\.extensions\.uninstall\(target\.source, target\.scope\)/);
});

test("reads an installed WSL npm extension version through its canonical host path", async () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "pideck-extension-version-"));
	const fixturePath = join(fixtureDir, "package.json");
	writeFileSync(fixturePath, JSON.stringify({ name: "fixture-extension", version: "1.2.3" }), "utf8");
	const requestedPaths = [];

	try {
		const { ExtensionManager, wslPaths } = loadExtensionManager({
			readFile: async (path, encoding) => {
				requestedPaths.push(String(path));
				return readFile(fixturePath, encoding);
			},
		});
		const manager = new ExtensionManager({}, () => ({}));
		manager.configureWsl(wslPaths.createWslEnvironment("Ubuntu-24.04", "root", "/root"));

		const version = await manager.readInstalledVersion(
			"/root/.pi/agent/extensions/npm/fixture-extension",
		);
		const invalidVersion = await manager.readInstalledVersion("relative/package");

		assert.equal(version, "1.2.3");
		assert.equal(invalidVersion, undefined);
		assert.equal(requestedPaths.length, 1);
		assert.equal(
			requestedPaths[0].replace(/\\/g, "/"),
			"//wsl.localhost/Ubuntu-24.04/root/.pi/agent/extensions/npm/fixture-extension/package.json",
		);
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
});

test("uses PI_CODING_AGENT_DIR instead of assuming the system drive", async () => {
	const paths = loadPiAgentPaths();
	assert.equal(
		paths.resolveLocalPiAgentDir({ PI_CODING_AGENT_DIR: "D:\\pi-data\\agent" }, "C:\\Users\\dev"),
		"D:\\pi-data\\agent",
	);
	assert.equal(
		paths.resolveLocalPiAgentDir({ PI_CODING_AGENT_DIR: "~\\custom-pi" }, "D:\\Users\\dev"),
		join("D:\\Users\\dev", "custom-pi"),
	);

	let settingsContent = JSON.stringify({ disabledExtensions: [] });
	const reads = [];
	const writes = [];
	const { ExtensionManager } = loadExtensionManager({
		readdir: async (directory) => {
			reads.push(String(directory));
			return ["drive-extension"];
		},
		readFile: async (filePath) => {
			const normalized = String(filePath).replace(/\\/g, "/");
			if (normalized.endsWith("/drive-extension/index.ts")) return "export default function extension() {}";
			if (normalized.endsWith("/drive-extension/package.json")) {
				return JSON.stringify({ name: "drive-extension", version: "2.4.6" });
			}
			return settingsContent;
		},
		writeFile: async (filePath, content) => {
			writes.push(String(filePath));
			settingsContent = String(content);
		},
	}, { resolvePiAgentDir: () => "D:\\pi-data\\agent" });
	const manager = new ExtensionManager({}, () => ({}));

	const extensions = await manager.scanLocalExtensions();
	await manager.setEnabled("custom-extension.ts", false);

	assert.equal(reads[0], join("D:\\pi-data\\agent", "extensions"));
	assert.equal(extensions.length, 1);
	assert.equal(extensions[0].source, "drive-extension");
	assert.equal(extensions[0].path, join("D:\\pi-data\\agent", "extensions", "drive-extension"));
	assert.equal(extensions[0].currentVersion, "2.4.6");
	assert.equal(writes[0], join("D:\\pi-data\\agent", "settings.json"));
	assert.deepEqual(JSON.parse(settingsContent).disabledExtensions, ["custom-extension.ts"]);
});

test("reads local extension versions with native Linux POSIX paths", async () => {
	const pathModule = require("node:path").posix;
	const paths = loadPiAgentPaths(pathModule);
	assert.equal(paths.resolveLocalPiAgentDir({}, "/home/dev"), "/home/dev/.pi/agent");
	assert.equal(
		paths.resolveLocalPiAgentDir({ PI_CODING_AGENT_DIR: "/opt/pi-agent" }, "/home/dev"),
		"/opt/pi-agent",
	);

	const requestedPaths = [];
	const { ExtensionManager } = loadExtensionManager({
		readdir: async (directory) => {
			requestedPaths.push(String(directory));
			return ["linux-extension"];
		},
		readFile: async (filePath) => {
			requestedPaths.push(String(filePath));
			if (String(filePath).endsWith("/index.ts")) return "export default function extension() {}";
			if (String(filePath).endsWith("/package.json")) return JSON.stringify({ version: "3.1.4" });
			throw new Error("unexpected path");
		},
	}, { resolvePiAgentDir: () => "/opt/pi-agent" }, pathModule);
	const manager = new ExtensionManager({}, () => ({}));

	const extensions = await manager.scanLocalExtensions();

	assert.equal(requestedPaths[0], "/opt/pi-agent/extensions");
	assert.equal(extensions.length, 1);
	assert.equal(extensions[0].path, "/opt/pi-agent/extensions/linux-extension");
	assert.equal(extensions[0].currentVersion, "3.1.4");
});

test("shows installed package versions on the first non-refresh extension list", async () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "pideck-extension-list-version-"));
	writeFileSync(
		join(fixtureDir, "package.json"),
		JSON.stringify({ name: "pi-maestro-flow", version: "4.5.6" }),
		"utf8",
	);

	try {
		const { ExtensionManager } = loadExtensionManager();
		const manager = new ExtensionManager({}, () => ({}));
		let registryQueries = 0;
		manager.runPi = async () => `User packages:\n  npm:pi-maestro-flow\n    ${fixtureDir}\n  file:../local-extension\n    ${fixtureDir}\n`;
		manager.scanLocalExtensions = async () => [];
		manager.ensureBuiltInDefaultsDisabled = async () => undefined;
		manager.getDisabledExtensions = async () => new Set();
		manager.npmViewVersion = async () => {
			registryQueries += 1;
			return "9.9.9";
		};

		const result = await manager.list(false);

		assert.equal(result.extensions.length, 2);
		assert.equal(result.extensions[0].currentVersion, "4.5.6");
		assert.equal(result.extensions[1].source, "file:../local-extension");
		assert.equal(result.extensions[1].currentVersion, "4.5.6");
		assert.equal(result.extensions[0].latestVersion, undefined);
		assert.equal(registryQueries, 0);
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
});

test("Maestro health checks only flow installation and its updates", async () => {
	const { ExtensionManager } = loadExtensionManager();
	const manager = new ExtensionManager({}, () => ({}));
	manager.list = async () => ({
		extensions: [
			{
				id: "user:npm:pi-maestro-flow",
				source: "npm:pi-maestro-flow",
				scope: "user",
				enabled: true,
				currentVersion: "1.2.3",
			},
		],
		raw: "",
	});
	const queried = [];
	manager.npmViewVersion = async (name) => {
		queried.push(name);
		return "1.3.0";
	};

	const health = await manager.checkMaestroHealth(true);

	assert.deepEqual(queried, ["pi-maestro-flow"]);
	assert.equal(health.checkedUpdates, true);
	assert.equal(health.packages[0].installed, true);
	assert.equal(health.packages[0].currentVersion, "1.2.3");
	assert.equal(health.packages[0].latestVersion, "1.3.0");
	assert.equal(health.packages[0].hasUpdate, true);
	assert.equal(health.packages.length, 1);
	assert.equal(health.packages.some((pkg) => pkg.source === "npm:pi-maestro-teammate"), false);
});

test("Maestro health skips registry access when update checks are disabled", async () => {
	const { ExtensionManager } = loadExtensionManager();
	const manager = new ExtensionManager({}, () => ({}));
	manager.list = async () => ({
		extensions: [
			{ source: "npm:pi-maestro-flow", currentVersion: "1.2.3", scope: "user" },
			{ source: "npm:pi-maestro-teammate", currentVersion: "2.0.0", scope: "user" },
		],
		raw: "",
	});
	manager.npmViewVersion = async () => {
		throw new Error("registry must not be queried");
	};

	const health = await manager.checkMaestroHealth(false);

	assert.equal(health.checkedUpdates, false);
	assert.equal(health.packages.length, 1);
	assert.equal(health.packages[0].source, "npm:pi-maestro-flow");
	assert.equal(health.packages[0].installed, true);
	assert.equal(health.packages[0].hasUpdate, false);
});

test("defaults installed legacy built-ins to disabled only once", async () => {
	let settingsContent = JSON.stringify({ disabledExtensions: ["custom.ts"] });
	let migrated = false;
	const writes = [];
	const { ExtensionManager } = loadExtensionManager({
		readFile: async (filePath) => {
			if (String(filePath).endsWith(".pideck-extension-defaults-v1")) {
				if (!migrated) throw Object.assign(new Error("missing"), { code: "ENOENT" });
				return "disabled\n";
			}
			return settingsContent;
		},
		writeFile: async (filePath, content) => {
			writes.push(String(filePath));
			if (String(filePath).endsWith("settings.json")) settingsContent = String(content);
			if (String(filePath).endsWith(".pideck-extension-defaults-v1")) migrated = true;
		},
	});
	const manager = new ExtensionManager({}, () => ({}));
	const extensions = [
		{ source: "pi-deck-todo.ts", builtIn: true },
		{ source: "pi-deck-plan-mode.ts", builtIn: true },
		{ source: "custom.ts", builtIn: false },
	];

	await manager.ensureBuiltInDefaultsDisabled(extensions);
	const settings = JSON.parse(settingsContent);
	assert.deepEqual(settings.disabledExtensions, ["custom.ts", "pi-deck-todo.ts", "pi-deck-plan-mode.ts"]);
	assert.equal(migrated, true);

	const writesAfterMigration = writes.length;
	settingsContent = JSON.stringify({ disabledExtensions: [] }); // 模拟用户之后手动启用
	await manager.ensureBuiltInDefaultsDisabled(extensions);
	assert.equal(writes.length, writesAfterMigration);
	assert.deepEqual(JSON.parse(settingsContent).disabledExtensions, []);
});

test("removes a legacy built-in file and keeps it disabled", async () => {
	let settingsContent = JSON.stringify({ disabledExtensions: [] });
	const removed = [];
	const { ExtensionManager } = loadExtensionManager({
		readFile: async () => settingsContent,
		writeFile: async (_filePath, content) => { settingsContent = String(content); },
		rm: async (filePath, options) => { removed.push({ filePath: String(filePath), options }); },
	});
	const manager = new ExtensionManager({}, () => ({}));

	await manager.uninstall("pi-deck-todo.ts");

	assert.equal(removed.length, 1);
	assert.match(removed[0].filePath.replace(/\\/g, "/"), /\/\.pi\/agent\/extensions\/pi-deck-todo\.ts$/);
	assert.equal(removed[0].options.force, true);
	assert.deepEqual(JSON.parse(settingsContent).disabledExtensions, ["pi-deck-todo.ts"]);
});

test("reads and writes extension enablement in the active WSL HOME", async () => {
	let settingsContent = JSON.stringify({ disabledExtensions: [] });
	const reads = [];
	const writes = [];
	const { ExtensionManager, wslPaths } = loadExtensionManager({
		readFile: async (filePath) => {
			reads.push(String(filePath));
			return settingsContent;
		},
		writeFile: async (filePath, content) => {
			writes.push(String(filePath));
			settingsContent = String(content);
		},
	});
	const manager = new ExtensionManager({}, () => ({}));
	manager.configureWsl(wslPaths.createWslEnvironment("Ubuntu-24.04", "root", "/root"));

	await manager.setEnabled("pi-deck-todo.ts", false);
	const disabled = await manager.getDisabledExtensions();

	const expectedPath = "//wsl.localhost/Ubuntu-24.04/root/.pi/agent/settings.json";
	assert.equal(reads.every((filePath) => filePath.replace(/\\/g, "/") === expectedPath), true);
	assert.equal(writes[0].replace(/\\/g, "/"), expectedPath);
	assert.equal(disabled.has("pi-deck-todo.ts"), true);
});
