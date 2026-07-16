import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/renderer/src/App.tsx", "utf8");
const turnRowSource = readFileSync(
  "src/renderer/src/components/app/AppParts.tsx",
  "utf8",
);

test("renders the execution process before the final assistant answer", () => {
  assert.ok(
    turnRowSource.indexOf("{/* 执行过程概要") < turnRowSource.indexOf("{/* 最终回答"),
    "the execution summary must precede the final answer in TurnRow",
  );
});

test("only the latest agent run receives the global running state", () => {
  const timelineRender = source.slice(
    source.indexOf("{renderedRuns.map"),
    source.indexOf("// 独立消息条目"),
  );
  assert.match(
    timelineRender,
    /agentRunning=\{isAgentBusy && index === renderedRuns\.length - 1\}/,
  );
  assert.doesNotMatch(timelineRender, /agentRunning=\{isAgentBusy\}/);
});
