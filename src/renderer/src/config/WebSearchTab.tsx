import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, Globe2, RefreshCw } from "lucide-react";
import type { SmartSearchConfigSnapshot, WebSearchConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { t, TranslationKey } from "../i18n";
import { showNotice } from "../utils/notice";

type ConfigSource = "smartSearch" | "webAccess";

type WebSearchApi = {
	getWebSearch: () => Promise<WebSearchConfigSnapshot>;
	getSmartSearch: () => Promise<SmartSearchConfigSnapshot>;
	saveWebSearch: (request: { raw: string }) => Promise<{ valid: boolean; error?: string }>;
	saveSmartSearch: (request: { raw: string }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): WebSearchApi {
	const api = (window as unknown as { piDesktop?: { config?: WebSearchApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

/** 与 pi-maestro-flow SMART_SEARCH_CONFIG_GROUPS / WEB_ACCESS_CONFIG_GROUPS 对齐的键分组。 */
const SMART_SEARCH_GROUPS = [
	{ id: "xai", label: "xAI Responses", keys: ["XAI_API_URL", "XAI_API_KEY", "XAI_MODEL", "XAI_TOOLS"] },
	{ id: "openai-compatible", label: "OpenAI Compatible", keys: ["OPENAI_COMPATIBLE_API_URL", "OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_MODEL", "OPENAI_COMPATIBLE_FALLBACK_MODELS", "OPENAI_COMPATIBLE_STREAM"] },
	{ id: "search-policy", label: "Search Policy", keys: ["SMART_SEARCH_VALIDATION_LEVEL", "SMART_SEARCH_FALLBACK_MODE", "SMART_SEARCH_MINIMUM_PROFILE", "SMART_SEARCH_RESEARCH_PREFERRED_PROVIDERS", "SMART_SEARCH_RESEARCH_DISABLED_PROVIDERS"] },
	{ id: "intent-router", label: "Intent Router", keys: ["SMART_SEARCH_INTENT_ROUTER", "INTENT_EMBEDDING_API_URL", "INTENT_EMBEDDING_API_KEY", "INTENT_EMBEDDING_MODEL", "INTENT_EMBEDDING_THRESHOLD", "INTENT_EMBEDDING_MARGIN", "INTENT_CLASSIFIER_API_URL", "INTENT_CLASSIFIER_API_KEY", "INTENT_CLASSIFIER_MODEL", "INTENT_ROUTER_TIMEOUT_SECONDS"] },
	{ id: "exa", label: "Exa", keys: ["EXA_API_KEY", "EXA_BASE_URL", "EXA_TIMEOUT_SECONDS"] },
	{ id: "context7", label: "Context7", keys: ["CONTEXT7_API_KEY", "CONTEXT7_BASE_URL", "CONTEXT7_TIMEOUT_SECONDS"] },
	{ id: "zhipu", label: "Zhipu Web Search", keys: ["ZHIPU_API_KEY", "ZHIPU_API_URL", "ZHIPU_SEARCH_ENGINE", "ZHIPU_TIMEOUT_SECONDS"] },
	{ id: "zhipu-mcp", label: "Zhipu Coding Plan MCP", keys: ["ZHIPU_MCP_API_KEY", "ZHIPU_MCP_SEARCH_API_URL", "ZHIPU_MCP_READER_API_URL", "ZHIPU_MCP_ZREAD_API_URL", "ZHIPU_MCP_TIMEOUT_SECONDS"] },
	{ id: "jina", label: "Jina Reader", keys: ["JINA_API_KEY", "JINA_READER_API_URL", "JINA_RESPOND_WITH", "JINA_TIMEOUT_SECONDS"] },
	{ id: "tavily", label: "Tavily", keys: ["TAVILY_API_KEY", "TAVILY_API_URL", "TAVILY_ENABLED", "TAVILY_TIMEOUT_SECONDS"] },
	{ id: "firecrawl", label: "Firecrawl", keys: ["FIRECRAWL_API_KEY", "FIRECRAWL_API_URL"] },
	{ id: "anysearch", label: "AnySearch", keys: ["ANYSEARCH_API_KEY", "ANYSEARCH_API_URL", "ANYSEARCH_TIMEOUT_SECONDS"] },
	{ id: "runtime", label: "Runtime", keys: ["SMART_SEARCH_DEBUG", "SMART_SEARCH_LOG_LEVEL", "SMART_SEARCH_LOG_DIR", "SMART_SEARCH_RETRY_MAX_ATTEMPTS", "SMART_SEARCH_RETRY_MULTIPLIER", "SMART_SEARCH_RETRY_MAX_WAIT", "SMART_SEARCH_OUTPUT_CLEANUP", "SMART_SEARCH_LOG_TO_FILE", "SSL_VERIFY"] },
] as const;

const WEB_ACCESS_GROUPS = [
	{ id: "wa-perplexity", label: "Perplexity", keys: ["PERPLEXITY_API_KEY"] },
	{ id: "wa-openai", label: "OpenAI Search", keys: ["OPENAI_API_KEY"] },
	{ id: "wa-brave", label: "Brave Search", keys: ["BRAVE_API_KEY"] },
	{ id: "wa-tavily", label: "Tavily", keys: ["TAVILY_API_KEY"] },
	{ id: "wa-jina", label: "Jina", keys: ["JINA_API_KEY"] },
] as const;

const SECRET_KEY_RE = /(_API_KEY|_TOKEN|PASSWORD)$/i;

function displayValue(key: string, value: unknown): string {
	if (value === undefined || value === null || value === "") return t("webSearch.unset");
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (SECRET_KEY_RE.test(key) && text) return "••••••••";
	return text;
}

/**
 * 对标 pi-maestro-flow SmartSearchConfigOverlay 基础流：
 * 选配置源 → 展开分组 → 选键编辑 → 保存。
 */
export function WebSearchTab() {
	const [webSnapshot, setWebSnapshot] = useState<WebSearchConfigSnapshot | null>(null);
	const [smartSnapshot, setSmartSnapshot] = useState<SmartSearchConfigSnapshot | null>(null);
	const [source, setSource] = useState<ConfigSource>("smartSearch");
	const [values, setValues] = useState<Record<string, unknown>>({});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set(["xai", "openai-compatible"]));
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [draft, setDraft] = useState("");

	const groups = source === "smartSearch" ? SMART_SEARCH_GROUPS : WEB_ACCESS_GROUPS;
	const snapshot = source === "smartSearch" ? smartSnapshot : webSnapshot;

	const configuredCount = useMemo(() => {
		const map = new Map<string, number>();
		for (const group of groups) {
			const count = group.keys.filter((key) => {
				const value = values[key];
				return value !== undefined && value !== null && value !== "";
			}).length;
			map.set(group.id, count);
		}
		return map;
	}, [groups, values]);

	const applySnapshot = (nextSource: ConfigSource, smart: SmartSearchConfigSnapshot | null, web: WebSearchConfigSnapshot | null) => {
		const target = nextSource === "smartSearch" ? smart : web;
		const parsed = (target?.parsed && typeof target.parsed === "object" && !Array.isArray(target.parsed)
			? target.parsed
			: {}) as Record<string, unknown>;
		setValues({ ...parsed });
		setDirty(false);
		setEditingKey(null);
		setDraft("");
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextSmart, nextWeb] = await Promise.all([getConfigApi().getSmartSearch(), getConfigApi().getWebSearch()]);
			setSmartSnapshot(nextSmart);
			setWebSnapshot(nextWeb);
			applySnapshot(source, nextSmart, nextWeb);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const selectSource = (nextSource: ConfigSource) => {
		setSource(nextSource);
		applySnapshot(nextSource, smartSnapshot, webSnapshot);
		setExpanded(new Set(nextSource === "smartSearch" ? ["xai", "openai-compatible"] : ["wa-perplexity", "wa-openai"]));
		setError(null);
	};

	const toggleGroup = (groupId: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(groupId)) next.delete(groupId);
			else next.add(groupId);
			return next;
		});
	};

	const beginEdit = (key: string) => {
		const current = values[key];
		setEditingKey(key);
		setDraft(current === undefined || current === null ? "" : typeof current === "string" ? current : JSON.stringify(current));
	};

	const commitEdit = () => {
		if (!editingKey) return;
		const trimmed = draft.trim();
		setValues((prev) => {
			const next = { ...prev };
			if (!trimmed) delete next[editingKey];
			else next[editingKey] = trimmed;
			return next;
		});
		setDirty(true);
		setEditingKey(null);
		setDraft("");
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const raw = JSON.stringify(values, null, 2);
			const result = source === "smartSearch"
				? await getConfigApi().saveSmartSearch({ raw })
				: await getConfigApi().saveWebSearch({ raw });
			if (!result.valid) {
				setError(result.error ?? t("webSearch.saveFailed"));
				return;
			}
			showNotice(t("webSearch.saved"), 1600);
			setDirty(false);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="web-search-tab">
			<div className="config-toolbar web-search-toolbar">
				<div>
					<strong>{t("webSearch.title")}</strong>
					<p>{t("webSearch.description")}</p>
				</div>
				<div className="config-toolbar-actions">
					<Button variant="secondary" onClick={() => void load()} loading={loading}>
						<RefreshCw size={15} aria-hidden="true" /> {t("common.refresh")}
					</Button>
					<Button variant="primary" onClick={() => void save()} loading={saving} disabled={loading || !dirty}>
						{t("common.save")}
					</Button>
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}
			{snapshot?.diagnostic ? <div className="config-error">{snapshot.diagnostic.message}</div> : null}

			<div className="web-search-flow-bar">
				<div className="web-search-source-switch" role="group" aria-label={t("webSearch.configFile")}>
					<Button buttonSize="sm" variant={source === "smartSearch" ? "primary" : "secondary"} aria-pressed={source === "smartSearch"} onClick={() => selectSource("smartSearch")}>
						{t("webSearch.smartSearchConfig")}
					</Button>
					<Button buttonSize="sm" variant={source === "webAccess" ? "primary" : "secondary"} aria-pressed={source === "webAccess"} onClick={() => selectSource("webAccess")}>
						{t("webSearch.webAccessConfig")}
					</Button>
				</div>
				{snapshot?.path ? <code title={snapshot.path}>{snapshot.path}</code> : null}
			</div>

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : (
				<div className="web-search-provider-groups">
					<div className="web-search-groups-header">
						<Globe2 size={16} aria-hidden="true" />
						<strong>{t("webSearch.providerGroups")}</strong>
						<span>{t("webSearch.flowHint")}</span>
					</div>
					<div className="web-search-groups-list">
						{groups.map((group) => {
							const count = configuredCount.get(group.id) ?? 0;
							const isExpanded = expanded.has(group.id);
							return (
								<div key={group.id} className="web-search-provider-group">
									<button type="button" className="web-search-group-toggle" onClick={() => toggleGroup(group.id)}>
										{isExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
										<div className="web-search-group-title">
											<span className="web-search-group-label">{t(`webSearch.groups.${group.id}.label` as TranslationKey)}</span>
											<span className="web-search-group-capability">{t(`webSearch.groups.${group.id}.capability` as TranslationKey)}</span>
										</div>
										<span className="web-search-group-count">{count}/{group.keys.length}</span>
									</button>
									{isExpanded ? (
										<div className="web-search-group-providers">
											{group.keys.map((key) => {
												const isEditing = editingKey === key;
												return (
													<div key={key} className={`web-search-key-row ${values[key] != null && values[key] !== "" ? "configured" : ""}`}>
														<div className="web-search-key-meta">
															<div className="web-search-key-name">
																<code>{key}</code>
																<IconButton className="web-search-key-help" label={t(`webSearch.keys.${key}` as TranslationKey)}>
																	<CircleHelp size={14} aria-hidden="true" />
																</IconButton>
															</div>
															<span className="web-search-key-value">{displayValue(key, values[key])}</span>
														</div>
														{isEditing ? (
															<div className="web-search-key-edit">
																<TextField
																	label=""
																	value={draft}
																	onChange={setDraft}
																	type={SECRET_KEY_RE.test(key) ? "password" : "text"}
																	placeholder={t("webSearch.valuePlaceholder")}
																	onKeyDown={(event) => {
																		if (event.key === "Enter") commitEdit();
																		if (event.key === "Escape") {
																			setEditingKey(null);
																			setDraft("");
																		}
																	}}
																/>
																<Button buttonSize="sm" variant="primary" onClick={commitEdit}>{t("common.apply")}</Button>
																<Button buttonSize="sm" variant="secondary" onClick={() => { setEditingKey(null); setDraft(""); }}>{t("common.cancel")}</Button>
															</div>
														) : (
															<Button buttonSize="sm" variant="secondary" onClick={() => beginEdit(key)}>
																{t("common.edit")}
															</Button>
														)}
													</div>
												);
											})}
										</div>
									) : null}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
