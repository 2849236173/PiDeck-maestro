import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/renderer/src/styles.css", "utf8");

test("collapsed sidebar reveal does not override the v3 conversation list layout", () => {
  assert.doesNotMatch(
    css,
    /\.conversation-list \{\n  display: block;/,
  );
  assert.match(
    css,
    /\.chat-list-pane\.v3-braun \.sidebar-body \.conversation-list \{[\s\S]*?display: flex;/,
  );
  assert.match(
    css,
    /\.list-collapsed:not\(\.list-hover-suppressed\) \.chat-list-pane\.v3-braun:focus-within \{/,
  );
});
