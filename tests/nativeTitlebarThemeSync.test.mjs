import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

test("main process syncs native titlebar appearance with app theme", () => {
  assert.match(source, /function applyNativeThemeSource\(settings: AppSettings\)/);
  assert.match(source, /nativeTheme\.themeSource\s*=\s*settings\.theme === "system" \? "system" : settings\.theme;/);
  assert.match(source, /applyNativeThemeSource\(settingsStore\.get\(\)\);[\s\S]*new BrowserWindow/);
  assert.match(source, /if \("theme" in patch\) \{[\s\S]*applyNativeThemeSource\(settings\);/);
});
