import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("terminal dock combines a short grid transition with composited motion", () => {
  const chatPane = cssRule("\\.chat-pane");
  const terminalDock = cssRule("\\.terminal-dock");

  assert.ok(chatPane, "chat pane styles must exist");
  assert.match(chatPane, /transition:\s*grid-template-rows 120ms/);
  assert.ok(terminalDock, "terminal dock styles must exist");
  assert.match(terminalDock, /will-change:\s*transform;/);
  assert.match(terminalDock, /transition:\s*transform/);
  assert.match(styles, /\.terminal-dock\[data-motion-state="hidden"\][\s\S]*?translate3d\(0, 100%, 0\)/);
});

test("terminal dock remains mounted while its exit transform runs", () => {
  assert.match(app, /const TERMINAL_DOCK_MOTION_MS = 180;/);
  assert.match(app, /const \[terminalDockMounted, setTerminalDockMounted\] = useState\(false\);/);
  assert.match(app, /const \[terminalDockClosing, setTerminalDockClosing\] = useState\(false\);/);
  assert.match(app, /window\.setTimeout\(\s*\(\) => \{\s*setTerminalDockMounted\(false\);\s*setTerminalDockClosing\(false\);\s*\},\s*TERMINAL_DOCK_MOTION_MS,/);
  assert.match(app, /terminalDockVisible && \(/);
});
