import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { normalize, join, dirname, isAbsolute, resolve } from "node:path";
import { dirname as posixDirname, normalize as posixNormalize } from "node:path/posix";
import { homedir } from "node:os";
import { net } from "electron";
import { TEAMMATE_MODEL_TASK_TYPES } from "../../shared/types";
import type {
	ConfigFileDiagnostic,
	ConfigFileReadResult,
	CompactionConfigPatch,
	CompactionConfigSaveRequest,
	CompactionConfigSnapshot,
	CompactionConfigSource,
	HookTrustFile,
	HooksConfigFile,
	HooksConfigSaveRequest,
	HooksConfigSnapshot,
	SkillConfigFile,
	SkillConfigSaveRequest,
	SkillConfigSnapshot,
	SkillConfigSource,
	WebSearchConfigSaveRequest,
	WebSearchConfigSnapshot,
	SmartSearchConfigSnapshot,
	McpConfigFile,
	McpConfigScope,
	McpConfigSaveRequest,
	McpConfigSnapshot,
	McpConfigSource,
	McpManagedServer,
	McpServerEntry,
	ModelFailoverConfig,
	ModelFailoverConfigSaveRequest,
	ModelFailoverConfigSnapshot,
	ModelFailoverConfigSource,
	TeammateModelConfigSaveRequest,
	TeammateModelConfigSnapshot,
	TeammateModelConfigSource,
	TeammateModelRoutingFile,
	TeammateModelTaskType,
} from "../../shared/types";
import {
	ensureOpenAiVersionPath,
	needsSessionBaseUrlVersionHint,
	suggestNormalizedBaseUrl,
} from "./baseUrlPath";
import { toWindowsHostPath, type WslEnvironment } from "../wsl/WslPaths";

/** pi 全局配置目录：~/.pi/agent/ */
const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const TEAMMATE_MODELS_FILE = "teammate-models.json";
const MCP_CONFIG_FILE = "mcp.json";
const MODEL_FAILOVER_CONFIG_FILE = "model-failover.json";
const SKILL_CONFIG_FILE = "skill-config.json";
const GENERIC_MCP_CONFIG_PATH = join(homedir(), ".config", "mcp", "mcp.json");
const DEFAULT_MCP_CONFIG: McpConfigFile = { mcpServers: {} };
const MCP_IMPORT_KINDS = ["cursor", "claude-code", "claude-desktop", "codex", "windsurf", "vscode"];
const CODEX_HOOK_EVENTS = [
	"SessionStart",
	"SubagentStart",
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"PreCompact",
	"PostCompact",
	"UserPromptSubmit",
	"SubagentStop",
	"Stop",
] as const;
const MCP_IMPORT_PATHS: Record<string, string[]> = {
	cursor: [join(homedir(), ".cursor", "mcp.json")],
	"claude-code": [
		join(homedir(), ".claude", "mcp.json"),
		join(homedir(), ".claude.json"),
		join(homedir(), ".claude", "claude_desktop_config.json"),
	],
	"claude-desktop": [join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
	codex: [join(homedir(), ".codex", "config.json")],
	windsurf: [join(homedir(), ".windsurf", "mcp.json")],
	vscode: [".vscode/mcp.json"],
};
const DEFAULT_COMPACTION_CONFIG: Required<Pick<CompactionConfigPatch, "enabled" | "reserveTokens" | "keepRecentTokens">> & { soft: { enabled: boolean } } = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
	soft: { enabled: true },
};

// ── models.json 结构 ──────────────────────────────────
// { providers: { [providerName]: { baseUrl, api, apiKey, models: [...] } } }

// Provider 连接测试面对的是第三方网关和 reasoning 模型，首包可能慢于普通模型；
// 放宽超时并在错误文案中说明“超时不等于兼容模式不支持”，避免误导用户改错配置。
const PROVIDER_TEST_TIMEOUT_MS = 45_000;
const PROVIDER_TEST_TIMEOUT_SECONDS = PROVIDER_TEST_TIMEOUT_MS / 1000;

export type PiModelItem = {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	[key: string]: unknown;
};

export type PiProviderConfig = {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	models: PiModelItem[];
	[key: string]: unknown;
};

export type PiModelsFile = {
	providers: Record<string, PiProviderConfig>;
};

// ── auth.json 结构 ────────────────────────────────────
// { [providerName]: { type: "api_key", key: "..." } }

export type PiAuthItem = {
	type?: string;
	key?: string;
	[key: string]: unknown;
};

export type PiAuthFile = Record<string, PiAuthItem>;

// ── settings.json ─────────────────────────────────────

export type PiSettings = Record<string, unknown>;

export type ConfigValidationResult = {
	valid: boolean;
	error?: string;
};

type TestRequest = {
	url: string;
	headers: Record<string, string>;
	body?: string;
	method?: "GET" | "POST";
};

/**
 * 管理 pi 全局配置文件（~/.pi/agent/ 下的 models.json、auth.json、settings.json）。
 * 按照 pi 实际文件格式解析：models.json 是嵌套 providers 结构，auth.json 是对象映射。
 */
export class ConfigManager {
	private configDir: string;
	private wslEnvironment: WslEnvironment | null = null;

	constructor(configDir?: string) {
		this.configDir = configDir ?? PI_AGENT_DIR;
	}

	/** 将配置目录切换到统一解析出的 WSL HOME；null 恢复 Windows home。 */
	configureWsl(environment: WslEnvironment | null) {
		this.wslEnvironment = environment;
		this.configDir = environment
			? join(environment.windowsHome, ".pi", "agent")
			: PI_AGENT_DIR;
	}

	// ── Teammate 模型路由 ─────────────────────────────────

	private resolveTeammateModelsPath(scope: "global" | "workspace", workspacePath?: string) {
		if (scope === "global") return join(this.configDir, TEAMMATE_MODELS_FILE);
		if (!workspacePath?.trim()) {
			throw new Error("Workspace path is required for project teammate model configuration");
		}
		const resolvedWorkspace = this.wslEnvironment
			? toWindowsHostPath(workspacePath, this.wslEnvironment)
			: workspacePath;
		if (!isAbsolute(resolvedWorkspace)) {
			throw new Error("Workspace path must be absolute");
		}
		return join(resolvedWorkspace, ".pi", TEAMMATE_MODELS_FILE);
	}

	private async readTeammateModelSource(
		scope: "global" | "workspace",
		workspacePath?: string,
	): Promise<TeammateModelConfigSource> {
		const filePath = this.resolveTeammateModelsPath(scope, workspacePath);
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				const value = JSON.parse(raw) as unknown;
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					throw new Error(`${TEAMMATE_MODELS_FILE} 的根节点必须是对象`);
				}
				const parsed = value as TeammateModelRoutingFile;
				if (parsed.global !== undefined && parsed.global !== null && typeof parsed.global !== "string") {
					throw new Error(`${TEAMMATE_MODELS_FILE} 的 global 字段必须是字符串或 null`);
				}
				for (const field of ["mappings", "thinkingLevels"] as const) {
					const candidate = parsed[field];
					if (candidate !== undefined && (!candidate || typeof candidate !== "object" || Array.isArray(candidate))) {
						throw new Error(`${TEAMMATE_MODELS_FILE} 的 ${field} 字段必须是对象`);
					}
				}
				for (const taskType of TEAMMATE_MODEL_TASK_TYPES) {
					const model = parsed.mappings?.[taskType];
					if (model !== undefined && model !== null && typeof model !== "string") {
						throw new Error(`${TEAMMATE_MODELS_FILE} 的 mappings.${taskType} 必须是字符串或 null`);
					}
				}
				return { scope, path: filePath, exists: true, raw, parsed };
			} catch (error) {
				return {
					scope,
					path: filePath,
					exists: true,
					raw,
					parsed: {},
					diagnostic: this.createJsonDiagnostic(TEAMMATE_MODELS_FILE, raw, error),
				};
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { scope, path: filePath, exists: false, raw: "", parsed: {} };
			}
			return {
				scope,
				path: filePath,
				exists: false,
				raw: "",
				parsed: {},
				diagnostic: this.createJsonDiagnostic(TEAMMATE_MODELS_FILE, "", error),
			};
		}
	}

	/** Project mappings override global mappings one task type at a time. */
	private mergeTeammateModelSources(
		globalConfig: TeammateModelRoutingFile,
		workspaceConfig?: TeammateModelRoutingFile,
	): TeammateModelRoutingFile {
		const mappings: Partial<Record<TeammateModelTaskType, string | null>> = {};
		for (const taskType of TEAMMATE_MODEL_TASK_TYPES) {
			let value = Object.hasOwn(globalConfig.mappings ?? {}, taskType)
				? globalConfig.mappings?.[taskType]
				: globalConfig.global;
			if (workspaceConfig) {
				if (Object.hasOwn(workspaceConfig.mappings ?? {}, taskType)) {
					value = workspaceConfig.mappings?.[taskType];
				} else if (workspaceConfig.global !== undefined) {
					value = workspaceConfig.global;
				}
			}
			if (value !== undefined) mappings[taskType] = value;
		}
		return {
			...globalConfig,
			...workspaceConfig,
			version: workspaceConfig?.version ?? globalConfig.version ?? 2,
			global: workspaceConfig?.global !== undefined
				? workspaceConfig.global
				: globalConfig.global,
			mappings,
			thinkingLevels: {
				...globalConfig.thinkingLevels,
				...workspaceConfig?.thinkingLevels,
			},
		};
	}

	private mergeTeammateModelUpdate(
		existing: TeammateModelRoutingFile,
		update: TeammateModelRoutingFile,
	): TeammateModelRoutingFile {
		return {
			...existing,
			...update,
			version: update.version ?? existing.version ?? 2,
			mappings: { ...existing.mappings, ...update.mappings },
			thinkingLevels: { ...existing.thinkingLevels, ...update.thinkingLevels },
		};
	}

	async getTeammateModelRoutingConfig(
		workspacePath?: string,
	): Promise<TeammateModelConfigSnapshot> {
		const global = await this.readTeammateModelSource("global");
		const workspace = workspacePath
			? await this.readTeammateModelSource("workspace", workspacePath)
			: undefined;
		return {
			global,
			workspace,
			effective: this.mergeTeammateModelSources(
				global.diagnostic ? {} : global.parsed,
				workspace?.diagnostic ? undefined : workspace?.parsed,
			),
		};
	}

	async saveTeammateModelRoutingConfig(
		request: TeammateModelConfigSaveRequest,
	): Promise<ConfigValidationResult> {
		if (
			!request ||
			typeof request !== "object" ||
			!request.config ||
			typeof request.config !== "object" ||
			Array.isArray(request.config) ||
			(request.scope !== "global" && request.scope !== "workspace")
		) {
			return { valid: false, error: "Teammate 模型路由保存请求无效" };
		}
		try {
			const source = await this.readTeammateModelSource(request.scope, request.workspacePath);
			if (source.diagnostic) {
				return {
					valid: false,
					error: `无法保存：${source.path} 当前无法安全解析，请先修复原文件。`,
				};
			}
			const merged = this.mergeTeammateModelUpdate(source.parsed, request.config);
			if (request.removeGlobal) delete merged.global;
			for (const taskType of request.removeMappings ?? []) {
				delete merged.mappings?.[taskType];
			}
			await this.writeJsonFileRaw(source.path, merged);
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private resolveCompactionSettingsPath(scope: "global" | "workspace", workspacePath?: string) {
		if (scope === "global") return join(this.configDir, "settings.json");
		if (!workspacePath?.trim()) {
			throw new Error("Workspace path is required for project compaction configuration");
		}
		const resolvedWorkspace = this.wslEnvironment
			? toWindowsHostPath(workspacePath, this.wslEnvironment)
			: workspacePath;
		if (!isAbsolute(resolvedWorkspace)) throw new Error("Workspace path must be absolute");
		return join(resolvedWorkspace, ".pi", "settings.json");
	}

	private normalizeCompactionConfig(value: unknown): CompactionConfigPatch {
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		const data = value as Record<string, unknown>;
		const hard = data.hard && typeof data.hard === "object" && !Array.isArray(data.hard)
			? data.hard as Record<string, unknown>
			: {};
		const soft = data.soft && typeof data.soft === "object" && !Array.isArray(data.soft)
			? data.soft as Record<string, unknown>
			: {};
		const patch: CompactionConfigPatch = {};
		if (typeof data.enabled === "boolean") patch.enabled = data.enabled;
		const reserveTokens = this.pickPositiveInteger(data.reserveTokens, hard.reserveTokens);
		if (reserveTokens !== undefined) patch.reserveTokens = reserveTokens;
		const keepRecentTokens = this.pickPositiveInteger(data.keepRecentTokens, hard.keepRecentTokens);
		if (keepRecentTokens !== undefined) patch.keepRecentTokens = keepRecentTokens;
		if (typeof data.model === "string" && data.model.trim()) patch.model = data.model.trim();
		if (typeof soft.enabled === "boolean") patch.soft = { enabled: soft.enabled };
		return patch;
	}

	private pickPositiveInteger(...values: unknown[]) {
		for (const value of values) {
			if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
		}
		return undefined;
	}

	private mergeCompactionConfig(base: CompactionConfigPatch, patch: CompactionConfigPatch): CompactionConfigPatch {
		const merged: CompactionConfigPatch = { ...base };
		if (typeof patch.enabled === "boolean") merged.enabled = patch.enabled;
		if (typeof patch.reserveTokens === "number") merged.reserveTokens = Math.floor(patch.reserveTokens);
		if (typeof patch.keepRecentTokens === "number") merged.keepRecentTokens = Math.floor(patch.keepRecentTokens);
		if (typeof patch.model === "string") {
			const model = patch.model.trim();
			if (model) merged.model = model;
			else delete merged.model;
		}
		if (patch.soft && typeof patch.soft.enabled === "boolean") {
			merged.soft = { ...(merged.soft ?? {}), enabled: patch.soft.enabled };
		}
		return merged;
	}

	private async readCompactionSource(
		scope: "global" | "workspace",
		workspacePath?: string,
	): Promise<CompactionConfigSource> {
		const filePath = this.resolveCompactionSettingsPath(scope, workspacePath);
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				const value = JSON.parse(raw) as unknown;
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					throw new Error("settings.json 的根节点必须是对象");
				}
				const settings = value as Record<string, unknown>;
				return { scope, path: filePath, exists: true, raw, parsed: this.normalizeCompactionConfig(settings.compaction) };
			} catch (error) {
				return {
					scope,
					path: filePath,
					exists: true,
					raw,
					parsed: {},
					diagnostic: this.createJsonDiagnostic("settings.json", raw, error),
				};
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { scope, path: filePath, exists: false, raw: "", parsed: {} };
			}
			return {
				scope,
				path: filePath,
				exists: false,
				raw: "",
				parsed: {},
				diagnostic: this.createJsonDiagnostic("settings.json", "", error),
			};
		}
	}

	async getCompactionConfig(workspacePath?: string): Promise<CompactionConfigSnapshot> {
		const [global, workspace] = await Promise.all([
			this.readCompactionSource("global"),
			workspacePath ? this.readCompactionSource("workspace", workspacePath) : Promise.resolve(undefined),
		]);
		return {
			global,
			...(workspace ? { workspace } : {}),
			effective: this.mergeCompactionConfig(
				DEFAULT_COMPACTION_CONFIG,
				this.mergeCompactionConfig(global.parsed, workspace?.parsed ?? {}),
			),
		};
	}

	async saveCompactionConfig(request: CompactionConfigSaveRequest): Promise<ConfigValidationResult> {
		if (!request || (request.scope !== "global" && request.scope !== "workspace")) {
			return { valid: false, error: "压缩配置保存请求无效" };
		}
		const config = this.normalizeCompactionConfig(request.config);
		if (config.reserveTokens !== undefined && config.reserveTokens < 1024) {
			return { valid: false, error: "预留输出空间不能小于 1024" };
		}
		if (config.keepRecentTokens !== undefined && config.keepRecentTokens < 1024) {
			return { valid: false, error: "保留最近上下文不能小于 1024" };
		}
		try {
			const source = await this.readCompactionSource(request.scope, request.workspacePath);
			if (source.diagnostic) {
				return { valid: false, error: `无法保存：${source.path} 当前无法安全解析，请先修复原文件。` };
			}
			let settings: Record<string, unknown> = {};
			if (source.raw.trim()) settings = JSON.parse(source.raw) as Record<string, unknown>;
			const existingCompaction = settings.compaction && typeof settings.compaction === "object" && !Array.isArray(settings.compaction)
				? settings.compaction as Record<string, unknown>
				: {};
			const existingSoft = existingCompaction.soft && typeof existingCompaction.soft === "object" && !Array.isArray(existingCompaction.soft)
				? existingCompaction.soft as Record<string, unknown>
				: {};
			settings.compaction = {
				...existingCompaction,
				enabled: config.enabled ?? DEFAULT_COMPACTION_CONFIG.enabled,
				reserveTokens: config.reserveTokens ?? DEFAULT_COMPACTION_CONFIG.reserveTokens,
				keepRecentTokens: config.keepRecentTokens ?? DEFAULT_COMPACTION_CONFIG.keepRecentTokens,
				...(config.model ? { model: config.model } : {}),
				...(!config.model ? { model: undefined } : {}),
				soft: {
					...existingSoft,
					enabled: config.soft?.enabled ?? DEFAULT_COMPACTION_CONFIG.soft.enabled,
				},
			};
			await this.writeJsonFileRaw(source.path, settings);
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	// ── MCP 配置管理 ───────────────────────────────────────

	private resolveWorkspacePath(workspacePath?: string) {
		if (!workspacePath?.trim()) return undefined;
		const resolvedWorkspace = this.wslEnvironment
			? toWindowsHostPath(workspacePath, this.wslEnvironment)
			: workspacePath;
		if (!isAbsolute(resolvedWorkspace)) {
			throw new Error("Workspace path must be absolute");
		}
		return resolvedWorkspace;
	}

	private resolveMcpProjectPath(workspacePath?: string) {
		const resolvedWorkspace = this.resolveWorkspacePath(workspacePath);
		return resolvedWorkspace ? join(resolvedWorkspace, ".mcp.json") : undefined;
	}

	private resolvePiMcpProjectPath(workspacePath?: string) {
		const resolvedWorkspace = this.resolveWorkspacePath(workspacePath);
		return resolvedWorkspace ? join(resolvedWorkspace, ".pi", MCP_CONFIG_FILE) : undefined;
	}

	private normalizeMcpConfig(raw: unknown): McpConfigFile {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_MCP_CONFIG };
		const value = raw as Record<string, unknown>;
		const servers = value.mcpServers ?? value["mcp-servers"] ?? {};
		return {
			...value,
			mcpServers: servers && typeof servers === "object" && !Array.isArray(servers)
				? servers as Record<string, McpServerEntry>
				: {},
			imports: Array.isArray(value.imports)
				? value.imports.filter((item): item is string => typeof item === "string")
				: undefined,
			settings: value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
				? value.settings as Record<string, unknown>
				: undefined,
		};
	}

	private validateMcpConfigDocument(raw: unknown): Record<string, unknown> {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error("配置必须是 JSON 对象");
		}
		const config = raw as Record<string, unknown>;
		const servers = config.mcpServers ?? config["mcp-servers"];
		if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
			throw new Error("配置必须包含对象形式的 mcpServers");
		}
		return config;
	}

	private async readMcpSource(
		source: Omit<McpConfigSource, "raw" | "parsed" | "diagnostic" | "exists" | "serverCount">,
	): Promise<McpConfigSource> {
		try {
			const raw = await readFile(source.path, "utf8");
			try {
				const parsed = this.normalizeMcpConfig(JSON.parse(raw));
				return { ...source, exists: true, raw, parsed, serverCount: Object.keys(parsed.mcpServers).length };
			} catch (error) {
				return {
					...source,
					exists: true,
					raw,
					parsed: { ...DEFAULT_MCP_CONFIG },
					serverCount: 0,
					diagnostic: this.createJsonDiagnostic(MCP_CONFIG_FILE, raw, error),
				};
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				return {
					...source,
					exists: false,
					raw: JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
					parsed: { ...DEFAULT_MCP_CONFIG },
					serverCount: 0,
					diagnostic: this.createJsonDiagnostic(MCP_CONFIG_FILE, "", error),
				};
			}
			return {
				...source,
				exists: false,
				raw: JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
				parsed: { ...DEFAULT_MCP_CONFIG },
				serverCount: 0,
			};
		}
	}

	private mergeMcpServerMaps(
		base: Record<string, McpServerEntry>,
		next: Record<string, McpServerEntry>,
	): Record<string, McpServerEntry> {
		const merged = { ...base };
		for (const [name, definition] of Object.entries(next)) {
			merged[name] = { ...(merged[name] ?? {}), ...definition };
		}
		return merged;
	}

	private resolveMcpImportPath(importKind: string, workspacePath?: string): string | null {
		for (const candidate of MCP_IMPORT_PATHS[importKind] ?? []) {
			const fullPath = candidate.startsWith(".")
				? resolve(this.resolveWorkspacePath(workspacePath) ?? process.cwd(), candidate)
				: candidate;
			try {
				if (existsSync(fullPath)) return fullPath;
			} catch {
				// Ignore inaccessible import candidates.
			}
		}
		return null;
	}

	private async readImportedMcpServers(importKind: string, workspacePath?: string): Promise<{ path: string; servers: Record<string, McpServerEntry> } | null> {
		const importPath = this.resolveMcpImportPath(importKind, workspacePath);
		if (!importPath) return null;
		try {
			const imported = this.normalizeMcpConfig(JSON.parse(await readFile(importPath, "utf8")));
			return { path: importPath, servers: imported.mcpServers };
		} catch {
			return null;
		}
	}

	private async expandMcpSourceImports(
		source: McpConfigSource,
		workspacePath?: string,
	): Promise<{ config: McpConfigFile; imports: Array<{ kind: string; path: string; servers: Record<string, McpServerEntry> }> }> {
		const imports: Array<{ kind: string; path: string; servers: Record<string, McpServerEntry> }> = [];
		let importedServers: Record<string, McpServerEntry> = {};
		for (const importKind of source.parsed.imports ?? []) {
			if (!MCP_IMPORT_KINDS.includes(importKind)) continue;
			const imported = await this.readImportedMcpServers(importKind, workspacePath);
			if (!imported) continue;
			imports.push({ kind: importKind, ...imported });
			importedServers = this.mergeMcpServerMaps(importedServers, imported.servers);
		}
		return {
			imports,
			config: {
				...source.parsed,
				mcpServers: this.mergeMcpServerMaps(importedServers, source.parsed.mcpServers),
			},
		};
	}

	private mergeMcpConfigs(configs: McpConfigFile[]): McpConfigFile {
		return configs.reduce<McpConfigFile>((merged, next) => ({
			...merged,
			...next,
			mcpServers: this.mergeMcpServerMaps(merged.mcpServers, next.mcpServers),
			imports: next.imports ?? merged.imports,
			settings: next.settings ? { ...merged.settings, ...next.settings } : merged.settings,
		}), { ...DEFAULT_MCP_CONFIG });
	}

	async getMcpConfig(workspacePath?: string): Promise<McpConfigSnapshot> {
		const projectPath = this.resolveMcpProjectPath(workspacePath);
		const piProjectPath = this.resolvePiMcpProjectPath(workspacePath);
		const sourceSpecs: Array<Omit<McpConfigSource, "raw" | "parsed" | "diagnostic" | "exists" | "serverCount">> = [
			{
				id: "shared-global",
				label: "Standard global MCP",
				scope: "global",
				kind: "shared",
				path: GENERIC_MCP_CONFIG_PATH,
				readOnly: true,
			},
			{
				id: "pi-global",
				label: "Pi global MCP",
				scope: "global",
				kind: "pi",
				path: join(this.configDir, MCP_CONFIG_FILE),
				readOnly: false,
			},
			...(projectPath ? [{
				id: "shared-project" as const,
				label: "Project MCP",
				scope: "workspace" as const,
				kind: "shared" as const,
				path: projectPath,
				readOnly: false,
			}] : []),
			...(piProjectPath && piProjectPath !== projectPath ? [{
				id: "pi-project" as const,
				label: "Project Pi MCP",
				scope: "workspace" as const,
				kind: "pi" as const,
				path: piProjectPath,
				readOnly: false,
			}] : []),
		];
		const sources = await Promise.all(sourceSpecs.map((source) => this.readMcpSource(source)));
		const validSources = sources.filter((source) => !source.diagnostic);
		const expandedSources = await Promise.all(validSources.map(async (source) => ({
			source,
			...(await this.expandMcpSourceImports(source, workspacePath)),
		})));
		const effective = this.mergeMcpConfigs(expandedSources.map((source) => source.config));
		const provenance = new Map<string, { scope: McpConfigScope | "import"; path: string; readOnly: boolean; importKind?: string }>();
		for (const expanded of expandedSources) {
			for (const imported of expanded.imports) {
				for (const name of Object.keys(imported.servers)) {
					if (!provenance.has(name)) {
						provenance.set(name, { scope: "import", path: imported.path, readOnly: true, importKind: imported.kind });
					}
				}
			}
			for (const name of Object.keys(expanded.source.parsed.mcpServers)) {
				provenance.set(name, {
					scope: expanded.source.scope === "workspace" ? "workspace" : "global",
					path: expanded.source.path,
					readOnly: expanded.source.readOnly,
				});
			}
		}
		const servers = Object.entries(effective.mcpServers)
			.map(([name, entry]): McpManagedServer => {
				const source = provenance.get(name);
				return {
					name,
					entry,
					scope: source?.scope ?? "global",
					path: source?.path ?? join(this.configDir, MCP_CONFIG_FILE),
					readOnly: source?.readOnly ?? false,
					...(source?.importKind ? { importKind: source.importKind } : {}),
				};
			})
			.sort((left, right) => left.name.localeCompare(right.name));
		return {
			globalPath: join(this.configDir, MCP_CONFIG_FILE),
			...(projectPath ? { projectPath } : {}),
			sources,
			servers,
			effective,
		};
	}

	async saveMcpConfig(request: McpConfigSaveRequest): Promise<ConfigValidationResult> {
		try {
			const filePath = request.scope === "workspace"
				? this.resolveMcpProjectPath(request.workspacePath)
				: join(this.configDir, MCP_CONFIG_FILE);
			if (!filePath) throw new Error("Workspace path is required for project MCP configuration");
			const parsed = this.validateMcpConfigDocument(JSON.parse(request.raw));
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	// ── 模型故障转移配置 ───────────────────────────────────

	private resolveModelFailoverPath(scope: "global" | "workspace", workspacePath?: string) {
		if (scope === "global") return join(this.configDir, MODEL_FAILOVER_CONFIG_FILE);
		const resolvedWorkspace = this.resolveWorkspacePath(workspacePath);
		if (!resolvedWorkspace) throw new Error("Workspace path is required for project model failover configuration");
		return join(resolvedWorkspace, ".pi", MODEL_FAILOVER_CONFIG_FILE);
	}

	private normalizeModelFailoverConfig(raw: unknown): ModelFailoverConfig {
		const config = raw && typeof raw === "object" && !Array.isArray(raw)
			? raw as Record<string, unknown>
			: {};
		const fallbackModels: Record<string, string[]> = {};
		const rawFallbacks = config.fallbackModels;
		if (rawFallbacks && typeof rawFallbacks === "object" && !Array.isArray(rawFallbacks)) {
			for (const [model, candidates] of Object.entries(rawFallbacks)) {
				if (!model.includes("/") || !Array.isArray(candidates)) continue;
				const chain = [...new Set(candidates
					.filter((candidate): candidate is string => typeof candidate === "string" && candidate.includes("/"))
					.map((candidate) => candidate.trim())
					.filter((candidate) => candidate && candidate !== model))];
				fallbackModels[model] = chain;
			}
		}
		return {
			enabled: typeof config.enabled === "boolean" ? config.enabled : false,
			fallbackModels,
		};
	}

	private async readModelFailoverSource(
		scope: "global" | "workspace",
		workspacePath?: string,
	): Promise<ModelFailoverConfigSource> {
		const filePath = this.resolveModelFailoverPath(scope, workspacePath);
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				return { scope, path: filePath, exists: true, raw, parsed: this.normalizeModelFailoverConfig(JSON.parse(raw)) };
			} catch (error) {
				return {
					scope,
					path: filePath,
					exists: true,
					raw,
					parsed: { enabled: false, fallbackModels: {} },
					diagnostic: this.createJsonDiagnostic(MODEL_FAILOVER_CONFIG_FILE, raw, error),
				};
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { scope, path: filePath, exists: false, raw: JSON.stringify({ enabled: false, fallbackModels: {} }, null, 2), parsed: { enabled: false, fallbackModels: {} } };
			}
			return {
				scope,
				path: filePath,
				exists: false,
				raw: "",
				parsed: { enabled: false, fallbackModels: {} },
				diagnostic: this.createJsonDiagnostic(MODEL_FAILOVER_CONFIG_FILE, "", error),
			};
		}
	}

	async getModelFailoverConfig(workspacePath?: string): Promise<ModelFailoverConfigSnapshot> {
		const [global, workspace] = await Promise.all([
			this.readModelFailoverSource("global"),
			workspacePath ? this.readModelFailoverSource("workspace", workspacePath) : Promise.resolve(undefined),
		]);
		return {
			global,
			...(workspace ? { workspace } : {}),
			effective: {
				enabled: workspace?.exists ? workspace.parsed.enabled : global.parsed.enabled,
				fallbackModels: {
					...global.parsed.fallbackModels,
					...(workspace?.exists ? workspace.parsed.fallbackModels : {}),
				},
			},
		};
	}

	async saveModelFailoverConfig(request: ModelFailoverConfigSaveRequest): Promise<ConfigValidationResult> {
		try {
			if (!request || (request.scope !== "global" && request.scope !== "workspace")) {
				return { valid: false, error: "Invalid model failover configuration request" };
			}
			const filePath = this.resolveModelFailoverPath(request.scope, request.workspacePath);
			const normalized = this.normalizeModelFailoverConfig(request.config);
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	// ── Hooks 配置管理 ─────────────────────────────────────

	private resolveHooksConfigPath(workspacePath?: string) {
		const resolvedWorkspace = this.resolveWorkspacePath(workspacePath);
		if (!resolvedWorkspace) throw new Error("Workspace path is required for Hooks configuration");
		return join(resolvedWorkspace, ".pi", "hooks.json");
	}

	private resolveHooksTrustPath() {
		return join(this.configDir, "hook-trust.json");
	}

	private validateHooksConfig(raw: unknown): HooksConfigFile {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("hooks.json root must be an object");
		const value = raw as Record<string, unknown>;
		if (value.$schema !== undefined && typeof value.$schema !== "string") throw new Error("$schema must be a string");
		if (!value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks)) throw new Error("hooks must be an object");
		const hooks: HooksConfigFile["hooks"] = {};
		const eventSet = new Set<string>(CODEX_HOOK_EVENTS);
		for (const [eventName, groupsRaw] of Object.entries(value.hooks as Record<string, unknown>)) {
			if (!eventSet.has(eventName)) throw new Error(`hooks.${eventName} is not a supported event`);
			if (!Array.isArray(groupsRaw)) throw new Error(`hooks.${eventName} must be an array`);
			hooks[eventName as keyof HooksConfigFile["hooks"]] = groupsRaw.map((groupRaw, groupIndex) => {
				if (!groupRaw || typeof groupRaw !== "object" || Array.isArray(groupRaw)) throw new Error(`hooks.${eventName}[${groupIndex}] must be an object`);
				const group = groupRaw as Record<string, unknown>;
				if (group.matcher !== undefined && typeof group.matcher !== "string") throw new Error(`hooks.${eventName}[${groupIndex}].matcher must be a string`);
				if (typeof group.matcher === "string" && group.matcher !== "*") new RegExp(group.matcher);
				if (group.hooks !== undefined && !Array.isArray(group.hooks)) throw new Error(`hooks.${eventName}[${groupIndex}].hooks must be an array`);
				const handlers = (group.hooks ?? []) as unknown[];
				return {
					...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}),
					hooks: handlers.map((handlerRaw, handlerIndex) => {
						if (!handlerRaw || typeof handlerRaw !== "object" || Array.isArray(handlerRaw)) throw new Error(`hooks.${eventName}[${groupIndex}].hooks[${handlerIndex}] must be an object`);
						const handler = handlerRaw as Record<string, unknown>;
						if (handler.type !== "command" && handler.type !== "prompt" && handler.type !== "agent") throw new Error(`hooks.${eventName}[${groupIndex}].hooks[${handlerIndex}].type is invalid`);
						if (handler.type === "command" && (typeof handler.command !== "string" || !handler.command.trim())) throw new Error(`hooks.${eventName}[${groupIndex}].hooks[${handlerIndex}].command is required`);
						return handler;
					}),
				};
			});
		}
		return { ...(typeof value.$schema === "string" ? { $schema: value.$schema } : {}), hooks };
	}

	private validateHookTrust(raw: unknown): HookTrustFile {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("hook-trust.json root must be an object");
		const value = raw as Record<string, unknown>;
		if (value.version !== 1) throw new Error("hook-trust.json version must be 1");
		if (!value.trusted || typeof value.trusted !== "object" || Array.isArray(value.trusted)) throw new Error("trusted must be an object");
		const trusted: Record<string, string> = {};
		for (const [key, hash] of Object.entries(value.trusted as Record<string, unknown>)) {
			if (typeof hash !== "string") throw new Error(`trusted.${key} must be a string`);
			trusted[key] = hash;
		}
		const toggles: Record<string, Record<string, boolean>> = {};
		if (value.toggles !== undefined) {
			if (!value.toggles || typeof value.toggles !== "object" || Array.isArray(value.toggles)) throw new Error("toggles must be an object");
			for (const [configPath, configToggles] of Object.entries(value.toggles as Record<string, unknown>)) {
				if (!configToggles || typeof configToggles !== "object" || Array.isArray(configToggles)) throw new Error(`toggles.${configPath} must be an object`);
				toggles[configPath] = {};
				for (const [hookId, enabled] of Object.entries(configToggles as Record<string, unknown>)) {
					if (typeof enabled !== "boolean") throw new Error(`toggles.${configPath}.${hookId} must be boolean`);
					toggles[configPath][hookId] = enabled;
				}
			}
		}
		return { version: 1, trusted, toggles };
	}

	private hookTrustKey(filePath: string) {
		const normalizedPath = normalize(filePath);
		return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
	}

	async getHooksConfig(workspacePath?: string): Promise<HooksConfigSnapshot> {
		const configPath = this.resolveHooksConfigPath(workspacePath);
		const trustPath = this.resolveHooksTrustPath();
		let configRaw = JSON.stringify({ hooks: {} }, null, 2);
		let configExists = false;
		let configParsed: HooksConfigFile = { hooks: {} };
		let configDiagnostic: ConfigFileDiagnostic | undefined;
		try {
			configRaw = await readFile(configPath, "utf8");
			configExists = true;
			configParsed = this.validateHooksConfig(JSON.parse(configRaw));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") configDiagnostic = this.createJsonDiagnostic("hooks.json", configRaw, error);
		}

		let trustRaw = JSON.stringify({ version: 1, trusted: {}, toggles: {} }, null, 2);
		let trustExists = false;
		let trustParsed: HookTrustFile = { version: 1, trusted: {}, toggles: {} };
		let trustDiagnostic: ConfigFileDiagnostic | undefined;
		try {
			trustRaw = await readFile(trustPath, "utf8");
			trustExists = true;
			trustParsed = this.validateHookTrust(JSON.parse(trustRaw));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") trustDiagnostic = this.createJsonDiagnostic("hook-trust.json", trustRaw, error);
		}
		const configHash = configExists && !configDiagnostic ? createHash("sha256").update(configRaw).digest("hex") : undefined;
		const trustKey = this.hookTrustKey(configPath);
		return {
			configPath,
			configExists,
			configRaw,
			configParsed,
			...(configDiagnostic ? { configDiagnostic } : {}),
			trustPath,
			trustExists,
			trustRaw,
			trustParsed,
			...(trustDiagnostic ? { trustDiagnostic } : {}),
			installedCount: Object.values(configParsed.hooks).reduce((sum, groups) => sum + (groups ?? []).reduce((inner, group) => inner + group.hooks.length, 0), 0),
			trusted: Boolean(configHash && trustParsed.trusted[trustKey] === configHash),
		};
	}

	async saveHooksConfig(request: HooksConfigSaveRequest): Promise<ConfigValidationResult> {
		try {
			if (request.configRaw !== undefined) {
				const configPath = this.resolveHooksConfigPath(request.workspacePath);
				const parsed = this.validateHooksConfig(JSON.parse(request.configRaw));
				await mkdir(dirname(configPath), { recursive: true });
				await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
			}
			if (request.trustRaw !== undefined) {
				const trustPath = this.resolveHooksTrustPath();
				const parsed = this.validateHookTrust(JSON.parse(request.trustRaw));
				await mkdir(dirname(trustPath), { recursive: true });
				await writeFile(trustPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
			}
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	// ── Skill 配置管理 ─────────────────────────────────────

	private defaultSkillConfig(): SkillConfigFile {
		return {
			version: "1.0.0",
			skills: {},
			groups: {},
			limits: { maxFileBytes: 128 * 1024, maxTotalBytes: 512 * 1024 },
		};
	}

	private resolveSkillConfigPath(scope: "global" | "workspace", workspacePath?: string) {
		if (scope === "global") return join(this.configDir, SKILL_CONFIG_FILE);
		const resolvedWorkspace = this.resolveWorkspacePath(workspacePath);
		if (!resolvedWorkspace) throw new Error("Workspace path is required for project skill configuration");
		return join(resolvedWorkspace, ".pi", SKILL_CONFIG_FILE);
	}

	private validateSkillConfig(raw: unknown): SkillConfigFile {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("skill-config root must be an object");
		const value = raw as Record<string, unknown>;
		const defaultConfig = this.defaultSkillConfig();
		const skillsRaw = value.skills ?? {};
		if (!skillsRaw || typeof skillsRaw !== "object" || Array.isArray(skillsRaw)) throw new Error("skills must be an object");
		const skills: SkillConfigFile["skills"] = {};
		for (const [skillName, skillRaw] of Object.entries(skillsRaw as Record<string, unknown>)) {
			if (!skillRaw || typeof skillRaw !== "object" || Array.isArray(skillRaw)) throw new Error(`skills.${skillName} must be an object`);
			const skill = skillRaw as Record<string, unknown>;
			const paramsRaw = skill.params ?? {};
			if (!paramsRaw || typeof paramsRaw !== "object" || Array.isArray(paramsRaw)) throw new Error(`skills.${skillName}.params must be an object`);
			const params: Record<string, string | boolean | number> = {};
			for (const [key, paramValue] of Object.entries(paramsRaw as Record<string, unknown>)) {
				if (typeof paramValue !== "string" && typeof paramValue !== "boolean" && typeof paramValue !== "number") throw new Error(`skills.${skillName}.params.${key} must be primitive`);
				params[key] = paramValue;
			}
			const disableModelInvocation = skill["disable-model-invocation"];
			if (disableModelInvocation !== undefined && typeof disableModelInvocation !== "boolean") throw new Error(`skills.${skillName}.disable-model-invocation must be boolean`);
			skills[skillName] = {
				params,
				...(typeof skill.updated === "string" ? { updated: skill.updated } : {}),
				...(typeof disableModelInvocation === "boolean" ? { "disable-model-invocation": disableModelInvocation } : {}),
			};
		}
		const groupsRaw = value.groups ?? {};
		if (!groupsRaw || typeof groupsRaw !== "object" || Array.isArray(groupsRaw)) throw new Error("groups must be an object");
		const groups: SkillConfigFile["groups"] = {};
		for (const [groupName, groupRaw] of Object.entries(groupsRaw as Record<string, unknown>)) {
			if (!groupRaw || typeof groupRaw !== "object" || Array.isArray(groupRaw) || !Array.isArray((groupRaw as { skills?: unknown }).skills)) throw new Error(`groups.${groupName}.skills must be an array`);
			groups[groupName] = { skills: [...new Set(((groupRaw as { skills: unknown[] }).skills).filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim())).map((skill) => skill.trim()))] };
		}
		const limitsRaw = value.limits && typeof value.limits === "object" && !Array.isArray(value.limits) ? value.limits as Record<string, unknown> : {};
		const maxFileBytes = limitsRaw.maxFileBytes === undefined
			? defaultConfig.limits.maxFileBytes
			: Number(limitsRaw.maxFileBytes);
		const maxTotalBytes = limitsRaw.maxTotalBytes === undefined
			? defaultConfig.limits.maxTotalBytes
			: Number(limitsRaw.maxTotalBytes);
		if (!Number.isInteger(maxFileBytes) || maxFileBytes <= 0) throw new Error("limits.maxFileBytes must be a positive integer");
		if (!Number.isInteger(maxTotalBytes) || maxTotalBytes <= 0) throw new Error("limits.maxTotalBytes must be a positive integer");
		if (maxTotalBytes < maxFileBytes) throw new Error("limits.maxTotalBytes must be >= limits.maxFileBytes");
		return { version: typeof value.version === "string" ? value.version : defaultConfig.version, skills, groups, limits: { maxFileBytes, maxTotalBytes } };
	}

	private async readSkillConfigSource(scope: "global" | "workspace", workspacePath?: string): Promise<SkillConfigSource> {
		const filePath = this.resolveSkillConfigPath(scope, workspacePath);
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				return { scope, path: filePath, exists: true, raw, parsed: this.validateSkillConfig(JSON.parse(raw)) };
			} catch (error) {
				return { scope, path: filePath, exists: true, raw, parsed: this.defaultSkillConfig(), diagnostic: this.createJsonDiagnostic(SKILL_CONFIG_FILE, raw, error) };
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { scope, path: filePath, exists: false, raw: JSON.stringify(this.defaultSkillConfig(), null, 2), parsed: this.defaultSkillConfig() };
			return { scope, path: filePath, exists: false, raw: "", parsed: this.defaultSkillConfig(), diagnostic: this.createJsonDiagnostic(SKILL_CONFIG_FILE, "", error) };
		}
	}

	private mergeSkillConfigs(global: SkillConfigFile, workspace?: SkillConfigFile): SkillConfigFile {
		const skills: SkillConfigFile["skills"] = { ...global.skills };
		for (const [skillName, defaults] of Object.entries(workspace?.skills ?? {})) {
			const existing = skills[skillName];
			skills[skillName] = existing
				? {
					params: { ...existing.params, ...defaults.params },
					updated: defaults.updated ?? existing.updated,
					...("disable-model-invocation" in existing ? { "disable-model-invocation": existing["disable-model-invocation"] } : {}),
					...("disable-model-invocation" in defaults ? { "disable-model-invocation": defaults["disable-model-invocation"] } : {}),
				}
				: defaults;
		}
		return {
			version: workspace?.version ?? global.version,
			skills,
			groups: { ...global.groups, ...(workspace?.groups ?? {}) },
			limits: { ...global.limits, ...(workspace?.limits ?? {}) },
		};
	}

	async getSkillConfig(workspacePath?: string): Promise<SkillConfigSnapshot> {
		const [global, workspace] = await Promise.all([
			this.readSkillConfigSource("global"),
			workspacePath ? this.readSkillConfigSource("workspace", workspacePath) : Promise.resolve(undefined),
		]);
		const effective = this.mergeSkillConfigs(global.parsed, workspace?.exists ? workspace.parsed : undefined);
		return {
			global,
			...(workspace ? { workspace } : {}),
			effective,
			configHash: createHash("sha256").update(JSON.stringify(effective)).digest("hex"),
		};
	}

	async saveSkillConfig(request: SkillConfigSaveRequest): Promise<ConfigValidationResult> {
		try {
			const filePath = this.resolveSkillConfigPath(request.scope, request.workspacePath);
			const parsed = this.validateSkillConfig(JSON.parse(request.raw));
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	// ── Web Search / Curator 配置管理 ─────────────────────

	private resolveWebSearchConfigPath(): string {
		// web-access 以 PI_CODING_AGENT_DIR 为根；未设置时才回退到 ~/.pi。
		// WSL 环境使用同一变量解析出的 agent 目录，保证桌面写入的位置与扩展运行时一致。
		const baseDir = this.wslEnvironment
			? this.wslEnvironment.windowsAgentDir
			: process.env.PI_CODING_AGENT_DIR
				|| (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "pi") : join(homedir(), ".pi"));
		return join(baseDir, "web-search.json");
	}

	private resolveSmartSearchConfigPath(): { path: string; pathSource: SmartSearchConfigSnapshot["pathSource"] } {
		if (this.wslEnvironment) {
			return { path: join(this.wslEnvironment.windowsHome, ".config", "smart-search", "config.json"), pathSource: "default" };
		}
		if (process.env.SMART_SEARCH_CONFIG_DIR) {
			return { path: join(process.env.SMART_SEARCH_CONFIG_DIR, "config.json"), pathSource: "environment" };
		}
		const legacyPath = join(homedir(), ".config", "smart-search", "config.json");
		const defaultPath = process.platform === "win32" && process.env.LOCALAPPDATA
			? join(process.env.LOCALAPPDATA, "smart-search", "config.json")
			: legacyPath;
		if (process.platform === "win32" && defaultPath !== legacyPath && !existsSync(defaultPath) && existsSync(legacyPath)) {
			return { path: legacyPath, pathSource: "legacy_windows_home" };
		}
		return { path: defaultPath, pathSource: "default" };
	}

	async getSmartSearchConfig(): Promise<SmartSearchConfigSnapshot> {
		const resolved = this.resolveSmartSearchConfigPath();
		try {
			const raw = await readFile(resolved.path, "utf8");
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Smart Search config root must be an object");
				return { path: resolved.path, pathSource: resolved.pathSource, exists: true, raw, parsed: parsed as Record<string, unknown> };
			} catch (error) {
				return { path: resolved.path, pathSource: resolved.pathSource, exists: true, raw, parsed: {}, diagnostic: this.createJsonDiagnostic("config.json", raw, error) };
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: resolved.path, pathSource: resolved.pathSource, exists: false, raw: "{}\n", parsed: {} };
			return { path: resolved.path, pathSource: resolved.pathSource, exists: false, raw: "", parsed: {}, diagnostic: this.createJsonDiagnostic("config.json", "", error) };
		}
	}

	async saveSmartSearchConfig(request: WebSearchConfigSaveRequest): Promise<ConfigValidationResult> {
		try {
			const parsed = JSON.parse(request.raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Smart Search config root must be an object");
			await this.writeJsonFileRaw(this.resolveSmartSearchConfigPath().path, parsed);
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	async getWebSearchConfig(): Promise<WebSearchConfigSnapshot> {
		const filePath = this.resolveWebSearchConfigPath();
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("web-search.json root must be an object");
				return { path: filePath, exists: true, raw, parsed: parsed as Record<string, unknown> };
			} catch (error) {
				return { path: filePath, exists: true, raw, parsed: {}, diagnostic: this.createJsonDiagnostic("web-search.json", raw, error) };
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: filePath, exists: false, raw: "{}\n", parsed: {} };
			return { path: filePath, exists: false, raw: "", parsed: {}, diagnostic: this.createJsonDiagnostic("web-search.json", "", error) };
		}
	}

	async saveWebSearchConfig(request: WebSearchConfigSaveRequest): Promise<ConfigValidationResult> {
		try {
			const parsed = JSON.parse(request.raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("web-search.json root must be an object");
			await this.writeJsonFileRaw(this.resolveWebSearchConfigPath(), parsed);
			return { valid: true };
		} catch (error) {
			return { valid: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private async writeJsonFileRaw<T>(filePath: string, data: T): Promise<void> {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	}

	// ── 读取 ──────────────────────────────────────────────

	async getModelsConfig(): Promise<ConfigFileReadResult<PiModelsFile>> {
		return this.readJsonFile<PiModelsFile>("models.json", { providers: {} });
	}

	async getAuthConfig(): Promise<ConfigFileReadResult<PiAuthFile>> {
		return this.readJsonFile<PiAuthFile>("auth.json", {});
	}

	async getSettingsConfig(): Promise<ConfigFileReadResult<PiSettings>> {
		return this.readJsonFile<PiSettings>("settings.json", {});
	}

	async getTrustConfig(): Promise<ConfigFileReadResult<Record<string, boolean>>> {
		return this.readJsonFile<Record<string, boolean>>("trust.json", {});
	}

	async getApiManagerConfig(): Promise<ConfigFileReadResult<Record<string, unknown>>> {
		return this.readJsonFile<Record<string, unknown>>("api-manager.json", {});
	}

	async getRawConfig(fileName: string): Promise<ConfigFileReadResult<Record<string, unknown>>> {
		const allowed = ["models.json", "auth.json", "settings.json", "trust.json", "api-manager.json", "permissions.json", "vision.json", "lsp.json"];
		if (!allowed.includes(fileName)) throw new Error(`不允许读取的文件：${fileName}`);
		return this.readJsonFile<Record<string, unknown>>(fileName, {});
	}

	async ensureTrustedDirectory(directoryPath: string): Promise<void> {
		const normalizedPath = this.normalizeTrustPath(directoryPath);
		const trustConfig = await this.getTrustConfig();
		if (trustConfig.diagnostic) return;

		const existingEntry = Object.entries(trustConfig.parsed).find(
			([path]) => this.normalizeTrustPathKey(path) === this.normalizeTrustPathKey(normalizedPath),
		);
		if (existingEntry) return;

		// 若用户已用不同大小写/分隔符写过同一路径，或显式设为 false，则不覆盖，尊重用户的 trust.json 决策。
		await this.writeJsonFile("trust.json", {
			...trustConfig.parsed,
			[normalizedPath]: true,
		});
	}

	/**
	 * 查询某项目目录的信任决策，沿父目录链查找最近记录（复刻 pi 的 findNearestTrustEntry 语义）。
	 * pi 的信任语义是父目录决策继承到子目录，例如 trust.json 记录 "C:\\Users": true，
	 * 则 C:\\Users\\14012\\project 同样视为已信任。返回 true/false；未记录返回 null。
	 */
	async getProjectTrustDecision(cwd: string): Promise<boolean | null> {
		const trustConfig = await this.getTrustConfig();
		if (trustConfig.diagnostic) return null;
		return this.findNearestTrustEntry(trustConfig.parsed, cwd);
	}

	/**
	 * 写入某项目目录的信任决策（覆盖该路径既有值）。
	 * 用户在信任弹窗选择“信任并记住”或“不信任”后调用，持久化决策避免重复打扰。
	 */
	async setProjectTrustDecision(cwd: string, decision: boolean): Promise<void> {
		const trustConfig = await this.getTrustConfig();
		if (trustConfig.diagnostic) return;
		const key = this.normalizeTrustPath(cwd);
		await this.writeJsonFile("trust.json", {
			...trustConfig.parsed,
			[key]: decision,
		});
	}

	/**
	 * 沿父目录链查找最近的信任记录。key 比较统一走 normalizeTrustPathKey，
	 * 与 ensureTrustedDirectory 的去重逻辑保持一致，避免大小写/分隔符差异导致漏查。
	 */
	private findNearestTrustEntry(data: Record<string, boolean>, cwd: string): boolean | null {
		const normalized = new Map<string, boolean>();
		for (const [key, value] of Object.entries(data)) {
			normalized.set(this.normalizeTrustPathKey(key), value);
		}
		let current = this.normalizeTrustPathKey(cwd);
		while (true) {
			const value = normalized.get(current);
			if (value === true || value === false) return value;
			const parent = current.startsWith("/") ? posixDirname(current) : dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}

	private normalizeTrustPathKey(path: string) {
		const normalized = this.normalizeTrustPath(path).replace(/[\\/]+$/, "");
		return process.platform === "win32" && !normalized.startsWith("/")
			? normalized.toLowerCase()
			: normalized;
	}

	private normalizeTrustPath(path: string) {
		if (!path.startsWith("/")) return normalize(path);
		const normalized = posixNormalize(path);
		return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
	}

	// ── 保存（可视化表单） ────────────────────────────────

	async saveModelsConfig(data: PiModelsFile): Promise<ConfigValidationResult> {
		const validation = this.validateModels(data);
		if (!validation.valid) return validation;
		// 保存前统一迁移历史别名，确保写入 models.json 的 api 名称能被 pi 官方 registry 识别。
		await this.writeJsonFile("models.json", this.normalizeModelsForPi(data));
		return { valid: true };
	}

	async saveAuthConfig(data: PiAuthFile): Promise<ConfigValidationResult> {
		await this.writeJsonFile("auth.json", data);
		return { valid: true };
	}

	async saveSettingsConfig(
		settings: PiSettings,
	): Promise<ConfigValidationResult> {
		await this.writeJsonFile("settings.json", settings);
		return { valid: true };
	}

	// ── 保存（源文件编辑） ────────────────────────────────

	async saveRawConfig(
		fileName: string,
		rawJson: string,
	): Promise<ConfigValidationResult> {
		try {
			JSON.parse(rawJson);
		} catch (e) {
			return {
				valid: false,
				error: `JSON 格式错误：${e instanceof Error ? e.message : String(e)}`,
			};
		}

		const allowed = ["models.json", "auth.json", "settings.json", "trust.json", "api-manager.json", "permissions.json", "vision.json", "lsp.json"];
		if (!allowed.includes(fileName)) {
			return { valid: false, error: `不允许编辑的文件：${fileName}` };
		}

		await this.writeJsonFile(fileName, rawJson);
		return { valid: true };
	}

	// ── 校验 ──────────────────────────────────────────────

	private validateModels(data: PiModelsFile): ConfigValidationResult {
		if (!data.providers || typeof data.providers !== "object") {
			return { valid: false, error: "models.json 缺少 providers 字段" };
		}
		for (const [providerName, config] of Object.entries(data.providers)) {
			if (!config.models || !Array.isArray(config.models)) {
				return {
					valid: false,
					error: `provider "${providerName}" 缺少 models 数组`,
				};
			}
			for (let i = 0; i < config.models.length; i++) {
				const m = config.models[i];
				if (!m.id || typeof m.id !== "string") {
					return {
						valid: false,
						error: `provider "${providerName}" 的模型 #${i + 1} 缺少有效的 id`,
					};
				}
			}
		}
		return { valid: true };
	}

	// ── 文件 IO ───────────────────────────────────────────

	private async readJsonFile<T>(
		fileName: string,
		fallback: T,
	): Promise<ConfigFileReadResult<T>> {
		const filePath = join(this.configDir, fileName);
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				const parsed = JSON.parse(raw) as T;
				return { raw, parsed };
			} catch (error) {
				// 配置 JSON 写错时，配置弹窗仍要能打开 Raw 页让用户修复；同时返回精确诊断用于 UI 提示。
				return {
					raw,
					parsed: fallback,
					diagnostic: this.createJsonDiagnostic(fileName, raw, error),
				};
			}
		} catch {
			return { raw: JSON.stringify(fallback, null, 2), parsed: fallback };
		}
	}

	private createJsonDiagnostic(
		fileName: string,
		raw: string,
		error: unknown,
	): ConfigFileDiagnostic {
		const message = error instanceof Error ? error.message : String(error);
		const positionMatch = message.match(/position\s+(\d+)/i);
		const position = positionMatch ? Number(positionMatch[1]) : undefined;
		let line: number | undefined;
		let column: number | undefined;
		let snippet: string | undefined;
		if (Number.isFinite(position)) {
			const before = raw.slice(0, position);
			const lines = before.split(/\r?\n/);
			line = lines.length;
			column = lines[lines.length - 1].length + 1;
			const rawLines = raw.split(/\r?\n/);
			const start = Math.max(0, line - 2);
			const end = Math.min(rawLines.length, line + 1);
			snippet = rawLines
				.slice(start, end)
				.map((text, index) => `${start + index + 1}: ${text}`)
				.join("\n");
		}
		return {
			fileName,
			message,
			line,
			column,
			snippet,
			docsUrl: this.docsUrlForFile(fileName),
		};
	}

	private docsUrlForFile(fileName: string) {
		if (fileName === "models.json") return "https://pi.dev/docs/latest/models";
		if (fileName === "settings.json") return "https://pi.dev/docs/latest/settings";
		if (fileName === TEAMMATE_MODELS_FILE) return "https://www.npmjs.com/package/pi-maestro-flow";
		return "https://pi.dev/docs/latest/providers";
	}

	private async writeJsonFile(
		fileName: string,
		content: unknown,
	): Promise<void> {
		await mkdir(this.configDir, { recursive: true });
		const filePath = join(this.configDir, fileName);
		const json =
			typeof content === "string" ? content : JSON.stringify(content, null, 2);
		await writeFile(filePath, json, "utf8");
	}

	// ── 远程拉取模型列表 ─────────────────────────────────

	/**
	 * 向 provider 拉取可用模型列表。
	 * 对优先路径尝试失败后自动回退到备选路径，提升对各厂商端点格式差异的容错。
	 */
	async fetchProviderModels(
		baseUrl: string,
		apiKey: string,
		apiType?: string,
	): Promise<{
		success: boolean;
		models?: Array<{ id: string; name?: string }>;
		error?: string;
		/** 实际成功/最后一次请求的 URL（脱敏），用于 UI 对比会话侧路径 */
		requestUrl?: string;
		/** 检测侧补了版本路径，而配置 baseUrl 仍是根路径 → 会话可能 404 */
		sessionBaseUrlNeedsVersion?: boolean;
		/** 建议写入配置的 baseUrl（含 /v1 等）；UI 可自动改写 */
		suggestedBaseUrl?: string;
	}> {
		const requests = this.buildModelsRequest(baseUrl, apiKey, apiType);
		let lastError: string | undefined;
		let lastRequestUrl: string | undefined;

		for (const request of requests) {
			lastRequestUrl = this.redactSecret(request.url, apiKey);
			try {
				const controller = new AbortController();
				// 10 秒超时，避免网络不通时长时间卡住
				const timeout = setTimeout(() => controller.abort(), 10_000);

				try {
					// 桌面端配置检测属于 Electron 主进程自身请求；使用 net.fetch 才能走 defaultSession 的代理配置。
					const res = await net.fetch(request.url, {
						method: request.method ?? "GET",
						headers: request.headers,
						signal: controller.signal,
					});

					if (!res.ok) {
						lastError = `HTTP ${res.status}: ${res.statusText}`;
						continue;
					}

					const body = (await res.json()) as Record<string, unknown>;
					const models = this.parseModelsResponse(body, apiType);

					if (models.length === 0) {
						lastError = "接口返回了空的模型列表";
						continue;
					}

					// 成功路径若依赖检测侧自动补 /v1，而用户配置仍是根路径，
					// 会话侧会原样用 baseUrl → 返回建议 baseUrl 供 UI 自动改写。
					const sessionBaseUrlNeedsVersion = needsSessionBaseUrlVersionHint(
						baseUrl,
						request.url,
					);
					const suggestedBaseUrl =
						suggestNormalizedBaseUrl(baseUrl, request.url, apiType) ?? undefined;
					return {
						success: true,
						models,
						requestUrl: lastRequestUrl,
						sessionBaseUrlNeedsVersion,
						suggestedBaseUrl,
					};
				} finally {
					clearTimeout(timeout);
				}
			} catch (e) {
				const msg =
					e instanceof Error
						? e.name === "AbortError"
							? "请求超时，请检查网络或 baseUrl"
							: e.message
						: String(e);
				lastError = this.redactSecret(msg, apiKey);
			}
		}

		return {
			success: false,
			error: lastError ?? "获取模型列表失败",
			requestUrl: lastRequestUrl,
			sessionBaseUrlNeedsVersion: needsSessionBaseUrlVersionHint(
				baseUrl,
				lastRequestUrl,
			),
		};
	}


	// ── 快速测试连接 ─────────────────────────────────────

	/**
	 * 向 provider 发送一条最小聊天请求验证 baseUrl、apiKey 和模型是否正常。
	 * 返回测试结果，包含模型名、响应摘要、token 用量和延迟。
	 */
	/**
	 * 根据 API 类型构造获取模型列表的 URL 列表（含优先路径和回退路径）。
	 * fetchProviderModels 会逐条尝试直到成功或全部失败。
	 *
	 * 各厂商获取模型列表的支持情况：
	 *
	 * | API 类型 | 优先路径 | 回退路径 |
	 * |----------|---------|---------|
	 * | OpenAI Chat Completions | /v1/models | /models |
	 * | OpenAI Responses / Codex | /v1/models | /models |
	 * | Anthropic Messages | /v1/models | /models |
	 * | Google Gemini | /v1beta/models | - |
	 * | Mistral Conversations | /v1/models | /models |
	 *
	 * OpenAI 生态（Chat Completions / Responses / Codex / Mistral）统一通过
	 * GET /v1/models 获取模型列表。
	 * 虽然 Anthropic 官方未公开 models 端点，但大部分兼容 Anthropic 协议的
	 * 第三方网关同样支持 /v1/models。优先尝试 /v1/models，再回退到 /models。
	 * Google Gemini 使用独立的 /v1beta/models。
	 */
	private buildModelsRequest(
		baseUrl: string,
		apiKey: string,
		apiType?: string,
	): TestRequest[] {
		const api = this.normalizeApiType(apiType);

		if (api === "google-generative-ai") {
			// Google Gemini：使用独立的 v1beta 路径
			const u = baseUrl.replace(/\/+$/, "");
			const needsPrefix = !/[\/]v\d+(alpha|beta)?$/.test(u);
			const versioned = needsPrefix ? `${u}/v1beta` : u;
			return [{
				url: `${versioned}/models?key=${encodeURIComponent(apiKey)}`,
				headers: { "Content-Type": "application/json" },
			}];
		}

		if (api === "anthropic-messages") {
			// Anthropic：优先尝试 /v1/models（兼容大部分第三方网关），
			// 再回退到 /models（原生 Anthropic API 或旧实现）
			const u = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
			const headers = this.withAnthropicSdkUserAgent({
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
			});
			const primaryUrl = `${u}/v1/models`;
			const fallbackUrl = `${u}/models`;
			return primaryUrl === fallbackUrl
				? [{ url: primaryUrl, headers }]
				: [
					{ url: primaryUrl, headers },
					{ url: fallbackUrl, headers },
				];
		}

		// OpenAI 兼容 API（Chat Completions / Responses / Codex / Mistral）：
		// 优先尝试 ensureVersionPath 补齐后的路径，再回退到原始 baseUrl + /models
		const headers = this.withOpenAiSdkUserAgent({
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		});
		const u = baseUrl.replace(/\/+$/, "");
		const primaryUrl = `${this.ensureVersionPath(baseUrl)}/models`;
		const fallbackUrl = `${u}/models`;

		return primaryUrl === fallbackUrl
			? [{ url: primaryUrl, headers }]
			: [
				{ url: primaryUrl, headers },
				{ url: fallbackUrl, headers },
			];
	}


	private parseModelsResponse(
		body: Record<string, unknown>,
		apiType?: string,
	): Array<{ id: string; name?: string }> {
		const api = this.normalizeApiType(apiType);
		const rawData = Array.isArray(body.data) ? body.data : Array.isArray(body)
			? body
			: body.models && Array.isArray(body.models)
				? body.models
				: [];

		return (rawData as Array<Record<string, unknown>>)
			.map((model) => {
				const rawId =
					typeof model.id === "string"
						? model.id
						: typeof model.name === "string"
							? model.name
							: "";
				const id =
					api === "google-generative-ai"
						? rawId.replace(/^models\//, "")
						: rawId;
				const name =
					typeof model.displayName === "string"
						? model.displayName
						: typeof model.name === "string"
							? model.name.replace(/^models\//, "")
							: id;
				return { id, name };
			})
			.filter((model) => model.id.length > 0);
	}

	private buildTestRequest(
		baseUrl: string,
		apiKey: string,
		modelId: string,
		apiType: string,
		requestHeaders?: Record<string, string>,
	): { url: string; headers: Record<string, string>; body: string } {
		const api = this.normalizeApiType(apiType);
		const extraHeaders = this.normalizeRequestHeaders(requestHeaders);

		switch (api) {
			case "openai-responses":
			case "openai-codex-responses":
				return {
					url: `${this.ensureVersionPath(baseUrl)}/responses`,
					headers: this.withOpenAiSdkUserAgent({
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						...extraHeaders,
					}),
					body: JSON.stringify({
						model: modelId,
						// 连接测试只验证接口是否可调用，不测试推理或工具能力；极短输入能减少
						// reasoning 模型的思考时间，避免把慢响应误判为兼容模式不可用。
						input: "Hi",
						max_output_tokens: 1,
					}),
				};

			case "anthropic-messages":
				// Anthropic Messages API 的聊天端点在 /v1/messages
				// 自动补齐 v1（Anthropic 文档示例：https://api.anthropic.com/v1/messages）
				return {
					url: `${this.ensureVersionPath(baseUrl)}/messages`,
					headers: this.withAnthropicSdkUserAgent({
						"x-api-key": apiKey,
						"anthropic-version": "2023-06-01",
						"Content-Type": "application/json",
						...extraHeaders,
					}),
					body: JSON.stringify({
						model: modelId,
						messages: [{ role: "user", content: "Hi" }],
						// 部分代理与 Claude 模型对 max_tokens 有最低要求，设为 10 避免 400/404。
						max_tokens: 10,
					}),
				};

			case "google-generative-ai":
				// Gemini 的 API key 作为查询参数
				// 自动补齐 v1beta（如果 baseUrl 不包含版本路径）
				// Google 文档示例：https://generativelanguage.googleapis.com/v1beta
				{
					const u = baseUrl.replace(/\/+$/, "");
					const needsPrefix = !/[\/]v\d+(alpha|beta)?$/.test(u);
					const versioned = needsPrefix ? `${u}/v1beta` : u;
					return {
						url: `${versioned}/${this.googleModelPath(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
						headers: {
							"Content-Type": "application/json",
							...extraHeaders,
						},
						body: JSON.stringify({
							contents: [
								{
									role: "user",
									parts: [{ text: "Hi" }],
								},
							],
							generationConfig: { maxOutputTokens: 1 },
						}),
					};
				}

			case "mistral-conversations":
				return {
					url: `${baseUrl.replace(/\/+$/, "")}/conversations`,
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						...extraHeaders,
					},
					body: JSON.stringify({
						model: modelId,
						inputs: "Hi",
						store: false,
					}),
				};

			default:
				// openai-completions 是 pi 官方名称，对应 OpenAI Chat Completions 接口。
				return {
					url: `${this.ensureVersionPath(baseUrl)}/chat/completions`,
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						...extraHeaders,
					},
					body: JSON.stringify({
						model: modelId,
						// Chat Completions 兼容网关常接入 reasoning 模型，测试时只要拿到
						// 一个最小响应即可，不要求完整回答，降低超时和 token 消耗。
						messages: [{ role: "user", content: "Hi" }],
						max_tokens: 1,
					}),
				};
		}
	}

	private normalizeModelsForPi(data: PiModelsFile): PiModelsFile {
		return {
			...data,
			providers: Object.fromEntries(
				Object.entries(data.providers).map(([name, provider]) => [
					name,
					{
						...provider,
						api: this.normalizeApiType(provider.api),
						models: provider.models.map((model) => ({
							...model,
							api: typeof model.api === "string"
								? this.normalizeApiType(model.api)
								: model.api,
						})),
					},
				]),
			),
		};
	}

	private normalizeApiType(apiType?: string) {
		switch (apiType) {
			case "anthropic":
			case "anthropic-messages":
				return "anthropic-messages";
			case "openai-codex-responses":
				return "openai-codex-responses";
			case "openai-chat-completions":
				// 兼容早期 pi-desktop 暴露过的别名；pi 官方 registry 名称是 openai-completions。
				return "openai-completions";
			case "openai-completions":
			case "openai-responses":
			case "google-generative-ai":
			case "mistral-conversations":
				return apiType;
			default:
				return "openai-completions";
		}
	}

	/**
	 * 确保 OpenAI 兼容 API 的基础 URL 包含 /v1 版本路径。
	 * 仅用于「获取模型 / 测试连接」；pi 会话不会走此补齐。
	 */
	private ensureVersionPath(baseUrl: string): string {
		return ensureOpenAiVersionPath(baseUrl);
	}

	private googleModelPath(modelId: string) {
		return modelId.startsWith("models/") ? modelId : `models/${modelId}`;
	}

	private normalizeRequestHeaders(headers?: Record<string, string>) {
		if (!headers) return {};
		return Object.fromEntries(
			Object.entries(headers).filter(
				([key, value]) =>
					key.trim().length > 0 && typeof value === "string",
			),
		);
	}

	private withOpenAiSdkUserAgent(headers: Record<string, string>) {
		const hasUserAgent = Object.keys(headers).some(
			(key) => key.toLowerCase() === "user-agent",
		);
		// pi 的 openai-responses provider 走 OpenAI JS SDK。部分代理会按 SDK
		// 默认 User-Agent 拦截请求，所以配置检测需要模拟该默认值，避免“检测通过、会话 403”。
		return hasUserAgent ? headers : { ...headers, "User-Agent": "OpenAI/JS 6.26.0" };
	}

	private withAnthropicSdkUserAgent(headers: Record<string, string>) {
		const hasUserAgent = Object.keys(headers).some(
			(key) => key.toLowerCase() === "user-agent",
		);
		// pi 的 anthropic-messages provider 走 Anthropic SDK。部分服务会验证
		// User-Agent 避免非官方客户端，所以需要模拟 SDK 的默认值。
		return hasUserAgent ? headers : { ...headers, "User-Agent": "anthropic-sdk-typescript/0.27.3" };
	}

	private redactSecret(value: string, apiKey: string) {
		if (!apiKey) return value;
		return value.split(apiKey).join("***");
	}

	/**
	 * 根据 API 类型从响应中提取模型名、文本片段和 token 用量。
	 */
	private parseTestResponse(
		body: Record<string, unknown>,
		modelId: string,
		apiType: string,
	): { model: string; snippet: string; tokens?: { input?: number; output?: number } } {
		const api = this.normalizeApiType(apiType);
		switch (api) {
			case "openai-completions": {
				const choices = body.choices as Array<Record<string, unknown>> | undefined;
				const text = (choices?.[0]?.text as string) ?? "(空响应)";
				const usage = body.usage as Record<string, unknown> | undefined;
				return {
					model: (body.model as string) ?? modelId,
					snippet: text,
					tokens: {
						input: usage?.prompt_tokens as number | undefined,
						output: usage?.completion_tokens as number | undefined,
					},
				};
			}

			case "openai-responses":
			case "openai-codex-responses": {
				const output = body.output as Array<Record<string, unknown>> | undefined;
				const content = output?.[0]?.content as Array<Record<string, unknown>> | undefined;
				const functionCall = output?.find(
					(item) => item.type === "function_call",
				);
				const text =
					(content?.[0]?.text as string | undefined) ??
					(functionCall
						? `工具调用兼容：${String(functionCall.name ?? "function_call")}`
						: "(空响应)");
				const usage = body.usage as Record<string, unknown> | undefined;
				return {
					model: (body.model as string) ?? modelId,
					snippet: text,
					tokens: {
						input: usage?.input_tokens as number | undefined,
						output: usage?.output_tokens as number | undefined,
					},
				};
			}

			case "anthropic-messages": {
				const content = body.content as Array<Record<string, unknown>> | undefined;
				const text = (content?.[0]?.text as string) ?? "(空响应)";
				const usage = body.usage as Record<string, unknown> | undefined;
				return {
					model: (body.model as string) ?? modelId,
					snippet: text,
					tokens: {
						input: usage?.input_tokens as number | undefined,
						output: usage?.output_tokens as number | undefined,
					},
				};
			}

			case "google-generative-ai": {
				const candidates = body.candidates as Array<Record<string, unknown>> | undefined;
				const parts = candidates?.[0]?.content as Record<string, unknown> | undefined;
				const text = (parts?.parts as Array<Record<string, unknown>>)?.[0]?.text as string ?? "(空响应)";
				const usage = body.usageMetadata as Record<string, unknown> | undefined;
				return {
					model: (body.modelVersion as string) ?? modelId,
					snippet: text,
					tokens: {
						input: usage?.promptTokenCount as number | undefined,
						output: usage?.candidatesTokenCount as number | undefined,
					},
				};
			}

			case "mistral-conversations": {
				const outputs = body.outputs as Array<Record<string, unknown>> | undefined;
				const firstOutput = outputs?.[0];
				const content = firstOutput?.content;
				const text = Array.isArray(content)
					? content
						.map((item) =>
							item && typeof item === "object"
								? String((item as Record<string, unknown>).text ?? "")
								: String(item ?? ""),
						)
						.filter(Boolean)
						.join(" ")
					: typeof content === "string"
						? content
						: (body.response as string | undefined) ?? "(空响应)";
				const usage = body.usage as Record<string, unknown> | undefined;
				return {
					model: (body.model as string) ?? modelId,
					snippet: text,
					tokens: {
						input: usage?.prompt_tokens as number | undefined,
						output: usage?.completion_tokens as number | undefined,
					},
				};
			}

			default:
				// openai-chat-completions
			{
				const choices = body.choices as Array<Record<string, unknown>> | undefined;
				const message = choices?.[0]?.message as Record<string, unknown> | undefined;
				const text = (message?.content as string) ?? "(空响应)";
				const usage = body.usage as Record<string, unknown> | undefined;
				return {
					model: (body.model as string) ?? modelId,
					snippet: text,
					tokens: {
						input: usage?.prompt_tokens as number | undefined,
						output: usage?.completion_tokens as number | undefined,
					},
				};
			}
		}
	}

	async testProviderConnection(
		baseUrl: string,
		apiKey: string,
		modelId: string,
		apiType?: string,
		requestHeaders?: Record<string, string>,
	): Promise<{
		success: boolean;
		model?: string;
		snippet?: string;
		tokens?: { input?: number; output?: number };
		latencyMs?: number;
		error?: string;
		requestUrl?: string;
		requestBody?: string;
		/** 检测侧补了 /v1，配置仍是根路径 → 会话侧可能失败 */
		sessionBaseUrlNeedsVersion?: boolean;
		/** 建议写入配置的 baseUrl；仅 success 时由 UI 自动改写 */
		suggestedBaseUrl?: string;
	}> {
		const startedAt = Date.now();
		const api = this.normalizeApiType(apiType);
		const { url: requestUrl, headers, body: requestBody } =
			this.buildTestRequest(baseUrl, apiKey, modelId, api, requestHeaders);
		const safeRequestUrl = this.redactSecret(requestUrl, apiKey);
		const safeRequestBody = this.redactSecret(requestBody, apiKey);
		// 与 fetch 一致：检测用了补齐路径、配置仍是根路径时给出建议 baseUrl。
		const sessionBaseUrlNeedsVersion = needsSessionBaseUrlVersionHint(
			baseUrl,
			requestUrl,
		);
		const suggestedBaseUrl =
			suggestNormalizedBaseUrl(baseUrl, requestUrl, api) ?? undefined;

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);

			let res: Awaited<ReturnType<typeof net.fetch>>;
			try {
				res = await net.fetch(requestUrl, {
					method: "POST",
					headers,
					body: requestBody,
					signal: controller.signal,
				});
			} finally {
				clearTimeout(timeout);
			}

			const latencyMs = Date.now() - startedAt;

			if (!res.ok) {
				let detail = `${res.status} ${res.statusText}`;
				try {
					const errBody = (await res.json()) as Record<string, unknown>;
					const errMsg =
						(errBody.error as Record<string, unknown>)?.message ??
						errBody.message ??
						"";
					if (errMsg) detail += ` — ${String(errMsg)}`;
				} catch {
					/* 忽略解析错误 */
				}
				// 失败时不自动改写 baseUrl，只保留诊断字段。
				return {
					success: false,
					error: this.redactSecret(detail, apiKey),
					latencyMs,
					requestUrl: safeRequestUrl,
					requestBody: safeRequestBody,
					sessionBaseUrlNeedsVersion,
				};
			}

			const body = (await res.json()) as Record<string, unknown>;
			const parsed = this.parseTestResponse(body, modelId, api);

			return {
				success: true,
				...parsed,
				latencyMs,
				requestUrl: safeRequestUrl,
				requestBody: safeRequestBody,
				sessionBaseUrlNeedsVersion,
				suggestedBaseUrl,
			};
		} catch (e) {
			const latencyMs = Date.now() - startedAt;
			const msg =
				e instanceof Error
					? e.name === "AbortError"
					? `请求超时（${PROVIDER_TEST_TIMEOUT_SECONDS} 秒）。这不一定代表兼容模式不支持或配置错误，可能是模型首包较慢、上游排队、代理/网络波动，或 reasoning 模型仍在内部思考。请稍后重试，或换用更轻量模型测试；如果模型列表可正常拉取，也可以保存配置后直接启动会话验证。`
					: e.message
					: String(e);
			return {
				success: false,
				error: this.redactSecret(msg, apiKey),
				latencyMs,
				requestUrl: safeRequestUrl,
				requestBody: safeRequestBody,
				sessionBaseUrlNeedsVersion,
			};
		}
	}

	// ── 导出 / 导入 ───────────────────────────────────────

	/** 将三个配置文件打包为单个 JSON 对象，便于用户备份和迁移。 */
	async exportConfig(): Promise<string> {
		const [models, auth, settings] = await Promise.all([
			this.readJsonFile<PiModelsFile>("models.json", { providers: {} }),
			this.readJsonFile<PiAuthFile>("auth.json", {}),
			this.readJsonFile<PiSettings>("settings.json", {}),
		]);
		return JSON.stringify(
			{
				version: 1,
				exportedAt: new Date().toISOString(),
				files: {
					"models.json": models.parsed,
					"auth.json": auth.parsed,
					"settings.json": settings.parsed,
				},
			},
			null,
			2,
		);
	}

	/** 从导出的 JSON 包恢复配置文件，返回导入结果。 */
	async importConfig(
		packageJson: string,
	): Promise<ConfigValidationResult> {
		let pkg: unknown;
		try {
			pkg = JSON.parse(packageJson);
		} catch (e) {
			return {
				valid: false,
				error: `JSON 格式错误：${e instanceof Error ? e.message : String(e)}`,
			};
		}
		const data = pkg as Record<string, unknown>;
		const files = data.files as Record<string, unknown> | undefined;
		if (!files || typeof files !== "object") {
			return { valid: false, error: "导入文件缺少 files 字段，请确认是 PiDeck 导出的配置包" };
		}

		// 按需写入，只处理三个已知文件名，忽略其他 key
		const allowed: Array<[string, string]> = [
			["models.json", "models.json"],
			["auth.json", "auth.json"],
			["settings.json", "settings.json"],
		];
		for (const [key, fileName] of allowed) {
			if (files[key] != null) {
				await this.writeJsonFile(fileName, files[key]);
			}
		}
		return { valid: true };
	}
}
