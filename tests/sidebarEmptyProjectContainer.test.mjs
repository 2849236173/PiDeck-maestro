import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");

test("empty expanded projects do not render a session-card container", () => {
  assert.match(
    appSource,
    /!isCollapsed &&\s*\(projectDisplay\.visibleChildren\.length > 0 \|\|\s*projectDisplay\.hiddenChildCount > 0\) && \(/,
  );
});
