import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync("src/renderer/src/hooks/useMessagePagination.ts", "utf8");

test("pagination exposes an Agent/session reset key", () => {
  assert.match(hook, /resetKey\?: string \| number \| null/);
  assert.match(hook, /useEffect\(\(\) => \{[\s\S]*?prevMessageCountRef\.current = messages\.length;[\s\S]*?reset\(\);[\s\S]*?\}, \[resetKey, reset\]\)/);
});

test("pagination expands to the current full list when messages shrink", () => {
  assert.match(hook, /if \(delta < 0\) \{[\s\S]*?setVisibleCount\(Math\.min\(messages\.length, maxVisibleMessages\)\)/);
});

test("pagination still increments the window for small appends", () => {
  assert.match(hook, /if \(!enabled \|\| delta === 0 \|\| delta >= 10\) return;/);
  assert.match(hook, /Math\.min\(prevCount \+ delta, messages\.length, maxVisibleMessages\)/);
});
