import assert from "node:assert/strict";
import test from "node:test";
import { supportsFastMode } from "../src/renderer/src/utils/modelFastMode.ts";

test("supports allowlisted GPT and Grok Fast models", () => {
  for (const modelId of ["gpt-5.5", "openai/gpt-5.6", "grok-4.5", "xai/grok-4"]) {
    assert.equal(supportsFastMode(modelId), true, modelId);
  }
});

test("rejects non-allowlisted or lookalike model ids", () => {
  for (const modelId of [undefined, "", "gpt-5.4", "gpt-5.5-previewish", "gpt-15.5", "grok-3", "claude-3-7-sonnet"]) {
    assert.equal(supportsFastMode(modelId), false, String(modelId));
  }
});
