import { useState } from "react";
import { Copy, Download, ExternalLink, ToggleLeft, ToggleRight, Trash2, Workflow } from "lucide-react";
import { MAESTRO_EXTENSION_PACKAGES } from "../../../shared/types";
import type { PiCliUpdateResult, PiExtensionListResult, PiExtensionSummary, PiPackageInfo } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import { openInSystemBrowser } from "../utils/openExternal";

type ExtensionsApi = {
	list: () => Promise<PiExtensionListResult>;
	uninstall: (source: string, scope?: "user" | "project" | "unknown") => Promise<void>;
	install: (source: string) => Promise<string>;
	toggle: (source: string, enabled: boolean) => Promise<void>;
	update: () => Promise<PiCliUpdateResult>;
};

function getExtensionsApi(): ExtensionsApi {
	const api = (window as unknown as { piDesktop?: { extensions?: ExtensionsApi } })
		.piDesktop?.extensions;
	if (!api) throw new Error("PiDeck extensions API is not available");
	return api;
}

const MAESTRO_BUNDLE = {
	name: "Maestro",
	packages: MAESTRO_EXTENSION_PACKAGES.map((pkg) => ({
		...pkg,
		descriptionKey: "config.maestroBundle.flowDescription" as const,
	})),
};

/** 预设推荐扩展包 */
const RECOMMENDED_PACKAGES: PiPackageInfo[] = [
	{
		name: "context-mode",
		description: "MCP 插件，可节省 98% 的上下文窗口。支持 Claude Code、Gemini CLI、VS Code Copilot 等。沙箱代码执行、FTS5 知识库和意图驱动搜索。",
		installCmd: "npm:context-mode",
		tags: ["extension"],
		downloads: "107K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/context-mode",
		repoUrl: "https://github.com/mksglu/context-mode",
	},
	{
		name: "pi-web-access",
		description: "网络搜索、URL 抓取、GitHub 仓库克隆、PDF 提取、YouTube 视频理解和本地视频分析。",
		installCmd: "npm:pi-web-access",
		tags: ["extension"],
		downloads: "99K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-web-access",
		repoUrl: "https://github.com/nicobailon/pi-web-access",
	},
	{
		name: "pi-mcp-adapter",
		description: "MCP（Model Context Protocol）适配器扩展，让 Pi 可以连接任何 MCP 服务器。",
		installCmd: "npm:pi-mcp-adapter",
		tags: ["extension"],
		downloads: "99K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-mcp-adapter",
		repoUrl: "https://github.com/nicobailon/pi-mcp-adapter",
	},
	{
		name: "@samfp/pi-memory",
		description: "长期记忆扩展，用于在 Pi 会话之间保存和检索偏好、项目事实与经验教训。",
		installCmd: "npm:@samfp/pi-memory",
		tags: ["extension", "memory"],
		downloads: "",
		updated: "",
		npmUrl: "https://pi.dev/packages/@samfp/pi-memory?name=%40samfp%2Fpi-memory",
	},
	{
		name: "pi-subagents",
		description: "任务委派扩展，支持链式、并行执行和 TUI 澄清。可将复杂任务拆解给多个子 Agent。",
		installCmd: "npm:pi-subagents",
		tags: ["extension"],
		downloads: "92K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-subagents",
		repoUrl: "https://github.com/nicobailon/pi-subagents",
	},
];

export function ExtensionsTab(props: {
	data: PiExtensionListResult;
	loading: boolean;
	uninstallingSource: string | null;
	onRefresh: () => void;
	onUninstall: (extension: PiExtensionSummary) => void;
}) {
	const [installingSources, setInstallingSources] = useState<Set<string>>(() => new Set());
	const [togglingSource, setTogglingSource] = useState<string | null>(null);

	const handleToggle = async (extension: PiExtensionSummary) => {
		if (togglingSource) return;
		setTogglingSource(extension.source);
		try {
			const nextEnabled = extension.enabled !== false ? false : true;
			await getExtensionsApi().toggle(extension.source, nextEnabled);
			props.onRefresh();
		} catch (e) {
			alert(t("config.installFailed") + ": " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setTogglingSource(null);
		}
	};
	const [updating, setUpdating] = useState<string | null>(null);
	const [updateResult, setUpdateResult] = useState<PiCliUpdateResult | null>(null);
	const [showUpdateDialog, setShowUpdateDialog] = useState(false);

	const handleInstall = async (pkg: PiPackageInfo) => {
		// 安装任务按扩展源分别记录；多个扩展并发安装时，不能用单一字符串覆盖前一个 loading 状态。
		setInstallingSources((current) => new Set(current).add(pkg.installCmd));
		try {
			await getExtensionsApi().install(pkg.installCmd);
			props.onRefresh();
		} catch (e) {
			alert(t("config.installFailed") + ": " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setInstallingSources((current) => {
				const next = new Set(current);
				next.delete(pkg.installCmd);
				return next;
			});
		}
	};

	const handleInstallBundle = async () => {
		const installedSources = new Set(props.data.extensions.map((extension) => extension.source));
		const missingPackages = MAESTRO_BUNDLE.packages.filter(
			(pkg) => !installedSources.has(pkg.source),
		);
		if (missingPackages.length === 0) return;

		setInstallingSources((current) => {
			const next = new Set(current);
			for (const pkg of missingPackages) next.add(pkg.source);
			return next;
		});
		try {
			// Pi 的安装接口一次接收一个 source；顺序安装便于失败时保留已完成的包并准确刷新状态。
			for (const pkg of missingPackages) {
				await getExtensionsApi().install(pkg.source);
			}
			showNotice(t("config.maestroBundle.installedNotice"), 2400);
		} catch (e) {
			alert(t("config.installFailed") + ": " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setInstallingSources((current) => {
				const next = new Set(current);
				for (const pkg of missingPackages) next.delete(pkg.source);
				return next;
			});
			props.onRefresh();
		}
	};

	const handleCopyBundleCommands = () => {
		const commands = MAESTRO_BUNDLE.packages
			.map((pkg) => `pi install ${pkg.source}`)
			.join("\n");
		void navigator.clipboard.writeText(commands);
		showNotice(t("app.codeCopied"), 1200);
	};

	const handleUpdateExtensions = async () => {
		setUpdating("all");
		setUpdateResult(null);
		setShowUpdateDialog(true);
		try {
			const result = await getExtensionsApi().update();
			setUpdateResult(result);
		} catch (e) {
			alert(t("settings.extensionsUpdateFailed", { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			setUpdating(null);
		}
	};

	const installedSources = new Set(props.data.extensions.map((extension) => extension.source));
	const maestroInstalledCount = MAESTRO_BUNDLE.packages.filter((pkg) =>
		installedSources.has(pkg.source),
	).length;
	const maestroMissingCount = MAESTRO_BUNDLE.packages.length - maestroInstalledCount;
	const maestroInstalling = MAESTRO_BUNDLE.packages.some((pkg) =>
		installingSources.has(pkg.source),
	);

	return (
		<div className="extensions-tab">
			{showUpdateDialog && (
				<div className="config-update-dialog-backdrop" role="dialog" aria-modal="true">
					<div className="config-update-dialog">
						<div className="config-update-dialog-header">
							<strong>{t("settings.updateExtensionsAll")}</strong>
							<button
								className="config-icon-btn"
								onClick={() => {
									setShowUpdateDialog(false);
									props.onRefresh();
								}}
								disabled={Boolean(updating)}
							>
								×
							</button>
						</div>
						<p className="config-im-form-hint">
							{updating ? t("settings.extensionsUpdatingDesc") : t("settings.extensionsUpdateResultHint")}
						</p>
						<pre className="setting-update-output">
							{updateResult ? `${updateResult.command}\n${updateResult.output}` : t("settings.extensionsUpdating")}
						</pre>
						<div className="config-update-dialog-actions">
							<button
								className="config-btn primary"
								onClick={() => {
									setShowUpdateDialog(false);
									props.onRefresh();
								}}
								disabled={Boolean(updating)}
							>
								{t("common.close")}
							</button>
						</div>
					</div>
				</div>
			)}
			{/* 预设推荐扩展 — 大列表简洁显示 */}
			<div className="config-section" style={{ marginBottom: 20 }}>
				<div className="config-toolbar">
					<h3 className="extensions-installed-title">{t("config.recommendedPackages")}</h3>
				</div>
				<p className="config-im-form-hint" style={{ marginBottom: 12 }}>
					{t("config.recommendedPackagesHint")}
				</p>
				<div className="extensions-recommended-list">
					<section className="extensions-bundle-card" aria-labelledby="maestro-bundle-title">
						<div className="extensions-bundle-header">
							<div className="extensions-bundle-title">
								<span className="extensions-bundle-icon" aria-hidden="true">
									<Workflow size={18} strokeWidth={1.8} />
								</span>
								<div>
									<strong id="maestro-bundle-title">{MAESTRO_BUNDLE.name}</strong>
									<p>{t("config.maestroBundle.description")}</p>
								</div>
							</div>
							<span className={maestroMissingCount === 0 ? "config-im-connected-badge" : "extensions-bundle-progress"}>
								{maestroMissingCount === 0
									? t("config.installed")
									: t("config.maestroBundle.installedCount", {
										installed: maestroInstalledCount,
										total: MAESTRO_BUNDLE.packages.length,
									})}
							</span>
						</div>

						<div className="extensions-bundle-packages">
							{MAESTRO_BUNDLE.packages.map((pkg) => {
								const installed = installedSources.has(pkg.source);
								return (
									<a
										key={pkg.source}
										className="extensions-bundle-package"
										href={pkg.npmUrl}
										target="_blank"
										rel="noreferrer"
										onClick={(event) => {
											event.preventDefault();
											openInSystemBrowser(pkg.npmUrl);
										}}
									>
										<span>
											<strong>{pkg.name}</strong>
											<small>{t(pkg.descriptionKey)}</small>
										</span>
										<span className="extensions-bundle-package-status">
											{installed && <span>{t("config.installed")}</span>}
											<ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
										</span>
									</a>
								);
							})}
						</div>

						<div className="extensions-bundle-actions">
							<IconButton
								label={t("config.maestroBundle.copyCommands")}
								onClick={handleCopyBundleCommands}
							>
								<Copy size={14} strokeWidth={1.8} aria-hidden="true" />
							</IconButton>
							<Button
								variant="primary"
								buttonSize="sm"
								loading={maestroInstalling}
								disabled={maestroMissingCount === 0}
								onClick={() => void handleInstallBundle()}
							>
								<Download size={15} strokeWidth={1.8} aria-hidden="true" />
								{maestroMissingCount === 0
									? t("config.installed")
									: t("config.maestroBundle.installMissing", { count: maestroMissingCount })}
							</Button>
						</div>
					</section>

					{RECOMMENDED_PACKAGES.map((pkg) => {
						const alreadyInstalled = props.data.extensions.some((ext) => ext.source === pkg.installCmd);
						const installing = installingSources.has(pkg.installCmd);
						return (
						<div
							key={pkg.name}
							className="extensions-recommended-row"
							onClick={() => {
								// pi.dev 的详情路由使用 npm 包名,但查询参数可能是扩展内部展示名。
								const packageName = pkg.piPackageName ?? pkg.name;
								window.open(`https://pi.dev/packages/${pkg.name}?name=${packageName}`, '_blank');
							}}
							title={`${t("config.openPackageDetail")}: ${pkg.name}`}
						>
							<div className="extensions-recommended-info">
								<div className="extensions-recommended-name">
									<strong>{pkg.name}</strong>
									{alreadyInstalled && <span className="config-im-connected-badge" style={{ marginLeft: 8 }}>{t("config.installed")}</span>}
								</div>
								<div className="extensions-recommended-desc">
									{pkg.description}
								</div>
							</div>
							<div className="extensions-recommended-action" onClick={(e) => e.stopPropagation()}>
								{installing ? (
									<span className="config-btn" style={{ opacity: 0.6 }}>{t("config.installing")}</span>
								) : (
									<button
										className="config-icon-btn"
										title={alreadyInstalled ? t("config.installed") : t("config.install")}
										onClick={() => handleInstall(pkg)}
										disabled={alreadyInstalled}
									>
										<Download size={15} strokeWidth={1.8} />
									</button>
								)}
								<button
									className="config-icon-btn"
									title={t("common.copy")}
									onClick={(e) => {
										e.stopPropagation();
										const cmd = `pi install ${pkg.installCmd}`;
										navigator.clipboard.writeText(cmd);
										showNotice(t("app.codeCopied"), 1200);
									}}
								>
									<Copy size={14} strokeWidth={1.8} />
								</button>
							</div>
						</div>
					);
					})}
				</div>
			</div>

			<hr className="extensions-divider" />

			{/* 已安装扩展列表 */}
			<div className="config-section">
				<h3 className="extensions-installed-title">{t("config.installedExtensions")}</h3>
				<div className="config-toolbar" style={{ marginTop: 8 }}>
					<div>
						<span className="config-count">
							{t("config.count.extensions", { count: props.data.extensions.length })}
						</span>
						<small className="skills-restart-hint">
							{t("config.extensionRestartHint")}
						</small>
					</div>
					<div className="skills-toolbar-actions">
						<button className="config-btn" onClick={handleUpdateExtensions} disabled={props.loading || Boolean(updating)}>
							{updating ? t("settings.updating") : t("settings.updateExtensionsAll")}
						</button>
						<button className="config-btn" onClick={props.onRefresh} disabled={props.loading}>
							{t("common.refresh")}
						</button>
					</div>
				</div>
				<div className="skills-list">
					{props.loading ? (
						<div className="config-loading">{t("config.loadingExtensions")}</div>
					) : props.data.extensions.length === 0 ? (
						<div className="config-empty">{t("config.emptyExtensions")}</div>
					) : (
						props.data.extensions.map((extension) => (
							<ExtensionCard
								key={extension.id}
								extension={extension}
								uninstalling={props.uninstallingSource === extension.source}
								onUninstall={props.onUninstall}
								onToggle={handleToggle}
								toggling={togglingSource === extension.source}
							/>
						))
					)}
				</div>
			</div>
		</div>
	);
}

function ExtensionCard(props: {
	extension: PiExtensionSummary;
	uninstalling: boolean;
	toggling?: boolean;
	onUninstall: (extension: PiExtensionSummary) => void;
	onToggle: (extension: PiExtensionSummary) => void;
}) {
	const { extension } = props;
	const name = extension.source.replace(/^(?:npm|file|github|git):/i, "");
	return (
		<article className="session-card skill-card extension-card">
			<div className="session-card-display">
				<div className="session-card-inner skill-card-main">
					<div className="session-card-title skill-title-row">
						<strong>{name}</strong>
						<div className="skill-badges">
							{extension.builtIn && (
								<span className="skill-state enabled">{t("common.builtIn")}</span>
							)}
							<span className={`skill-state ${extension.enabled === false ? "disabled" : "enabled"}`}>
								{extension.enabled !== false ? t("common.enabled") : t("common.disabled")}
							</span>
							<span className="skill-state enabled">
								{extension.scope === "project"
									? t("common.project")
									: t("common.global")}
							</span>
						</div>
					</div>
					<small>{extension.source}</small>
					{!extension.builtIn && (extension.currentVersion || extension.latestVersion) && (
						<small>
							{extension.latestVersion
								? t("config.extensionVersions", {
									current: extension.currentVersion ?? "-",
									latest: extension.latestVersion,
								})
								: t("config.extensionCurrentVersion", { version: extension.currentVersion ?? "-" })}
							{extension.hasUpdate ? ` · ${t("config.extensionUpdateAvailable")}` : ""}
						</small>
					)}
					{extension.updateError && <small className="setting-status error">{extension.updateError}</small>}
					{extension.path && <small>{extension.path}</small>}
				</div>
				<div className="prompts-list-item-actions">
					<button
						className="config-icon-btn"
						disabled={props.toggling}
						onClick={() => props.onToggle(extension)}
						title={extension.enabled !== false ? t("common.disable") : t("common.enabled")}
						style={extension.enabled !== false ? { color: "var(--color-accent)" } : undefined}
					>
						{extension.enabled !== false ? <ToggleRight size={18} strokeWidth={1.8} /> : <ToggleLeft size={18} strokeWidth={1.8} />}
					</button>
					<button
						className="config-icon-btn danger"
						disabled={props.uninstalling}
						onClick={() => props.onUninstall(extension)}
						title={props.uninstalling ? t("config.uninstalling") : t("config.uninstall")}
					>
						<Trash2 size={14} strokeWidth={1.8} />
					</button>
				</div>
			</div>
		</article>
	);
}
