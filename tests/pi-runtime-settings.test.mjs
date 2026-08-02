import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function loadModule(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { exports: module.exports, module, require }, { filename: sourcePath });
  return module.exports;
}

const {
  normalizePiRuntimeSettings,
  PI_MODEL_RETRY_MAX_ATTEMPTS,
} = loadModule("src/main/pi/PiRuntimeSettings.ts");

test("preserves configured timeout while enabling five native retries", () => {
  const result = normalizePiRuntimeSettings({
    httpIdleTimeoutMs: 120_000,
    retry: { enabled: false, maxRetries: 1, baseDelayMs: 5_000 },
  });

  assert.equal(result.changed, true);
  assert.equal(result.settings.httpIdleTimeoutMs, 120_000);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.settings.retry)),
    { enabled: true, maxRetries: PI_MODEL_RETRY_MAX_ATTEMPTS, baseDelayMs: 5_000 },
  );
});

test("leaves omitted and disabled timeout values untouched", () => {
  for (const settings of [
    { retry: { enabled: true, maxRetries: 8, baseDelayMs: 1_000 } },
    { httpIdleTimeoutMs: 0, retry: { enabled: true, maxRetries: 8, baseDelayMs: 1_000 } },
    { httpIdleTimeoutMs: 900_000, retry: { enabled: true, maxRetries: 8, baseDelayMs: 1_000 } },
  ]) {
    const result = normalizePiRuntimeSettings(settings);
    assert.equal(result.changed, false);
    assert.equal(JSON.stringify(result.settings), JSON.stringify(settings));
  }
});

test("does not rewrite provider timeout while normalizing retry policy", () => {
  const result = normalizePiRuntimeSettings({
    httpIdleTimeoutMs: 900_000,
    retry: {
      enabled: true,
      maxRetries: 5,
      baseDelayMs: 2_000,
      provider: { timeoutMs: 60_000, maxRetries: 2 },
    },
  });

  assert.equal(result.changed, false);
  assert.equal(result.settings.retry.provider.timeoutMs, 60_000);
  assert.equal(result.settings.retry.provider.maxRetries, 2);
});
