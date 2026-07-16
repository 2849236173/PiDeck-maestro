import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/renderer/src/styles.css", "utf8");

test("right-side entries keep the same gap to the drawer splitter", () => {
  const outlineHover = styles.match(
    /\.outline-hover \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(outlineHover, "right-side entry container styles must exist");
  assert.match(
    outlineHover,
    /right:\s*calc\(11px \+ var\(--drawer-splitter-w\) \+ max\(var\(--drawer-col-w\), min\(var\(--drawer-width\), 38vw\)\)\);/,
  );
});
