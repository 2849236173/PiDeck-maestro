import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const promptSource = readFileSync("src/renderer/src/components/app/MaestroHealthPrompt.tsx", "utf8");
const configSource = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
const skillsSource = readFileSync("src/renderer/src/config/SkillsTab.tsx", "utf8");
const i18nSource = readFileSync("src/renderer/src/i18n.ts", "utf8");
const ipcSource = readFileSync("src/shared/ipc.ts", "utf8");
const preloadSource = readFileSync("src/preload/index.ts", "utf8");
const previewSource = readFileSync("src/renderer/src/previewApi.ts", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");

test("Maestro startup health is delayed, session-deduplicated, and honors update settings", () => {
	assert.match(
		appSource,
		/setTimeout\(\s*\(\) => void checkMaestroHealthOnStartup\(!next\.disableUpdateCheck\),\s*1800/,
	);
	assert.match(appSource, /if \(maestroHealthCheckedRef\.current\) return/);
	assert.match(appSource, /maestroHealthCheckedRef\.current = true/);
	assert.match(appSource, /const hasMissing = health\.packages\.some\(\(pkg\) => !pkg\.installed\)/);
	assert.match(appSource, /pkg\.source === "npm:pi-maestro-flow" && pkg\.hasUpdate/);
	assert.match(appSource, /catch \{[\s\S]*?Pi\/网络尚未就绪时静默跳过/);
});

test("Maestro health API is wired through shared IPC, main, preload, and preview", () => {
	assert.match(ipcSource, /extensionsMaestroHealth: "extensions:maestro-health"/);
	assert.match(mainSource, /ipcMain\.handle\(ipcChannels\.extensionsMaestroHealth/);
	assert.match(mainSource, /extensionManager\.checkMaestroHealth\(checkForUpdates !== false\)/);
	assert.match(preloadSource, /checkMaestroHealth: \(checkForUpdates = true\)/);
	assert.match(preloadSource, /ipcChannels\.extensionsMaestroHealth, checkForUpdates/);
	assert.match(previewSource, /checkMaestroHealth: async \(checkForUpdates = true\)/);
});

test("health prompt is actionable and non-modal, and opens Extensions directly", () => {
	assert.match(promptSource, /<aside className="maestro-health-prompt" role="status" aria-live="polite">/);
	assert.doesNotMatch(promptSource, /<Modal|modal-backdrop/);
	assert.match(promptSource, /onOpenExtensions/);
	assert.match(appSource, /setConfigInitialSection\("extensions"\)/);
	assert.match(appSource, /initialSection=\{configInitialSection\}/);
	assert.match(configSource, /initialSection\?: ConfigSection/);
	assert.match(configSource, /if \(open && props\.initialSection\) setSection\(props\.initialSection\)/);
});

test("Skills list aggregates every source and hides mutations for package-owned Skills", () => {
	assert.match(skillsSource, /const filteredSkills = data\.skills/);
	assert.doesNotMatch(skillsSource, /data\.skills\.filter\(\(s\) => s\.sourceId === props\.newLocationId\)/);
	assert.match(skillsSource, /const writableLocations = data\.locations\.filter\(\(location\) => !location\.readOnly\)/);
	assert.match(skillsSource, /\{!skill\.readOnly && \([\s\S]*className="prompts-list-item-actions"/);
	assert.match(skillsSource, /skill\.readOnly \? t\("config\.skillReadOnly"\)/);
});

test("new Maestro health and read-only messages are bilingual", () => {
	for (const key of [
		"maestroHealth.missingTitle",
		"maestroHealth.updateTitle",
		"maestroHealth.openExtensions",
		"config.skillReadOnly",
		"config.skillReadOnlyBadge",
	]) {
		assert.equal((i18nSource.match(new RegExp(`"${key.replaceAll(".", "\\.")}"`, "g")) ?? []).length, 2, key);
	}
});
