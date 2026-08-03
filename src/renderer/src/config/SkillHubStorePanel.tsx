// @ts-nocheck - SkillHub store panel, new feature
import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Download, ArrowLeft, Check, AlertCircle, X, Trash2, BadgeCheck, TerminalSquare } from "lucide-react";
import { t } from "../i18n";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { showNotice } from "../utils/notice";
import { openInSystemBrowser } from "../utils/openExternal";
import type { SkillHubItem, SkillHubDetail, SkillHubSearchResult, SkillHubInstallResult, PiSkillListResult } from "../../../shared/types";

const STORAGE_KEY = "skillhub-installed-v1";

/** localStorage 持久化的安装记录（slug + name，用于验证删除后自动清理） */
interface PersistedInstall {
	slug: string;
	name: string;
}

function loadPersisted(): PersistedInstall[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function savePersisted(entries: PersistedInstall[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch { /* noop */ }
}

/** 添加入口到持久化列表（去重） */
function persistInstall(prev: PersistedInstall[], slug: string, name: string): PersistedInstall[] {
	if (!Array.isArray(prev)) prev = [];
	const existing = prev.find((e) => e.slug === slug);
	if (existing) {
		existing.name = name;
		return prev;
	}
	return [...prev, { slug, name }];
}

/** 获取本地已安装 skill 名称集合 */
async function getInstalledNames(): Promise<Set<string>> {
	try {
		const piDesktop = (window as any).piDesktop;
		if (!piDesktop?.skills?.list) return new Set();
		const list: PiSkillListResult = await piDesktop.skills.list();
		return new Set(list.skills.map((s) => s.name.toLowerCase()));
	} catch {
		return new Set();
	}
}

/** 获取本地已安装 skill 名称 → slugs 映射（同名取唯一匹配的 skills.sh slug） */
async function getInstalledSlugsSet(searchItems: SkillHubItem[]): Promise<Set<string>> {
	try {
		const installed = await getInstalledNames();

		// 统计搜索结果中各 name 出现的次数
		const nameCount = new Map<string, number>();
		for (const item of searchItems) {
			const n = item.name.toLowerCase();
			nameCount.set(n, (nameCount.get(n) || 0) + 1);
		}

		// 仅当 name 在搜索结果中唯一出现时才标为已安装（避免同名不同包的误标）
		const result = new Set<string>();
		for (const item of searchItems) {
			if (installed.has(item.name.toLowerCase()) && nameCount.get(item.name.toLowerCase()) === 1) {
				result.add(item.slug);
			}
		}
		return result;
	} catch {
		return new Set();
	}
}

const api = (window as unknown as {
	piDesktop: {
		skillHub: {
			search: (q: string, limit?: number) => Promise<SkillHubSearchResult>;
			detail: (slug: string) => Promise<SkillHubDetail | null>;
			install: (slug: string, installDir: string) => Promise<SkillHubInstallResult>;
		};
	};
}).piDesktop;

const SUGGESTED_SEARCHES = [
	"pdf", "ocr", "translate", "code review", "react",
	"python", "git", "image", "data", "writing",
];

function fmtNum(n: number): string {
	if (n >= 10000) return (n / 10000).toFixed(1) + "w";
	if (n >= 1000) return (n / 1000).toFixed(1) + "k";
	return String(n);
}

export function SkillHubStorePanel() {
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
	/** 持久化安装记录（跨组件卸载/重启），用于同名歧义时强制标记已安装 */
	const persistedRef = useRef<PersistedInstall[]>(loadPersisted);
	const [installingSlugs, setInstallingSlugs] = useState<Set<string>>(new Set());
	const [result, setResult] = useState<SkillHubSearchResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [previewSlug, setPreviewSlug] = useState<string | null>(null);
	const [detail, setDetail] = useState<SkillHubDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [installResult, setInstallResult] = useState<SkillHubInstallResult | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		searchInputRef.current?.focus();
	}, []);

	const handleSearch = useCallback(async (searchQuery: string) => {
		const q = searchQuery.trim();
		if (!q) return;
		setResult(null);
		setPreviewSlug(null);
		setDetail(null);
		setInstallResult(null);
		setError(null);
		setSearching(true);
		try {
			const data = await api.skillHub.search(q, 50);
			// 搜索后判断已安装状态（需要搜索结果列表来消除同名歧义）
			const installed = await getInstalledSlugsSet(data.items);
			// 合并持久化记录 → 确保已安装的始终显示为已安装（即使文件系统检测因同名不唯一而跳过）
			// 同时验证持久化记录是否仍然有效：检查对应 name 是否还在本地已安装列表中
			const allInstalledNames = await getInstalledNames();
			const merged = new Set(installed);
			// ref 可能在组件热更新后仍持有旧 session 的脏数据，运行时兜底确保可迭代。
			const persisted = Array.isArray(persistedRef.current) ? persistedRef.current : [];
			const validPersisted: PersistedInstall[] = [];
			for (const entry of persisted) {
				if (allInstalledNames.has(entry.name.toLowerCase())) {
					merged.add(entry.slug);
					validPersisted.push(entry);
				}
			}
			// 更新持久化存储（自动清理已删除的条目）
			persistedRef.current = validPersisted;
			savePersisted(validPersisted);
			setResult(data);
			setInstalledSlugs(merged);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSearching(false);
		}
	}, []);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") void handleSearch(query);
	};

	const openDetail = useCallback(async (slug: string) => {
		setPreviewSlug(slug);
		setDetail(null);
		setInstallResult(null);
		setDetailLoading(true);
		try {
			const data = await api.skillHub.detail(slug);
			setDetail(data);
		} catch {
			setDetail(null);
		} finally {
			setDetailLoading(false);
		}
	}, []);

	/** 列表直接安装（不进入详情），安装成功后重新搜索以刷新状态 */
	const handleInstallFromList = async (slug: string, name: string) => {
		setInstallingSlugs((prev) => new Set(prev).add(slug));
		try {
			const result = await api.skillHub.install(slug, "");
			if (result.success) {
				showNotice(t("app.skillsInstalled", { name }), 3000);
				// 安装成功 → 持久化安装记录（确保跨组件卸载后仍显示已安装，删除后自动清理）
				persistedRef.current = persistInstall(persistedRef.current, slug, name);
				savePersisted(persistedRef.current);
				// 刷新搜索结果（更新已安装标注）
				void handleSearch(query);
			} else {
				showNotice(result.error || t("common.error"), 5000, "error");
			}
		} catch (err) {
			showNotice(err instanceof Error ? err.message : String(err), 5000, "error");
		} finally {
			setInstallingSlugs((prev) => {
				const next = new Set(prev);
				next.delete(slug);
				return next;
			});
		}
	};

	const handleInstall = async () => {
		if (!previewSlug) return;
		setInstalling(true);
		setInstallResult(null);
		try {
			const result = await api.skillHub.install(previewSlug, "");
			setInstallResult(result);
			if (result.success) {
				showNotice(t("app.skillsInstalled", { name: detail?.skill?.displayName || previewSlug }), 3000);
			}
		} catch (err) {
			setInstallResult({ success: false, slug: previewSlug, installDir: "", error: String(err) });
		} finally {
			setInstalling(false);
		}
	};

	const handleUninstall = async () => {
		if (!detail) return;
		try {
			const list: PiSkillListResult = await (window as any).piDesktop.skills.list();
			const matches = list.skills.filter((skill) => skill.name.toLowerCase() === detail.skill.displayName.toLowerCase() && !skill.readOnly);
			if (matches.length === 0) {
				showNotice(t("config.skillHubNotInstalled"), 1800, "error");
				return;
			}
			for (const skill of matches) await (window as any).piDesktop.skills.delete(skill.path);
			setInstalledSlugs((current) => { const next = new Set(current); next.delete(detail.skill.slug); return next; });
			persistedRef.current = persistedRef.current.filter((entry) => entry.slug !== detail.skill.slug);
			savePersisted(persistedRef.current);
			showNotice(t("config.skillHubUninstalled"), 1800);
		} catch (err) {
			showNotice(err instanceof Error ? err.message : String(err), 4000, "error");
		}
	};

	if (previewSlug) {
		const skill = detail?.skill;
		return (
			<div className="skillhub-panel">
				<div className="skillhub-detail-toolbar">
					<Button variant="secondary" onClick={() => { setPreviewSlug(null); setDetail(null); setInstallResult(null); }}>
						<ArrowLeft size={14} /> {t("config.promptStoreBack")}
					</Button>
					{skill && installedSlugs.has(skill.slug) ? <Button variant="danger" onClick={() => void handleUninstall()}>{t("config.skillHubUninstall")}</Button> : null}
				</div>
				{detailLoading ? <div className="config-loading">{t("common.loading")}</div> : skill ? (
					<div className="skillhub-detail">
						<h2>{skill.displayName}</h2>
						<p>{skill.summary_zh || skill.summary}</p>
						<div className="skillhub-detail-meta"><span>{skill.category}</span><span>{skill.stats.downloads} {t("common.results")}</span><span>{detail.latestVersion.version}</span><span>{detail.owner.displayName}</span></div>
						<h3>{t("config.skillHubInstallCommand")}</h3>
						<code>npx skills add {skill.slug}</code>
						{detail.latestVersion.changelog ? <><h3>{t("config.skillHubChangelog")}</h3><p>{detail.latestVersion.changelog}</p></> : null}
						<Button variant="primary" onClick={() => void handleInstall()} loading={installing}>{t("common.install")}</Button>
						{installResult?.error ? <div className="config-error">{installResult.error}</div> : null}
					</div>
				) : <div className="config-empty">{t("config.skillHubDetailNotAvailable")}</div>}
			</div>
		);
	}

	// Search / List view
	return (
		<div className="skillhub-panel">
			<div className="skillhub-search-bar">
				<div className="skillhub-search-input-wrap">
					<Search size={15} strokeWidth={1.8} className="skillhub-search-icon" />
					<input
						ref={searchInputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={t("config.skillHubSearchPlaceholder")}
						disabled={searching}
					/>
					<Button
						variant="primary"
						onClick={() => void handleSearch(query)}
						disabled={searching || !query.trim()}
						loading={searching}
					>
						{searching ? t("common.searching") + "…" : <Search size={14} />}
					</Button>
				</div>
				{!result && !searching && (
					<div className="skillhub-suggestions">
						{SUGGESTED_SEARCHES.map((s) => (
							<Button
								key={s}
								variant="ghost"
								buttonSize="sm"
								className="skillhub-suggestion-chip"
								onClick={() => { setQuery(s); void handleSearch(s); }}
							>
								{s}
							</Button>
						))}
					</div>
				)}
			</div>

			{error && <div className="config-error">{error}</div>}
			{searching && <div className="config-loading">{t("common.searching")}…</div>}

			{result && !searching && result.total === 0 && (
				<div className="config-empty">{t("config.noSearchResults")}</div>
			)}

			{result && result.total > 0 && (
				<div className="skillhub-results">
					<small className="skillhub-result-count">
						{result.total} {t("common.results")}
					</small>
					{result.items.map((item) => (
						<article
							key={item.slug}
							className="skillhub-card"
							onClick={() => void openDetail(item.slug)}
						>
							<div className="skillhub-card-main">
								<strong className="skillhub-card-title">
									{item.name}
									{installedSlugs.has(item.slug) && (
										<span className="skillhub-installed-badge">
											<Check size={11} /> 已安装
										</span>
									)}
								</strong>
								<div className="skillhub-card-meta">
									<span className="skillhub-card-stats">
										<Download size={12} /> {fmtNum(item.downloads)} 安装
									</span>
									<span className="skillhub-card-source">{item.ownerName}</span>
								</div>
							</div>
							<div className="skillhub-card-actions">
								<IconButton
									label={t("config.skillHubCopyInstallCommand")}
									onClick={(e) => {
										e.stopPropagation();
										const pkg = item.slug.slice(0, item.slug.lastIndexOf("/"));
										navigator.clipboard.writeText(`npx skills add ${pkg}`);
										showNotice(t("app.codeCopied"), 1200);
									}}
								>
									<TerminalSquare size={14} />
								</IconButton>
								{!installedSlugs.has(item.slug) && (
									<IconButton
										label={t("common.install")}
										disabled={installingSlugs.has(item.slug)}
										onClick={async (e) => {
											e.stopPropagation();
											await handleInstallFromList(item.slug, item.name);
										}}
									>
										{installingSlugs.has(item.slug) ? <span className="skillhub-installing-dot" /> : <Download size={14} />}
									</IconButton>
								)}
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}
