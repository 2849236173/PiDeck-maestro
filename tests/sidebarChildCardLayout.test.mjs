import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/renderer/src/styles.css", "utf8");
const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");

test("sidebar child cards share the workspace card's horizontal bounds", () => {
  const workspaceCard = styles.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.session-card \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(workspaceCard, "sidebar workspace card styles must exist");
  assert.match(workspaceCard, /padding:\s*2px 0;/);
});

test("sidebar workspace wrapper does not frame child cards", () => {
  const workspaceCard = styles.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.session-card \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(workspaceCard, "sidebar workspace card styles must exist");
  assert.match(workspaceCard, /background:\s*transparent;/);
  assert.match(workspaceCard, /border:\s*0;/);
  assert.match(workspaceCard, /border-radius:\s*0;/);
  assert.match(workspaceCard, /overflow:\s*visible;/);
});

test("sidebar workspace wrapper stays transparent on hover", () => {
  const workspaceCardHover = styles.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.session-card:hover \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(workspaceCardHover, "sidebar workspace hover styles must exist");
  assert.match(workspaceCardHover, /background:\s*transparent;/);
});

test("sidebar child cards use fixed workspace row dimensions", () => {
  const childRows = styles.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.agent-row,\n\.chat-list-pane\.v3-braun \.sidebar-body \.session-row \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(childRows, "sidebar child card styles must exist");
  assert.match(childRows, /width:\s*100%;/);
  assert.match(childRows, /height:\s*var\(--control-height-md\);/);
  assert.match(childRows, /padding:\s*var\(--space-1\) var\(--space-2\);/);
});

test("sidebar child titles use an ellipsis when clipped", () => {
  const childTitles = styles.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.agent-row \.conversation-title strong,([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(childTitles, "sidebar child title styles must exist");
  assert.match(childTitles, /text-overflow:\s*ellipsis;/);
});

test("sidebar agent statuses use compact color-coded card badges", () => {
  const indicator = styles.match(/\.agent-status-indicator \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(indicator, "sidebar status indicator styles must exist");
  assert.match(indicator, /height:\s*var\(--space-5\);/);
  assert.match(indicator, /padding:\s*0 var\(--space-1\);/);
  assert.match(indicator, /font-size:\s*var\(--font-size-micro\);/);
  assert.match(indicator, /border:\s*1px solid var\(--color-border-subtle\);/);

  for (const [status, color] of [
    ["idle", "info"],
    ["running", "accent"],
    ["starting", "warning"],
    ["error", "danger"],
  ]) {
    const state = styles.match(
      new RegExp(`\\.agent-status-indicator\\.status-${status} \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];

    assert.ok(state, `${status} status styles must exist`);
    assert.match(state, new RegExp(`color:\\s*var\\(--color-${color}\\);`));
    assert.match(state, /border-color:/);
  }
});

test("sidebar status labels do not render circle glyphs", () => {
  assert.doesNotMatch(appSource, /agent\.status === 'running' && '●'/);
  assert.doesNotMatch(appSource, /agent\.status === 'idle' && '○'/);
  assert.doesNotMatch(appSource, /agent\.status === 'starting' && '◐'/);
});
