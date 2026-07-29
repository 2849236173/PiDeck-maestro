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
