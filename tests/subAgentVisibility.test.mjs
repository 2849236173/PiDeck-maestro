import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sub-agent panel is connected to preload state and detail APIs", () => {
  const preload = readFileSync("src/preload/index.ts", "utf8");
  const panel = readFileSync("src/renderer/src/components/app/SubAgentPanel.tsx", "utf8");
  // 详情加载已从面板内嵌展开迁移到独立弹层 SubAgentDetailModal
  const detailModal = readFileSync("src/renderer/src/components/app/SubAgentDetailModal.tsx", "utf8");

  assert.match(preload, /subAgents:\s*\{/);
  assert.match(preload, /subAgentsStateUpdate/);
  assert.match(preload, /subAgentsLoadDetail/);
  assert.match(panel, /api\.subAgents\.onState/);
  assert.match(panel, /payload\.agentId === agentId/);
  assert.match(detailModal, /api\.subAgents\.loadDetail/);
  assert.doesNotMatch(panel, /running'\)} \(0\)/);
});

test("sub-agent monitoring handles new sessions and nested teammate session files", () => {
  const manager = readFileSync("src/main/pi/AgentManager.ts", "utf8");

  assert.match(manager, /if \(tab\.sessionPath\) \{\s*this\.startSubAgentMonitoring\(id, tab\.sessionPath\)/);
  assert.match(manager, /collectSubAgentSessionFiles/);
  assert.match(manager, /replace\(\/\\\.jsonl\$\/i, ''\)/);
  assert.match(manager, /record\?\.message/);
  assert.match(manager, /previousAgentProgress/);
  assert.match(manager, /watch\(subAgentDir, \{ recursive: process\.platform === "win32" \}/);
});

test("parent tool end finalizes remaining active teammate placeholders", () => {
  const manager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
  assert.match(manager, /toolStatus === "done" && snapshots\.length === 0 \? "finalizing"/);
  assert.match(manager, /parent tool 进入终态后，收敛仍挂在同一 toolCallId/);
  assert.match(manager, /subAgent\.parentToolCallId !== toolCallId/);
  assert.match(manager, /toolStatus === "error" \? "failed" : "completed"/);
});

test("teammate lifecycle creates immediate placeholders and does not complete on assistant stop", () => {
  const manager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
  const types = readFileSync("src/shared/types.ts", "utf8");
  const panel = readFileSync("src/renderer/src/components/app/SubAgentPanel.tsx", "utf8");

  assert.match(manager, /syncSubAgentsFromToolEvent\(agentId, typed, "running"\)/);
  assert.match(manager, /`tool:\$\{toolCallId\}:\$\{taskIndex\}`/);
  assert.match(manager, /subAgent\.parentToolCallId \? 'finalizing'/);
  assert.match(manager, /subAgent\.endTime = stat\.mtimeMs/);
  assert.match(manager, /if \(!subAgent\.endTime\) subAgent\.endTime = subAgent\.lastUpdate \|\| now/);
  assert.match(manager, /candidate\.correlationId && pathSegments\.includes\(candidate\.correlationId\)/);
  assert.match(types, /'pending' \| 'running' \| 'finalizing' \| 'completed'/);
  assert.match(panel, /t\('subAgent\.finalizing'\)/);
  assert.match(panel, /disabled=\{!item\.sessionFile\}/);
  assert.match(manager, /endTime: subAgent\.endTime \?\? subAgent\.lastUpdate \+ AgentManager\.SUB_AGENT_STALL_MS/);
  assert.match(panel, /const hasLiveRunning = state\.running\.some\(\(item\) => !item\.stalled\)/);
  assert.match(panel, /if \(!hasLiveRunning\) return/);
});

test("sub-agent details reuse rich assistant rendering and separate active count from history", () => {
  const panel = readFileSync("src/renderer/src/components/app/SubAgentPanel.tsx", "utf8");
  // 详情渲染已迁移到独立弹层；富文本渲染断言改查 SubAgentDetailModal
  const detailModal = readFileSync("src/renderer/src/components/app/SubAgentDetailModal.tsx", "utf8");

  // AssistantText 与 ThinkingBlock/ToolCard 已合并为同一条 import；只断言它确实来自 AppParts
  assert.match(detailModal, /import \{[^}]*AssistantText[^}]*\} from '\.\/AppParts'/);
  assert.match(detailModal, /<AssistantText[\s\S]*?text=\{message\.text\}/);
  assert.match(panel, /subAgent\.activeCount/);
  assert.match(panel, /subAgent\.history/);
  assert.match(panel, /historyExpanded &&/);
  assert.match(panel, /state\.todos\.flatMap/);
  assert.match(panel, /record\.subject, record\.title, record\.name, record\.description, record\.command/);
  assert.match(panel, /if \(typeof candidate !== 'string'\) return \[\]/);
  assert.match(panel, /task\.displaySubject/);
  assert.doesNotMatch(panel, /typeof task\.subject === 'string' \? task\.subject : ''/);
});

test("sub-agent detail stays content-sized and tool counting supports Pi session records", () => {
  const detailModal = readFileSync("src/renderer/src/components/app/SubAgentDetailModal.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles.css", "utf8");
  const manager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
  const panel = readFileSync("src/renderer/src/components/app/SubAgentPanel.tsx", "utf8");

  assert.match(detailModal, /size="medium" contentClassName="subagent-detail-modal"/);
  assert.match(styles, /\.modal-radix-content\.subagent-detail-modal\s*\{[\s\S]*?width: min\(1080px, calc\(100vw - 48px\)\)[\s\S]*?min-width: min\(640px,[\s\S]*?min-height: min\(360px,[\s\S]*?resize: both/);
  assert.match(styles, /\.subagent-detail-body\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?overflow-y: auto/);
  assert.match(manager, /block\?\.type === 'toolCall'/);
  assert.match(manager, /Math\.max\(item\.toolCount, existing\?\.toolCount \?\? 0\)/);
  assert.match(panel, /subAgent\.durationMinutesSeconds/);
});

test("sub-agent panel occupies the dedicated grid column in expanded and collapsed layouts", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles.css", "utf8");

  assert.match(app, /subAgentPanelVisible && \(/);
  assert.match(app, /<SubAgentPanel[\s\S]*?agentId=\{activeAgentId\}[\s\S]*?api=\{api\}/);
  assert.match(styles, /\.subagent-panel\s*\{[\s\S]*?grid-column:\s*4/);
  const collapsed = styles.match(/\.wechat-shell\.list-collapsed\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(collapsed, /var\(--subagent-panel-col-w\)/);
});
