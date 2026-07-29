import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	mkdtemp,
	mkdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

class SymlinkUnavailableError extends Error {}

function loadWslPathsModule() {
	const source = readFileSync("src/main/wsl/WslPaths.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const sandbox = { exports: {}, require };
	vm.runInNewContext(outputText, sandbox, { filename: "WslPaths.ts" });
	return sandbox.exports;
}

function loadSkillManagerModule(options = {}) {
	const resolvedWslPaths = options.wslPaths ?? loadWslPathsModule();
	const source = readFileSync("src/main/skills/SkillManager.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const sandbox = {
		exports: {},
		require: (id) => {
			if (id === "electron") return { shell: { openPath: async () => "" } };
			if (id === "node:fs") return { ...require(id), ...options.fsSyncOverrides };
			if (id === "node:fs/promises") return { ...require(id), ...options.fsOverrides };
			if (id === "node:path" && options.pathModule) return options.pathModule;
			if (id === "../wsl/WslPaths") return resolvedWslPaths;
			return require(id);
		},
	};
	sandbox.global = sandbox;
	vm.runInNewContext(outputText, sandbox, {
		filename: "SkillManager.ts",
	});
	return sandbox.exports;
}

async function createSkillFile(path, name, description = `${name} description`) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
		"utf8",
	);
}

async function createSkillRoot(home) {
	const globalSkills = join(home, ".pi", "agent", "skills");
	await mkdir(globalSkills, { recursive: true });
	return globalSkills;
}

async function createDirectoryLink(target, linkPath) {
	try {
		await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		if (["EACCES", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
			throw new SymlinkUnavailableError(error.message);
		}
		throw error;
	}
}

async function createFileLink(target, linkPath) {
	try {
		await symlink(target, linkPath, "file");
	} catch (error) {
		if (["EACCES", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
			throw new SymlinkUnavailableError(error.message);
		}
		throw error;
	}
}

async function withTemporaryHome(run) {
	const home = await mkdtemp(join(tmpdir(), "pideck-skill-manager-"));
	try {
		await run(home);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

function skipUnavailable(t, error) {
	if (error instanceof SymlinkUnavailableError) {
		t.skip(`软连接不可用：${error.message}`);
		return true;
	}
	return false;
}

test("discovers installed package Skills and protects them as read-only", async () => {
	await withTemporaryHome(async (home) => {
		const packageRoot = join(home, "packages", "pi-maestro-flow");
		const packageSkillPath = join(packageRoot, ".pi", "skills", "maestro-plan", "SKILL.md");
		await createSkillFile(packageSkillPath, "maestro-plan", "Plan with Maestro");
		await createSkillFile(
			join(home, ".pi", "agent", "skills", "user-skill", "SKILL.md"),
			"user-skill",
		);
		await createSkillFile(
			join(home, ".pi", "agent", "skills", "maestro-plan", "SKILL.md"),
			"maestro-plan",
			"User override",
		);

		const { SkillManager } = loadSkillManagerModule();
		const manager = new SkillManager(home, async () => [
			{ source: "npm:pi-maestro-flow", path: packageRoot },
		]);
		const result = await manager.list();
		const packageSkill = result.skills.find(
			(item) => item.name === "maestro-plan" && item.sourceId === "extension-packages",
		);
		const userSkill = result.skills.find((item) => item.name === "user-skill");

		assert.equal(result.skills.filter((item) => item.name === "maestro-plan").length, 2);
		assert.ok(packageSkill);
		assert.equal(packageSkill.path, packageSkillPath);
		assert.equal(packageSkill.sourceId, "extension-packages");
		assert.equal(packageSkill.sourceLabel, "pi-maestro-flow · .pi/skills");
		assert.equal(packageSkill.readOnly, true);
		assert.ok(userSkill);
		assert.equal(userSkill.readOnly, undefined);
		assert.equal(result.locations.some((location) => location.id === "extension-packages"), false);

		await assert.rejects(() => manager.toggle(packageSkill.path, false), /只读/);
		await assert.rejects(() => manager.delete(packageSkill.path), /只读/);
		await assert.rejects(() => manager.rename(packageSkill.path, "renamed"), /只读/);
	});
});

test("uses native POSIX package roots on Linux and macOS", async () => {
	const pathModule = require("node:path").posix;
	const packageRoot = "/opt/pi/packages/pi-maestro-flow";
	const skillsRoot = `${packageRoot}/.pi/skills`;
	const skillDir = `${skillsRoot}/maestro-execute`;
	const skillPath = `${skillDir}/SKILL.md`;
	const dirent = (name, kind) => ({
		name,
		isDirectory: () => kind === "directory",
		isFile: () => kind === "file",
		isSymbolicLink: () => false,
	});
	const requestedDirectories = [];
	const { SkillManager } = loadSkillManagerModule({
		pathModule,
		fsSyncOverrides: { existsSync: (path) => String(path) === skillPath },
		fsOverrides: {
			mkdir: async () => undefined,
			realpath: async (path) => String(path),
			readdir: async (path) => {
				const value = String(path);
				requestedDirectories.push(value);
				if (value === skillsRoot) return [dirent("maestro-execute", "directory")];
				return [];
			},
			readFile: async (path) => {
				assert.equal(String(path), skillPath);
				return "---\nname: maestro-execute\ndescription: Execute Maestro plans\n---\n";
			},
		},
	});
	const manager = new SkillManager("/home/dev", async () => [
		{ source: "npm:pi-maestro-flow", path: packageRoot },
	]);

	const result = await manager.list();

	assert.ok(requestedDirectories.includes(skillsRoot));
	assert.equal(result.skills.length, 1);
	assert.equal(result.skills[0].path, skillPath);
	assert.equal(result.skills[0].readOnly, true);
});

test("converts WSL package roots to host UNC paths before scanning", async () => {
	const wslPaths = loadWslPathsModule();
	const environment = wslPaths.createWslEnvironment("Ubuntu-24.04", "dev", "/home/dev");
	const packageRoot = "/home/dev/.pi/agent/npm/node_modules/pi-maestro-flow";
	const expectedRoot = "//wsl.localhost/Ubuntu-24.04/home/dev/.pi/agent/npm/node_modules/pi-maestro-flow/.pi/skills";
	const requestedDirectories = [];
	const { SkillManager } = loadSkillManagerModule({
		wslPaths,
		fsOverrides: {
			mkdir: async () => undefined,
			realpath: async () => { throw new Error("missing"); },
			readdir: async (path) => {
				requestedDirectories.push(String(path).replace(/\\/g, "/"));
				return [];
			},
		},
	});
	const manager = new SkillManager(undefined, async () => [
		{ source: "file:broken-relative-package", path: "relative/package" },
		{ source: "npm:pi-maestro-flow", path: packageRoot },
	]);
	manager.configureWsl(environment);

	await manager.list();

	assert.ok(requestedDirectories.includes(expectedRoot));
});

test("discovers a directory skill through a root-level symlink", async (t) => {
	await withTemporaryHome(async (home) => {
		const globalSkills = await createSkillRoot(home);
		const target = join(home, "linked", "directory-skill");
		const link = join(globalSkills, "directory-skill");
		await createSkillFile(join(target, "SKILL.md"), "directory-skill");

		try {
			await createDirectoryLink(target, link);
		} catch (error) {
			if (skipUnavailable(t, error)) return;
			throw error;
		}

		const { SkillManager } = loadSkillManagerModule();
		const result = await new SkillManager(home).list();
		const skill = result.skills.find((item) => item.path === join(link, "SKILL.md"));
		assert.ok(skill);
		assert.equal(skill.type, "directory");
		assert.equal(skill.name, "directory-skill");
	});
});

test("discovers a root markdown skill through a file symlink", async (t) => {
	await withTemporaryHome(async (home) => {
		const globalSkills = await createSkillRoot(home);
		const target = join(home, "linked", "root-skill.md");
		const link = join(globalSkills, "root-skill.md");
		await createSkillFile(target, "root-skill");

		try {
			await createFileLink(target, link);
		} catch (error) {
			if (skipUnavailable(t, error)) return;
			throw error;
		}

		const { SkillManager } = loadSkillManagerModule();
		const result = await new SkillManager(home).list();
		const skill = result.skills.find((item) => item.path === link);
		assert.ok(skill);
		assert.equal(skill.type, "markdown");
		assert.equal(skill.name, "root-skill");
	});
});

test("discovers a nested skill through a directory symlink", async (t) => {
	await withTemporaryHome(async (home) => {
		const globalSkills = await createSkillRoot(home);
		const parent = join(globalSkills, "collection");
		const target = join(home, "linked", "nested-skill");
		const link = join(parent, "nested-skill");
		await mkdir(parent, { recursive: true });
		await createSkillFile(join(target, "SKILL.md"), "nested-skill");

		try {
			await createDirectoryLink(target, link);
		} catch (error) {
			if (skipUnavailable(t, error)) return;
			throw error;
		}

		const { SkillManager } = loadSkillManagerModule();
		const result = await new SkillManager(home).list();
		const skill = result.skills.find((item) => item.path === join(link, "SKILL.md"));
		assert.ok(skill);
		assert.equal(skill.name, "nested-skill");
	});
});

test("does not recurse forever through a directory symlink cycle", async () => {
	await withTemporaryHome(async (home) => {
		const globalSkills = await createSkillRoot(home);
		const cycleRoot = join(globalSkills, "cycle");
		await createSkillFile(join(cycleRoot, "visible", "SKILL.md"), "visible-skill");
		try {
			await createDirectoryLink(cycleRoot, join(cycleRoot, "loop"));
		} catch (error) {
			if (skipUnavailable(t, error)) return;
			throw error;
		}

		const { SkillManager } = loadSkillManagerModule();
		const result = await Promise.race([
			new SkillManager(home).list(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("scan timed out")), 1000)),
		]);
		assert.ok(result.skills.some((item) => item.name === "visible-skill"));
	});
});
