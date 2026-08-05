/**
 * 用户数据目录一次性迁移（PiDeck → PiDeck-maestro）。
 *
 * 背景：
 *   v0.6.6-15 将 Electron `appId` 从 `com.ayuayue.pi-desktop` 改为 `com.personal.pideck-maestro`，
 *   这会改变 Electron 派生的 userData 路径（macOS: `~/Library/Application Support/<appId>`，
 *   Windows: `%APPDATA%\<appId>`，Linux: `~/.config/<appId>`）。若不做迁移，旧用户的会话历史、
 *   设置、pet 配置、SQLite 缓存会全部"看不到"。
 *
 * 策略（B 一次性迁移）：
 *   - 仅当"旧目录存在且新目录不存在"时，原子地把旧目录改名为新目录。
 *   - 写一个 sentinel（`.migrated-from-appId.txt`）防止重复执行。
 *   - 冲突（两边都存在）则不动数据，只写日志 + 继续启动，让用户自己处理。
 *
 * 入口约束：
 *   - 必须在 `app.whenReady()` 之后调用（Electron 9+ 的派生在 ready 后才稳定）。
 *   - 必须早于 AppLogger / SettingsStore / ProjectStore 等任何依赖 userData 的服务实例化，
 *     否则它们会在新路径下新建空目录/空文件，导致后续 rename 失败。
 *   - 任何日志写入新 userData 都是安全的；如果迁移失败、仍走新路径，老数据保留在旧目录可手工恢复。
 *
 * 不依赖 AppLogger：本模块自身用 console.* 输出，避免循环依赖。
 */
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LEGACY_APP_IDS = ["com.ayuayue.pi-desktop", "pi-desktop", "PiDeck"] as const;
const NEW_APP_ID = "com.personal.pideck-maestro";
const SENTINEL_NAME = ".migrated-from-appId.txt";

/**
 * 在 `app.whenReady()` 之后第一时间调用一次（早于任何 userData 消费者）。
 *
 * @returns 迁移结果描述（用于日志 / IPC 状态）
 */
export function migrateUserDataOnce(): {
	executed: boolean;
	from?: string;
	to?: string;
	reason?: string;
} {
	let parent: string;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const electron = require("electron") as typeof import("electron");
		const newUserData = electron.app.getPath("userData");
		parent = dirname(newUserData);
	} catch (err) {
		console.warn("[migration] cannot resolve userData parent, skip", err);
		return { executed: false, reason: "no-userdata-parent" };
	}

	const newDir = join(parent, NEW_APP_ID);
	const sentinel = join(newDir, SENTINEL_NAME);

	// 已经迁移过：跳过
	if (existsSync(sentinel)) {
		return { executed: false, reason: "already-migrated" };
	}

	// 新目录存在但没有 sentinel → 视为已经是从其他路径升级上来的新用户，不迁移
	if (existsSync(newDir)) {
		return { executed: false, reason: "new-dir-exists" };
	}

	// 逐个尝试旧目录，第一个存在的就作为源
	let legacyDir: string | undefined;
	for (const legacyId of LEGACY_APP_IDS) {
		const candidate = join(parent, legacyId);
		if (existsSync(candidate)) {
			legacyDir = candidate;
			break;
		}
	}
	if (!legacyDir) {
		return { executed: false, reason: "no-legacy-dir" };
	}

	try {
		renameSync(legacyDir, newDir);
		writeFileSync(
			sentinel,
			`migrated-from=${legacyDir}\nmigrated-at=${new Date().toISOString()}\nmigrated-by=PiDeck-maestro v0.6.6.15\n`,
			"utf8",
		);
		console.log(`[migration] userData renamed: ${legacyDir} -> ${newDir}`);
		return { executed: true, from: legacyDir, to: newDir };
	} catch (err) {
		console.error(`[migration] failed to rename ${legacyDir} -> ${newDir}`, err);
		return { executed: false, reason: "rename-failed" };
	}
}
