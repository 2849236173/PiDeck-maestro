export type ModelRetryPhase = "waiting" | "attempting" | "success" | "error";

export function formatModelRetryStatusText(input: {
	phase: ModelRetryPhase;
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	reason: string;
}): string {
	const countText = input.maxAttempts > 0
		? `${input.attempt}/${input.maxAttempts}`
		: String(input.attempt || 1);

	if (input.phase === "waiting") {
		const delayText = input.delayMs > 0
			? `，${Math.ceil(input.delayMs / 1000)} 秒后重试`
			: "，即将重试";
		return `请求失败${delayText}（${countText}）\n原因：${input.reason}`;
	}
	if (input.phase === "attempting") {
		return `正在进行第 ${countText} 次重试\n原因：${input.reason}`;
	}
	if (input.phase === "success") {
		return `第 ${countText} 次重试成功`;
	}
	return `已重试 ${countText} 次，仍然失败\n原因：${input.reason}`;
}
