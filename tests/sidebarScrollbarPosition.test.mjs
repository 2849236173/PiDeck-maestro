import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/renderer/src/styles.css", "utf8");
const selector = ".chat-list-pane.v3-braun .sidebar-body .conversation-list";
const rule = css.match(new RegExp(`${selector.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`));

test("sidebar scrollbar sits closer to the sidebar's right edge without moving list content", () => {
  assert.ok(rule, "v3 sidebar conversation list rule should exist");
  assert.match(rule[1], /margin-right:\s*calc\(-1 \* var\(--space-3\)\);/);
  assert.match(rule[1], /padding-right:\s*var\(--space-3\);/);
});
