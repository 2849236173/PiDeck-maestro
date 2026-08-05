export type ConfigTab = "models" | "auth" | "settings" | "maestro" | "trust" | "vision" | "raw";

export type {
	TeammateModelConfigSaveRequest,
	TeammateModelConfigScope,
	TeammateModelConfigSnapshot,
	TeammateModelRoutingFile,
	TeammateModelTaskType,
} from "../../../shared/types";

// ── 匹配 pi 实际文件格式的类型 ────────────────────────

export type ThinkingLevelMap = Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh", string | null>>;

export type ProviderCompat = {
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	[key: string]: unknown;
};

export type ModelItem = {
	id: string;
	name?: string;
	reasoning?: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	[key: string]: unknown;
};

export type ProviderConfig = {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	compat?: ProviderCompat;
	models: ModelItem[];
	[key: string]: unknown;
};

export type ModelsFile = { providers: Record<string, ProviderConfig> };
export type AuthFile = Record<
	string,
	{ type?: string; key?: string; [key: string]: unknown }
>;
export type SettingsFile = Record<string, unknown>;

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type VisionConfig = {
	enabled: boolean;
	provider?: string;
	model?: string;
	maxDimension: number;
	jpegQuality: number;
	defaultReasoningEffort: ReasoningLevel;
	systemPrompt?: string;
	cacheEnabled: boolean;
	cachePersist: boolean;
	cacheMaxEntries: number;
	retryAttempts: number;
	retryBackoffMs: number;
	fallbackProvider?: string;
	fallbackModel?: string;
};

export const VISION_DEFAULTS: VisionConfig = {
	enabled: true,
	maxDimension: 1568,
	jpegQuality: 85,
	defaultReasoningEffort: "off",
	cacheEnabled: true,
	cachePersist: false,
	cacheMaxEntries: 256,
	retryAttempts: 2,
	retryBackoffMs: 500,
};

const REASONING_LEVELS: readonly ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function strOrUndef(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function isReasoningLevel(value: unknown): value is ReasoningLevel {
	return typeof value === "string" && REASONING_LEVELS.includes(value as ReasoningLevel);
}

/**
 * Matches the vision extension's tolerant config merge so a malformed or partial
 * vision.json cannot make the renderer fail while unknown extension fields stay raw.
 */
export function mergeVisionConfig(partial: unknown): VisionConfig {
	const value = partial && typeof partial === "object" && !Array.isArray(partial)
		? partial as Record<string, unknown>
		: {};
	return {
		enabled: typeof value.enabled === "boolean" ? value.enabled : VISION_DEFAULTS.enabled,
		provider: strOrUndef(value.provider),
		model: strOrUndef(value.model),
		maxDimension: clampInt(value.maxDimension, 1, 8000, VISION_DEFAULTS.maxDimension),
		jpegQuality: clampInt(value.jpegQuality, 1, 100, VISION_DEFAULTS.jpegQuality),
		defaultReasoningEffort: isReasoningLevel(value.defaultReasoningEffort)
			? value.defaultReasoningEffort
			: VISION_DEFAULTS.defaultReasoningEffort,
		systemPrompt: strOrUndef(value.systemPrompt),
		cacheEnabled: typeof value.cacheEnabled === "boolean" ? value.cacheEnabled : VISION_DEFAULTS.cacheEnabled,
		cachePersist: typeof value.cachePersist === "boolean" ? value.cachePersist : VISION_DEFAULTS.cachePersist,
		cacheMaxEntries: clampInt(value.cacheMaxEntries, 1, 100000, VISION_DEFAULTS.cacheMaxEntries),
		retryAttempts: clampInt(value.retryAttempts, 0, 10, VISION_DEFAULTS.retryAttempts),
		retryBackoffMs: clampInt(value.retryBackoffMs, 0, 60000, VISION_DEFAULTS.retryBackoffMs),
		fallbackProvider: strOrUndef(value.fallbackProvider),
		fallbackModel: strOrUndef(value.fallbackModel),
	};
}
