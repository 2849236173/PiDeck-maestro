/** 当前 agent 的并行工具调用集合，以及本次事件是否结束了整个工具批次。 */
export interface ActiveToolCallState {
  calls: Map<string, string>;
  isExecutingTool: boolean;
  executingToolName?: string;
  completedBatch: boolean;
  /** end 事件实际匹配到的活动调用；用于同步修正缺失或错配的上游 ID。 */
  endedToolCallId?: string;
}

/**
 * 以 toolCallId 归并并行工具事件。只有已追踪集合从非空变为空时才产生 final-end，
 * 防止首个并行工具结束或迟到的重复 end 被误判成可投递 steer 的窗口。
 */
export function updateActiveToolCalls(
  current: ReadonlyMap<string, string>,
  event:
    | { type: "start"; toolCallId: string; toolName: string }
    | { type: "end"; toolCallId?: string; toolName?: string },
): ActiveToolCallState {
  const calls = new Map(current);
  let endedToolCallId: string | undefined;
  if (event.type === "start") {
    calls.set(event.toolCallId, event.toolName);
  } else {
    const requestedId = event.toolCallId?.trim();
    if (requestedId && calls.has(requestedId)) {
      endedToolCallId = requestedId;
    } else if (calls.size === 1) {
      // 单工具批次没有歧义；兼容 Pi/扩展遗漏或重写 toolCallId 的终态事件。
      endedToolCallId = calls.keys().next().value;
    } else if (event.toolName) {
      const sameName = [...calls.entries()].filter(([, name]) => name === event.toolName);
      // 并行批次只有工具名唯一时才回退，避免迟到/重复 end 误删另一个同名调用。
      if (sameName.length === 1) endedToolCallId = sameName[0][0];
    }
    if (endedToolCallId) calls.delete(endedToolCallId);
  }
  const executingToolName = Array.from(calls.values()).at(-1);
  return {
    calls,
    isExecutingTool: calls.size > 0,
    executingToolName,
    completedBatch: event.type === "end" && Boolean(endedToolCallId) && current.size > 0 && calls.size === 0,
    endedToolCallId,
  };
}
