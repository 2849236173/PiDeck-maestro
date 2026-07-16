const fs = require('fs');
let content = fs.readFileSync('src/main/index.ts', 'utf8');
const normalized = content.replace(/\r\n/g, '\n');

// 1. Add WSL session scanner config after settingsStore.load()
const loadPattern = 'await settingsStore.load();\n\n\t// 自动部署 PiDeck 内置扩展';
const loadReplacement = 'await settingsStore.load();\n\n\t// 根据已加载的 WSL 设置配置会话扫描器，使其能同时扫描 WSL 中的 pi 会话目录\n\t{\n\t\tconst { wslEnabled, wslDistro, wslUser } = settingsStore.get();\n\t\tif (wslEnabled && wslDistro && wslUser) {\n\t\t\tsessionScanner.configureWsl(wslDistro, wslUser);\n\t\t} else {\n\t\t\tsessionScanner.clearWsl();\n\t\t}\n\t}\n\n\t// 自动部署 PiDeck 内置扩展';

if (!normalized.includes(loadPattern)) {
  console.log('NOT FOUND - load pattern');
  process.exit(1);
}

let fixed = normalized.replace(loadPattern, loadReplacement);

// 2. Add WSL config update in settings update handler
const updatePattern = [
  '\t\t\tif ("webServiceEnabled" in patch ||',
  '\t\t\t\t"webServiceHost" in patch ||',
  '\t\t\t\t"webServicePort" in patch',
  '\t\t\t) {',
  '\t\t\t\ttry {',
  '\t\t\t\t\tawait webServiceManager.applySettings(settings);',
  '\t\t\t\t} catch (error) {',
  '\t\t\t\t\tif (settings.webServiceEnabled) {',
  '\t\t\t\t\t\tawait settingsStore.update({ webServiceEnabled: false });',
  '\t\t\t\t\t}',
  '\t\t\t\t\tthrow error;',
  '\t\t\t\t}',
  '\t\t\t}',
].join('\n');

const updateReplacement = updatePattern + '\n' + [
  '\t\t\t// WSL 设置变更时同步更新会话扫描器',
  '\t\t\tif ("wslEnabled" in patch || "wslDistro" in patch || "wslUser" in patch) {',
  '\t\t\t\tif (settings.wslEnabled && settings.wslDistro && settings.wslUser) {',
  '\t\t\t\t\tsessionScanner.configureWsl(settings.wslDistro, settings.wslUser);',
  '\t\t\t\t} else {',
  '\t\t\t\t\tsessionScanner.clearWsl();',
  '\t\t\t\t}',
  '\t\t\t}',
].join('\n');

if (!fixed.includes(updatePattern)) {
  console.log('NOT FOUND - update pattern');
  process.exit(1);
}

fixed = fixed.replace(updatePattern, updateReplacement);
fs.writeFileSync('src/main/index.ts', fixed, 'utf8');
console.log('OK');
