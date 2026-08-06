/**
 * 一次性用户数据迁移器：当 Electron appId / productName 改名后，app.getPath("userData") 会指向新目录，
 * 老数据被遗留在旧目录。本工具在 main 启动早期扫描候补的旧 userData 目录，把"抽屉配置"等关键
 * 业务文件搬过来，让用户在升级后立刻看到以前的抽屉 / pet / sandbox / sdk / 会话缓存。
 *
 * 设计要点：
 * - 只在标记文件 userdata.migrated 不存在时执行，写完即落盘，下次启动跳过
 * - 候补目录按"从近到远"排序：当前 productName 的所有历史拼写 → appId 拼接 → 上游 PiDeck 历史名
 * - 单文件粒度复制，遇同名目标已存在 → 跳过新数据，保留已有的（不强制覆盖，避免吞掉新版本正在用的数据）
 * - chat-workspace 子树做合并（非覆盖），以保留用户在 chat 抽屉里累积的本地文件
 * - 整个过程 console 输出 [PiDeck][migrate] 前缀，方便用户在终端日志里追踪
 */

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";

/**
 * 单个候选源目录的"业务文件 / 子目录"清单。注意：聊天/缓存/LevelDB/GPUCache 这些 Chromium
 * 自动管理的目录不要列进来；它们产品名换了之后会重新生成，老数据没意义还会冲突。
 */
const MIGRATABLE_FILES: string[] = [
    "pet-position.json",
    "pi-desktop.json",
    "pi-desktop-index.db",
];

/**
 * 这些文件即使在目标目录里已存在也要覆盖：从旧 appId 升级时，目标目录里"新版本"通常只有初始化的
 * 空白内容（projects.json 只有 2 个默认抽屉，session-summary-cache 还是空），而旧目录里是用户
 * 已经积累的真实数据。备份新版本到 migration-backup/<file>.new 供回滚。
 */
const OVERWRITE_FOR_MIGRATION_FILES: string[] = [
    "projects.json",
    "settings.json",
    "session-summary-cache.json",
    "subagent-session-links.json",
];

const MIGRATABLE_DIRS: string[] = [
    "Partitions",
    "sandbox-workspaces",
    "sdk",
    "preload",
];

const MIGRATABLE_CHAT_DIRS: string[] = [
    "chat-workspace",
];

/**
 * 候选的"脏"userData 目录名列表（按"由旧到新"排序）。
 * 这些都是历史上因为 productName / name 改拼写，导致 Electron 的 app.getPath("userData")
 * 指向的目录 —— 老用户数据被遗留在那里。迁移器按这个顺序逐个合并：第一个候选的
 * 关键业务文件（如 projects.json）做"强制覆盖"，后续候选做"键集合并"。
 *
 * 目标目录固定是 %APPDATA%\PiDeck\，由 index.ts 用 app.setPath 钉死，所以 "PiDeck" 本身
 * 不在候选列表里（它是目标不是源，否则会形成自环）。
 *
 * Windows 下 userData 位于 %APPDATA%\<dirName>\，按名字在父目录里匹配即可。
 */
const CANDIDATE_DIR_NAMES: string[] = [
	// v0.6.6-15 之前的 productName（用户最老的真实数据，"主源"，projects.json 强制覆盖）
	"pi-desktop",
	// v0.6.6-15 ~ v0.6.6-19 由 package.json.name "pideck-maestro" 实际生成的用户目录
	// （Electron 在 Windows 下用 app.getName() 拼 userData；包名会成为目录名。
	//  这是 v0.6.6-19 用户系统里真实存在的"次源"，projects.json 走合并、不覆盖主源）
	"pideck-maestro",
	// 防御性候选：上游历史 / 早期 appId / 错误的 productName 拼写
	"pi-deck",
	"Ayuayue PiDeck",
	"PiDeck-maestro",
];

interface MigrationReport {
    startedAt: number;
    finishedAt: number;
    sourceDir: string | null;
    targetDir: string;
    copiedFiles: string[];
    copiedDirs: string[];
    skippedTargets: string[];
    notes: string[];
}

function fmtSize(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function safeStat(p: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
        const s = await stat(p);
        return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
        return null;
    }
}

async function copyFileIfMissing(src: string, dst: string): Promise<"copied" | "skipped-existing" | "absent"> {
    const s = await safeStat(src);
    if (!s) return "absent";
    if (existsSync(dst)) return "skipped-existing";
    // mkdir -p parent
    await mkdir(resolve(dst, ".."), { recursive: true });
    await copyFile(src, dst);
    return "copied";
}

async function copyDirMerging(src: string, dst: string): Promise<{ copied: number; skipped: number }> {
    const result = { copied: 0, skipped: 0 };
    if (!existsSync(src)) return result;
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const ent of entries) {
        const s = join(src, ent.name);
        const d = join(dst, ent.name);
        if (ent.isDirectory()) {
            const sub = await copyDirMerging(s, d);
            result.copied += sub.copied;
            result.skipped += sub.skipped;
        } else if (ent.isFile()) {
            const r = await copyFileIfMissing(s, d);
            if (r === "copied") result.copied += 1;
            else if (r === "skipped-existing") result.skipped += 1;
        }
    }
    return result;
}

async function listChildDirs(parent: string): Promise<string[]> {
    if (!existsSync(parent)) return [];
    const out: string[] = [];
    for (const ent of await readdir(parent, { withFileTypes: true })) {
        if (ent.isDirectory()) out.push(join(parent, ent.name));
    }
    return out;
}

/**
 * 把单个候选源目录里的业务数据搬入目标目录。
 * - forceOverwriteCritical=true: 关键业务文件（projects.json 等）做"强制覆盖"，适用主源
 * - forceOverwriteCritical=false: 同名单文件已存在则跳过（避免后续源吞掉主源数据）
 */
async function mergeOneSource(
    source: { path: string; name: string },
    targetDir: string,
    report: MigrationReport,
    options: { forceOverwriteCritical: boolean },
): Promise<void> {
    const sourceTag = `[${source.name}]`;
    console.log(`[PiDeck][migrate] merging ${sourceTag} ${source.path} → ${targetDir} (overwriteCritical=${options.forceOverwriteCritical})`);

    for (const name of MIGRATABLE_FILES) {
        const r = await copyFileIfMissing(join(source.path, name), join(targetDir, name));
        if (r === "copied") report.copiedFiles.push(`${sourceTag} ${name}`);
        else if (r === "skipped-existing") report.skippedTargets.push(`${sourceTag} ${name}`);
    }

    for (const name of OVERWRITE_FOR_MIGRATION_FILES) {
        const src = join(source.path, name);
        const s = await safeStat(src);
        if (!s) continue;
        const dst = join(targetDir, name);
        if (existsSync(dst) && !options.forceOverwriteCritical) {
            report.skippedTargets.push(`${sourceTag} ${name} (target exists, not overwriting)`);
            continue;
        }
        try {
            // 主源覆盖前，把当前目标里的"新版本"（往往是空模板）备份到 migration-backup/，便于回滚
            const backupDir = process.env.PIDECK_MIGRATION_BACKUP_DIR ?? join(targetDir, "migration-backup");
            await mkdir(backupDir, { recursive: true });
            if (existsSync(dst)) {
                await copyFile(dst, join(backupDir, `${name}.new`)).catch(() => undefined);
            }
            await copyFile(src, dst);
            report.copiedFiles.push(`${sourceTag} ${name} (overwrite)`);
        } catch (err) {
            report.notes.push(`Failed to overwrite ${name}: ${(err as Error).message}`);
        }
    }

    for (const name of MIGRATABLE_DIRS) {
        const src = join(source.path, name);
        if (!existsSync(src)) continue;
        const dst = join(targetDir, name);
        await mkdir(resolve(dst, ".."), { recursive: true });
        const r = await copyDirMerging(src, dst);
        if (r.copied > 0) {
            report.copiedDirs.push(`${sourceTag} ${name}/ (+${r.copied} entries, skipped=${r.skipped})`);
        }
    }

    for (const name of MIGRATABLE_CHAT_DIRS) {
        const src = join(source.path, name);
        if (!existsSync(src)) continue;
        const dst = join(targetDir, name);
        await mkdir(resolve(dst, ".."), { recursive: true });
        const r = await copyDirMerging(src, dst);
        if (r.copied > 0) {
            report.copiedDirs.push(`${sourceTag} ${name}/ (merged +${r.copied} entries, skipped=${r.skipped})`);
        }
    }
}

/**
 * 扫描所有候选脏目录，按候选列表顺序依次返回。迁移器会对每个源都跑一遍合并
 * （第一个做强制覆盖，后续的走合并），所以多个历史脏目录不会被吞掉。
 */
async function pickSourceDirs(): Promise<Array<{ path: string; name: string }>> {
    const currentUserData = app.getPath("userData");
    const roamingRoot = resolve(currentUserData, "..");
    const currentName = currentUserData.split(/[\\/]/).pop()!;
    const candidates = await listChildDirs(roamingRoot);
    const seen = new Set<string>([currentName]);
    const hits: Array<{ path: string; name: string }> = [];

    for (const name of CANDIDATE_DIR_NAMES) {
        if (seen.has(name)) continue;
        const hit = candidates.find((p) => p.endsWith(name));
        if (!hit) continue;
        const sample = await safeStat(join(hit, "projects.json"));
        if (sample && sample.size > 0) {
            seen.add(name);
            hits.push({ path: hit, name });
        }
    }
    return hits;
}

/** 主入口。幂等：以 userdata.migrated 哨兵文件防止重复。 */
export async function runUserDataMigrationIfNeeded(): Promise<MigrationReport | null> {
    const startedAt = Date.now();
    const targetDir = app.getPath("userData");
    const sentinel = join(targetDir, "userdata.migrated");

    if (existsSync(sentinel)) {
        return null;
    }

    await mkdir(targetDir, { recursive: true });

    const sources = await pickSourceDirs();
    const report: MigrationReport = {
        startedAt,
        finishedAt: 0,
        sourceDir: null,
        targetDir,
        copiedFiles: [],
        copiedDirs: [],
        skippedTargets: [],
        notes: [],
    };

    if (sources.length === 0) {
        report.notes.push("No legacy userData directory found in known candidates.");
        report.finishedAt = Date.now();
        await writeFile(sentinel, JSON.stringify(report, null, 2), "utf8");
        return report;
    }

    console.log(`[PiDeck][migrate] legacy userData directories detected: ${sources.length}`);
    for (const s of sources) {
        console.log(`[PiDeck][migrate]   - ${s.path} (matched by name "${s.name}")`);
    }
    console.log(`[PiDeck][migrate] target: ${targetDir}`);
    // 第一个源作为权威主源（用户最老的真实数据），记录到 sourceDir 便于回溯
    report.sourceDir = sources[0].path;

    // 第一个源：projects.json / settings.json 等关键文件"强制覆盖"（用户真实数据优先）
    // 后续源：同名单文件已存在则跳过，目录做合并写回
    await mergeOneSource(sources[0], targetDir, report, { forceOverwriteCritical: true });
    for (let i = 1; i < sources.length; i++) {
        await mergeOneSource(sources[i], targetDir, report, { forceOverwriteCritical: false });
    }

    report.finishedAt = Date.now();

    console.log(`[PiDeck][migrate] done in ${report.finishedAt - report.startedAt}ms`);
    console.log(`[PiDeck][migrate] files copied: ${report.copiedFiles.length || 0} → ${report.copiedFiles.join(", ") || "(none)"}`);
    console.log(`[PiDeck][migrate] dirs copied:  ${report.copiedDirs.length || 0} → ${report.copiedDirs.join(" | ") || "(none)"}`);
    if (report.skippedTargets.length) {
        console.log(`[PiDeck][migrate] skipped (target already exists): ${report.skippedTargets.join(", ")}`);
    }

    await writeFile(sentinel, JSON.stringify(report, null, 2), "utf8");
    return report;
}
