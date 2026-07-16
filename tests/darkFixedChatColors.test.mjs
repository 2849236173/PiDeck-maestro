import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
}

test("fixed light chat/table colors are tokenized for dark mode", () => {
  assert.match(block(":root"), /--color-chat-card-bg:\s*#fafafa;/i);
  assert.match(block(":root"), /--color-chat-muted-bg:\s*#f4f4f5;/i);
  assert.match(block(":root"), /--color-chat-table-bg:\s*#ffffff;/i);
  assert.match(block(":root[data-theme=\"dark\"]"), /--color-chat-card-bg:\s*#20242a;/i);
  assert.match(block(":root[data-theme=\"dark\"]"), /--color-chat-muted-bg:\s*#242932;/i);
  assert.match(block(":root[data-theme=\"dark\"]"), /--color-chat-table-bg:\s*#1d2024;/i);

  assert.match(block(".diagnostic-card"), /background:\s*var\(--color-chat-muted-bg\);/);
  assert.match(block(".user-turn-bubble"), /background:\s*var\(--color-chat-card-bg\);/);
  assert.match(block(".markdown-body .table-wrap"), /background:\s*var\(--color-chat-table-bg\);/);
  assert.match(block(".markdown-body .table-wrap thead"), /background:\s*var\(--color-chat-muted-bg\);/);
  assert.match(block(".markdown-body .table-wrap tr td"), /background:\s*var\(--color-chat-table-bg\);/);
});
