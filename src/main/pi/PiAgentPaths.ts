import { homedir } from "node:os";
import { join } from "node:path";
import type { WslEnvironment } from "../wsl/WslPaths";

/**
 * 与原生 pi 的 getAgentDir() 保持一致：优先 PI_CODING_AGENT_DIR，
 * 未设置时回退到 ~/.pi/agent，并兼容环境变量中的 ~ 前缀。
 */
export function resolveLocalPiAgentDir(
	environment: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): string {
	const configured = environment.PI_CODING_AGENT_DIR;
	if (!configured) return join(home, ".pi", "agent");
	if (configured === "~") return home;
	if (configured.startsWith("~/") || configured.startsWith("~\\")) {
		return join(home, configured.slice(2));
	}
	return configured;
}

/** 返回当前 PiDeck 运行模式下与原生 pi 一致的配置根目录。 */
export function resolvePiAgentDir(wslEnvironment: WslEnvironment | null): string {
	return wslEnvironment?.windowsAgentDir ?? resolveLocalPiAgentDir();
}
