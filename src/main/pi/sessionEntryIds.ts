/**
 * 会话 JSONL entryId 对齐与重发截断的纯函数。
 * 抽离出 AgentManager 以便单测覆盖「空 assistant 不消费 slot」这类错位回归。
 */

/**
 * 从 activeEntryIds 消费一个槽位。
 * 业务规则：get_entries 的 message 型 entry 与 get_messages 的
 * user/assistant/toolResult 一一对应；即使桌面端因空文本跳过渲染，
 * 也必须推进 index，否则后续消息的 entryId 会整体前移错位。
 */
export function takeActiveEntryId(
	activeEntryIds: string[] | undefined,
	entryIndex: number,
): { entryId?: string; nextIndex: number } {
	const entryId =
		activeEntryIds && entryIndex < activeEntryIds.length
			? activeEntryIds[entryIndex]
			: undefined;
	return { entryId, nextIndex: entryIndex + 1 };
}

/**
 * 模拟 convertAgentMessages 的 entryId 对齐逻辑（仅角色 + 空文本跳过规则）。
 * 用于回归：工具调用回合里「无文本的 assistant」不得打乱后续 entryId。
 */
export function alignEntryIdsForDisplayMessages(
	rawMessages: Array<{ role?: string; content?: unknown }>,
	activeEntryIds: string[],
	extractText: (content: unknown) => string,
): Array<{ role: string; entryId?: string; skipped: boolean }> {
	let entryIndex = 0;
	const result: Array<{ role: string; entryId?: string; skipped: boolean }> = [];

	for (const typed of rawMessages) {
		if (!typed || typeof typed !== "object") continue;
		const role = typed.role;
		if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;

		const { entryId, nextIndex } = takeActiveEntryId(activeEntryIds, entryIndex);
		// 无论是否渲染，message 型 entry 都要消费槽位
		entryIndex = nextIndex;

		if (role === "user" || role === "assistant") {
			const text = extractText(typed.content);
			const skipped = !text.trim();
			if (skipped && role === "assistant") {
				result.push({ role, entryId, skipped: true });
				continue;
			}
			if (skipped && role === "user") {
				result.push({ role, entryId, skipped: true });
				continue;
			}
			result.push({ role, entryId, skipped: false });
			continue;
		}

		// toolResult 始终展示（即使结果为空也有 ✓/✗ 摘要）
		result.push({ role: "tool", entryId, skipped: false });
	}

	return result;
}

/**
 * 收集 rootEntryId 及其全部后代 entry（沿 parentId 向下闭包）。
 * 重发时用于截断「该用户消息 + 之后的 assistant/tool」整段分支。
 */
export function collectDescendantEntryIds(
	lines: string[],
	rootEntryId: string,
): Set<string> {
	const removeIds = new Set<string>([rootEntryId]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const rawLine of lines) {
			const line = rawLine?.trim();
			if (!line) continue;
			try {
				const parsed = JSON.parse(line) as {
					id?: string;
					parentId?: string;
					type?: string;
				};
				if (!parsed?.id || parsed.type === "deleted") continue;
				if (parsed.parentId && removeIds.has(parsed.parentId) && !removeIds.has(parsed.id)) {
					removeIds.add(parsed.id);
					grew = true;
				}
			} catch {
				// 跳过无法解析的行
			}
		}
	}
	return removeIds;
}

export type ResendTextCandidate = string | readonly string[];

/** 桌面 Plan 模式注入的隐藏标记；pi-deck-plan-mode 扩展可能在落盘前剥离它。 */
export const PI_DECK_PLAN_MODE_MARKER = "__PI_DECK_PLAN_MODE__";

export type FindUserMessageOptions = {
	allowImageFallback?: boolean;
	/** 自动重试最近一条 prompt 时，允许直接取 JSONL 中最后一条 user，忽略正文差异。 */
	allowLastUserFallback?: boolean;
};

function normalizeTextCandidates(text: ResendTextCandidate): string[] {
	return [...new Set((Array.isArray(text) ? text : [text]).filter((value): value is string => typeof value === "string"))];
}

/**
 * 生成可用于定位的正文变体：原文、去掉 Plan 标记、extractText 去宿主后的结果。
 * Plan 扩展可能在落盘前剥离标记，宿主包装则由 extractText 剥离，两侧都要覆盖。
 */
export function expandResendTextCandidates(
	text: ResendTextCandidate,
	extractText: (content: unknown) => string = (value) => (typeof value === "string" ? value : ""),
): string[] {
	const expanded: string[] = [];
	for (const candidate of normalizeTextCandidates(text)) {
		expanded.push(candidate);
		const withoutPlanMarker = stripPiDeckPlanModeMarker(candidate);
		if (withoutPlanMarker) expanded.push(withoutPlanMarker);
		const extracted = extractText(candidate);
		if (extracted) expanded.push(extracted);
		const extractedWithoutPlan = stripPiDeckPlanModeMarker(extracted);
		if (extractedWithoutPlan) expanded.push(extractedWithoutPlan);
	}
	return [...new Set(expanded.filter(Boolean))];
}

export function stripPiDeckPlanModeMarker(text: string): string {
	if (!text) return "";
	if (!text.startsWith(PI_DECK_PLAN_MODE_MARKER)) return text;
	return text.slice(PI_DECK_PLAN_MODE_MARKER.length).replace(/^\s+/, "");
}

function isImagePlaceholderCandidate(candidates: string[], allowImageFallback: boolean): boolean {
	return allowImageFallback && candidates.includes("[图片]");
}

function isImageUserMessage(
	message: { content?: unknown } | undefined,
	extractText: (content: unknown) => string,
): boolean {
	if (!message) return false;
	const content = message.content;
	if (!Array.isArray(content)) return !extractText(content).trim();
	return content.some((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "image");
}

function entryTextMatchesCandidates(
	entryText: string,
	candidates: string[],
	extractText: (content: unknown) => string,
): boolean {
	if (candidates.includes(entryText)) return true;
	const normalizedEntry = stripPiDeckPlanModeMarker(extractText(entryText) || entryText);
	if (candidates.includes(normalizedEntry)) return true;
	return candidates.some((candidate) => {
		const normalizedCandidate = stripPiDeckPlanModeMarker(extractText(candidate) || candidate);
		return Boolean(normalizedCandidate) && normalizedCandidate === normalizedEntry;
	});
}

/**
 * 在 JSONL 中按「角色 + 文本」找最后一次匹配的用户消息行。
 * 重试时传入 agentMessage 和 UI 文本两个候选值：前者是实际落盘正文，后者只用于
 * 兼容旧会话或未能保留宿主包装的记录。图片消息允许匹配空文本/默认描述，和根节点校验规则一致。
 */
export function findLastUserMessageLine(
	lines: string[],
	text: ResendTextCandidate,
	extractText: (content: unknown) => string,
	options: FindUserMessageOptions = {},
): { lineIndex: number; entry: Record<string, unknown> } | null {
	const candidates = expandResendTextCandidates(text, extractText);
	const allowImageFallback = isImagePlaceholderCandidate(candidates, options.allowImageFallback === true);
	let found: { lineIndex: number; entry: Record<string, unknown> } | null = null;
	let lastUser: { lineIndex: number; entry: Record<string, unknown> } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trim();
		if (!line) continue;
		try {
			const entry = JSON.parse(line) as Record<string, unknown>;
			if (entry.type === "deleted") continue;
			const message = entry.message as { role?: string; content?: unknown } | undefined;
			if (message?.role !== "user") continue;
			lastUser = { lineIndex: i, entry };
			const entryText = extractText(message.content);
			if (
				entryTextMatchesCandidates(entryText, candidates, extractText) ||
				(allowImageFallback && isImageUserMessage(message, extractText))
			) {
				found = { lineIndex: i, entry };
			}
		} catch {
			// 跳过无法解析的行
		}
	}
	if (found) return found;
	// Deck 自动重试的是最近一次 prompt；扩展 transform 后正文可能与 UI/agentMessage 都不同，
	// 此时取 JSONL 最后一条 user 作为截断根是安全的。
	if (options.allowLastUserFallback) return lastUser;
	return null;
}

/**
 * 校验重发根节点必须是 user 消息，且文本与目标一致。
 * 防止 entryId 错位时把 assistant/更早的 user 当成截断根，误删整段历史。
 */
export function assertResendRootEntry(
	entry: Record<string, unknown>,
	expectedText: ResendTextCandidate,
	extractText: (content: unknown) => string,
	options: FindUserMessageOptions = {},
): void {
	const message = entry.message as { role?: string; content?: unknown } | undefined;
	if (!message || message.role !== "user") {
		throw new Error("Resend root must be a user message entry");
	}
	if (options.allowLastUserFallback) return;
	const candidates = expandResendTextCandidates(expectedText, extractText);
	const entryText = extractText(message.content);
	// 图片消息桌面端可能显示为「[图片]」，或被 pi 规范化为空文案/默认描述。
	const imageFallback = isImagePlaceholderCandidate(candidates, options.allowImageFallback === true)
		&& isImageUserMessage(message, extractText);
	if (!entryTextMatchesCandidates(entryText, candidates, extractText) && !imageFallback) {
		throw new Error(
			`Resend root text mismatch: expected ${JSON.stringify(candidates[0]?.slice(0, 80) ?? "")}, got ${JSON.stringify(entryText.slice(0, 80))}`,
		);
	}
}
