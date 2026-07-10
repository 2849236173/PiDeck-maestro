import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	net,
	shell,
	Tray,
} from "electron";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { is } from "@electron-toolkit/utils";
import { PetSystem, type PetSystemDeps } from "./pet";
import {
	applyLinuxDisplayBackendWorkaround,
	isUsingLinuxXWaylandWorkaround,
} from "./linuxDisplayBackend";
// 使用 ?asset 后缀导入图标，electron-vite 会在构建时将其复制到输出目录并提供正确的运行时路径
// 这解决了打包后 build/ 目录不在 asar 中导致托盘图标丢失的问题
import iconPath from "../../build/icon.png?asset";

applyLinuxDisplayBackendWorkaround();

// 开发模式下 stdout 管道可能断开导致 EPIPE 崩溃，全局静默处理
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	throw err;
});
process.stderr.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	throw err;
});

process.on("uncaughtException", (error) => {
	void appLogger?.error("process", "Uncaught exception", error);
	console.error("Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
	void appLogger?.error("process", "Unhandled rejection", reason);
	console.error("Unhandled rejection:", reason);
});
import { ipcChannels } from "../shared/ipc";
import type {
	AppSettings,
	AppUpdateAsset,
	AppUpdateDownloadProgress,
	AppLogLevel,
	AppLogQuery,
	AppUpdateDownloadResult,
	ExternalEditor,
	ExternalEditorId,
	ExternalEditorSetting,
	AppUpdateInfo,
	CreateAgentInput,
	FeishuBotConfig,
	FeishuBridgeStatus,
	FeishuConnectInput,
	FeishuTestResult,
	SendPromptInput,
	CreatePiPromptTemplateInput,
	CreatePiSkillInput,
	CreateProjectSkillInput,
	PiPromptTemplateSummary,
	PromptStoreSearchResult,
	PromptStoreSearchResponse,
	PromptStoreRawItem,
	PromptStoreItem,
} from "../shared/types";
import { ProjectStore } from "./projects/ProjectStore";
import { FileSystemService } from "./fs/FileSystemService";
import { AgentManager } from "./pi/AgentManager";
import { PiLocator } from "./pi/PiLocator";
import { testPiProxy } from "./pi/PiProxyTester";
import { SessionScanner } from "./sessions/SessionScanner";
import { CodexSessionImporter } from "./sessions/CodexSessionImporter";
import { ClaudeSessionImporter } from "./sessions/ClaudeSessionImporter";
import { OpenCodeSessionImporter } from "./sessions/OpenCodeSessionImporter";
import { SettingsStore } from "./settings/SettingsStore";
import { applyDesktopProxy } from "./settings/DesktopProxy";
import { GitService } from "./git/GitService";
import { WorktreeService } from "./git/WorktreeService";
import { ConfigManager } from "./config/ConfigManager";
import { TerminalSessionManager } from "./terminal/TerminalSessionManager";
import { TelemetryService } from "./telemetry/TelemetryService";
import { PromptManager } from "./prompts/PromptManager";
import { SkillManager } from "./skills/SkillManager";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { ProjectResourceManager } from "./projects/ProjectResourceManager";
import { WebServiceManager } from "./web/WebServiceManager";
import { preparePreloadPath } from "./preloadPath";
import { AppLogger } from "./logging/AppLogger";
import { RpcLogger } from "./logging/RpcLogger";
import {
	detectExternalEditors,
	listConfiguredExternalEditors,
	mergeDetectedExternalEditors,
	openProjectInEditor,
	validateExternalEditorCommand,
} from "./editors/EditorDetector";
import { FeishuBridge } from "./feishu/FeishuBridge";
import { wantsFeishuDoc } from "./feishu/docActions";
import { resolveFeishuFileSendIntent } from "./feishu/fileIntent";
import {
	listBots,
	getBot,
	addBot as addFeishuBot,
	removeBot as removeFeishuBot,
	updateBot as updateFeishuBot,
	getDecryptedBotAppSecret,
	getSessionBotId,
	setSessionBotId,
} from "./feishu/FeishuConfig";
import type { FeishuChatBinding } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let internalLinkWindow: BrowserWindow | null = null;
/** 标记是否由用户主动退出（托盘菜单「退出」），区别于窗口关闭隐藏到托盘 */
let isQuitting = false;
let projectStore: ProjectStore;
let fileSystemService: FileSystemService;
let sessionScanner: SessionScanner;
let codexSessionImporter: CodexSessionImporter;
let claudeSessionImporter: ClaudeSessionImporter;
let openCodeSessionImporter: OpenCodeSessionImporter;
let settingsStore: SettingsStore;
let worktreeService: WorktreeService;
let gitService: GitService;
let piLocator: PiLocator;
let agentManager: AgentManager;
let configManager: ConfigManager;
let promptManager: PromptManager;
let skillManager: SkillManager;
let extensionManager: ExtensionManager;
let projectResourceManager: ProjectResourceManager;
let webServiceManager: WebServiceManager;
let terminalManager: TerminalSessionManager;
let petSystem: PetSystem | null = null;
let appLogger: AppLogger;
let rpcLogger: RpcLogger;
let feishuBridge: FeishuBridge | null = null;

const RELEASES_URL = "https://github.com/ayuayue/pi-desktop/releases";
const LATEST_RELEASE_API =
	"https://api.github.com/repos/ayuayue/pi-desktop/releases/latest";
const POSTHOG_PROJECT_KEY =
	process.env.POSTHOG_PROJECT_KEY ??
	"phc_xgJ8gFUMgExZEEPzZ7VRa7698ENcaDRquWZVGYb2dCFK";
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

type GitHubReleaseAsset = {
	name: string;
	browser_download_url: string;
	size: number;
};

type GitHubRelease = {
	tag_name?: string;
	name?: string;
	body?: string;
	html_url?: string;
	published_at?: string;
	assets?: GitHubReleaseAsset[];
};

function normalizeVersion(version: string) {
	return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string) {
	const leftParts = normalizeVersion(left)
		.split(/[.-]/)
		.map((part) => Number(part) || 0);
	const rightParts = normalizeVersion(right)
		.split(/[.-]/)
		.map((part) => Number(part) || 0);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function selectRecommendedAsset(
	assets: AppUpdateAsset[],
	installationType?: "portable" | "installed",
) {
	const platform = process.platform;
	const arch = process.arch;
	// Windows 便携版以 electron-builder 注入的运行时环境变量为准；旧 settings 可能残留 installed。
	const isPortable =
		platform === "win32"
			? process.env.PORTABLE_EXECUTABLE_DIR !== undefined || installationType === "portable"
			: installationType === "portable";

	// 映射资产以便匹配
	const candidates = assets.map((asset) => ({
		...asset,
		lowerName: asset.name.toLowerCase(),
	}));

	// 根据架构确定关键词，严格匹配
	const archKeywords =
		arch === "arm64" ? ["arm64", "aarch64"] : ["x64", "amd64", "x86_64"];
	const matchesArch = (name: string) =>
		archKeywords.some((keyword) => name.includes(keyword));

	// 检查是否为非目标架构（用于排除不匹配的资产）
	const isWrongArch = (name: string) => {
		if (arch === "arm64") {
			// 当前是 ARM64，排除 x64 相关的
			return /\b(x64|amd64|x86_64)\b/i.test(name);
		} else {
			// 当前是 x64，排除 arm64 相关的
			return /\b(arm64|aarch64)\b/i.test(name);
		}
	};

	const isWindowsAsset = (name: string) =>
		/\.(exe|msi)$/i.test(name) || (name.endsWith(".zip") && !/(mac|darwin|osx|linux|appimage|deb|tar\.gz)/i.test(name));
	const isMacAsset = (name: string) => /\.(dmg)$/i.test(name) || /(mac|darwin|osx)/i.test(name);
	const isLinuxAsset = (name: string) => /(appimage|\.deb$|\.tar\.gz$|linux)/i.test(name);

	if (platform === "win32") {
		// Windows 只能在 Windows 资产里挑选；Release 同时包含 macOS zip，不能用全局 zip 回退。
		const platformCandidates = candidates.filter((asset) => isWindowsAsset(asset.lowerName));
		// Windows: 优先匹配当前安装形态（便携版 vs 安装版）和架构
		if (isPortable) {
			// 便携版 exe 是单文件绿色版，无需安装；优先推荐非 Setup 的便携 exe，其次 .zip
			return (
				platformCandidates.find(
					(asset) => !asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => !asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && !isWrongArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && !isWrongArch(asset.lowerName),
				)
			);
		} else {
			// 安装版：优先推荐带 Setup 的安装 exe，其次普通 exe，最后 zip
			return (
				platformCandidates.find(
					(asset) => asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && !isWrongArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".exe") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".exe") && !isWrongArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && !isWrongArch(asset.lowerName),
				)
			);
		}
	}

	if (platform === "darwin") {
		// macOS 只在 macOS 资产中选择，避免 x64 zip 回退到 Windows/Linux 包。
		const platformCandidates = candidates.filter((asset) => isMacAsset(asset.lowerName));
		return (
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".dmg") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".dmg") && !isWrongArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".zip") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".zip") && !isWrongArch(asset.lowerName),
			)
		);
	}

	if (platform === "linux") {
		// Linux 只在 Linux 资产中选择，避免跨平台 zip/exe 被误推荐。
		const platformCandidates = candidates.filter((asset) => isLinuxAsset(asset.lowerName));
		return (
			platformCandidates.find(
				(asset) => asset.lowerName.includes("appimage") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) =>
					asset.lowerName.includes("appimage") && !isWrongArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".deb") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".deb") && !isWrongArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".tar.gz") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".tar.gz") && !isWrongArch(asset.lowerName),
			)
		);
	}

	// 回退：返回第一个匹配架构的资产
	return candidates.find((asset) => matchesArch(asset.lowerName)) ?? candidates[0];
}

async function checkForAppUpdate(
	installationType?: "portable" | "installed",
): Promise<AppUpdateInfo> {
	const currentVersion = app.getVersion();
	void appLogger.info("update", "Check for app update", { currentVersion, installationType });
	const response = await fetch(LATEST_RELEASE_API, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": `pi-desktop/${currentVersion}`,
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub Release 检查失败：HTTP ${response.status}`);
	}
	const release = (await response.json()) as GitHubRelease;
	const latestVersion = normalizeVersion(release.tag_name || currentVersion);
	const assets = (release.assets ?? []).map((asset) => ({
		name: asset.name,
		url: asset.browser_download_url,
		size: asset.size,
	}));
	const recommendedAsset = selectRecommendedAsset(assets, installationType);
	void appLogger.info("update", "App update check completed", {
		currentVersion,
		latestVersion,
		hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
		recommendedAsset: recommendedAsset?.name,
	});
	return {
		currentVersion,
		latestVersion,
		hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
		releaseName: release.name || `v${latestVersion}`,
		releaseNotes: release.body || "",
		releaseUrl: release.html_url || RELEASES_URL,
		publishedAt: release.published_at,
		assets,
		recommendedAsset,
	};
}

function emitUpdateProgress(progress: AppUpdateDownloadProgress) {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(ipcChannels.appUpdateProgress, progress);
}

async function downloadUpdateAsset(asset: AppUpdateAsset): Promise<AppUpdateDownloadResult> {
	if (!asset.url || !/^https:\/\//i.test(asset.url)) {
		throw new Error("无效的更新下载地址");
	}

	const safeName = basename(asset.name).replace(/[<>:"/\\|?*]+/g, "-");
	const downloadDir = join(app.getPath("userData"), "updates");
	await mkdir(downloadDir, { recursive: true });
	const filePath = join(downloadDir, safeName);
	const startedAt = Date.now();
	let receivedBytes = 0;
	let totalBytes = asset.size > 0 ? asset.size : undefined;

	// 使用 Electron net 下载可继承 Chromium 的 TLS/代理能力；进度通过 IPC 推送给 renderer。
	return new Promise((resolve, reject) => {
			void appLogger.info("update", "Download update asset started", { assetName: asset.name, url: asset.url });
		const request = net.request({ method: "GET", url: asset.url });
		request.setHeader("User-Agent", `pi-desktop/${app.getVersion()}`);
		request.on("redirect", (_statusCode, _method, redirectUrl) => {
			// GitHub browser_download_url 通常会 302 到对象存储,必须显式跟随重定向。
			request.followRedirect();
			void appLogger.debug("update", "Follow update download redirect", { redirectUrl });
		});
		request.on("response", (response) => {
			if (response.statusCode < 200 || response.statusCode >= 300) {
				const error = new Error(`下载失败：HTTP ${response.statusCode}`);
				emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, state: "failed", error: error.message });
				reject(error);
				return;
			}

			const contentLength = Number(response.headers["content-length"]);
			if (Number.isFinite(contentLength) && contentLength > 0) totalBytes = contentLength;
			const output = createWriteStream(filePath);
			response.on("data", (chunk: Buffer) => {
				receivedBytes += chunk.length;
				output.write(chunk);
				const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
				emitUpdateProgress({
					assetName: asset.name,
					receivedBytes,
					totalBytes,
					percent: totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : undefined,
					bytesPerSecond: receivedBytes / elapsedSeconds,
					state: "downloading",
				});
			});
			response.on("end", () => output.end());
			output.on("finish", () => {
				output.close(() => {
					emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, percent: 100, state: "completed", filePath });
					void appLogger.info("update", "Download update asset completed", { assetName: asset.name, filePath, receivedBytes });
					resolve({ filePath, assetName: asset.name });
				});
			});
			output.on("error", (error) => {
				emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, state: "failed", error: error.message });
				reject(error);
			});
		});
		request.on("error", (error) => {
			emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, state: "failed", error: error.message });
			reject(error);
		});
		request.end();
	});
}

async function installDownloadedUpdate(filePath: string) {
	// Windows/Linux 不同包类型的真正静默自更新风险较高；这里交给系统打开安装包或文件位置。
	// 便携版用户通常下载 zip/AppImage/tar.gz 后需要替换当前目录,避免在运行中覆盖自身可执行文件。
	await appLogger.info("update", "Open downloaded update package", { filePath });
	await shell.openPath(filePath);
}

function setupTray() {
	// iconPath 由 electron-vite 的 ?asset 后缀自动解析，打包后也能正确定位
	const icon = nativeImage.createFromPath(iconPath);
	tray = new Tray(icon.resize({ width: 16, height: 16 }));
	tray.setToolTip("PiDeck");

	// 双击托盘图标恢复窗口（Windows 常见交互）
	tray.on("double-click", () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.show();
			mainWindow.focus();
		}
	});

	const contextMenu = Menu.buildFromTemplate([
		{
			label: "显示窗口",
			click: () => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.show();
					mainWindow.focus();
				}
			},
		},
		{ type: "separator" },
		{
			label: "退出 PiDeck",
			click: () => {
				isQuitting = true;
				app.quit();
			},
		},
	]);
	tray.setContextMenu(contextMenu);
}

async function openExternalUrl(url: string) {
	if (!url.startsWith("http:") && !url.startsWith("https:")) return;
	const settings = settingsStore.get();
	if (settings.linkOpenMode === "internal") {
		openInternalLinkWindow(url);
		return;
	}
	await shell.openExternal(url);
}

function openInternalLinkWindow(url: string) {
	// 内部打开使用独立 BrowserWindow，避免外部网页导航污染主工作台，同时保留系统浏览器作为默认选项。
	if (!internalLinkWindow || internalLinkWindow.isDestroyed()) {
		internalLinkWindow = new BrowserWindow({
			width: 1180,
			height: 820,
			minWidth: 760,
			minHeight: 520,
			title: "PiDeck",
			parent: mainWindow ?? undefined,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			},
		});
		internalLinkWindow.on("closed", () => {
			internalLinkWindow = null;
		});
		internalLinkWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
			void openExternalUrl(nextUrl);
			return { action: "deny" };
		});
	}
	internalLinkWindow.loadURL(url).catch((error) => {
		void shell.openExternal(url);
		console.warn("Failed to load internal link window, falling back to browser:", error);
	});
	internalLinkWindow.show();
	internalLinkWindow.focus();
}

function printStartupInfo() {
	if (!mainWindow || mainWindow.isDestroyed()) return;

	const settings = settingsStore.get();
	const appVersion = app.getVersion();
	const electronVersion = process.versions.electron;
	const chromeVersion = process.versions.chrome;
	const nodeVersion = process.versions.node;
	const platform = process.platform;
	const arch = process.arch;
	const persistentInstallationType = settings.installationType || "unknown";
	const isPortableEnv = process.env.PORTABLE_EXECUTABLE_DIR !== undefined;
	// Debug 中展示实际生效类型,便于发现持久化值和运行时便携信号不一致的问题。
	const effectiveInstallationType =
		process.platform === "win32" && isPortableEnv ? "portable" : persistentInstallationType;

	// 执行 console.log 输出到开发者工具
	mainWindow.webContents.executeJavaScript(`
		console.log(
			"%c╭──────────────────────────────────────────────────────────╮",
			"color: #8b5cf6; font-weight: bold;"
		);
		console.log(
			"%c│                      PiDeck Desktop                      │",
			"color: #8b5cf6; font-weight: bold; font-size: 16px;"
		);
		console.log(
			"%c╰──────────────────────────────────────────────────────────╯",
			"color: #8b5cf6; font-weight: bold;"
		);
		console.log("");
		console.log("%c📦 Application Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  Version:         %c${appVersion}", "color: #6b7280;", "color: #10b981; font-weight: bold;");
		console.log("%c  Installation:    %c${effectiveInstallationType}", "color: #6b7280;", "color: #f59e0b; font-weight: bold;");
		console.log("%c  Platform:        %c${platform} (${arch})", "color: #6b7280;", "color: #8b5cf6;");
		console.log("");
		console.log("%c⚡ Runtime Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  Electron:        %c${electronVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("%c  Chrome:          %c${chromeVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("%c  Node:            %c${nodeVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("");
		console.log("%c🔧 Debug Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  PORTABLE_EXECUTABLE_DIR: %c${isPortableEnv ? '✅ Set' : '❌ Not set'}", "color: #6b7280;", "color: ${isPortableEnv ? '#10b981' : '#ef4444'};");
		console.log("%c  Persistent installationType: %c${persistentInstallationType}", "color: #6b7280;", "color: #8b5cf6; font-weight: bold;");
		console.log("");
		console.log("%c🐛 Found a bug? Report at:", "color: #6b7280;");
		console.log("%c  https://github.com/ayuayue/PiDeck/issues", "color: #3b82f6; text-decoration: underline;");
		console.log("");
		console.log("%c🎉 Easter egg: You found it! Thanks for exploring.", "color: #ec4899; font-weight: bold;");
		console.log("");
	`);
}

async function prepareMainPreloadPath() {
	const sourcePath = join(__dirname, "../preload/index.js");
	return preparePreloadPath(sourcePath, "main-preload.js");
}

async function createWindow() {
	const windowOptions = settingsStore.createWindowOptions();
	const showMainWindowImmediately = shouldShowMainWindowImmediately();
	const sourcePreloadPath = join(__dirname, "../preload/index.js");
	const mainPreloadPath = await prepareMainPreloadPath();
	void appLogger.info("app", "Main window preload configured", {
		sourcePreloadPath,
		preloadPath: mainPreloadPath,
		sourceExists: existsSync(sourcePreloadPath),
		exists: existsSync(mainPreloadPath),
		appPath: app.getAppPath(),
		userDataPath: app.getPath("userData"),
		packaged: app.isPackaged,
		isDev: is.dev,
		electronRendererUrl: process.env.ELECTRON_RENDERER_URL ? "set" : "unset",
	});

	mainWindow = new BrowserWindow({
		show: showMainWindowImmediately,
		backgroundColor: "#eef0f3",
		width: 1480,
		height: 960,
		minWidth: 880,
		minHeight: 640,
		title: "",
		icon: iconPath,
		frame: windowOptions.frame,
		titleBarStyle: windowOptions.titleBarStyle,
		trafficLightPosition: windowOptions.trafficLightPosition,
		webPreferences: {
			preload: mainPreloadPath,
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const createdWindow = mainWindow;
	let hasShownMainWindow = false;
	function showMainWindowOnce() {
		if (createdWindow.isDestroyed() || hasShownMainWindow) return;
		hasShownMainWindow = true;
		createdWindow.show();
		createdWindow.focus();
		// 向开发者工具输出启动信息
		printStartupInfo();
	}

	// 窗口保持隐藏时先最大化，再加载页面；避免 ready-to-show 后再最大化造成首帧布局跳变。
	if (!showMainWindowImmediately) {
		mainWindow.maximize();
	}

	// 所有 target="_blank" 或 window.open 的链接统一经同一入口处理，遵守用户设置的打开方式。
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("did-start-loading", () => {
		void appLogger.info("app", "Main window load started", {
			url: mainWindow?.webContents.getURL(),
		});
	});
	mainWindow.webContents.on("did-finish-load", () => {
		void appLogger.info("app", "Main window load finished", {
			url: mainWindow?.webContents.getURL(),
		});
	});
	mainWindow.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			void appLogger.error("app", "Main window load failed", {
				errorCode,
				errorDescription,
				validatedURL,
				isMainFrame,
			});
		},
	);
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		const level: AppLogLevel = details.reason === "clean-exit" ? "info" : "error";
		void appLogger.log(level, "app", "Main window renderer process gone", details);
	});
	mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
		void appLogger.error("app", "Main window preload failed", {
			preloadPath,
			message: error.message,
			stack: error.stack,
		});
	});
	mainWindow.webContents.on("dom-ready", () => {
		void mainWindow?.webContents
			.executeJavaScript("Boolean(window.piDesktop)", true)
			.then((hasPiDesktop) => {
				void appLogger.info("app", "Main window preload API availability", {
					hasPiDesktop,
					url: mainWindow?.webContents.getURL(),
				});
			})
			.catch((error) => {
				void appLogger.warn("app", "Main window preload API check failed", error);
			});
	});
	mainWindow.webContents.on(
		"console-message",
		(event) => {
			if (!["warning", "error"].includes(event.level)) return;
			void appLogger.warn("app", "Main window renderer console error", {
				level: event.level,
				message: event.message,
				line: event.lineNumber,
				sourceId: event.sourceId,
			});
		},
	);

	mainWindow.once("ready-to-show", showMainWindowOnce);
	mainWindow.webContents.once("did-finish-load", showMainWindowOnce);
	setTimeout(showMainWindowOnce, 3000);
	if (showMainWindowImmediately) {
		showMainWindowOnce();
	}

	// 关闭窗口时根据设置决定：隐藏到托盘还是正常退出
	mainWindow.on("close", (event) => {
		if (!isQuitting && settingsStore.get().closeToTray) {
			event.preventDefault();
			mainWindow?.hide();
		} else if (!isQuitting) {
			// 如果没有启用托盘，关闭窗口时直接退出应用
			isQuitting = true;
			app.quit();
		}
	});

	// 监听浏览器标准快捷键打开开发者工具
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (!mainWindow || mainWindow.isDestroyed()) return;

		// F12
		if (input.key === "F12" && input.type === "keyDown") {
			event.preventDefault();
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools({ mode: "detach" });
			}
		}

		// Ctrl+Shift+I (Windows/Linux) 或 Cmd+Option+I (macOS)
		const isMac = process.platform === "darwin";
		const ctrlOrCmd = isMac ? input.meta : input.control;
		const shiftOrOption = input.shift || (isMac && input.alt);

		if (
			ctrlOrCmd &&
			shiftOrOption &&
			input.key.toLowerCase() === "i" &&
			input.type === "keyDown"
		) {
			event.preventDefault();
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools({ mode: "detach" });
			}
		}

		// Ctrl+Shift+J (Windows/Linux) 或 Cmd+Option+J (macOS) - 直接打开 Console
		if (
			ctrlOrCmd &&
			shiftOrOption &&
			input.key.toLowerCase() === "j" &&
			input.type === "keyDown"
		) {
			event.preventDefault();
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools({ mode: "detach", activate: true });
			}
		}
	});

	const devRendererUrl = shouldUseDevRendererUrl()
		? process.env.ELECTRON_RENDERER_URL
		: undefined;
	if (devRendererUrl) {
		mainWindow.loadURL(devRendererUrl);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

function shouldUseDevRendererUrl() {
	return is.dev && !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);
}

function shouldShowMainWindowImmediately() {
	return isUsingLinuxXWaylandWorkaround();
}

// ===== 飞书桥接 IPC =====

/** 自动连接：启动时检查已保存的 Bot 配置，自动连接 */
async function autoConnectFeishu() {
	const bots = listBots();
	if (bots.length === 0) return;
	const bot = bots.find((b) => b.enabled);
	if (!bot) return;
	// 不再自动连接，由用户手动在配置页点击连接
	// 避免应用重启后静默恢复连接导致用户困惑
	console.log("[飞书] 检测到已保存的 Bot 配置:", bot.name, "(跳过自动连接，需手动连接)");
}

function registerFeishuIpc() {
	/** Bot 配置变更后主动推送给 renderer，保证多个页面/弹窗中的 Bot 列表实时同步。 */
	function broadcastBotsChanged() {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send(ipcChannels.feishuBotsChanged, listBots());
	}

	// 临时连接（不保存 bot 配置），用于添加 Bot 时先验证凭证可用性
	ipcMain.handle(ipcChannels.feishuConnectTemp, async (_event, input: FeishuConnectInput) => {
		const appId = input.appId?.trim() ?? "";
		const appSecret = input.appSecret?.trim() ?? "";
		console.log("[Feishu] 收到临时连接请求", JSON.stringify({ appId: appId ? appId.slice(0, 8) + "..." : "", name: input.name, hasSecret: Boolean(appSecret) }));
		try {
			if (!appId || !appSecret) {
				return { success: false, message: "请填写 App ID 和 App Secret" };
			}
			if (feishuBridge) {
				feishuBridge.stop();
			}
			// 临时构造 botConfig，不做持久化；明文 secret 只传给当前 bridge，不写入磁盘。
			const botConfig: FeishuBotConfig = {
				id: "temp-" + randomUUID(),
				name: input.name?.trim() || "临时机器人",
				enabled: true,
				appId,
				appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			};
			feishuBridge = new FeishuBridge(botConfig, agentManager, () => mainWindow, () => projectStore.list(), appSecret);
			await feishuBridge.start();
			const status = feishuBridge.getStatus();
			console.log("[Feishu] 临时连接成功，状态:", JSON.stringify(status));
			return {
				success: true,
				message: "连接成功",
				botInfo: { id: botConfig.id, name: botConfig.name },
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Feishu] 临时连接失败:", message);
			return { success: false, message };
		}
	});

	// 连接飞书（保存 bot）
	ipcMain.handle(ipcChannels.feishuConnect, async (_event, input: FeishuConnectInput) => {
		console.log("[Feishu] 收到连接请求", JSON.stringify({ appId: input.appId?.slice(0, 8) + "...", name: input.name }));
		try {
			if (feishuBridge) {
				console.log("[Feishu] 停止旧 bridge 状态:", JSON.stringify(feishuBridge.getStatus()));
				feishuBridge.stop();
			}

			const botConfig = addFeishuBot({
				name: input.name || "飞书机器人",
				appId: input.appId,
				appSecret: input.appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			});

			feishuBridge = new FeishuBridge(botConfig, agentManager, () => mainWindow, () => projectStore.list());
			await feishuBridge.start();
			console.log("[Feishu] 连接成功，状态:", JSON.stringify(feishuBridge.getStatus()));
			void appLogger.info("feishu", "Feishu connected", { botId: botConfig.id, name: botConfig.name });
			broadcastBotsChanged();
			return { success: true, message: "连接成功" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Feishu] 连接失败:", message);
			void appLogger.error("feishu", "Feishu connect failed", error);
			return { success: false, message };
		}
	});

	// 断开连接
	ipcMain.handle(ipcChannels.feishuDisconnect, async () => {
		console.log("[Feishu] 收到断开请求");
		if (feishuBridge) {
			console.log("[Feishu] 停止 bridge，此前状态:", JSON.stringify(feishuBridge.getStatus()));
			feishuBridge.stop();
			feishuBridge = null;
			console.log("[Feishu] bridge 已置 null");
		}
		void appLogger.info("feishu", "Feishu disconnected");
		return { success: true };
	});

	// 查询状态
	ipcMain.handle(ipcChannels.feishuStatusRequest, async () => {
		if (feishuBridge) {
			const s = feishuBridge.getStatus();
			console.log("[Feishu] 状态查询:", JSON.stringify(s));
			return s;
		}
		console.log("[Feishu] 状态查询: bridge 为 null，返回 disconnected");
		return { status: "disconnected", activeBindings: 0 } as FeishuBridgeStatus;
	});

	// Bot 列表
	ipcMain.handle(ipcChannels.feishuBotsList, async () => {
		return listBots();
	});

	// 添加 Bot
	ipcMain.handle(ipcChannels.feishuBotAdd, async (_event, input: FeishuConnectInput) => {
		// 同 feishuConnect，但可以添加多个 Bot
		try {
			const botConfig = addFeishuBot({
				name: input.name || "飞书机器人",
				appId: input.appId,
				appSecret: input.appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			});
			void appLogger.info("feishu", "Feishu bot added", { botId: botConfig.id, name: botConfig.name });
			broadcastBotsChanged();
			return { success: true, bot: { ...botConfig, appSecret: "" } };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	});

	// 删除 Bot
	ipcMain.handle(ipcChannels.feishuBotRemove, async (_event, botId: string) => {
		if (feishuBridge) {
			feishuBridge.stop();
			feishuBridge = null;
		}
		const result = removeFeishuBot(botId);
		if (result) {
			broadcastBotsChanged();
		}
		void appLogger.info("feishu", "Feishu bot removed", { botId });
		return result;
	});

	// 更新 Bot 配置
	ipcMain.handle(ipcChannels.feishuBotConfig, async (_event, botId: string, patch: Partial<FeishuBotConfig>) => {
		const updated = updateFeishuBot(botId, patch);
		void appLogger.info("feishu", "Feishu bot config updated", { botId, keys: Object.keys(patch) });
		// 只热更新当前在线 Bot；修改其它 Bot 配置不应污染正在运行的 bridge。
		if (feishuBridge && feishuBridge.getStatus().status === "connected" && feishuBridge.getStatus().botId === botId) {
			feishuBridge.updateBotConfig(patch);
			console.log("[飞书] 配置已热更新:", Object.keys(patch).join(", "));
		}
		if (updated) {
			broadcastBotsChanged();
		}
		return updated ? { ...updated, appSecret: "" } : undefined;
	});

	// 返回解密后的 Secret，仅用于用户主动复制/查看凭证。
	ipcMain.handle(ipcChannels.feishuBotSecret, async (_event, botId: string) => {
		return getDecryptedBotAppSecret(botId);
	});

	// 测试连接
	ipcMain.handle(ipcChannels.feishuTestConnection, async (_event, appId: string, appSecret: string) => {
		// 创建临时 bridge 实例来测试连接
		const testBridge = new FeishuBridge(
			{
				id: "test",
				name: "测试",
				enabled: true,
				appId,
				appSecret: "", // 将在 testConnection 中传入
			},
			agentManager,
			() => mainWindow,
			() => projectStore.list(),
		);
		return testBridge.testConnection(appId, appSecret);
	});

	// 绑定列表
	ipcMain.handle(ipcChannels.feishuBindingsList, async () => {
		if (feishuBridge) {
			return feishuBridge.listBindings();
		}
		return [];
	});

	// 移除绑定
	ipcMain.handle(ipcChannels.feishuBindingRemove, async (_event, chatId: string) => {
		if (feishuBridge) {
			// 先查 binding 拿到 sessionId，移除后清理 session-bot 映射，
			// 使 FeishuLinkIndicator 等 UI 同步更新断开状态。
			const bindings = feishuBridge.listBindings();
			const binding = bindings.find((b) => b.chatId === chatId);
			const result = feishuBridge.removeBinding(chatId);
			if (result && binding) {
				setSessionBotId(binding.sessionId, undefined);
			}
			return result;
		}
		return false;
	});

	// 更新绑定
	ipcMain.handle(ipcChannels.feishuBindingUpdate, async (_event, chatId: string, patch: Partial<FeishuChatBinding>) => {
		if (feishuBridge) {
			return feishuBridge.updateBinding(chatId, patch);
		}
		return undefined;
	});

	// 通过已保存的 Bot ID 连接（自动解密 Secret）
	ipcMain.handle(ipcChannels.feishuConnectByBot, async (_event, botId: string) => {
		try {
			if (feishuBridge) {
				feishuBridge.stop();
			}
			const botConfig = getBot(botId);
			if (!botConfig) {
				return { success: false, message: "Bot 配置不存在" };
			}
			feishuBridge = new FeishuBridge(botConfig, agentManager, () => mainWindow, () => projectStore.list());
			await feishuBridge.start();
			void appLogger.info("feishu", "Feishu connected by saved bot", { botId, name: botConfig.name });
			return { success: true, message: "连接成功" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { success: false, message };
		}
	});

	// 获取 Agent 绑定的飞书 Bot ID
	ipcMain.handle(ipcChannels.feishuSessionBotGet, async (_event, agentId: string) => {
		return getSessionBotId(agentId) ?? null;
	});

	// 设置 Agent 使用的飞书 Bot ID；非空表示用户手动连接当前会话，需要立即创建/复用飞书群绑定。
	// 传入 null 时取消关联：仅移除绑定（不终止 Agent），同时清理配置映射。
	ipcMain.handle(ipcChannels.feishuSessionBotSet, async (_event, agentId: string, botId: string | null) => {
		if (!botId) {
			setSessionBotId(agentId, undefined);
			// 取消当前会话的飞书关联：移除绑定但不停止 Agent 进程
			if (feishuBridge && feishuBridge.getStatus().status === "connected") {
				feishuBridge.removeBindingBySessionId(agentId);
			}
			return;
		}
		const status = feishuBridge?.getStatus();
		if (!feishuBridge || status?.status !== "connected") return;
		if (status.botId !== botId) return;
		setSessionBotId(agentId, botId);
		const tab = agentManager.list().find((item) => item.id === agentId);
		if (!tab) return;
		await feishuBridge.ensureSessionMirror(tab.id, tab.title, tab.sessionPath);
	});
}

function registerIpc() {
	ipcMain.handle(ipcChannels.projectsList, () => projectStore.list());
	ipcMain.handle(ipcChannels.editorsList, async () => listConfiguredExternalEditors(settingsStore.get()));
	ipcMain.handle(ipcChannels.editorsChooseExecutable, async () => {
		const options = {
			properties: ["openFile"],
			filters: process.platform === "win32"
				? [
						{ name: "Applications", extensions: ["exe", "cmd", "bat"] },
						{ name: "All Files", extensions: ["*"] },
					]
				: [{ name: "All Files", extensions: ["*"] }],
		} satisfies Electron.OpenDialogOptions;
		const result = mainWindow
			? await dialog.showOpenDialog(mainWindow, options)
			: await dialog.showOpenDialog(options);
		return result.canceled ? null : result.filePaths[0] ?? null;
	});
	ipcMain.handle(ipcChannels.editorsRedetect, async () => {
		const detected = await detectExternalEditors();
		const settings = await settingsStore.update({
			externalEditors: mergeDetectedExternalEditors(settingsStore.get().externalEditors, detected),
		});
		void appLogger.info("editor", "External editors redetected", { count: detected.length });
		return settings;
	});
	ipcMain.handle(
		ipcChannels.editorsUpdate,
		async (_event, editorId: ExternalEditorId, patch: Partial<ExternalEditorSetting>) => {
			const current = settingsStore.get().externalEditors;
			const existing = current[editorId];
			if (!existing) throw new Error(`Unsupported editor: ${editorId}`);
			const command = typeof patch.command === "string" ? patch.command.trim() : existing.command;
			if (command) {
				const validation = await validateExternalEditorCommand(command);
				if (!validation.valid) throw new Error(`Editor path does not exist: ${command}`);
			}
			const settings = await settingsStore.update({
				externalEditors: {
					...current,
					[editorId]: {
						...existing,
						...patch,
						command,
						detectedFrom: patch.command !== undefined ? "manual" : (patch.detectedFrom ?? existing.detectedFrom),
						updatedAt: Date.now(),
					},
				},
			});
			void appLogger.info("editor", "External editor settings updated", { editorId, keys: Object.keys(patch) });
			return settings;
		},
	);
	ipcMain.handle(
		ipcChannels.editorsOpenProject,
		async (_event, editor: ExternalEditor, projectPath: string) => {
			// 只接收已检测到的编辑器配置；打开项目不经过 shell 拼接命令,降低路径含空格时失败的概率。
			await openProjectInEditor(editor, projectPath);
			void appLogger.info("editor", "Project opened in external editor", {
				editorId: editor.id,
				editorName: editor.name,
				command: editor.command,
				args: editor.args,
				projectPath,
			});
		},
	);
	ipcMain.handle(ipcChannels.projectsAdd, async () => {
		const project = await projectStore.chooseAndAdd();
		void appLogger.info("project", "Project added", { projectId: project?.id, path: project?.path });
		return project;
	});
	ipcMain.handle(ipcChannels.projectsRemove, async (_event, id: string) => {
		// 删除前拦截：项目仍有运行中的 Agent（pi 子进程）时禁止删除，避免进程悬挂后台继续占用资源。
		if (agentManager.hasAgentForProject(id)) {
			throw new Error("PROJECT_HAS_RUNNING_AGENT");
		}
		await projectStore.remove(id);
		void appLogger.info("project", "Project removed", { projectId: id });
		return projectStore.list();
	});
	ipcMain.handle(
		ipcChannels.projectsReorder,
		async (_event, projectIds: string[]) => {
			const result = await projectStore.reorder(projectIds);
			void appLogger.info("project", "Projects reordered", { count: projectIds.length });
			return result;
		},
	);
	ipcMain.handle(ipcChannels.projectResourcesList, async (_event, projectId: string) => {
		return projectResourceManager.list(projectId);
	});
	ipcMain.handle(ipcChannels.projectResourcesCreateSkill, async (_event, input: CreateProjectSkillInput) => {
		const result = await projectResourceManager.createSkill(input);
		void appLogger.info("project-resource", "Project skill created", { projectId: input.projectId, name: result.name });
		return result;
	});
	ipcMain.handle(ipcChannels.projectResourcesDeleteSkill, async (_event, projectId: string, skillPath: string) => {
		// 项目资源删除由 ProjectResourceManager 再次校验路径归属，避免 renderer 传入任意文件路径。
		await projectResourceManager.deleteSkill(projectId, skillPath);
		void appLogger.info("project-resource", "Project skill deleted", { projectId, skillPath });
	});
	ipcMain.handle(ipcChannels.projectResourcesDeleteExtension, async (_event, projectId: string, extensionPath: string) => {
		// 项目级 extension 是自动发现的本地文件/目录，删除时仅移除项目 .pi/extensions 下对应资源。
		await projectResourceManager.deleteExtension(projectId, extensionPath);
		void appLogger.info("project-resource", "Project extension deleted", { projectId, extensionPath });
	});
	ipcMain.handle(ipcChannels.projectResourcesToggleSkill, async (_event, projectId: string, skillPath: string, enabled: boolean) => {
		const result = await projectResourceManager.toggleSkill(projectId, skillPath, enabled);
		void appLogger.info("project-resource", "Project skill toggled", { projectId, skillPath, enabled });
		return result;
	});
	ipcMain.handle(ipcChannels.projectResourcesToggleExtension, async (_event, projectId: string, extensionPath: string, enabled: boolean) => {
		await projectResourceManager.toggleExtension(projectId, extensionPath, enabled);
		void appLogger.info("project-resource", "Project extension toggled", { projectId, extensionPath, enabled });
	});
	ipcMain.handle(ipcChannels.projectResourcesRenameSkill, async (_event, projectId: string, skillPath: string, newName: string) => {
		const result = await projectResourceManager.renameSkill(projectId, skillPath, newName);
		void appLogger.info("project-resource", "Project skill renamed", { projectId, skillPath, newName });
		return result;
	});

	// ── Worktree 项目管理 ──

	ipcMain.handle(ipcChannels.projectsListRoot, () => {
		return projectStore.listRoot();
	});

	ipcMain.handle(
		ipcChannels.projectsListWorktreeChildren,
		async (_event, parentId: string) => {
			return projectStore.listWorktreeChildren(parentId);
		},
	);

	ipcMain.handle(
		ipcChannels.projectsToggleWorktreeEnabled,
		async (_event, projectId: string) => {
			const project = await projectStore.toggleWorktreeEnabled(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			// 开启 worktree 模式时，自动注册已有的 git worktree
			if (project.worktreeEnabled) {
				try {
					const entries = await worktreeService.list(project.path);
					for (const wt of entries) {
						// findByPath 返回 null 表示未注册
						if (!projectStore.findByPath(wt.path)) {
							await projectStore.add(wt.path, projectId);
						}
					}
				} catch {
					// worktree 查询失败不阻塞 toggle
				}
			}
			return project;
		},
	);

	ipcMain.handle(ipcChannels.filesList, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		return fileSystemService.listTree(project.path);
	});

	ipcMain.handle(ipcChannels.filesOpen, async (_event, path: string) => {
		const error = await shell.openPath(path);
		// Electron 通过返回字符串报告打开失败；显式抛出后前端才能提示路径不存在或系统无法打开。
		if (error) throw new Error(error);
	});

	ipcMain.handle(ipcChannels.filesReadContent, async (_event, path: string) => {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return "";
			}
			throw error;
		}
	});

	ipcMain.handle(ipcChannels.filesWriteContent, async (_event, path: string, content: string) => {
		await writeFile(path, content, "utf8");
		void appLogger.info("file", "File written", { path, bytes: Buffer.byteLength(content, "utf8") });
	});

	ipcMain.handle(ipcChannels.filesDelete, async (_event, path: string, recursive?: boolean) => {
		await fileSystemService.delete(path, recursive);
		void appLogger.info("file", "File deleted", { path, recursive: Boolean(recursive) });
	});

	ipcMain.handle(ipcChannels.filesRename, async (_event, path: string, newName: string) => {
		const result = await fileSystemService.rename(path, newName);
		void appLogger.info("file", "File renamed", { path, newName, result });
		return result;
	});

	// Scratch Pad（草稿本）：多草稿支持，每份草稿为 drafts/ 下的独立 .md 文件
	const draftsDir = join(app.getPath("userData"), "drafts");

	/** 确保 drafts 目录存在，首次访问时如果旧 scratch-pad.md 存在则迁移为草稿 */
	async function ensureDraftsDir(): Promise<void> {
		try {
			await mkdir(draftsDir, { recursive: true });
		} catch {
			// 忽略目录已存在错误
		}
		// 迁移旧 scratch-pad.md：如果存在且有内容，移入 drafts 目录
		const oldPath = join(app.getPath("userData"), "scratch-pad.md");
		try {
			const oldStat = await stat(oldPath);
			if (oldStat.size > 0) {
				const ts = new Date(oldStat.mtimeMs);
				const name = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")} ${String(ts.getHours()).padStart(2, "0")}-${String(ts.getMinutes()).padStart(2, "0")}-${String(ts.getSeconds()).padStart(2, "0")}.md`;
				await copyFile(oldPath, join(draftsDir, name));
			}
			await rm(oldPath);
		} catch {
			// 旧文件不存在则忽略
		}
	}

	/** 生成以当前时间命名的默认文件名：YYYY-MM-DD HH-mm-ss.md */
	function generateDraftName(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}.md`;
	}

	/** 列出所有草稿，按更新时间降序排列 */
	ipcMain.handle(ipcChannels.scratchPadList, async (): Promise<import("../shared/types").DraftMeta[]> => {
		await ensureDraftsDir();
		const files = await readdir(draftsDir);
		const mdFiles = files.filter(f => f.endsWith(".md"));
		const drafts = await Promise.all(
			mdFiles.map(async (f) => {
				const fullPath = join(draftsDir, f);
				try {
					const s = await stat(fullPath);
					return {
						id: f.replace(/\.md$/, ""),
						name: f.replace(/\.md$/, ""),
						path: fullPath,
						createdAt: s.birthtimeMs,
						updatedAt: s.mtimeMs,
					};
				} catch {
					return null;
				}
			}),
		);
		return drafts
			.filter((d): d is NonNullable<typeof d> => d !== null)
			.sort((a, b) => b.updatedAt - a.updatedAt);
	});

	/** 创建新草稿，默认文件名为当前时间 */
	ipcMain.handle(ipcChannels.scratchPadCreate, async (): Promise<import("../shared/types").DraftMeta> => {
		await ensureDraftsDir();
		const name = generateDraftName();
		const fullPath = join(draftsDir, name);
		await writeFile(fullPath, "", "utf8");
		const s = await stat(fullPath);
		void appLogger.info("scratchPad", "draft created", { path: fullPath });
		return {
			id: name.replace(/\.md$/, ""),
			name: name.replace(/\.md$/, ""),
			path: fullPath,
			createdAt: s.birthtimeMs,
			updatedAt: s.mtimeMs,
		};
	});

	/** 删除指定草稿 */
	ipcMain.handle(ipcChannels.scratchPadDelete, async (_event, draftPath: string): Promise<void> => {
		await rm(draftPath);
		void appLogger.info("scratchPad", "draft deleted", { path: draftPath });
	});

	/** 加载指定草稿内容，path 为空时返回空内容 */
	ipcMain.handle(ipcChannels.scratchPadLoad, async (_event, draftPath?: string): Promise<import("../shared/types").ScratchPadData> => {
		if (!draftPath) return { content: "", lastEditedAt: 0, cursorPosition: 0 };
		try {
			const content = await readFile(draftPath, "utf8");
			const fileStat = await stat(draftPath);
			return { content, lastEditedAt: fileStat.mtimeMs, cursorPosition: 0 };
		} catch {
			return { content: "", lastEditedAt: 0, cursorPosition: 0 };
		}
	});

	/** 保存内容到指定草稿 */
	ipcMain.handle(ipcChannels.scratchPadSave, async (_event, draftPath: string, content: string, cursorPosition: number) => {
		await ensureDraftsDir();
		await writeFile(draftPath, content, "utf8");
		void appLogger.info("scratchPad", "saved", { path: draftPath, bytes: Buffer.byteLength(content, "utf8"), cursorPosition });
	});

	/** 导出指定草稿到用户选择的路径 */
	ipcMain.handle(ipcChannels.scratchPadExport, async (_event, draftPath?: string) => {
		if (!draftPath) return false;
		const suggestedName = basename(draftPath);
		const { canceled, filePath } = await dialog.showSaveDialog({
			defaultPath: suggestedName,
			filters: [{ name: "Markdown", extensions: ["md"] }],
		});
		if (canceled || !filePath) return false;
		const content = await readFile(draftPath, "utf8");
		await writeFile(filePath, content, "utf8");
		return true;
	});

	ipcMain.handle(
		ipcChannels.filesShowInFolder,
		async (_event, path: string) => {
			shell.showItemInFolder(path);
		},
	);

	ipcMain.handle(
		ipcChannels.sessionsList,
		async (_event, projectId?: string) => {
			const project = projectId ? projectStore.get(projectId) : undefined;
			return sessionScanner.list(project?.path);
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsRename,
		async (_event, filePath: string, newName: string) => {
			await sessionScanner.rename(filePath, newName);
			void appLogger.info("session", "Session renamed", { filePath, newName });
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCopy,
		(_event, projectId: string, filePath: string) =>
			agentManager.cloneSessionFile(projectId, filePath),
	);
	ipcMain.handle(
		ipcChannels.sessionsExportHtml,
		(_event, projectId: string, filePath: string) =>
			agentManager.exportSessionHtml(projectId, filePath),
	);
	ipcMain.handle(ipcChannels.sessionsDelete, async (_event, filePath: string) => {
		// 检查是否有活跃 Agent 正在使用该会话文件；如有则拒绝删除，避免 pi 进程访问已删除文件。
		const normalizedTarget = filePath.replace(/\\/g, "/").toLowerCase();
		const activeAgents = agentManager.list();
		const usingAgent = activeAgents.find((agent) => {
			const sessionPath = agent.sessionPath?.replace(/\\/g, "/").toLowerCase();
			return sessionPath === normalizedTarget;
		});
		if (usingAgent) {
			throw new Error(
				`会话“${usingAgent.title}”正在使用中，请先关闭 Agent 后再删除`,
			);
		}

		await sessionScanner.delete(filePath);
		void appLogger.info("session", "Session deleted", { filePath });
	});
	ipcMain.handle(
		ipcChannels.codexSessionsScan,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return codexSessionImporter.scan(project.path);
		},
	);
	ipcMain.handle(
		ipcChannels.codexSessionsImport,
		async (_event, projectId: string, sourcePaths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return codexSessionImporter.import(project.path, sourcePaths);
		},
	);
	ipcMain.handle(
		ipcChannels.claudeSessionsScan,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return claudeSessionImporter.scan(project.path);
		},
	);
	ipcMain.handle(
		ipcChannels.claudeSessionsImport,
		async (_event, projectId: string, sourcePaths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return claudeSessionImporter.import(project.path, sourcePaths);
		},
	);
	ipcMain.handle(
		ipcChannels.openCodeSessionsScan,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return openCodeSessionImporter.scan(project.path);
		},
	);
	ipcMain.handle(
		ipcChannels.openCodeSessionsImport,
		async (_event, projectId: string, sourcePaths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return openCodeSessionImporter.import(project.path, sourcePaths);
		},
	);

	ipcMain.handle(ipcChannels.gitBranches, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		return gitService.getBranches(project.path);
	});

	ipcMain.handle(
		ipcChannels.gitCheckout,
		async (_event, projectId: string, branch: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return gitService.checkout(project.path, branch);
		},
	);

	ipcMain.handle(
		ipcChannels.gitCreateBranch,
		async (_event, projectId: string, branchName: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return gitService.createBranch(project.path, branchName);
		},
	);

	// 差异查看需要文件的 Git HEAD 原始内容作为对比基准；参数是绝对文件路径，后端自行定位仓库根。
	ipcMain.handle(
		ipcChannels.gitOriginalContent,
		async (_event, filePath: string) => {
			return gitService.getOriginalContent(filePath);
		},
	);

	// 获取工作区中被 Git 跟踪的变更文件列表（对比 HEAD），返回到前端用于右侧文件面板。
	ipcMain.handle(
		ipcChannels.gitChangedFiles,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) return [];
			return gitService.getChangedFiles(project.path);
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorktreeList,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const entries = await worktreeService.list(project.path);
			// 每次扫描都同步注册外部新增 worktree，保证侧栏数据和 git 状态一致。
			for (const wt of entries) {
				await projectStore.add(wt.path, projectId);
			}
			return entries;
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorktreeCreate,
		async (_event, projectId: string, branchName: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const info = await worktreeService.create(project.path, projectId, branchName);
			await projectStore.add(info.path, projectId);
			return info;
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorktreeRemove,
		async (_event, projectId: string, worktreePath: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const ok = await worktreeService.remove(worktreePath, project.path);
			if (ok) {
				const child = projectStore.findByPath(worktreePath);
				if (child) await projectStore.remove(child.id);
			}
			return ok;
		},
	);

	ipcMain.handle(ipcChannels.piCheck, async () => {
		// 用户手动指定的路径优先于自动检测
		const settings = settingsStore.get();
		const status = await piLocator.check(settings.customPiPath);
		void appLogger.info("pi", "Pi check completed", {
			installed: status.installed,
			version: status.version,
			command: status.command,
			error: status.error,
		});
		return status;
	});
	ipcMain.handle(ipcChannels.piUpdateCheck, async () => {
		const result = await extensionManager.checkPiUpdate();
		void appLogger.info("pi", "Pi update check completed", { currentVersion: result.currentVersion, latestVersion: result.latestVersion, hasUpdate: result.hasUpdate, error: result.error });
		return result;
	});
	ipcMain.handle(ipcChannels.piUpdate, async () => {
		const result = await extensionManager.updatePi();
		void appLogger.info("pi", "Pi update command completed", { updated: result.updated, bytes: result.output.length });
		return result;
	});
	ipcMain.handle(
		ipcChannels.piCheckCustom,
		async (_event, customPath: string) => {
			const status = await piLocator.validateCustomPath(customPath);
			// 校验通过后持久化归一化后的路径，后续启动 agent 时 PiProcess 会从 settings 读取。
			// 例如用户粘贴 "D:\\foo\\pi" 时，PiLocator 会返回可执行的 D:\foo\pi.cmd。
			if (status.installed && status.command) {
				await settingsStore.update({ customPiPath: status.command });
			}
			void appLogger.info("pi", "Custom pi path checked", {
				installed: status.installed,
				version: status.version,
				command: status.command,
				error: status.error,
			});
			return status;
		},
	);
	ipcMain.handle(ipcChannels.appInfo, () => ({
		version: app.getVersion(),
		releasesUrl: RELEASES_URL,
	}));
	ipcMain.handle(ipcChannels.appCheckUpdate, () =>
		checkForAppUpdate(settingsStore.get().installationType),
	);
	ipcMain.handle(
		ipcChannels.appDownloadUpdate,
		async (_event, asset: AppUpdateAsset) => downloadUpdateAsset(asset),
	);
	ipcMain.handle(
		ipcChannels.appInstallUpdate,
		async (_event, filePath: string) => installDownloadedUpdate(filePath),
	);
	ipcMain.handle(ipcChannels.logsList, async (_event, query: AppLogQuery) =>
		appLogger.list(query),
	);
	ipcMain.handle(
		ipcChannels.rendererLog,
		async (
			_event,
			level: AppLogLevel,
			scope: string,
			message: string,
			detail?: unknown,
		) => {
			const safeLevel = ["debug", "info", "warn", "error"].includes(level)
				? level
				: "info";
			await appLogger.log(safeLevel as AppLogLevel, scope, message, detail);
		},
	);
	ipcMain.on(ipcChannels.preloadReady, (event) => {
		void appLogger.info("app", "Preload API exposed", {
			url: event.sender.getURL(),
		});
	});
	ipcMain.on(ipcChannels.preloadError, (event, detail) => {
		void appLogger.error("app", "Preload API expose failed", {
			url: event.sender.getURL(),
			detail,
		});
	});
	ipcMain.handle(ipcChannels.logsClear, async () => appLogger.clear());
	ipcMain.handle(ipcChannels.logsOpenFolder, async () => appLogger.openFolder());
	/** 获取 app 日志文件总大小 */
	ipcMain.handle(ipcChannels.logsSize, async () => appLogger.getSize());
	/** 获取 RPC 日志文件总大小，可选按 agentId 过滤 */
	ipcMain.handle(ipcChannels.rpcLogsGetSize, async (_event, agentId?: string) => rpcLogger.getSize(agentId));
	/** 从文件读取 RPC 日志，可选按 agentId/日期范围过滤 */
	ipcMain.handle(ipcChannels.rpcLogsGet, async (_event, options?: { agentId?: string; days?: number; limit?: number }) => rpcLogger.getFromFile(options));
	/** 清空 RPC 日志文件，可选按 agentId 过滤 */
	ipcMain.handle(ipcChannels.rpcLogsClear, async (_event, agentId?: string) => rpcLogger.clear(agentId));
	/** 开关某 agent 的 RPC 日志记录 */
	ipcMain.handle(ipcChannels.rpcLoggingSet, async (_event, agentId: string, enabled: boolean) => {
		agentManager.setRpcLogging(agentId, enabled);
		return enabled;
	});
	/** 查询某 agent 的 RPC 日志记录状态 */
	ipcMain.handle(ipcChannels.rpcLoggingGet, async (_event, agentId: string) => agentManager.isRpcLogging(agentId));
	/** 用默认编辑器打开某 agent 的 RPC 日志文件 */
	ipcMain.handle(ipcChannels.rpcLogsOpenFile, async (_event, agentId: string) => {
		const { shell } = require("electron");
		const { join } = require("path");
		const dir = join(app.getPath("userData"), "logs", "rpc");
		await shell.openPath(dir);
	});
	ipcMain.handle(ipcChannels.appFeedbackEnvironment, async () => {
		// 反馈报告只包含诊断必需的运行时版本与 pi 检测结果，不读取配置密钥或会话内容。
		const pi = await piLocator.check();
		return {
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			electronVersion: process.versions.electron ?? "",
			chromeVersion: process.versions.chrome ?? "",
			nodeVersion: process.versions.node,
			pi,
		};
	});
	ipcMain.handle(ipcChannels.appOpenExternal, async (_event, url: string) => {
		// 外部链接统一经主进程打开，避免 renderer 直接依赖 shell 权限，并遵守用户设置的打开方式。
		await openExternalUrl(url);
	});
	ipcMain.handle(ipcChannels.appRestart, async () => {
		// 标记为退出状态，避免 closeToTray 阻止重启
		isQuitting = true;
		// 停止所有 Agent 和服务
		await webServiceManager?.stop();
		terminalManager?.closeAll();
		agentManager?.stopAll();
		// 重启应用
		app.relaunch();
		app.quit();
	});
	ipcMain.handle(ipcChannels.appWindowMinimize, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.minimize();
	});
	ipcMain.handle(ipcChannels.appWindowToggleMaximize, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	});
	ipcMain.handle(ipcChannels.appWindowToggleAlwaysOnTop, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return false;
		const next = !mainWindow.isAlwaysOnTop();
		// floating 适合工具型桌面窗口；跨平台由 Electron 映射到各系统的置顶层级。
		mainWindow.setAlwaysOnTop(next, "floating");
		return next;
	});
	ipcMain.handle(ipcChannels.appWindowClose, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.close();
	});

	ipcMain.handle(ipcChannels.settingsGet, () => settingsStore.get());
	ipcMain.handle(
		ipcChannels.settingsUpdate,
		async (_event, patch: Partial<AppSettings>) => {
			// 记录更新前的设置，用于驱动桌面宠物对 pet 字段变化的反应
			const prevSettings = settingsStore.get();
			const settings = await settingsStore.update(patch);
			void appLogger.info("settings", "Settings updated", { keys: Object.keys(patch) });
			// 桌面宠物：设置面板走 settings.update，这里统一驱动开窗/切换/置顶
			await petSystem?.reactToSettings(prevSettings, settings);
			if (
				"desktopProxyEnabled" in patch ||
				"desktopProxyUrl" in patch ||
				"desktopProxyBypass" in patch
			) {
				await applyDesktopProxy(settings);
			}
			if ("useNativeTitleBar" in patch) {
				settingsStore.notifyTitleBarChange(mainWindow);
			}
			if (
				"webServiceEnabled" in patch ||
				"webServiceHost" in patch ||
				"webServicePort" in patch
			) {
				try {
					await webServiceManager.applySettings(settings);
				} catch (error) {
					if (settings.webServiceEnabled) {
						await settingsStore.update({ webServiceEnabled: false });
					}
					throw error;
				}
			}
			return settings;
		},
	);
	ipcMain.handle(
		ipcChannels.settingsTestPiProxy,
		async () => {
			const result = await testPiProxy(settingsStore.get());
			void appLogger.info("settings", "Pi proxy tested", {
				success: result.success,
				elapsedMs: result.elapsedMs,
				statusCode: result.statusCode,
				error: result.error,
			});
			return result;
		},
	);

	ipcMain.handle(ipcChannels.skillsList, () => skillManager.list());
	ipcMain.handle(ipcChannels.skillsCreate, async (_event, input: CreatePiSkillInput) => {
		const result = await skillManager.create(input);
		void appLogger.info("skill", "Skill created", { name: input.name, locationId: input.locationId });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsToggle, async (_event, path: string, enabled: boolean) => {
		const result = await skillManager.toggle(path, enabled);
		void appLogger.info("skill", "Skill toggled", { path, enabled });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsDelete, async (_event, path: string) => {
		const result = await skillManager.delete(path);
		void appLogger.info("skill", "Skill deleted", { path });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsOpenFolder, (_event, path?: string) =>
		skillManager.openFolder(path),
	);

	// ── Prompt Templates ──
	ipcMain.handle(ipcChannels.promptsList, () => promptManager.list());
	ipcMain.handle(ipcChannels.promptsCreate, async (_event, input: CreatePiPromptTemplateInput) => {
		const result = await promptManager.create(input);
		void appLogger.info("prompt", "Prompt template created", { name: input.name });
		return result;
	});
	ipcMain.handle(ipcChannels.promptsDelete, async (_event, filePath: string) => {
		await promptManager.delete(filePath);
		void appLogger.info("prompt", "Prompt template deleted", { filePath });
	});
	ipcMain.handle(ipcChannels.promptsOpenFolder, () => promptManager.openFolder());
	ipcMain.handle(ipcChannels.promptsEdit, async (_event, filePath: string, content?: string) => {
		if (content !== undefined) {
			await promptManager.writeContent(filePath, content);
			return;
		}
		return promptManager.readContent(filePath);
	});
	ipcMain.handle(ipcChannels.promptsListByProject, async (_event, projectPath: string) => {
		return promptManager.listByProject(projectPath);
	});
	ipcMain.handle(ipcChannels.promptsCreateInProject, async (_event, projectPath: string, input: CreatePiPromptTemplateInput) => {
		const result = await promptManager.createInProject(projectPath, input);
		void appLogger.info("prompt", "Project prompt template created", {
			projectPath,
			name: input.name,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.promptsDeleteInProject, async (_event, projectPath: string, fileName: string) => {
		await promptManager.deleteFromProject(projectPath, fileName);
		void appLogger.info("prompt", "Project prompt template deleted", { projectPath, fileName });
	});
	ipcMain.handle(ipcChannels.promptsRename, async (_event, oldName: string, newName: string) => {
		const result = await promptManager.rename(oldName, newName);
		void appLogger.info("prompt", "Prompt template renamed", { oldName, newName });
		return result;
	});
	ipcMain.handle(ipcChannels.promptsRenameInProject, async (_event, projectPath: string, oldName: string, newName: string) => {
		const result = await promptManager.renameInProject(projectPath, oldName, newName);
		void appLogger.info("prompt", "Project prompt template renamed", { projectPath, oldName, newName });
		return result;
	});

	// ── Prompt Store (prompts.chat) ──────────────────────────────────────
	/** prompts.chat REST API 端点 */
	const PROMPT_STORE_BASE = "https://prompts.chat/api";

	/**
	 * 搜索 prompts.chat 公开 prompt 市场。
	 * 使用 REST API 搜索，返回结构化结果供用户浏览和选择导入。
	 */
	ipcMain.handle(ipcChannels.promptStoreSearch, async (_event, query: string, options?: {
		limit?: number;
		type?: string;
		category?: string;
		tag?: string;
	}) => {
		try {
			const params = new URLSearchParams({ q: query });
			if (options?.limit) params.set("perPage", String(options.limit));
			if (options?.type) params.set("type", options.type);
			if (options?.category) params.set("category", options.category);
			if (options?.tag) params.set("tag", options.tag);

			const url = `${PROMPT_STORE_BASE}/prompts?${params.toString()}`;
			const response = await fetch(url, {
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				throw new Error(`prompts.chat API 返回 ${response.status}`);
			}
			// API 返回原始结构，扁平化为 UI 消费的格式
			const raw = (await response.json()) as PromptStoreSearchResponse;
			const result: PromptStoreSearchResult = {
				query,
				count: raw.total,
				prompts: raw.prompts.map(flattenPromptItem),
			};
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("prompt-store", "Search failed", { query, error: message });
			throw new Error(`搜索 prompt 商店失败: ${message}`);
		}
	});

	/** 通过 ID 获取 prompts.chat 单个 prompt 的完整内容 */
	ipcMain.handle(ipcChannels.promptStoreGet, async (_event, id: string) => {
		try {
			const url = `${PROMPT_STORE_BASE}/prompts/${encodeURIComponent(id)}`;
			const response = await fetch(url, {
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				throw new Error(`prompts.chat API 返回 ${response.status}`);
			}
			const raw = (await response.json()) as PromptStoreRawItem;
			return flattenPromptItem(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("prompt-store", "Get prompt failed", { id, error: message });
			throw new Error(`获取 prompt 详情失败: ${message}`);
		}
	});

	/** 将 prompts.chat 原始 prompt 条目扁平化为 UI 消费的格式 */
	function flattenPromptItem(raw: PromptStoreRawItem): PromptStoreItem {
		return {
			id: raw.id,
			title: raw.title,
			description: raw.description,
			content: raw.content,
			type: raw.type,
			author: raw.author?.name ?? "",
			category: raw.category?.name ?? "",
			tags: raw.tags?.map((t) => t.tag?.name).filter(Boolean) ?? [],
			votes: raw.voteCount ?? 0,
			createdAt: raw.createdAt,
		};
	}

	/**
	 * 将 prompts.chat 的命名变量（${name} / ${name:default}）
	 * 转换为 pi 的位置参数（$N / ${N:-default}）。
	 * 同时生成 argument-hint。
	 */
	function convertStoreVarsToPiVars(content: string): { converted: string; argumentHint: string; varCount: number } {
		// 收集所有 ${name} 和 ${name:default}，保留出现顺序
		const varMap = new Map<string, { index: number; hasDefault: boolean; defaultVal?: string }>();
		let nextIndex = 1;
		// 先扫描所有变量并分配序号
		const scanRegex = /\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g;
		let scanMatch: RegExpExecArray | null;
		while ((scanMatch = scanRegex.exec(content)) !== null) {
			const varName = scanMatch[1];
			if (!varMap.has(varName)) {
				varMap.set(varName, {
					index: nextIndex++,
					hasDefault: scanMatch[2] !== undefined,
					defaultVal: scanMatch[2],
				});
			}
		}

		// 如果没有变量，直接返回原文
		if (varMap.size === 0) {
			return { converted: content, argumentHint: "", varCount: 0 };
		}

		// 替换变量
		let converted = content.replace(
			/\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g,
			(_match, varName: string, defaultVal?: string) => {
				const info = varMap.get(varName)!;
				if (defaultVal !== undefined) {
					return `\${${info.index}:-${defaultVal}}`;
				}
				return `$${info.index}`;
			},
		);

		// 生成 argument-hint：无默认值的用 <>, 有默认值的用 []
		const hints: string[] = [];
		for (let i = 1; i < nextIndex; i++) {
			const entry = Array.from(varMap.entries()).find(([, v]) => v.index === i);
			if (!entry) continue;
			const [varName, info] = entry;
			if (info.hasDefault) {
				hints.push(`[${varName}:${info.defaultVal}]`);
			} else {
				hints.push(`<${varName}>`);
			}
		}
		const argumentHint = hints.length > 0 ? hints.join(" ") : "";

		return { converted, argumentHint, varCount: varMap.size };
	}

	/** 从 prompts.chat 导入 prompt 到本地 ~/.pi/agent/prompts/ */
	ipcMain.handle(ipcChannels.promptStoreImport, async (_event, {
		title,
		description,
		content,
	}: {
		title: string;
		description: string;
		content: string;
	}) => {
		try {
			const name = title
				.trim()
				.toLowerCase()
				.replace(/[^\p{L}\p{N}-]+/gu, "-")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "");
			if (!name) throw new Error("标题中未提取到有效文件名");

			// 转换变量格式：prompts.chat 的 ${name} → pi 的 $N
			const { converted, argumentHint, varCount } = convertStoreVarsToPiVars(content);

			// 使用 PromptManager.create 来创建，统一命名规范
			// 但如果 create 失败（模板已存在名），加后缀
			const tryCreate = async (tryName: string): Promise<PiPromptTemplateSummary> => {
				try {
					return await promptManager.create({ name: tryName, description });
				} catch {
					// 名称冲突，加数字后缀重试
					const match = tryName.match(/-(\d+)$/);
					const nextNum = match ? parseInt(match[1], 10) + 1 : 2;
					const suffixName = tryName.replace(/-\d+$/, "") + "-" + nextNum;
					return tryCreate(suffixName);
				}
			};

			// 如果有 argument-hint，在 frontmatter 中标注
			const hintLine = argumentHint ? `\nargument-hint: ${argumentHint}` : "";
			const frontmatter = `---\ndescription: ${description.replace(/\n/g, " ")}\nsource: prompts.chat${hintLine}\n---\n\n`;
			const summary = await tryCreate(name);
			await promptManager.writeContent(summary.path, frontmatter + converted);

			void appLogger.info("prompt-store", "Imported prompt from store", {
				title,
				localName: summary.name,
				variables: varCount,
			});
			return summary;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("prompt-store", "Import failed", { title, error: message });
			throw new Error(`导入 prompt 失败: ${message}`);
		}
	});

	ipcMain.handle(ipcChannels.extensionsList, () => extensionManager.list());
	ipcMain.handle(ipcChannels.extensionsUninstall, async (_event, source: string, scope?: "user" | "project" | "unknown") => {
		const result = await extensionManager.uninstall(source, scope);
		void appLogger.info("extension", "Extension uninstalled", { source, scope });
		return result;
	});
	ipcMain.handle(ipcChannels.extensionsInstall, async (_event, source: string) => {
		const result = await extensionManager.install(source);
		void appLogger.info("extension", "Extension installed", { source });
		return result;
	});
	ipcMain.handle(ipcChannels.extensionsToggle, async (_event, source: string, enabled: boolean) => {
		// Built-in extensions: also deploy/remove the .ts file so pi actually stops/starts loading it
		if (source.startsWith("pi-deck-") && source.endsWith(".ts")) {
			if (enabled) {
				await ensurePiDeckExtension(source);
			} else {
				await removeStalePiDeckExtension(source);
			}
		}
		await extensionManager.setEnabled(source, enabled);
		void appLogger.info("extension", "Extension toggled", { source, enabled });
	});
	ipcMain.handle(ipcChannels.extensionsUpdate, async () => {
		const result = await extensionManager.updateExtensions();
		void appLogger.info("extension", "Extensions update command completed", { updated: result.updated, bytes: result.output.length });
		return result;
	});

	ipcMain.handle(ipcChannels.agentsList, () => agentManager.list());
	ipcMain.handle(ipcChannels.agentsCreate, async (_event, input: CreateAgentInput) => {
		void appLogger.info("agent", "Agent create IPC received", {
			projectId: input.projectId,
			sessionPath: input.sessionPath,
			title: input.title,
		});
		const tab = await agentManager.create(input);
		void appLogger.info("agent", "Agent create IPC completed", {
			agentId: tab.id,
			projectId: input.projectId,
			status: tab.status,
			sessionPath: tab.sessionPath,
		});
		void appLogger.info("agent", "Agent created", {
			agentId: tab.id,
			projectId: input.projectId,
			title: tab.title,
			sessionPath: tab.sessionPath,
		});
		// 不再自动为新会话创建飞书群；必须由用户在会话输入框的飞书菜单中手动连接后才同步。
		return tab;
	});
	ipcMain.handle(
		ipcChannels.agentsRename,
		async (_event, agentId: string, name: string) => {
			const result = await agentManager.rename(agentId, name);
			void appLogger.info("agent", "Agent renamed", { agentId, name });
			return result;
		},
	);
	ipcMain.handle(ipcChannels.agentsStop, async (_event, agentId: string) => {
		terminalManager.closeAgent(agentId);
		await agentManager.stop(agentId);
		void appLogger.info("agent", "Agent stopped", { agentId });
	});
	ipcMain.handle(ipcChannels.agentsPrompt, async (_event, input: SendPromptInput) => {
		const bridge = feishuBridge;
		const bridgeConnected = bridge?.getStatus().status === "connected";
		const hasFeishuBinding = bridgeConnected && bridge.hasSessionBinding(input.agentId);
		const docTitle = bridgeConnected ? wantsFeishuDoc(input.message) : undefined;
		const sessionChatId = bridgeConnected ? bridge.getSessionChatId(input.agentId) : undefined;
		let agentInstruction: string | undefined;
		const buildFeishuActionInstruction = (chatId?: string) => [
			"当前会话已连接飞书聊天。严禁调用 lark-cli、飞书 IM API 或搜索群聊来发送文件；不要询问 chat_id。需要把本地文件发到当前飞书聊天时，最终回答末尾独立一行写 [SEND_FILE:本地文件路径]，PiDeck 会按当前会话绑定自动上传。",
			chatId ? `当前绑定的飞书 chat_id: ${chatId}。这是只读上下文，用于确认当前会话绑定；发送文件仍必须用 [SEND_FILE:本地文件路径]。` : undefined,
		].filter(Boolean).join("\n");

		if (bridgeConnected && hasFeishuBinding) {
			const filePath = resolveFeishuFileSendIntent(input.message, agentManager.getCwd(input.agentId));
			if (filePath) {
				const result = await bridge.sendFileForSession(input.agentId, filePath);
				agentManager.recordHostExchange(input.agentId, input.message, result);
				void appLogger.info("feishu", "File sent through current session binding", {
					agentId: input.agentId,
					filePath,
					success: result.startsWith("✅"),
				});
				return;
			}
		}

		// 用户说了要做飞书文档但当前会话未绑定 → 自动绑定并告知 Agent 可用 lark-cli
		if (bridgeConnected && docTitle && !hasFeishuBinding) {
			const tab = agentManager.list().find((item) => item.id === input.agentId);
			if (tab) {
				await bridge.ensureSessionMirror(tab.id, tab.title, tab.sessionPath).catch((e) => {
					console.error("[Feishu] auto-bind session mirror failed:", e);
				});
				bridge.trackDocRequest(tab.id, docTitle);
				void bridge.forwardUserMessageToFeishu(tab.id, input.message).catch((e) => {
					console.error("[Feishu] forward PiDeck message failed:", e);
				});
				agentInstruction = `${buildFeishuActionInstruction(bridge.getSessionChatId(tab.id))}\n创建飞书文档时，先输出完整正文，最后独立一行写 [CREATE_DOC:文档标题]。`;
			}
		} else if (hasFeishuBinding) {
			agentInstruction = buildFeishuActionInstruction(sessionChatId);
			const tab = agentManager.list().find((item) => item.id === input.agentId);
			if (tab) {
				void bridge.startSessionMirrorRun(tab.id, tab.title, tab.sessionPath).catch((e) => {
					console.error("[Feishu] session mirror card init failed:", e);
				});
				if (input.message.trim()) {
					void bridge.forwardUserMessageToFeishu(tab.id, input.message).catch((e) => {
						console.error("[Feishu] forward PiDeck message failed:", e);
					});
				}
			}
		}
		const result = await agentManager.sendPrompt(
			agentInstruction
				? { ...input, agentMessage: `${agentInstruction}\n\n${input.message}` }
				: input,
		);
		void appLogger.info("agent", "Prompt sent", {
			agentId: input.agentId,
			messageLength: input.message.length,
			imageCount: input.images?.length ?? 0,
			streamingBehavior: input.streamingBehavior,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.agentsAbort, async (_event, agentId: string) => {
		// Session Mirror: 停止飞书流式卡片
		if (feishuBridge) {
			feishuBridge.stopSessionMirrorRun(agentId);
		}
		const result = await agentManager.abort(agentId);
		void appLogger.info("agent", "Agent aborted", { agentId });
		return result;
	});
	ipcMain.handle(ipcChannels.agentsExportHtml, (_event, agentId: string) =>
		agentManager.exportHtml(agentId),
	);
	ipcMain.handle(ipcChannels.agentsForkMessages, (_event, agentId: string) =>
		agentManager.getForkMessages(agentId),
	);
	ipcMain.handle(
		ipcChannels.agentsForkSession,
		(_event, agentId: string, entryId: string) =>
			agentManager.forkSession(agentId, entryId),
	);
	ipcMain.handle(ipcChannels.agentsCloneSession, async (_event, agentId: string) => {
		const result = await agentManager.cloneSession(agentId);
		void appLogger.info("agent", "Agent session cloned", { agentId });
		return result;
	});
	ipcMain.handle(
		ipcChannels.agentsSwitchSession,
		async (_event, agentId: string, sessionPath: string) => {
			const result = await agentManager.switchSession(agentId, sessionPath);
			void appLogger.info("agent", "Agent switched session", { agentId, sessionPath });
			return result;
		},
	);
	ipcMain.handle(ipcChannels.agentsEditMessage, async (_event, agentId: string, messageId: string, text: string) => {
		await agentManager.editMessage(agentId, messageId, text);
		void appLogger.info("agent", "Message edited", { agentId, messageId });
	});
	ipcMain.handle(ipcChannels.agentsDeleteMessage, async (_event, agentId: string, messageId: string) => {
		await agentManager.deleteMessage(agentId, messageId);
		void appLogger.info("agent", "Message deleted", { agentId, messageId });
	});
	ipcMain.handle(ipcChannels.agentsReload, async (_event, agentId: string) => {
		const result = await agentManager.reload(agentId);
		void appLogger.info("agent", "Agent reloaded", { agentId });
		return result;
	});
	ipcMain.handle(ipcChannels.agentsRestart, async (_event, agentId: string) => {
		terminalManager.closeAgent(agentId);
		const result = await agentManager.restart(agentId);
		void appLogger.info("agent", "Agent restarted", { agentId });
		return result;
	});
	ipcMain.handle(ipcChannels.agentsCompact, async (_event, agentId: string, prompt?: string) => {
		void appLogger.info("agent", "Agent compact IPC called", { agentId, prompt });
		try {
			const result = await agentManager.compact(agentId, prompt);
			void appLogger.info("agent", "Agent compact IPC succeeded", { agentId });
			return result;
		} catch (error) {
			void appLogger.error("agent", "Agent compact IPC failed", {
				agentId,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.agentsRuntimeState, (_event, agentId: string) =>
		agentManager.getRuntimeState(agentId),
	);
	ipcMain.handle(ipcChannels.agentsCycleModel, (_event, agentId: string) =>
		agentManager.cycleModel(agentId),
	);
	ipcMain.handle(ipcChannels.agentsAvailableModels, (_event, agentId: string) =>
		agentManager.getAvailableModels(agentId),
	);
	ipcMain.handle(
		ipcChannels.agentsSetModel,
		async (_event, agentId: string, provider: string, modelId: string) => {
			const result = await agentManager.setModel(agentId, provider, modelId);
			void appLogger.info("agent", "Agent model changed", { agentId, provider, modelId });
			return result;
		},
	);
	ipcMain.handle(ipcChannels.agentsCycleThinking, (_event, agentId: string) =>
		agentManager.cycleThinking(agentId),
	);
	ipcMain.handle(
		ipcChannels.agentsSetThinking,
		async (_event, agentId: string, level: string) => {
			const result = await agentManager.setThinking(agentId, level);
			void appLogger.info("agent", "Agent thinking level changed", { agentId, level });
			return result;
		},
	);
	ipcMain.handle("agents:commands", async (_event, agentId: string) => {
		try {
			return await agentManager.getCommands(agentId);
		} catch {
			// agent 不存在或 RPC 超时时返回空列表，避免控制台报未处理异常
			return [];
		}
	});

	/** 用户通过 UI 响应了扩展的 ask_question 请求，转发给 AgentManager 发送 extension_ui_response */
	ipcMain.handle(ipcChannels.agentsUiResponse, async (_event, agentId: string, requestId: string, response: { value?: string | boolean; cancelled?: boolean; confirmed?: boolean }) => {
		await agentManager.sendUIResponse(agentId, requestId, response);
	});

	ipcMain.handle(ipcChannels.terminalList, (_event, agentId: string) =>
		terminalManager.list(agentId),
	);
	ipcMain.handle(ipcChannels.terminalEnsure, (_event, agentId: string) =>
		terminalManager.ensure(agentId),
	);
	ipcMain.handle(ipcChannels.terminalCreate, async (_event, agentId: string) => {
		const result = await terminalManager.create(agentId);
		void appLogger.info("terminal", "Terminal created", { agentId, tabId: result.id });
		return result;
	});
	ipcMain.handle(
		ipcChannels.terminalInput,
		(_event, tabId: string, data: string) => {
			terminalManager.input(tabId, data);
		},
	);
	ipcMain.handle(
		ipcChannels.terminalResize,
		(_event, tabId: string, cols: number, rows: number) => {
			terminalManager.resize(tabId, cols, rows);
		},
	);
	ipcMain.handle(ipcChannels.terminalClose, (_event, tabId: string) => {
		terminalManager.close(tabId);
		void appLogger.info("terminal", "Terminal closed", { tabId });
	});

	// ── 配置管理 ──────────────────────────────────────
	ipcMain.handle(ipcChannels.configGetModels, () =>
		configManager.getModelsConfig(),
	);
	ipcMain.handle(ipcChannels.configGetAuth, () =>
		configManager.getAuthConfig(),
	);
	ipcMain.handle(ipcChannels.configGetSettings, () =>
		configManager.getSettingsConfig(),
	);
	ipcMain.handle(ipcChannels.configGetTrust, () =>
		configManager.getTrustConfig(),
	);
	// 项目信任确认：渲染进程回传用户选择，唤醒等待中的 Agent 创建流程（见 AgentManager.ensureProjectTrust）
	ipcMain.handle(
		ipcChannels.agentsTrustResponse,
		(_event, requestId: string, choice: "trust-remember" | "trust-session" | "deny") =>
			agentManager.respondTrustRequest(requestId, choice),
	);
	ipcMain.handle(ipcChannels.configSaveModels, async (_event, data) => {
		const result = await configManager.saveModelsConfig(data);
		void appLogger.info("config", "Models config saved", { providerCount: Object.keys(data?.providers ?? {}).length });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveAuth, async (_event, data) => {
		const result = await configManager.saveAuthConfig(data);
		void appLogger.info("config", "Auth config saved", { authCount: Object.keys(data ?? {}).length });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveSettings, async (_event, settings) => {
		const result = await configManager.saveSettingsConfig(settings);
		void appLogger.info("config", "Pi settings config saved", { keys: Object.keys(settings ?? {}) });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveRaw, async (_event, fileName, rawJson) => {
		const result = await configManager.saveRawConfig(fileName, rawJson);
		void appLogger.info("config", "Raw config saved", { fileName, bytes: Buffer.byteLength(rawJson, "utf8") });
		return result;
	});
	ipcMain.handle(ipcChannels.configExport, () =>
		configManager.exportConfig(),
	);
	ipcMain.handle(ipcChannels.configImport, async (_event, packageJson: string) => {
		const result = await configManager.importConfig(packageJson);
		void appLogger.info("config", "Config imported", { bytes: Buffer.byteLength(packageJson, "utf8"), valid: result.valid });
		return result;
	});
	// 远程拉取 provider 模型列表
	ipcMain.handle(
		ipcChannels.configFetchModels,
		async (
			_event,
			payload: { baseUrl: string; apiKey: string; apiType?: string },
		) => {
			const result = await configManager.fetchProviderModels(
				payload.baseUrl,
				payload.apiKey,
				payload.apiType,
			);
			void appLogger.info("config", "Provider models fetched", {
				baseUrl: payload.baseUrl,
				apiType: payload.apiType,
				modelCount: Array.isArray(result) ? result.length : undefined,
			});
			return result;
		},
	);
	// 快速测试 provider 连接
	ipcMain.handle(
		ipcChannels.configTestProvider,
		async (
			_event,
			payload: {
				baseUrl: string;
				apiKey: string;
				modelId: string;
				apiType?: string;
				headers?: Record<string, string>;
			},
		) => {
			const result = await configManager.testProviderConnection(
				payload.baseUrl,
				payload.apiKey,
				payload.modelId,
				payload.apiType,
				payload.headers,
			);
			void appLogger.info("config", "Provider connection tested", {
				baseUrl: payload.baseUrl,
				apiType: payload.apiType,
				modelId: payload.modelId,
				success: result.success,
				error: result.error,
			});
			return result;
		},
	);

	// 切换开发者控制台
	ipcMain.handle(ipcChannels.appToggleDevTools, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return false;
		if (mainWindow.webContents.isDevToolsOpened()) {
			mainWindow.webContents.closeDevTools();
			return false;
		}
		mainWindow.webContents.openDevTools({ mode: "detach" });
		return true;
	});
}

function sendTelemetryHeartbeat() {
	const telemetry = new TelemetryService({
		settingsStore,
		config: {
			projectKey: POSTHOG_PROJECT_KEY,
			host: POSTHOG_HOST,
		},
		metadata: {
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			packaged: app.isPackaged,
		},
		capture: async (request) => {
			const response = await net.fetch(request.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request.body),
			});
			if (!response.ok) {
				throw new Error(`Telemetry request failed: ${response.status}`);
			}
		},
	});

	void telemetry.sendHeartbeat().catch(() => undefined);
}

async function detectExternalEditorsOnFirstLaunch() {
	const current = settingsStore.get().externalEditors;
	if (Object.values(current).some((editor) => editor.command)) return;
	const detected = await detectExternalEditors();
	if (detected.length === 0) return;
	await settingsStore.update({
		externalEditors: mergeDetectedExternalEditors(current, detected),
	});
	void appLogger.info("editor", "External editors detected on first launch", { count: detected.length });
}

app.whenReady().then(async () => {
	projectStore = new ProjectStore();
	fileSystemService = new FileSystemService();
	sessionScanner = new SessionScanner();
	codexSessionImporter = new CodexSessionImporter();
	claudeSessionImporter = new ClaudeSessionImporter();
	openCodeSessionImporter = new OpenCodeSessionImporter();
	settingsStore = new SettingsStore();
	appLogger = new AppLogger();
	rpcLogger = new RpcLogger();
	gitService = new GitService();
	worktreeService = new WorktreeService();
	piLocator = new PiLocator();
	configManager = new ConfigManager();
	promptManager = new PromptManager();
	skillManager = new SkillManager();
	extensionManager = new ExtensionManager(piLocator, () => settingsStore.get());
	projectResourceManager = new ProjectResourceManager((projectId) => projectStore.get(projectId));
	agentManager = new AgentManager(
		(id) => projectStore.get(id),
		() => mainWindow,
		settingsStore,
		configManager,
		rpcLogger,
		appLogger,
	);
	webServiceManager = new WebServiceManager({
		listProjects: () => projectStore.list(),
		listAgents: () => agentManager.list(),
		listSessions: (projectId) => {
			const project = projectStore.get(projectId);
			return sessionScanner.list(project?.path);
		},
		getMessages: (agentId) => agentManager.getMessages(agentId),
		createAgent: (input) => agentManager.create(input),
		sendPrompt: (input) => agentManager.sendPrompt(input),
		stopAgent: (agentId) => agentManager.stop(agentId),
		runtimeState: (agentId) => agentManager.getRuntimeState(agentId),
		cycleModel: (agentId) => agentManager.cycleModel(agentId),
		availableModels: (agentId) => agentManager.getAvailableModels(agentId),
		setModel: (agentId, provider, modelId) => agentManager.setModel(agentId, provider, modelId),
		cycleThinking: (agentId) => agentManager.cycleThinking(agentId),
		setThinking: (agentId, level) => agentManager.setThinking(agentId, level),
	});
	terminalManager = new TerminalSessionManager(
		(agentId) => agentManager.getCwd(agentId),
		(channel, payload) => mainWindow?.webContents.send(channel, payload),
	);

	await settingsStore.load();

	// 自动部署 PiDeck 内置扩展：这些扩展提供桌面端差异预览、提问卡片和 Plan Mode。
	// 放到 pi 自动发现目录后，新建/重启的 RPC Agent 会自动加载；只在内容变更时覆盖，避免用户目录产生无意义写入。
	// Read disabled extensions so disabled built-in extensions aren't re-deployed at startup
	const disabledExtList: string[] = await readFile(join(app.getPath("home"), ".pi", "agent", "settings.json"), "utf-8")
		.then((raw: string) => JSON.parse(raw).disabledExtensions ?? [])
		.catch(() => [] as string[]);
	const disabledBuiltIn = new Set<string>(disabledExtList);

	for (const extensionName of [
		"pi-deck-file-capture.ts",
		"pi-deck-ask-question.ts",
		"pi-deck-plan-mode.ts",
		"pi-deck-todo.ts",
	]) {
		if (disabledBuiltIn.has(extensionName)) {
			// 已禁用：确保 .ts 文件被移除，避免 pi 残余加载
			await removeStalePiDeckExtension(extensionName).catch(() => {});
			continue;
		}
		await ensurePiDeckExtension(extensionName).catch((error) => {
			console.error(`Failed to install ${extensionName}:`, error);
		});
	}

	// 清理已废弃的 pi-deck-project-trust 扩展：RPC 模式下 pi 的 project_trust 事件 hasUI 恒为 false，
	// 该扩展无法弹窗，信任确认改由桌面端 AgentManager.ensureProjectTrust 自行处理，删除残留避免用户误解。
	await removeStalePiDeckExtension("pi-deck-project-trust.ts").catch((error) => {
		console.error("Failed to remove stale pi-deck-project-trust extension:", error);
	});

	await appLogger.info("app", "Application started", {
		version: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		installationType: settingsStore.get().installationType,
	});
	await applyDesktopProxy(settingsStore.get());
	await webServiceManager.applySettings(settingsStore.get()).catch((error) => {
		console.error("Failed to start web service:", error);
		void settingsStore.update({ webServiceEnabled: false });
	});
	registerIpc();
	registerFeishuIpc();

	// 🆕 自动连接：如果已有 Bot 配置，自动启动飞书连接
	autoConnectFeishu();

	sendTelemetryHeartbeat();
	await createWindow();
	setupTray();
	void detectExternalEditorsOnFirstLaunch().catch((error) => {
		void appLogger.warn("editor", "External editor first launch detection failed", error);
	});

	// 桌面宠物系统：新增模块，默认关闭（petEnabled=false），不触碰现有 IPC 与主窗逻辑
	petSystem = new PetSystem({
		agentManager,
		settingsStore,
		getMainWindow: () => mainWindow,
		recreateMainWindow: async () => {
			await createWindow();
			return mainWindow!;
		},
	});
	void petSystem.start().catch((error) => {
		void appLogger.warn("pet", "Pet system start failed", error);
	});

	// 项目列表可能位于杀软/同步盘较慢的 userData；窗口先显示，随后异步加载，避免 packaged app 打开时白屏等待。
	void projectStore
		.load()
		.then(() =>
			mainWindow?.webContents.send("projects:changed", projectStore.list()),
		)
		.catch(() => undefined);

	// 启动后异步检查 RPC 超时时间，如果小于 600 秒则自动修正为 600 秒
	// 避免用户配置的过小超时（如 30 秒）导致启动或命令执行频繁超时
	setTimeout(() => {
		void settingsStore.ensureRpcTimeoutMinimum().catch((error) => {
			void appLogger.warn("settings", "Failed to ensure rpcTimeout minimum", error);
		});
	}, 0);

	// macOS dock 点击或任务栏点击时恢复窗口
	app.on("activate", () => {
		if (mainWindow) {
			mainWindow.show();
			mainWindow.focus();
		} else {
			void createWindow().catch((error) => {
				void appLogger.error("app", "Failed to create window on activate", error);
			});
		}
	});
});

/**
 * 将 PiDeck 内置的 pi 扩展部署到用户扩展目录，使 pi 自动加载。
 * 仅在目标文件不存在或内容不一致时覆盖写入，避免不必要的磁盘操作。
 */
async function ensurePiDeckExtension(extensionName: string): Promise<void> {
	const homedir = app.getPath("home");
	const extensionsDir = join(homedir, ".pi", "agent", "extensions");
	const targetPath = join(extensionsDir, extensionName);

	// 获取源文件路径：开发模式下在 resources/ 目录，打包后通过 process.resourcesPath 访问
	const sourcePath = is.dev
		? join(app.getAppPath(), "resources", "extensions", extensionName)
		: join(process.resourcesPath, "extensions", extensionName);

	// 检查源文件是否存在
	const sourceContent = await readFile(sourcePath, "utf-8").catch(() => null);
	if (!sourceContent) {
		console.warn(`[PiDeck] Extension source not found: ${sourcePath}`);
		return;
	}

	// 读取目标文件，只在内容不一致时覆盖（兼顾首次安装和版本更新）
	const existingContent = await readFile(targetPath, "utf-8").catch(() => null);
	if (existingContent === sourceContent) return;

	await mkdir(extensionsDir, { recursive: true });
	await writeFile(targetPath, sourceContent, "utf-8");
	console.log(`[PiDeck] Installed extension: ${targetPath}`);
}

/**
 * 删除已下线的 PiDeck 内置扩展残留文件（如 pi-deck-project-trust.ts）。
 * 用于扩展废弃后清理用户扩展目录，避免 pi 仍加载无效扩展造成误解。
 * rm 的 force 选项会在文件不存在时静默忽略。
 */
async function removeStalePiDeckExtension(extensionName: string): Promise<void> {
	const targetPath = join(app.getPath("home"), ".pi", "agent", "extensions", extensionName);
	await rm(targetPath, { force: true });
	console.log(`[PiDeck] Removed stale extension: ${targetPath}`);
}

app.on("before-quit", () => {
	isQuitting = true;
	tray?.destroy();
	tray = null;
	void webServiceManager?.stop();
	terminalManager?.closeAll();
	agentManager?.stopAll();
	petSystem?.stop();
	petSystem = null;
});

app.on("window-all-closed", () => {
	// macOS 关闭所有窗口不退出；其他平台如果启用 closeToTray 也不退出
	if (process.platform === "darwin") return;
	if (!isQuitting) return;
	app.quit();
});
