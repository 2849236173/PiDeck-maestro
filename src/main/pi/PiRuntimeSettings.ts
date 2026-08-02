export const PI_MODEL_RETRY_MAX_ATTEMPTS = 5;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * 补齐 PiDeck 运行模型所需的重试设置。
 * timeout 属于用户对流空闲/请求时长的运行时选择，不能为了网络重试而覆盖；
 * 未配置时交给 Pi 使用自身默认值，避免把正常请求人为拉成长等待。
 */
export function normalizePiRuntimeSettings(current: JsonRecord): {
	settings: JsonRecord;
	changed: boolean;
} {
	const settings = { ...current };
	let changed = false;

	const currentRetry = isRecord(current.retry) ? current.retry : {};
	const retry = { ...currentRetry };
	if (retry.enabled !== true) {
		retry.enabled = true;
		changed = true;
	}
	if (
		!isFiniteNumber(retry.maxRetries) ||
		retry.maxRetries < PI_MODEL_RETRY_MAX_ATTEMPTS
	) {
		retry.maxRetries = PI_MODEL_RETRY_MAX_ATTEMPTS;
		changed = true;
	}
	if (!isFiniteNumber(retry.baseDelayMs) || retry.baseDelayMs < 0) {
		retry.baseDelayMs = 2_000;
		changed = true;
	}

	if (changed || !isRecord(current.retry)) {
		settings.retry = retry;
	}

	return { settings, changed };
}
