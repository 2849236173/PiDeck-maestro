import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw, ShieldAlert } from "lucide-react";
import type { ModelFailoverConfig, ModelFailoverConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import type { ModelsFile } from "./configTypes";

type Scope = "global" | "workspace";

type ModelFailoverApi = {
	getModelFailover: (workspacePath?: string) => Promise<ModelFailoverConfigSnapshot>;
	saveModelFailover: (request: {
		scope: Scope;
		workspacePath?: string;
		config: ModelFailoverConfig;
	}) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): ModelFailoverApi {
	const api = (window as unknown as { piDesktop?: { config?: ModelFailoverApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

/** 收集 models.json 中全部 provider/model，供主模型与 fallback 选择。 */
function collectModelRefs(modelsData?: ModelsFile): string[] {
	const refs = new Set<string>();
	for (const [provider, cfg] of Object.entries(modelsData?.providers ?? {})) {
		for (const model of cfg.models ?? []) {
			const id = typeof model === "string" ? model : model.id?.trim();
			if (provider.trim() && id) refs.add(`${provider}/${id}`);
		}
	}
	return [...refs].sort((a, b) => a.localeCompare(b));
}

/**
 * 对标 pi-maestro-flow ModelFailoverOverlay 基础流：
 * 选择作用域 → 启用开关 → 选主模型 → 勾选/排序 fallback → 保存。
 */
export function ModelFailoverTab(props: { workspacePath?: string; modelsData?: ModelsFile }) {
	const [snapshot, setSnapshot] = useState<ModelFailoverConfigSnapshot | null>(null);
	const [scope, setScope] = useState<Scope>("global");
	const [enabled, setEnabled] = useState(false);
	const [chains, setChains] = useState<Record<string, string[]>>({});
	const [primary, setPrimary] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);

	const catalog = useMemo(() => {
		const fromModels = collectModelRefs(props.modelsData);
		const fromConfig = Object.keys(chains);
		for (const chain of Object.values(chains)) fromConfig.push(...chain);
		return [...new Set([...fromModels, ...fromConfig])].sort((a, b) => a.localeCompare(b));
	}, [chains, props.modelsData]);

	const filteredPrimaries = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return q ? catalog.filter((m) => m.toLowerCase().includes(q)) : catalog;
	}, [catalog, filter]);

	const activePrimary = primary && catalog.includes(primary) ? primary : filteredPrimaries[0] ?? null;
	const fallbacks = activePrimary ? chains[activePrimary] ?? [] : [];

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getModelFailover(props.workspacePath);
			setSnapshot(next);
			const source = scope === "workspace" ? next.workspace : next.global;
			const parsed = source?.parsed ?? next.effective;
			setEnabled(Boolean(parsed.enabled));
			setChains({ ...(parsed.fallbackModels ?? {}) });
			const first = Object.keys(parsed.fallbackModels ?? {})[0] ?? collectModelRefs(props.modelsData)[0] ?? null;
			setPrimary(first);
			setDirty(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// 仅在工作区变化时重载；scope 切换在 selectScope 内处理。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.workspacePath]);

	const selectScope = (nextScope: Scope) => {
		setScope(nextScope);
		const source = nextScope === "workspace" ? snapshot?.workspace : snapshot?.global;
		const parsed = source?.parsed ?? { enabled: false, fallbackModels: {} };
		setEnabled(Boolean(parsed.enabled));
		setChains({ ...(parsed.fallbackModels ?? {}) });
		setPrimary(Object.keys(parsed.fallbackModels ?? {})[0] ?? catalog[0] ?? null);
		setDirty(false);
		setError(null);
	};

	const markDirty = () => setDirty(true);

	const toggleFallback = (model: string) => {
		if (!activePrimary || model === activePrimary) return;
		setChains((prev) => {
			const current = [...(prev[activePrimary] ?? [])];
			const idx = current.indexOf(model);
			if (idx >= 0) current.splice(idx, 1);
			else current.push(model);
			return { ...prev, [activePrimary]: current };
		});
		markDirty();
	};

	const moveFallback = (model: string, delta: number) => {
		if (!activePrimary) return;
		setChains((prev) => {
			const current = [...(prev[activePrimary] ?? [])];
			const idx = current.indexOf(model);
			const next = idx + delta;
			if (idx < 0 || next < 0 || next >= current.length) return prev;
			[current[idx], current[next]] = [current[next], current[idx]];
			return { ...prev, [activePrimary]: current };
		});
		markDirty();
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			// 清理空链，避免写入无意义主模型条目。
			const fallbackModels = Object.fromEntries(
				Object.entries(chains).filter(([, chain]) => chain.length > 0),
			);
			const result = await getConfigApi().saveModelFailover({
				scope,
				workspacePath: props.workspacePath,
				config: { enabled, fallbackModels },
			});
			if (!result.valid) {
				setError(result.error ?? t("modelFailover.saveFailed"));
				return;
			}
			showNotice(t("modelFailover.saved"), 1600);
			setDirty(false);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	const selectedSource = scope === "workspace" ? snapshot?.workspace : snapshot?.global;
	const candidateFallbacks = catalog.filter((m) => m !== activePrimary);

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
					<Button variant="primary" onClick={() => void save()} loading={saving} disabled={loading || !dirty}>
						{t("common.save")}
					</Button>
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}

			<div className="failover-flow-bar">
				<div className="mcp-scope-switch" role="group" aria-label={t("modelFailover.editScope")}>
					<Button buttonSize="sm" variant={scope === "global" ? "primary" : "secondary"} aria-pressed={scope === "global"} onClick={() => selectScope("global")}>
						{t("modelFailover.global")}
					</Button>
					<Button
						buttonSize="sm"
						variant={scope === "workspace" ? "primary" : "secondary"}
						aria-pressed={scope === "workspace"}
						onClick={() => selectScope("workspace")}
						disabled={!props.workspacePath}
					>
						{t("modelFailover.project")}
					</Button>
				</div>
				<button
					type="button"
					className={`failover-enable-toggle ${enabled ? "on" : ""}`}
					aria-pressed={enabled}
					onClick={() => {
						setEnabled((v) => !v);
						markDirty();
					}}
				>
					<ShieldAlert size={14} aria-hidden="true" />
					{enabled ? t("modelFailover.enabled") : t("modelFailover.disabled")}
				</button>
				{selectedSource?.path ? <code className="failover-path" title={selectedSource.path}>{selectedSource.path}</code> : null}
			</div>

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : (
				<div className="failover-dual-pane">
					<section className="failover-pane" aria-label={t("modelFailover.primaryPane")}>
						<header>
							<strong>{t("modelFailover.primaryPane")}</strong>
							<span>{t("modelFailover.primaryHint")}</span>
						</header>
						<TextField
							label=""
							value={filter}
							onChange={setFilter}
							placeholder={t("modelFailover.filterPlaceholder")}
						/>
						<div className="failover-list" role="listbox" aria-label={t("modelFailover.primaryPane")}>
							{filteredPrimaries.length === 0 ? (
								<div className="config-empty-sm">{t("modelFailover.noModels")}</div>
							) : (
								filteredPrimaries.map((model) => {
									const count = chains[model]?.length ?? 0;
									return (
										<button
											key={model}
											type="button"
											role="option"
											aria-selected={model === activePrimary}
											className={`failover-list-item ${model === activePrimary ? "selected" : ""}`}
											onClick={() => setPrimary(model)}
										>
											<code>{model}</code>
											{count > 0 ? <span className="failover-chip">{count}</span> : null}
										</button>
									);
								})
							)}
						</div>
					</section>

					<section className="failover-pane" aria-label={t("modelFailover.fallbackPane")}>
						<header>
							<strong>{t("modelFailover.fallbackPane")}</strong>
							<span>
								{activePrimary
									? t("modelFailover.fallbackHint", { model: activePrimary })
									: t("modelFailover.selectPrimaryFirst")}
							</span>
						</header>
						<div className="failover-list failover-fallback-list">
							{!activePrimary ? (
								<div className="config-empty-sm">{t("modelFailover.selectPrimaryFirst")}</div>
							) : candidateFallbacks.length === 0 ? (
								<div className="config-empty-sm">{t("modelFailover.noFallbackCandidates")}</div>
							) : (
								candidateFallbacks
									.slice()
									.sort((a, b) => {
										const ai = fallbacks.indexOf(a);
										const bi = fallbacks.indexOf(b);
										if (ai >= 0 && bi >= 0) return ai - bi;
										if (ai >= 0) return -1;
										if (bi >= 0) return 1;
										return a.localeCompare(b);
									})
									.map((model) => {
										const included = fallbacks.includes(model);
										const priority = included ? fallbacks.indexOf(model) + 1 : null;
										return (
											<div key={model} className={`failover-fallback-row ${included ? "included" : ""}`}>
												<label>
													<input
														type="checkbox"
														checked={included}
														onChange={() => toggleFallback(model)}
													/>
													<code>{model}</code>
												</label>
												{priority !== null ? (
													<div className="failover-fallback-actions">
														<span className="failover-chip">#{priority}</span>
														<IconButton label={t("modelFailover.moveUp")} onClick={() => moveFallback(model, -1)} disabled={priority <= 1}>
															<ArrowUp size={14} aria-hidden="true" />
														</IconButton>
														<IconButton label={t("modelFailover.moveDown")} onClick={() => moveFallback(model, 1)} disabled={priority >= fallbacks.length}>
															<ArrowDown size={14} aria-hidden="true" />
														</IconButton>
													</div>
												) : null}
											</div>
										);
									})
							)}
						</div>
					</section>
				</div>
			)}
		</div>
	);
}
