import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadSyncModule() {
	const source = readFileSync("src/main/pi/AgentShellSync.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const sandbox = { exports: {}, process };
	sandbox.global = sandbox;
	vm.runInNewContext(outputText, sandbox, { filename: "AgentShellSync.ts" });
	return sandbox.exports;
}

test("auto resolves when the global shellPath is missing", async () => {
	const { resolveAgentShellPath } = loadSyncModule();
	const result = await resolveAgentShellPath({
		mode: "auto",
		wslEnabled: false,
		currentPath: "",
		selectedPath: "",
		resolveAuto: async () => "/git/bin/bash.exe",
		validate: async () => ({ ok: false }),
	});
	assert.equal(result, "/git/bin/bash.exe");
});

test("auto keeps an existing healthy shellPath", async () => {
	const { resolveAgentShellPath } = loadSyncModule();
	let autoCalled = false;
	const result = await resolveAgentShellPath({
		mode: "auto",
		wslEnabled: false,
		currentPath: "/usr/bin/bash",
		selectedPath: "",
		resolveAuto: async () => { autoCalled = true; return "/bin/bash"; },
		validate: async () => ({ ok: true }),
	});
	assert.equal(result, undefined);
	assert.equal(autoCalled, false);
});

test("auto replaces the legacy System32 WSL shell", async () => {
	const { resolveAgentShellPath } = loadSyncModule();
	const result = await resolveAgentShellPath({
		mode: "auto",
		wslEnabled: false,
		currentPath: "C:\\Windows\\System32\\bash.exe",
		selectedPath: "",
		resolveAuto: async () => "C:\\Program Files\\Git\\bin\\bash.exe",
		validate: async () => ({ ok: true }),
	});
	assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("custom path is explicit and valid", async () => {
	const { resolveAgentShellPath } = loadSyncModule();
	const result = await resolveAgentShellPath({
		mode: "custom",
		wslEnabled: false,
		currentPath: "",
		selectedPath: "/opt/bash",
		resolveAuto: async () => "/bin/bash",
		validate: async (path) => ({ ok: path === "/opt/bash" }),
	});
	assert.equal(result, "/opt/bash");
});

test("WSL mode never writes a Windows shellPath", async () => {
	const { resolveAgentShellPath } = loadSyncModule();
	const result = await resolveAgentShellPath({
		mode: "custom",
		wslEnabled: true,
		currentPath: "C:\\Windows\\System32\\bash.exe",
		selectedPath: "C:\\Program Files\\Git\\bin\\bash.exe",
		resolveAuto: async () => "C:\\Program Files\\Git\\bin\\bash.exe",
		validate: async () => ({ ok: true }),
	});
	assert.equal(result, undefined);
});
