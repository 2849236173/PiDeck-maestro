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

test("chat header gives the agent title remaining width before ellipsis", () => {
  assert.match(block(".chat-header"), /grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(block(".chat-title-block"), /flex:\s*1 1 auto;/);
  assert.match(block(".chat-title-block"), /min-width:\s*0;/);
  assert.match(block(".chat-header strong"), /max-width:\s*100%;/);
  assert.match(block(".chat-header strong"), /text-overflow:\s*ellipsis;/);
  assert.match(block(".chat-header-actions"), /justify-self:\s*end;/);
  assert.match(block(".chat-header-actions"), /flex:\s*0 0 auto;/);
});
