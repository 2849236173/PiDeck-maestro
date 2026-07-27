import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const GLOBAL_PATH = "C:\\Users\\tester\\.maestro\\cli-tools.json";
const WORKSPACE_PATH = "C:\\repo\\.maestro\\cli-tools.json";

function missingFile() {
	const error = new Error("ENOENT");
	error.code = "ENOENT";
	return error;
}

function loadConfigManager(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const writes = [];
	const source = readFileSync("src/main/config/ConfigManager.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const sandbox = {
		AbortController,
		clearTimeout,
		exports: {},
		process: { ...process, platform: "win32" },
		setTimeout,
		require: (id) => {
			if (id === "node:fs/promises") {
				return {
					mkdir: async () => {},
					readFile: async (filePath) => {
						if (!files.has(filePath)) throw missingFile();
						return files.get(filePath);
					},
					writeFile: async (filePath, content) => {
						files.set(filePath, content);
						writes.push({ filePath, content });
					},
				};
			}
			if (id === "node:path") return path.win32;
			if (id === "node:os") return { homedir: () => "C:\\Users\\tester" };
			if (id === "electron") return { net: {} };
			if (id === "./baseUrlPath") {
				return {
					ensureOpenAiVersionPath: (value) => value,
					needsSessionBaseUrlVersionHint: () => false,
					suggestNormalizedBaseUrl: () => undefined,
				};
			}
			if (id === "../wsl/WslPaths") {
				return { toWindowsHostPath: (value) => value };
			}
			return require(id);
		},
	};
	vm.runInNewContext(outputText, sandbox, { filename: "ConfigManager.ts" });
	return {
		...sandbox.exports,
		files,
		writes,
	};
}

function createManager(ConfigManager) {
	return new ConfigManager("C:\\Users\\tester\\.pi\\agent");
}

const globalConfig = {
	version: "1.1.0",
	customTopLevel: { future: true },
	tools: {
		claude: {
			enabled: true,
			primaryModel: "global-model",
			secondaryModel: "global-backup",
			tags: ["fullstack"],
			type: "builtin",
			auth: { tokenRef: "secret" },
			futureToolField: 42,
		},
		codex: {
			enabled: true,
			primaryModel: "gpt-global",
			tags: ["backend"],
			type: "builtin",
		},
	},
	roles: {
		analyze: { fallbackChain: ["claude", "codex"], futureRoleField: "keep" },
	},
};

const workspaceConfig = {
	tools: {
		claude: {
			enabled: true,
			primaryModel: "workspace-model",
			tags: ["frontend"],
			type: "builtin",
		},
	},
	roles: {
		analyze: { tool: "claude" },
	},
};

test("loads global and workspace sources with Maestro runtime override semantics", async () => {
	const { ConfigManager } = loadConfigManager({
		[GLOBAL_PATH]: JSON.stringify(globalConfig),
		[WORKSPACE_PATH]: JSON.stringify(workspaceConfig),
	});
	const manager = createManager(ConfigManager);
	const snapshot = await manager.getMaestroCliToolsConfig("C:\\repo");

	assert.equal(snapshot.global.path, GLOBAL_PATH);
	assert.equal(snapshot.workspace.path, WORKSPACE_PATH);
	assert.equal(snapshot.global.exists, true);
	assert.equal(snapshot.workspace.exists, true);
	assert.equal(snapshot.effective.tools.claude.primaryModel, "workspace-model");
	assert.equal(snapshot.effective.tools.claude.futureToolField, undefined);
	assert.equal(snapshot.effective.tools.codex.primaryModel, "gpt-global");
	assert.equal(snapshot.effective.roles.analyze.tool, "claude");
	assert.equal(snapshot.effective.roles.analyze.futureRoleField, undefined);
});

test("field-merges GUI updates and preserves unknown Maestro fields", async () => {
	const { ConfigManager, files, writes } = loadConfigManager({
		[GLOBAL_PATH]: JSON.stringify(globalConfig),
	});
	const manager = createManager(ConfigManager);
	const result = await manager.saveMaestroCliToolsConfig({
		scope: "global",
		config: {
			tools: {
				claude: {
					primaryModel: "glm-5.2",
					secondaryModel: undefined,
					reasoningEffort: "high",
				},
			},
			roles: {
				analyze: { tool: "claude", fallbackChain: undefined },
			},
		},
	});

	assert.equal(result.valid, true);
	assert.equal(writes.length, 1);
	const saved = JSON.parse(files.get(GLOBAL_PATH));
	assert.deepEqual(saved.customTopLevel, { future: true });
	assert.deepEqual(saved.tools.claude.auth, { tokenRef: "secret" });
	assert.equal(saved.tools.claude.futureToolField, 42);
	assert.deepEqual(saved.tools.claude.tags, ["fullstack"]);
	assert.equal(saved.tools.claude.primaryModel, "glm-5.2");
	assert.equal(saved.tools.claude.secondaryModel, undefined);
	assert.equal(saved.tools.claude.reasoningEffort, "high");
	assert.equal(saved.roles.analyze.tool, "claude");
	assert.equal(saved.roles.analyze.fallbackChain, undefined);
	assert.equal(saved.roles.analyze.futureRoleField, "keep");
});

test("refuses to overwrite malformed JSON in the selected scope", async () => {
	const malformed = '{"tools":{"claude":';
	const { ConfigManager, files, writes } = loadConfigManager({
		[GLOBAL_PATH]: malformed,
	});
	const manager = createManager(ConfigManager);
	const snapshot = await manager.getMaestroCliToolsConfig();

	assert.equal(snapshot.global.diagnostic?.fileName, "cli-tools.json");
	const result = await manager.saveMaestroCliToolsConfig({
		scope: "global",
		config: { tools: { claude: { primaryModel: "must-not-write" } } },
	});
	assert.equal(result.valid, false);
	assert.match(result.error, /无法保存/);
	assert.equal(files.get(GLOBAL_PATH), malformed);
	assert.equal(writes.length, 0);
});

test("creates a workspace override without modifying the global file", async () => {
	const initialGlobal = JSON.stringify(globalConfig);
	const { ConfigManager, files, writes } = loadConfigManager({
		[GLOBAL_PATH]: initialGlobal,
	});
	const manager = createManager(ConfigManager);
	const result = await manager.saveMaestroCliToolsConfig({
		scope: "workspace",
		workspacePath: "C:\\repo",
		config: {
			tools: {
				claude: {
					enabled: true,
					primaryModel: "project-model",
					tags: ["fullstack"],
					type: "builtin",
				},
			},
		},
	});

	assert.equal(result.valid, true);
	assert.equal(writes[0].filePath, WORKSPACE_PATH);
	assert.equal(files.get(GLOBAL_PATH), initialGlobal);
	assert.equal(JSON.parse(files.get(WORKSPACE_PATH)).tools.claude.primaryModel, "project-model");
});

test("restores workspace inheritance by explicitly removing scoped entries", async () => {
	const initialGlobal = JSON.stringify(globalConfig);
	const workspaceWithUnknown = {
		...workspaceConfig,
		futureWorkspaceField: "keep",
	};
	const { ConfigManager, files } = loadConfigManager({
		[GLOBAL_PATH]: initialGlobal,
		[WORKSPACE_PATH]: JSON.stringify(workspaceWithUnknown),
	});
	const manager = createManager(ConfigManager);
	const result = await manager.saveMaestroCliToolsConfig({
		scope: "workspace",
		workspacePath: "C:\\repo",
		config: {},
		removeTools: ["claude"],
		removeRoles: ["analyze"],
	});

	assert.equal(result.valid, true);
	const savedWorkspace = JSON.parse(files.get(WORKSPACE_PATH));
	assert.equal(savedWorkspace.tools.claude, undefined);
	assert.equal(savedWorkspace.roles.analyze, undefined);
	assert.equal(savedWorkspace.futureWorkspaceField, "keep");
	assert.equal(files.get(GLOBAL_PATH), initialGlobal);

	const snapshot = await manager.getMaestroCliToolsConfig("C:\\repo");
	assert.equal(snapshot.effective.tools.claude.primaryModel, "global-model");
	assert.deepEqual(Array.from(snapshot.effective.roles.analyze.fallbackChain), ["claude", "codex"]);
});

test("renderer contract keeps Maestro models free-form and project-scoped", () => {
	const maestroTab = readFileSync("src/renderer/src/config/MaestroTab.tsx", "utf8");
	const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
	const app = readFileSync("src/renderer/src/App.tsx", "utf8");

	assert.match(maestroTab, /getMaestroCliTools\(workspacePath\)/);
	assert.match(maestroTab, /primaryModel/);
	assert.match(maestroTab, /secondaryModel/);
	assert.match(maestroTab, /reasoningEffort/);
	assert.match(maestroTab, /MAESTRO_DELEGATE_ROLES\.map/);
	assert.match(maestroTab, /<TextField[\s\S]*label=\{t\("maestro\.primaryModel"\)\}/);
	assert.match(maestroTab, /restoreInheritedTool/);
	assert.match(maestroTab, /removeTools/);
	assert.doesNotMatch(maestroTab, /models\.providers|allModels/);
	assert.match(configModal, /workspacePath=\{props\.projectPath\}/);
	assert.match(app, /projectPath=\{activeProject\?\.path\}/);
});
