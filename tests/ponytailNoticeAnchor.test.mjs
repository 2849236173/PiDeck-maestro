import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("通知使用不遮挡会话控件的右下角全局 toast", () => {
  assert.match(app, /showNotice\(notifyRequest\.message/);
  assert.match(app, /"app-notice app-notice-error"/);

  const notice = cssRule("\\.app-notice");
  assert.ok(notice, "通知样式必须存在");
  assert.match(notice, /position:\s*fixed;/);
  assert.match(notice, /bottom:\s*24px;/);
  assert.match(notice, /right:\s*24px;/);
});
