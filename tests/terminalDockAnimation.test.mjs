import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const terminalDock = readFileSync(
  "src/renderer/src/components/terminal/TerminalDock.tsx",
  "utf8",
);

test("defers terminal initialization until the dock opening animation completes", () => {
  assert.match(
    terminalDock,
    /const TERMINAL_OPEN_ANIMATION_MS = 300;/,
  );
  assert.match(
    terminalDock,
    /const \[contentReady, setContentReady\] = useState\(false\);/,
  );
  assert.match(
    terminalDock,
    /window\.setTimeout\(\s*\(\) => setContentReady\(true\),\s*TERMINAL_OPEN_ANIMATION_MS,\s*\)/,
  );
  assert.match(terminalDock, /if \(!open \|\| !contentReady\) return;/);
  assert.match(
    terminalDock,
    /if \(collapsed \|\| !contentReady \|\| !activeTab \|\| !containerRef\.current\) return;/,
  );
});
