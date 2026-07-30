import { useEffect, useState } from "react";
import { Globe2, RefreshCw } from "lucide-react";
import type { SmartSearchConfigSnapshot, WebSearchConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { LazyMonacoEditor } from "../components/ui/LazyMonacoEditor";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

type ConfigSource = "smartSearch" | "webAccess";
type ConfigSnapshot = SmartSearchConfigSnapshot | WebSearchConfigSnapshot;

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

export function WebSearchTab() {
	const [webSnapshot, setWebSnapshot] = useState<WebSearchConfigSnapshot | null>(null);
	const [smartSnapshot, setSmartSnapshot] = useState<SmartSearchConfigSnapshot | null>(null);
	const [source, setSource] = useState<ConfigSource>("smartSearch");
	const [raw, setRaw] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextSmart, nextWeb] = await Promise.all([getConfigApi().getSmartSearch(), getConfigApi().getWebSearch()]);
			setSmartSnapshot(nextSmart);
			setWebSnapshot(nextWeb);
			setRaw((source === "smartSearch" ? nextSmart : nextWeb).raw);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	const selectSource = (nextSource: ConfigSource) => {
		setSource(nextSource);
		setRaw((nextSource === "smartSearch" ? smartSnapshot : webSnapshot)?.raw ?? "{}\n");
		setError(null);
	};

	const snapshot: ConfigSnapshot | null = source === "smartSearch" ? smartSnapshot : webSnapshot;

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			JSON.parse(raw);
			const result = source === "smartSearch"
				? await getConfigApi().saveSmartSearch({ raw })
				: await getConfigApi().saveWebSearch({ raw });
			if (!result.valid) {
				setError(result.error ?? t("webSearch.saveFailed"));
				return;
			}
			showNotice(t("webSearch.saved"), 1600);
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
					<Button variant="primary" onClick={() => void save()} loading={saving} disabled={loading}>
						{t("common.save")}
					</Button>
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}
			{snapshot?.diagnostic ? <div className="config-error">{snapshot.diagnostic.message}</div> : null}

			{loading && !snapshot ? <div className="config-loading">{t("common.loading")}</div> : null}
			{snapshot ? (
				<>
					<div className="web-search-summary">
						<Globe2 size={18} aria-hidden="true" />
						<div>
							<strong>{source === "smartSearch" ? t("webSearch.smartSearchConfig") : t("webSearch.webAccessConfig")}</strong>
							<code title={snapshot.path}>{snapshot.path}</code>
							<span>{snapshot.exists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
						</div>
					</div>
					<div className="web-search-source-switch" role="tablist" aria-label={t("webSearch.configFile")}>
						<Button buttonSize="sm" variant={source === "smartSearch" ? "primary" : "secondary"} onClick={() => selectSource("smartSearch")}>{t("webSearch.smartSearchConfig")}</Button>
						<Button buttonSize="sm" variant={source === "webAccess" ? "primary" : "secondary"} onClick={() => selectSource("webAccess")}>{t("webSearch.webAccessConfig")}</Button>
					</div>
					<div className="web-search-editor-card">
						<LazyMonacoEditor value={raw} language="json" height="100%" onChange={(value) => setRaw(value ?? "")} />
					</div>
				</>
			) : null}
		</div>
	);
}
