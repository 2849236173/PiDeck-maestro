import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/main/pi/AgentManager.ts", import.meta.url), "utf8");
const rendererSource = fs.readFileSync(new URL("../src/renderer/src/components/app/AppParts.tsx", import.meta.url), "utf8");

test("normalizes Maestro ask_userquestion requests instead of dropping them", () => {
	assert.match(source, /ask_userquestion/);
	assert.match(source, /questionPayload/);
	assert.match(source, /typed\.params/);
	assert.match(source, /Array\.isArray\(questionPayload\.options\)/);
});

test("renders live Maestro progress in the tool card subtitle", () => {
	assert.match(rendererSource, /toolName === "maestro"/);
	assert.match(rendererSource, /meta\.status === "running"/);
	assert.match(rendererSource, /meta\.result/);
});

test("keeps Maestro setStatus and setTitle visible to the renderer", () => {
	assert.match(source, /method === "setStatus"/);
	assert.match(source, /method === "setTitle"/);
	assert.match(rendererSource, /setExtensionStatusByAgent/);
	assert.match(rendererSource, /setExtensionTitleByAgent/);
});
