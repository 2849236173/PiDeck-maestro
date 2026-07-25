import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sub-agent panel is connected to preload state and detail APIs", () => {
  const preload = readFileSync("src/preload/index.ts", "utf8");
  const panel = readFileSync("src/renderer/src/components/app/SubAgentPanel.tsx", "utf8");

  assert.match(preload, /subAgents:\s*\{/);
  assert.match(preload, /subAgentsStateUpdate/);
  assert.match(preload, /subAgentsLoadDetail/);
  assert.match(panel, /api\.subAgents\.onState/);
  assert.match(panel, /payload\.agentId === agentId/);
  assert.match(panel, /api\.subAgents\.loadDetail/);
  assert.doesNotMatch(panel, /running'\)} \(0\)/);
});

test("sub-agent monitoring handles new sessions and nested teammate session files", () => {
  const manager = readFileSync("src/main/pi/AgentManager.ts", "utf8");

  assert.match(manager, /if \(tab\.sessionPath\) \{\s*this\.startSubAgentMonitoring\(id, tab\.sessionPath\)/);
  assert.match(manager, /collectSubAgentSessionFiles/);
  assert.match(manager, /replace\(\/\\\.jsonl\$\/i, ''\)/);
  assert.match(manager, /record\?\.message/);
  assert.match(manager, /previousAgentProgress/);
});

test("sub-agent panel occupies the dedicated grid column in expanded and collapsed layouts", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles.css", "utf8");

  assert.match(app, /subAgentPanelVisible && \(/);
  assert.match(app, /<SubAgentPanel agentId=\{activeAgentId\} api=\{api\}/);
  assert.match(styles, /\.subagent-panel\s*\{[\s\S]*?grid-column:\s*4/);
  const collapsed = styles.match(/\.wechat-shell\.list-collapsed\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(collapsed, /var\(--subagent-panel-col-w\)/);
});
