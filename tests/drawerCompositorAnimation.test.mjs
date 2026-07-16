import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("drawer combines a short grid transition with composited motion", () => {
  const shell = cssRule("\\.wechat-shell");
  const drawer = cssRule("\\.detail-drawer");

  assert.ok(shell, "shell styles must exist");
  assert.match(shell, /transition:\s*grid-template-columns 120ms/);
  assert.match(
    styles,
    /body\.is-resizing \.wechat-shell \{\s*transition:\s*none;/,
  );
  assert.ok(drawer, "drawer styles must exist");
  assert.match(drawer, /will-change:\s*transform;/);
  assert.match(drawer, /transition:\s*transform/);
  assert.match(
    styles,
    /\.detail-drawer:not\(\[data-open="true"\]\)[\s\S]*?translate3d\(100%, 0, 0\)/,
  );
});

test("drawer starts its short layout transition from the actual open state", () => {
  assert.match(app, /const DRAWER_ANIMATION_MS = 180;/);
  assert.match(app, /const drawerContentPanel = drawer && !drawerCollapsed \? drawer : renderedDrawer;/);
  assert.match(app, /drawer && !drawerCollapsed \? drawerWidth : 0/);
  assert.match(app, /drawer && !drawerCollapsed \? 260 : 0/);
});
