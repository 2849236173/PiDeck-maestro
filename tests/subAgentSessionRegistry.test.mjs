import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function loadRegistry(userDataPath, fsPromiseOverrides = {}) {
	const source = readFileSync("src/main/sessions/SubAgentSessionRegistry.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const sandbox = {
		clearTimeout,
		exports: {},
		process,
		require: (id) => {
			if (id === "electron") return { app: { getPath: () => userDataPath } };
			if (id === "node:fs/promises" && Object.keys(fsPromiseOverrides).length > 0) {
				return { ...require(id), ...fsPromiseOverrides };
			}
			return require(id);
		},
		setTimeout,
	};
	vm.runInNewContext(outputText, sandbox, { filename: "SubAgentSessionRegistry.ts" });
	return sandbox.exports.SubAgentSessionRegistry;
}

test("persists normalized child links and reloads them without rescanning sessions", async () => {
	const userData = mkdtempSync(join(tmpdir(), "pideck-subagent-registry-"));
	try {
		const SubAgentSessionRegistry = loadRegistry(userData);
		const childPath = "C:\\Users\\dev\\.pi\\agent\\sessions\\project\\child.jsonl";
		const parentPath = "C:\\Users\\dev\\.pi\\agent\\sessions\\project.jsonl";
		const registry = new SubAgentSessionRegistry();
		await registry.record({
			childSessionPath: childPath,
			parentSessionPath: parentPath,
			correlationId: "child-123",
			source: "runtime",
		});
		await registry.flush();

		const disk = JSON.parse(readFileSync(join(userData, "subagent-session-links.json"), "utf8"));
		assert.equal(disk.version, 1);
		assert.equal(Object.keys(disk.links).length, 1);

		const restored = new SubAgentSessionRegistry();
		await restored.ensureLoaded();
		assert.equal(restored.get(childPath.toLowerCase())?.parentSessionPath, parentPath);

		restored.prune([childPath], ["C:\\Users\\dev\\.pi\\agent\\sessions"]);
		assert.equal(restored.get(childPath), undefined);
		await restored.flush();
	} finally {
		rmSync(userData, { recursive: true, force: true });
	}
});

test("persists records that arrive while an atomic save is in flight", async () => {
	const userData = mkdtempSync(join(tmpdir(), "pideck-subagent-registry-race-"));
	try {
		const fsPromises = require("node:fs/promises");
		let releaseWrite;
		let writeStarted;
		const writeStartedPromise = new Promise((resolve) => { writeStarted = resolve; });
		const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
		let delayed = false;
		const SubAgentSessionRegistry = loadRegistry(userData, {
			writeFile: async (...args) => {
				if (!delayed) {
					delayed = true;
					writeStarted();
					await writeGate;
				}
				return fsPromises.writeFile(...args);
			},
		});
		const registry = new SubAgentSessionRegistry();
		await registry.record({
			childSessionPath: "C:\\sessions\\parent\\one.jsonl",
			parentSessionPath: "C:\\sessions\\parent.jsonl",
			source: "runtime",
		});
		const firstFlush = registry.flush();
		await writeStartedPromise;
		await registry.record({
			childSessionPath: "C:\\sessions\\parent\\two.jsonl",
			parentSessionPath: "C:\\sessions\\parent.jsonl",
			source: "runtime",
		});
		releaseWrite();
		await firstFlush;
		await registry.flush();

		const restored = new SubAgentSessionRegistry();
		await restored.ensureLoaded();
		assert.equal(restored.get("C:\\sessions\\parent\\one.jsonl")?.parentSessionPath, "C:\\sessions\\parent.jsonl");
		assert.equal(restored.get("C:\\sessions\\parent\\two.jsonl")?.parentSessionPath, "C:\\sessions\\parent.jsonl");
	} finally {
		rmSync(userData, { recursive: true, force: true });
	}
});

test("prunes stale native POSIX links under a scanned local root", async () => {
	const userData = mkdtempSync(join(tmpdir(), "pideck-subagent-registry-posix-"));
	try {
		const SubAgentSessionRegistry = loadRegistry(userData);
		const registry = new SubAgentSessionRegistry();
		const childPath = "/home/dev/.pi/agent/sessions/project/parent/child.jsonl";
		const parentPath = "/home/dev/.pi/agent/sessions/project/parent.jsonl";
		await registry.record({
			childSessionPath: childPath,
			parentSessionPath: parentPath,
			source: "migration",
		});

		registry.prune([childPath], ["/home/dev/.pi/agent/sessions"]);
		assert.equal(registry.get(childPath), undefined);
	} finally {
		rmSync(userData, { recursive: true, force: true });
	}
});

test("does not prune links owned by a session root that was not scanned", async () => {
	const userData = mkdtempSync(join(tmpdir(), "pideck-subagent-registry-roots-"));
	try {
		const SubAgentSessionRegistry = loadRegistry(userData);
		const registry = new SubAgentSessionRegistry();
		const childPath = "D:\\other\\sessions\\parent\\child.jsonl";
		const parentPath = "D:\\other\\sessions\\parent.jsonl";
		await registry.record({
			childSessionPath: childPath,
			parentSessionPath: parentPath,
			source: "migration",
		});

		registry.prune([], ["C:\\current\\sessions"]);
		assert.equal(registry.get(childPath)?.parentSessionPath, parentPath);
	} finally {
		rmSync(userData, { recursive: true, force: true });
	}
});
