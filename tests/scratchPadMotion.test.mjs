import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("scratch pad uses short composited motion without a backdrop blur", () => {
  const overlay = cssRule("\\.scratch-pad-overlay");
  const panel = cssRule("\\.scratch-pad-panel");

  assert.ok(overlay, "scratch pad overlay styles must exist");
  assert.doesNotMatch(overlay, /backdrop-filter/);
  assert.match(overlay, /animation:\s*scratch-pad-backdrop-enter 120ms/);
  assert.ok(panel, "scratch pad panel styles must exist");
  assert.match(panel, /animation:\s*scratch-pad-enter 180ms/);
  assert.match(panel, /will-change:\s*opacity, transform;/);
});
