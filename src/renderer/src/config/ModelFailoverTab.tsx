import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import type { ModelFailoverConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { LazyMonacoEditor } from "../components/ui/LazyMonacoEditor";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import { ConfigEntryList, type ConfigEntryListItem } from "./ConfigEntryList";

type Scope = "global" | "workspace";

type ModelFailoverApi = {
	getModelFailover: (workspacePath?: string) => Promise<ModelFailoverConfigSnapshot>;
	saveModelFailover: (request: { scope: Scope; workspacePath?: string; config: { enabled: boolean; fallbackModels: Record<string, string[]> } }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): ModelFailoverApi {
	const api = (window as unknown as { piDesktop?: { config?: ModelFailoverApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

function fallbackCount(snapshot: ModelFailoverConfigSnapshot | null) {
	if (!snapshot) return 0;
	return Object.values(snapshot.effective.fallbackModels).reduce((sum, chain) => sum + chain.length, 0);
}

export function ModelFailoverTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<ModelFailoverConfigSnapshot | null>(null);
	const [scope, setScope] = useState<Scope>("global");
	const [raw, setRaw] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedSource = useMemo(() => scope === "workspace" ? snapshot?.workspace : snapshot?.global, [scope, snapshot]);

	const entries = useMemo<ConfigEntryListItem[]>(() => {
		try {
			const parsed = JSON.parse(raw) as { fallbackModels?: Record<string, unknown> };
			const chains = parsed.fallbackModels && typeof parsed.fallbackModels === "object" ? parsed.fallbackModels : {};
			return Object.entries(chains).map(([id, value]) => ({
				id,
				label: id,
				summary: Array.isArray(value) ? (value as unknown[]).map(String).join(" → ") : t("config.entries.invalid"),
				invalid: !Array.isArray(value),
			}));
		} catch {
			return [];
		}
	}, [raw]);

	const updateChains = (mutate: (chains: Record<string, unknown>) => void) => {
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const chains = parsed.fallbackModels && typeof parsed.fallbackModels === "object" && !Array.isArray(parsed.fallbackModels) ? { ...(parsed.fallbackModels as Record<string, unknown>) } : {};
			mutate(chains);
			setRaw(JSON.stringify({ ...parsed, fallbackModels: chains }, null, 2));
		} catch {
			setError(t("modelFailover.invalidRoot"));
		}
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getModelFailover(props.workspacePath);
			setSnapshot(next);
			setScope("global");
			setRaw(next.global.raw);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [props.workspacePath]);

	const selectScope = (nextScope: Scope) => {
		setScope(nextScope);
		const source = nextScope === "workspace" ? snapshot?.workspace : snapshot?.global;
		setRaw(source?.raw ?? JSON.stringify({ enabled: false, fallbackModels: {} }, null, 2));
		setError(null);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				setError(t("modelFailover.invalidRoot"));
				return;
			}
			const result = await getConfigApi().saveModelFailover({
				scope,
				workspacePath: props.workspacePath,
				config: parsed as { enabled: boolean; fallbackModels: Record<string, string[]> },
			});
			if (!result.valid) {
				setError(result.error ?? t("modelFailover.saveFailed"));
				return;
			}
			showNotice(t("modelFailover.saved"), 1600);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="model-failover-tab">
			<div className="config-toolbar model-failover-toolbar">
				<div>
					<strong>{t("modelFailover.title")}</strong>
					<p>{t("modelFailover.description")}</p>
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

			<ConfigEntryList
				items={entries}
				onAdd={() => updateChains((chains) => {
					let index = Object.keys(chains).length + 1;
					let name = `provider/model-${index}`;
					while (chains[name]) name = `provider/model-${++index}`;
					chains[name] = [];
				})}
				onDelete={(id) => updateChains((chains) => { delete chains[id]; })}
			/>

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : snapshot ? (
				<>
					<div className="model-failover-summary">
						<div className="model-failover-card">
							<ShieldAlert size={18} aria-hidden="true" />
							<div>
								<strong>{snapshot.effective.enabled ? t("modelFailover.enabled") : t("modelFailover.disabled")}</strong>
								<span>{t("modelFailover.chainCount", { count: Object.keys(snapshot.effective.fallbackModels).length })}</span>
								<span>{t("modelFailover.fallbackCount", { count: fallbackCount(snapshot) })}</span>
							</div>
						</div>
						<div className="model-failover-card">
							<strong>{t("modelFailover.global")}</strong>
							<code title={snapshot.global.path}>{snapshot.global.path}</code>
							<span>{snapshot.global.exists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
						</div>
						{snapshot.workspace ? (
							<div className="model-failover-card">
								<strong>{t("modelFailover.project")}</strong>
								<code title={snapshot.workspace.path}>{snapshot.workspace.path}</code>
								<span>{snapshot.workspace.exists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
							</div>
						) : null}
					</div>

					<div className="model-failover-editor-card">
						<div className="model-failover-editor-header">
							<div className="mcp-scope-switch" role="group" aria-label={t("modelFailover.editScope")}>
								<Button buttonSize="sm" variant={scope === "global" ? "primary" : "secondary"} aria-pressed={scope === "global"} onClick={() => selectScope("global")}>
									{t("modelFailover.global")}
								</Button>
								<Button buttonSize="sm" variant={scope === "workspace" ? "primary" : "secondary"} aria-pressed={scope === "workspace"} onClick={() => selectScope("workspace")} disabled={!props.workspacePath}>
									{t("modelFailover.project")}
								</Button>
							</div>
							<code title={selectedSource?.path}>{selectedSource?.path}</code>
						</div>
						<div className="model-failover-monaco-wrap">
							<LazyMonacoEditor value={raw} language="json" height="100%" onChange={(value) => setRaw(value ?? "")} />
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
