import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function loadPiLocatorModule(platform = process.platform, envOverrides = {}) {
	const source = readFileSync("src/main/pi/PiLocator.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const sandbox = {
		Buffer,
		TextDecoder,
		exports: {},
		process: {
			...process,
			env: { ...process.env, ...envOverrides },
			platform,
		},
		require: (id) => {
			if (id === "electron") {
				return { app: { getPath: () => tmpdir() } };
			}
			return require(id);
		},
	};
	sandbox.global = sandbox;
	vm.runInNewContext(outputText, sandbox, {
		filename: "PiLocator.ts",
	});
	return sandbox.exports;
}

test("uses the pi shim bin directory as PATH prefix on macOS when node is beside the shim", () => {
	const root = join(tmpdir(), `pi-desktop-locator-${process.pid}-${Date.now()}`);
	const binDir = join(root, ".nvm", "versions", "node", "v22.22.1", "bin");
	mkdirSync(binDir, { recursive: true });
	const piPath = join(binDir, "pi");
	writeFileSync(piPath, "#!/usr/bin/env node\n", "utf8");
	writeFileSync(join(binDir, "node"), "", "utf8");

	try {
		const { PiLocator } = loadPiLocatorModule("darwin");
		const invocation = new PiLocator().createInvocation(piPath, ["--version"]);

		assert.equal(invocation.command, piPath);
		assert.deepEqual(invocation.args, ["--version"]);
		assert.equal(invocation.shell, false);
		assert.equal(invocation.pathPrefix, binDir);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("uses the pi cmd shim bin directory as PATH prefix on Windows when node.exe is beside the shim", () => {
	const root = join(tmpdir(), `pi-desktop-locator-win-${process.pid}-${Date.now()}`);
	const binDir = join(root, "nvm", "v22.22.1");
	mkdirSync(binDir, { recursive: true });
	const piPath = join(binDir, "pi.cmd");
	writeFileSync(piPath, "@echo off\r\nnode \"%~dp0\\node_modules\\pi\\bin.js\" %*\r\n", "utf8");
	writeFileSync(join(binDir, "node.exe"), "", "utf8");

	try {
		const { PiLocator } = loadPiLocatorModule("win32");
		const invocation = new PiLocator().createInvocation(piPath, ["--version"]);

		assert.match(invocation.command.toLowerCase(), /cmd\.exe$/);
		assert.equal(JSON.stringify(invocation.args.slice(0, 3)), JSON.stringify(["/d", "/s", "/c"]));
		assert.equal(invocation.shell, false);
		assert.equal(invocation.pathPrefix, binDir);
		assert.equal(invocation.windowsVerbatimArguments, true);
		assert.match(invocation.args[3], /^"".*pi\.cmd" --version"$/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("places an explicit WSL cwd before the pi command", () => {
	const { PiLocator } = loadPiLocatorModule("win32");
	const invocation = new PiLocator().createInvocation(
		"wsl://Ubuntu-24.04/root/pi",
		["--mode", "rpc"],
		{ wslCwd: "/root/ba cli" },
	);

	assert.deepEqual(
		Array.from(invocation.args),
		["-d", "Ubuntu-24.04", "-u", "root", "--cd", "/root/ba cli", "pi", "--mode", "rpc"],
	);
	assert.equal(invocation.wsl.distro, "Ubuntu-24.04");
});

test("adds a portable Git Bash bin directory discovered from PATH", () => {
	const root = join(tmpdir(), `pi-desktop-git-${process.pid}-${Date.now()}`);
	const gitCmdDir = join(root, "Git", "cmd");
	const gitBinDir = join(root, "Git", "bin");
	mkdirSync(gitCmdDir, { recursive: true });
	mkdirSync(gitBinDir, { recursive: true });
	writeFileSync(join(gitBinDir, "bash.exe"), "", "utf8");

	try {
		const { PiLocator } = loadPiLocatorModule("win32", {
			PATH: `${gitCmdDir};C:\\Windows\\System32`,
		});
		const env = new PiLocator().createProcessEnv();

		assert.match(env.PATH, new RegExp(gitBinDir.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("lists real bash candidates and excludes System32 WSL bash", async () => {
	const root = join(tmpdir(), `pi-desktop-shell-${process.pid}-${Date.now()}`);
	const gitBinDir = join(root, "Git", "bin");
	mkdirSync(gitBinDir, { recursive: true });
	writeFileSync(join(gitBinDir, "bash.exe"), "", "utf8");

	try {
		const { PiLocator, isLegacyWslShellPath } = loadPiLocatorModule("win32", {
			PATH: `${gitBinDir};C:\\Windows\\System32`,
		});
		const candidates = await new PiLocator().listAgentShellCandidates({ probeHealth: false });
		assert.ok(candidates.some((candidate) => candidate.path === join(gitBinDir, "bash.exe")));
		assert.equal(candidates.some((candidate) => isLegacyWslShellPath(candidate.path)), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("lists bash and sh candidates on Linux", async () => {
	const { PiLocator } = loadPiLocatorModule("linux");
	const candidates = await new PiLocator().listAgentShellCandidates({ probeHealth: false });
	const paths = new Set(candidates.map((candidate) => candidate.path));
	assert.equal(paths.has("/bin/bash"), true);
	assert.equal(paths.has("/bin/sh"), true);
});
