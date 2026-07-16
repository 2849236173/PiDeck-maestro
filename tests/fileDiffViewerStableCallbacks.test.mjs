import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");

test("file viewer IO callbacks are stable across App re-renders", () => {
  assert.match(app, /const readEditorFileContent = useCallback\(\s*\(path: string\) => api\.files\.readContent\(path\),\s*\[\],\s*\);/);
  assert.match(app, /const readEditorOriginalContent = useCallback\(\s*\(path: string\) => api\.git\.originalContent\(path\),\s*\[\],\s*\);/);
  assert.match(app, /const saveEditorFileContent = useCallback\(\s*\(path: string, content: string\) => api\.files\.writeContent\(path, content\),\s*\[\],\s*\);/);
  assert.doesNotMatch(app, /readContent=\{\(path\) => api\.files\.readContent\(path\)\}/);
  assert.doesNotMatch(app, /readOriginalContent=\{\(path\) => api\.git\.originalContent\(path\)\}/);
  assert.doesNotMatch(app, /saveContent=\{\(path, content\) => api\.files\.writeContent\(path, content\)\}/);
});
