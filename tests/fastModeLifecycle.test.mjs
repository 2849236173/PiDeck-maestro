import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const main = readFileSync("src/main/index.ts", "utf8");
const web = readFileSync("src/main/web/WebServiceManager.ts", "utf8");
const preview = readFileSync("src/renderer/src/previewApi.ts", "utf8");
const rendererApp = readFileSync("src/renderer/src/App.tsx", "utf8");
const sharedTypes = readFileSync("src/shared/types.ts", "utf8");
const browserApi = readFileSync("src/renderer/src/browserApi.ts", "utf8");

test("Fast mode hydrates from the session marker when an Agent is created or its session changes", () => {
  assert.match(manager, /await this\.hydrateFastMode\(id, tab\.sessionPath\)/);
  assert.match(manager, /this\.clearFastModeCache\(agentId\);[\s\S]*?await this\.hydrateFastMode\(agentId, runtime\.tab\.sessionPath\)/);
  assert.match(manager, /const marker = await readFile\(markerPath, "utf8"\)/);
});

test("Fast mode rejects no-session Agents and persists before updating the cache", () => {
  assert.match(manager, /throw new Error\("Fast mode requires a persisted session"\)/);
  assert.match(manager, /await this\.writeFastModeMarker\(agentId, enabled\);[\s\S]*?this\.fastModeByAgent\.set\(agentId, enabled\)/);
  assert.match(manager, /const previous = this\.fastModeMutations\.get\(agentId\) \?\? Promise\.resolve\(\)/);
});

test("Agent creation is gated by Fast extension readiness", () => {
  assert.match(manager, /await this\.fastExtensionReady;[\s\S]*?const t0 = Date\.now\(\)/);
  assert.match(main, /agentManager\.setFastExtensionReady\(fastExtensionReady\)/);
  assert.match(main, /syncWslEnvironment\(settingsStore\.get\(\)\)[\s\S]*?extensionManager\.ensureFastExtension\(\)/);
});

test("preview Fast mode preserves the independently selected thinking level", () => {
  assert.match(preview, /let previewThinkingLevel = "low"/);
  assert.match(preview, /previewThinkingLevel = level/);
  assert.match(preview, /setFastMode: async \(_agentId, enabled\) => \{[\s\S]*?previewFastMode = enabled;[\s\S]*?thinkingLevel: previewThinkingLevel/);
  assert.match(preview, /runtimeState: async \(\) => \(\{[\s\S]*?thinkingLevel: previewThinkingLevel,[\s\S]*?fastMode: previewFastMode/);
});

test("Fast UI is gated by runtime extension readiness", () => {
  assert.match(sharedTypes, /fastModeSupported\?: boolean/);
  assert.match(manager, /fastModeSupported: this\.fastExtensionAvailable/);
  assert.match(rendererApp, /supportsFastMode\(activeRuntimeState\.modelId\)[\s\S]*?activeRuntimeState\.fastModeSupported !== false/);
  assert.match(rendererApp, /app\.fastModeExtensionUnavailable/);
});

test("Sub-agent terminal convergence rescans the session tail before deciding failure", () => {
  assert.match(manager, /private async finalizeSubAgentsAfterAgentEnd/);
  assert.match(manager, /if \(subAgent\.sessionFile\) await this\.extractSubAgentInfo\(subAgent\);[\s\S]*?subAgentScanState\.get\(subAgent\.sessionFile\)\?\.hasError/);
  assert.match(manager, /await this\.finalizeSubAgentsAfterAgentEnd\(/);
});

test("First-token delivery avoids the preflight and first-message batch delay", () => {
  assert.match(manager, /Do not preflight get_commands here/);
  assert.match(manager, /this\.scheduleMessageEmit\(agentId, !existing && list\[list\.length - 1\]\?\.role === "assistant"\)/);
  assert.match(browserApi, /WEB_STATE_POLL_INTERVAL_MS = 200/);
});

test("Fast Web mutation accepts loopback only", () => {
  assert.match(web, /request\.socket\.remoteAddress\?\.replace\(\/\^::ffff:\//);
  assert.match(web, /remoteAddress !== "127\.0\.0\.1" && remoteAddress !== "::1"/);
  assert.match(web, /Fast mode is only available from loopback/);
});
