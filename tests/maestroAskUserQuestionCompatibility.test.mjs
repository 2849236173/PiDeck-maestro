import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/main/pi/AgentManager.ts", import.meta.url), "utf8");

test("normalizes Maestro ask_userquestion requests instead of dropping them", () => {
	assert.match(source, /ask_userquestion/);
	assert.match(source, /questionPayload/);
	assert.match(source, /typed\.params/);
	assert.match(source, /Array\.isArray\(questionPayload\.options\)/);
});
