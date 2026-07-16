import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/renderer/src/styles.css", "utf8");

test("sidebar search uses #FAFAFA in light mode and preserves the dark theme surface", () => {
  const lightRule = css.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.search-box \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(lightRule, "sidebar search styles must exist");
  assert.match(lightRule, /background:\s*#FAFAFA;/);
  assert.match(
    css,
    /:root\[data-theme="dark"\] \.chat-list-pane\.v3-braun \.sidebar-body \.search-box \{\n  background: var\(--color-bg-muted\);\n\}/,
  );
});

test("sidebar search focus uses an outline instead of a shadow", () => {
  const focusRule = css.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.search-box:focus-within \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(focusRule, "sidebar search focus styles must exist");
  assert.match(focusRule, /box-shadow:\s*none;/);
  assert.match(focusRule, /outline:/);
});
