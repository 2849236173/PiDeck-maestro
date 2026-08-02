import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const agentManagerSource = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const ipcSource = readFileSync("src/shared/ipc.ts", "utf8");

function sourceBetween(start, end) {
  const startIndex = agentManagerSource.indexOf(start);
  const endIndex = agentManagerSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return agentManagerSource.slice(startIndex, endIndex);
}

function loadModule(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const sandbox = { exports: module.exports, module, require };
  vm.runInNewContext(outputText, sandbox, { filename: sourcePath });
  return module.exports;
}

function loadRetryClassifier() {
  const start = agentManagerSource.indexOf("function isRetryableModelRequestError");
  const endMarker = "\n}\n\nexport class AgentManager";
  const end = agentManagerSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, "missing retry classifier");
  assert.notEqual(end, -1, "missing retry classifier end marker");

  const source = `${agentManagerSource.slice(start, end + 2)}\nexport { isRetryableModelRequestError };`;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  const sandbox = { exports: module.exports, module };
  vm.runInNewContext(outputText, sandbox, { filename: "retry-classifier.ts" });
  return module.exports.isRetryableModelRequestError;
}

test("main process avoids duplicate high-frequency event and log IPC", () => {
  assert.doesNotMatch(ipcSource, /agentsEvent|agents:event/);
  assert.doesNotMatch(agentManagerSource, /ipcChannels\.agentsEvent/);

  const loggingGuards = agentManagerSource.match(
    /if \(!this\.rpcLoggingAgents\.has\((?:id|agentId)\)\) return;/g,
  ) ?? [];
  assert.equal(loggingGuards.length, 2, "create and reattach paths must both gate RPC payloads");
});

test("tool edges stay local and progress IPC remains coalesced", () => {
  const toolStart = sourceBetween(
    'if (typed.type === "tool_execution_start")',
    'if (typed.type === "tool_execution_end")',
  );
  const toolEnd = sourceBetween(
    'if (typed.type === "tool_execution_end")',
    'if (typed.type === "tool_execution_update")',
  );
  const toolUpdate = sourceBetween(
    'if (typed.type === "tool_execution_update")',
    'if (typed.type === "extension_ui_request")',
  );

  assert.match(toolStart, /applyActiveToolCallState/);
  assert.match(toolEnd, /applyActiveToolCallState/);
  assert.doesNotMatch(toolStart, /emitRuntimeState/);
  assert.doesNotMatch(toolEnd, /emitRuntimeState/);
  assert.doesNotMatch(toolUpdate, /flushMessageEmit/);

  // 常规对话严格以 Pi 的 agent_settled 为空闲终点，不从 agent_end 定时推断。
  assert.doesNotMatch(agentManagerSource, /AGENT_SETTLED_TIMEOUT_MS/);
  const agentEnd = sourceBetween(
    'if (typed.type === "agent_end")',
    'if (typed.type === "agent_settled")',
  );
  assert.doesNotMatch(agentEnd, /markIdleIfPiReportsNoWork|setTimeout/);
});

test("Deck retries transient model failures five times with progressive delays", () => {
  assert.match(agentManagerSource, /const DECK_MODEL_RETRY_POLICY = Object\.freeze\(\{[\s\S]*?maxRetries: 5,[\s\S]*?initialDelayMs: 1_000,[\s\S]*?maxDelayMs: 16_000,/);
  assert.match(agentManagerSource, /initialDelayMs \* 2 \*\* \(normalizedAttempt - 1\)/);
  assert.match(agentManagerSource, /upstream\[_\\s-\]\*error\|upstream request failed/);

  const agentEnd = sourceBetween(
    'if (typed.type === "agent_end")',
    'if (typed.type === "agent_settled")',
  );
  assert.match(agentEnd, /isRetryableModelRequestError/);
  assert.match(agentEnd, /retryAttempt < DECK_MODEL_RETRY_POLICY\.maxRetries/);
  assert.match(agentEnd, /deckModelRetryDelayMs\(nextRetryAttempt\)/);
  assert.match(agentEnd, /retryLastPromptAfterModelError\(agentId, delayMs\)/);
  assert.match(agentEnd, /!this\.runHadToolCalls\.has\(agentId\)/);

  // 新用户请求会清空旧预算；自动重发保留它，直到本次成功或最终失败。
  assert.match(agentManagerSource, /if \(!this\.pendingDeckModelRetries\.has\(input\.agentId\)\) \{[\s\S]*?this\.deckModelRetryAttempts\.delete\(input\.agentId\);/);
  assert.match(agentManagerSource, /if \(this\.pendingDeckModelRetries\.has\(agentId\)\) \{[\s\S]*?this\.upsertRetryStatusMessage\(agentId, \{[\s\S]*?attempt: this\.deckModelRetryAttempts\.get\(agentId\) \?\? 1,/);

  const agentStart = sourceBetween(
    'if (typed.type === "agent_start"',
    'if (typed.type === "message_start"',
  );
  assert.doesNotMatch(agentStart, /pendingDeckModelRetries\.delete/);
  assert.match(agentStart, /phase: "attempting"[\s\S]*?"running"/);
  assert.match(agentEnd, /deckRetryInProgress && !errorMsg && !endedWithUnknownError/);
  assert.match(agentEnd, /phase: "success"[\s\S]*?"success"/);
  assert.match(agentEnd, /phase: "error"[\s\S]*?"error"/);

  const retryPath = sourceBetween(
    "private async retryLastPromptAfterModelError",
    "private addDetailedErrorMessage",
  );
  assert.match(retryPath, /isRetryableModelRequestError\(errorMessage\)/);
  assert.match(retryPath, /attempt < DECK_MODEL_RETRY_POLICY\.maxRetries/);
  assert.match(retryPath, /nextAttempt = attempt \+ 1/);
  assert.match(retryPath, /pendingDeckModelRetries\.add\(agentId\)/);
  assert.match(retryPath, /retryLastPromptAfterModelError\(agentId, nextDelayMs\)/);

  const agentSettled = sourceBetween(
    'if (typed.type === "agent_settled")',
    'typed.type === "message_update"',
  );
  assert.match(agentSettled, /deckRetryPending = this\.pendingDeckModelRetries\.has\(agentId\)/);
  assert.match(agentSettled, /deckRetryPending \? "running" : "idle"/);

  const isRetryable = loadRetryClassifier();
  assert.equal(isRetryable("terminated"), true);
  assert.equal(isRetryable("Upstream stream terminated"), true);
  assert.equal(isRetryable("fetch failed"), true);
  assert.equal(isRetryable("stream_read_error: connection closed"), true);
  assert.equal(isRetryable("Request cancelled and terminated by user"), false);
});

test("retry status survives session reload without restoring unrelated runtime messages", () => {
  const { mergeHistoryWithPreservedMessages } = loadModule(
    "src/main/pi/historyMessages.ts",
  );
  const history = [
    { id: "user-1", role: "user", text: "hello", timestamp: 1 },
  ];
  const current = [
    ...history,
    { id: "stale-assistant", role: "assistant", text: "failed", timestamp: 2 },
    {
      id: "retry-status",
      role: "system",
      text: "waiting",
      timestamp: 3,
      meta: { type: "modelRetry" },
    },
  ];

  const merged = mergeHistoryWithPreservedMessages(
    history,
    current,
    undefined,
    new Set(["retry-status"]),
  );
  assert.deepEqual(Array.from(merged, (message) => message.id), ["user-1", "retry-status"]);
});

test("retry status text exposes waiting, attempting, success, and terminal failure", () => {
  const { formatModelRetryStatusText } = loadModule(
    "src/main/pi/modelRetryStatus.ts",
  );
  const base = { attempt: 2, maxAttempts: 5, delayMs: 2_000, reason: "fetch failed" };

  assert.equal(
    formatModelRetryStatusText({ ...base, phase: "waiting" }),
    "请求失败，2 秒后重试（2/5）\n原因：fetch failed",
  );
  assert.equal(
    formatModelRetryStatusText({ ...base, phase: "attempting" }),
    "正在进行第 2/5 次重试\n原因：fetch failed",
  );
  assert.equal(
    formatModelRetryStatusText({ ...base, phase: "success" }),
    "第 2/5 次重试成功",
  );
  assert.equal(
    formatModelRetryStatusText({ ...base, attempt: 5, phase: "error" }),
    "已重试 5/5 次，仍然失败\n原因：fetch failed",
  );
});

test("mergeAgentRuntimeState skips update when nothing changed", () => {
  const { mergeAgentRuntimeState } = loadModule(
    "src/renderer/src/utils/agentRuntimeState.ts",
  );

  const state = {
    isStreaming: true,
    isExecutingTool: false,
    activeToolCall: null,
  };

  // Same values → should return reference unchanged.
  const same = mergeAgentRuntimeState(state, {
    isStreaming: true,
    isExecutingTool: false,
    activeToolCall: null,
  });
  assert.equal(same, state, "should return same reference when no change");

  // Different values → should return new object.
  const changed = mergeAgentRuntimeState(state, {
    isStreaming: false,
    isExecutingTool: false,
    activeToolCall: null,
  });
  assert.notEqual(changed, state, "should return new object when changed");
  assert.equal(changed.isStreaming, false);
});
