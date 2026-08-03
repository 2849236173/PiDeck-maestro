import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import type { HooksConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { LazyMonacoEditor } from "../components/ui/LazyMonacoEditor";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import { ConfigEntryList, type ConfigEntryListItem } from "./ConfigEntryList";

type HooksApi = {
	getHooks: (workspacePath?: string) => Promise<HooksConfigSnapshot>;
	saveHooks: (request: { workspacePath: string; configRaw?: string; trustRaw?: string }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): HooksApi {
	const api = (window as unknown as { piDesktop?: { config?: HooksApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

export function HooksTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<HooksConfigSnapshot | null>(null);
	const [mode, setMode] = useState<"config" | "trust">("config");
	const [configRaw, setConfigRaw] = useState("");
	const [trustRaw, setTrustRaw] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const activePath = useMemo(() => mode === "config" ? snapshot?.configPath : snapshot?.trustPath, [mode, snapshot]);
	const activeDiagnostic = mode === "config" ? snapshot?.configDiagnostic : snapshot?.trustDiagnostic;
	const activeRaw = mode === "config" ? configRaw : trustRaw;
	const entries = useMemo<ConfigEntryListItem[]>(() => {
		try {
			const parsed = JSON.parse(activeRaw) as Record<string, unknown>;
			const source = mode === "config" && parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks as Record<string, unknown> : parsed;
			return Object.entries(source).map(([id, value]) => ({ id, label: id, summary: typeof value === "string" ? value : Array.isArray(value) ? t("hooks.entryCount", { count: value.length }) : t("config.entries.title") }));
		} catch {
			return [];
		}
	}, [activeRaw, mode]);

	const updateEntries = (mutate: (source: Record<string, unknown>) => void) => {
		try {
			const parsed = JSON.parse(activeRaw) as Record<string, unknown>;
			const nested = mode === "config" && parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks);
			const source = nested ? { ...(parsed.hooks as Record<string, unknown>) } : { ...parsed };
			mutate(source);
			const next = nested ? { ...parsed, hooks: source } : source;
			if (mode === "config") setConfigRaw(JSON.stringify(next, null, 2)); else setTrustRaw(JSON.stringify(next, null, 2));
		} catch {
			setError(t("hooks.invalidJson"));
		}
	};

	const load = async () => {
		if (!props.workspacePath) return;
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getHooks(props.workspacePath);
			setSnapshot(next);
			setConfigRaw(next.configRaw);
			setTrustRaw(next.trustRaw);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [props.workspacePath]);

	const save = async () => {
		if (!props.workspacePath) return;
		setSaving(true);
		setError(null);
		try {
			const result = await getConfigApi().saveHooks({
				workspacePath: props.workspacePath,
				...(mode === "config" ? { configRaw } : { trustRaw }),
			});
			if (!result.valid) {
				setError(result.error ?? t("hooks.saveFailed"));
				return;
			}
			showNotice(t("hooks.saved"), 1600);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	if (!props.workspacePath) return <div className="config-empty">{t("hooks.noProject")}</div>;

	return (
		<div className="hooks-tab">
			<div className="config-toolbar hooks-toolbar">
				<div>
					<strong>{t("hooks.title")}</strong>
					<p>{t("hooks.description")}</p>
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
			{activeDiagnostic ? <div className="config-error">{activeDiagnostic.message}</div> : null}

			<ConfigEntryList
				items={entries}
				onAdd={() => updateEntries((source) => {
					let index = Object.keys(source).length + 1;
					let name = `entry-${index}`;
					while (source[name]) name = `entry-${++index}`;
					source[name] = mode === "config" ? [] : "";
				})}
				onDelete={(id) => updateEntries((source) => { delete source[id]; })}
			/>

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : snapshot ? (
				<>
					<div className="hooks-summary">
						<div className="hooks-card">
							<ShieldCheck size={18} aria-hidden="true" />
							<div>
								<strong>{snapshot.trusted ? t("hooks.trusted") : t("hooks.untrusted")}</strong>
								<span>{t("hooks.installedCount", { count: snapshot.installedCount })}</span>
							</div>
						</div>
						<div className="hooks-card">
							<strong>{t("hooks.configFile")}</strong>
							<code title={snapshot.configPath}>{snapshot.configPath}</code>
							<span>{snapshot.configExists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
						</div>
						<div className="hooks-card">
							<strong>{t("hooks.trustFile")}</strong>
							<code title={snapshot.trustPath}>{snapshot.trustPath}</code>
							<span>{snapshot.trustExists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
						</div>
					</div>

					<div className="hooks-editor-card">
						<div className="hooks-editor-header">
							<div className="mcp-scope-switch" role="group" aria-label={t("hooks.editScope")}>
								<Button buttonSize="sm" variant={mode === "config" ? "primary" : "secondary"} aria-pressed={mode === "config"} onClick={() => setMode("config")}>{t("hooks.configFile")}</Button>
								<Button buttonSize="sm" variant={mode === "trust" ? "primary" : "secondary"} aria-pressed={mode === "trust"} onClick={() => setMode("trust")}>{t("hooks.trustFile")}</Button>
							</div>
							<code title={activePath}>{activePath}</code>
						</div>
						<div className="hooks-monaco-wrap">
							<LazyMonacoEditor
								value={mode === "config" ? configRaw : trustRaw}
								language="json"
								height="100%"
								onChange={(value) => mode === "config" ? setConfigRaw(value ?? "") : setTrustRaw(value ?? "")}
							/>
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
