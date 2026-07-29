import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parts = readFileSync("src/renderer/src/components/app/AppParts.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles.css", "utf8");
const i18n = readFileSync("src/renderer/src/i18n.ts", "utf8");

function cssRule(selector) {
  const matches = [...styles.matchAll(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`, "g"))];
  return matches.at(-1)?.[1] ?? "";
}

test("empty state shows the pi agent ownership tagline with branded yours", () => {
  assert.match(parts, /className="empty-tagline"/);
  assert.match(parts, /t\("app\.emptyTaglineLine1"\)/);
  assert.match(parts, /t\("app\.emptyTaglineLine2Prefix"\)/);
  assert.match(parts, /className="empty-tagline-yours"/);
  assert.match(parts, /t\("app\.emptyTaglineYours"\)/);
  assert.doesNotMatch(parts, /<h2>\{t\("app\.startAgent"\)\}<\/h2>/);
  assert.doesNotMatch(parts, /<p>\{t\("app\.emptyGuide"\)\}<\/p>/);
  assert.match(parts, /width="66"[\s\S]*height="66"/);

  assert.match(i18n, /"app\.emptyTaglineLine1": "There are many agent harnesses"/);
  assert.match(i18n, /"app\.emptyTaglineLine2Prefix": "but this one is "/);
  assert.match(i18n, /"app\.emptyTaglineYours": "yours"/);

  const logo = cssRule("\\.empty-logo");
  const button = cssRule("\\.empty-state button");
  const tagline = cssRule("\\.empty-tagline");
  const yours = cssRule("\\.empty-tagline-yours");

  assert.match(logo, /width:\s*118px;[\s\S]*height:\s*118px;/);
  assert.match(button, /min-width:\s*118px;[\s\S]*height:\s*40px;/);
  assert.match(styles, /--color-accent-soft:\s*#eaf6ed;/i);
  assert.match(button, /background:\s*transparent;[\s\S]*font-size:\s*var\(--font-size-control\);/);
  assert.match(button, /color:\s*var\(--color-accent-strong\);/);
  assert.match(button, /font-family:\s*var\(--font-family-base\);/);
  assert.match(button, /font-weight:\s*600;/);
  assert.match(button, /letter-spacing:\s*0;/);
  assert.match(button, /border-radius:\s*var\(--radius-md\);/);
  assert.match(tagline, /font-family:\s*var\(--font-family-brand\)/);
  assert.match(yours, /color:\s*var\(--color-brand-green\)/);
});
