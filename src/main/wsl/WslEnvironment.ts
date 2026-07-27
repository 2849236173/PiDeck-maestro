import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWslEnvironment, type WslEnvironment } from "./WslPaths";

type ExecFile = typeof execFile;

type ResolveWslEnvironmentOptions = {
	execFile?: ExecFile;
	warn?: (message: string, details: Record<string, unknown>) => void;
	wslCommand?: string;
};

function resolveWslCommand(): string {
	if (process.platform !== "win32") return "wsl.exe";
	const systemRoot = process.env.SystemRoot || "C:\\Windows";
	const candidates = process.arch === "ia32"
		? [join(systemRoot, "Sysnative", "wsl.exe"), join(systemRoot, "System32", "wsl.exe")]
		: [join(systemRoot, "System32", "wsl.exe")];
	return candidates.find((candidate) => existsSync(candidate)) ?? "wsl.exe";
}

function fallbackHome(user: string): string {
	return user === "root" ? "/root" : `/home/${user}`;
}

export async function resolveWslEnvironment(
	distro: string,
	user: string,
	options: ResolveWslEnvironmentOptions = {},
): Promise<WslEnvironment> {
	const run = options.execFile ?? execFile;
	const command = options.wslCommand ?? resolveWslCommand();
	const resolved = await new Promise<{ linuxHome: string; linuxAgentDir?: string }>((resolve) => {
		run(
			command,
			["-d", distro, "-u", user, "--exec", "printenv", "HOME", "PI_CODING_AGENT_DIR"],
			{
				encoding: "utf8",
				timeout: 8_000,
				windowsHide: true,
			},
			(error, stdout) => {
				// printenv 在可选的 PI_CODING_AGENT_DIR 缺失时会返回非零，但仍会先输出 HOME。
				// 因此按输出内容判定，而不是仅依赖退出码。
				const lines = typeof stdout === "string"
					? stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
					: [];
				const linuxHome = lines[0];
				if (linuxHome?.startsWith("/")) {
					const linuxAgentDir = lines[1]?.startsWith("/") ? lines[1] : undefined;
					resolve({ linuxHome, linuxAgentDir });
					return;
				}
				const fallback = fallbackHome(user);
				options.warn?.("Failed to resolve WSL HOME; using the compatibility fallback.", {
					distro,
					user,
					fallback,
					error: error instanceof Error ? error.message : lines.join("\n") || "empty output",
				});
				resolve({ linuxHome: fallback });
			},
		);
	});

	return createWslEnvironment(distro, user, resolved.linuxHome, resolved.linuxAgentDir);
}
