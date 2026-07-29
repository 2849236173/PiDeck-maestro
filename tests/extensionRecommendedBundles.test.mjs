import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tabSource = readFileSync("src/renderer/src/config/ExtensionsTab.tsx", "utf8");
const i18nSource = readFileSync("src/renderer/src/i18n.ts", "utf8");
const stylesSource = readFileSync("src/renderer/src/styles.css", "utf8");

test("recommended extensions include one Maestro bundle with both npm sources", () => {
	assert.match(tabSource, /name: "Maestro"/);
	assert.match(tabSource, /name: "pi-maestro-flow"[\s\S]*source: "npm:pi-maestro-flow"/);
	assert.match(tabSource, /name: "pi-maestro-teammate"[\s\S]*source: "npm:pi-maestro-teammate"/);
	assert.match(tabSource, /className="extensions-bundle-card"/);
	assert.match(tabSource, /MAESTRO_BUNDLE\.packages\.map/);
});

test("Maestro bundle installs only missing packages through the existing single-source API", () => {
	assert.match(
		tabSource,
		/const missingPackages = MAESTRO_BUNDLE\.packages\.filter\([\s\S]*!installedSources\.has\(pkg\.source\)/,
	);
	assert.match(
		tabSource,
		/for \(const pkg of missingPackages\) \{[\s\S]*await getExtensionsApi\(\)\.install\(pkg\.source\)/,
	);
	assert.match(tabSource, /finally \{[\s\S]*props\.onRefresh\(\)/);
	assert.match(tabSource, /\.map\(\(pkg\) => `pi install \$\{pkg\.source\}`\)/);
});

test("Maestro bundle uses shared controls, semantic styles, and bilingual copy", () => {
	assert.match(tabSource, /import \{ Button \} from "\.\.\/components\/ui\/Button"/);
	assert.match(tabSource, /import \{ IconButton \} from "\.\.\/components\/ui\/IconButton"/);
	assert.match(tabSource, /<Button[\s\S]*handleInstallBundle/);
	assert.match(tabSource, /<IconButton[\s\S]*handleCopyBundleCommands/);
	assert.match(stylesSource, /\.extensions-bundle-card[\s\S]*var\(--color-border-subtle\)/);
	assert.equal(
		(i18nSource.match(/"config\.maestroBundle\.description"/g) ?? []).length,
		2,
	);
	assert.equal(
		(i18nSource.match(/"config\.maestroBundle\.installMissing"/g) ?? []).length,
		2,
	);
});
