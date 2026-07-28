import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const TASK_TYPES = ["explore", "analysis", "debug", "planning", "development", "review", "testing"];
const GLOBAL_PATH = "C:\\Users\\tester\\.pi\\agent\\teammate-models.json";
const WORKSPACE_PATH = "C:\\repo\\.pi\\teammate-models.json";

function missingFile() {
	const error = new Error("ENOENT");
	error.code = "ENOENT";
	return error;
}

function loadConfigManager(initialFiles = {}, toWindowsHostPath = (value) => value) {
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
			if (id === "../../shared/types") return { TEAMMATE_MODEL_TASK_TYPES: TASK_TYPES };
			if (id === "./baseUrlPath") {
				return {
					ensureOpenAiVersionPath: (value) => value,
					needsSessionBaseUrlVersionHint: () => false,
					suggestNormalizedBaseUrl: () => undefined,
				};
			}
			if (id === "../wsl/WslPaths") return { toWindowsHostPath };
			return require(id);
		},
	};
	vm.runInNewContext(outputText, sandbox, { filename: "ConfigManager.ts" });
	return { ...sandbox.exports, files, writes };
}

function createManager(ConfigManager) {
	return new ConfigManager("C:\\Users\\tester\\.pi\\agent");
}

const globalConfig = {
	version: 2,
	global: "anthropic/claude-sonnet-4-6",
	customTopLevel: { future: true },
	mappings: {
		explore: "google/gemini-2.5-pro",
		analysis: "anthropic/claude-sonnet-4-6",
		development: "openai/gpt-5.4",
	},
	thinkingLevels: {
		analysis: "high",
		development: "medium",
	},
};

const workspaceConfig = {
	version: 2,
	mappings: {
		explore: "openai/gpt-5.4-mini",
		testing: "anthropic/claude-haiku-4-5",
	},
	thinkingLevels: { testing: "low" },
};

test("loads global and project teammate-models files with per-task override semantics", async () => {
	const { ConfigManager } = loadConfigManager({
		[GLOBAL_PATH]: JSON.stringify(globalConfig),
		[WORKSPACE_PATH]: JSON.stringify(workspaceConfig),
	});
	const snapshot = await createManager(ConfigManager).getTeammateModelRoutingConfig("C:\\repo");

	assert.equal(snapshot.global.path, GLOBAL_PATH);
	assert.equal(snapshot.workspace.path, WORKSPACE_PATH);
	assert.equal(snapshot.effective.mappings.explore, "openai/gpt-5.4-mini");
	assert.equal(snapshot.effective.mappings.analysis, "anthropic/claude-sonnet-4-6");
	assert.equal(snapshot.effective.mappings.debug, "anthropic/claude-sonnet-4-6");
	assert.equal(snapshot.effective.mappings.development, "openai/gpt-5.4");
	assert.equal(snapshot.effective.mappings.testing, "anthropic/claude-haiku-4-5");
	assert.equal(snapshot.effective.thinkingLevels.analysis, "high");
	assert.equal(snapshot.effective.thinkingLevels.testing, "low");
});

test("preserves thinking levels and unknown fields while saving model mappings", async () => {
	const { ConfigManager, files, writes } = loadConfigManager({
		[GLOBAL_PATH]: JSON.stringify(globalConfig),
	});
	const result = await createManager(ConfigManager).saveTeammateModelRoutingConfig({
		scope: "global",
		config: {
			version: 2,
			global: "openai/gpt-5.5",
			mappings: { analysis: "openai/gpt-5.5" },
		},
	});

	assert.equal(result.valid, true);
	assert.equal(writes.length, 1);
	const saved = JSON.parse(files.get(GLOBAL_PATH));
	assert.deepEqual(saved.customTopLevel, { future: true });
	assert.deepEqual(saved.thinkingLevels, globalConfig.thinkingLevels);
	assert.equal(saved.global, "openai/gpt-5.5");
	assert.equal(saved.mappings.analysis, "openai/gpt-5.5");
	assert.equal(saved.mappings.explore, "google/gemini-2.5-pro");
});

test("refuses to overwrite malformed teammate-models JSON", async () => {
	const malformed = '{"mappings":{"analysis":';
	const { ConfigManager, files, writes } = loadConfigManager({ [GLOBAL_PATH]: malformed });
	const manager = createManager(ConfigManager);
	const snapshot = await manager.getTeammateModelRoutingConfig();

	assert.equal(snapshot.global.diagnostic?.fileName, "teammate-models.json");
	const result = await manager.saveTeammateModelRoutingConfig({
		scope: "global",
		config: { mappings: { analysis: "must-not-write" } },
	});
	assert.equal(result.valid, false);
	assert.match(result.error, /无法保存/);
	assert.equal(files.get(GLOBAL_PATH), malformed);
	assert.equal(writes.length, 0);
});

test("reports invalid known task mapping values without overwriting the source", async () => {
	const malformedShape = JSON.stringify({ version: 2, mappings: { analysis: 42 } });
	const { ConfigManager, files, writes } = loadConfigManager({ [GLOBAL_PATH]: malformedShape });
	const manager = createManager(ConfigManager);
	const snapshot = await manager.getTeammateModelRoutingConfig();

	assert.match(snapshot.global.diagnostic?.message ?? "", /mappings\.analysis/);
	const result = await manager.saveTeammateModelRoutingConfig({
		scope: "global",
		config: { mappings: { analysis: "openai/gpt-5.5" } },
	});
	assert.equal(result.valid, false);
	assert.equal(files.get(GLOBAL_PATH), malformedShape);
	assert.equal(writes.length, 0);
});

test("creates a project mapping without modifying the global file", async () => {
	const initialGlobal = JSON.stringify(globalConfig);
	const { ConfigManager, files, writes } = loadConfigManager({ [GLOBAL_PATH]: initialGlobal });
	const result = await createManager(ConfigManager).saveTeammateModelRoutingConfig({
		scope: "workspace",
		workspacePath: "C:\\repo",
		config: { version: 2, mappings: { review: "openai/gpt-5.4" } },
	});

	assert.equal(result.valid, true);
	assert.equal(writes[0].filePath, WORKSPACE_PATH);
	assert.equal(files.get(GLOBAL_PATH), initialGlobal);
	assert.equal(JSON.parse(files.get(WORKSPACE_PATH)).mappings.review, "openai/gpt-5.4");
});

test("restores project inheritance and preserves unrelated project fields", async () => {
	const projectWithUnknown = { ...workspaceConfig, projectFutureField: "keep", global: "openai/gpt-5.5" };
	const { ConfigManager, files } = loadConfigManager({
		[GLOBAL_PATH]: JSON.stringify(globalConfig),
		[WORKSPACE_PATH]: JSON.stringify(projectWithUnknown),
	});
	const manager = createManager(ConfigManager);
	const result = await manager.saveTeammateModelRoutingConfig({
		scope: "workspace",
		workspacePath: "C:\\repo",
		config: {},
		removeGlobal: true,
		removeMappings: ["explore"],
	});

	assert.equal(result.valid, true);
	const saved = JSON.parse(files.get(WORKSPACE_PATH));
	assert.equal(saved.global, undefined);
	assert.equal(saved.mappings.explore, undefined);
	assert.equal(saved.mappings.testing, "anthropic/claude-haiku-4-5");
	assert.equal(saved.projectFutureField, "keep");

	const snapshot = await manager.getTeammateModelRoutingConfig("C:\\repo");
	assert.equal(snapshot.effective.mappings.explore, "google/gemini-2.5-pro");
});

test("resolves project teammate-models path through the configured WSL environment", async () => {
	const hostProject = "D:\\wsl\\home\\dev\\repo";
	const hostPath = `${hostProject}\\.pi\\teammate-models.json`;
	const { ConfigManager } = loadConfigManager(
		{ [hostPath]: JSON.stringify(workspaceConfig) },
		(value) => (value === "/home/dev/repo" ? hostProject : value),
	);
	const manager = createManager(ConfigManager);
	manager.configureWsl({ windowsHome: "D:\\wsl\\home\\dev" });
	const snapshot = await manager.getTeammateModelRoutingConfig("/home/dev/repo");
	assert.equal(snapshot.workspace.path, hostPath);
	assert.equal(snapshot.workspace.exists, true);
});

test("renderer exposes Pi-backed searchable editable task model selectors", () => {
	const maestroTab = readFileSync("src/renderer/src/config/MaestroTab.tsx", "utf8");
	const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
	const shared = readFileSync("src/renderer/src/config/ConfigShared.tsx", "utf8");

	assert.match(maestroTab, /getTeammateModels\(workspacePath\)/);
	assert.match(maestroTab, /saveTeammateModels\(buildSaveRequest\(\)\)/);
	assert.match(maestroTab, /TEAMMATE_MODEL_TASK_TYPES\.map/);
	assert.match(maestroTab, /const value = `\$\{provider\}\/\$\{id\}`/);
	assert.match(maestroTab, /<ConfigComboboxInput/);
	assert.match(maestroTab, /removeMappings/);
	assert.match(maestroTab, /normalizeRoutingDraft/);
	assert.doesNotMatch(maestroTab, /reasoningEffort|fallbackChain|primaryModel|secondaryModel/);
	assert.match(configModal, /target === "maestro"[\s\S]*api\.config\.getModels\(\)/);
	assert.match(configModal, /models=\{modelsData\}/);
	assert.match(configModal, /workspacePath=\{props\.projectPath\}/);
	assert.match(shared, /role="combobox"/);
	assert.match(shared, /props\.onChange\(e\.target\.value\)/);
});
