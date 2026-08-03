import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Globe, MapPin, RefreshCw, RotateCcw } from "lucide-react";
import {
	TEAMMATE_MODEL_TASK_TYPES,
	type TeammateModelConfigScope,
	type TeammateModelConfigSnapshot,
	type TeammateModelRoutingFile,
	type TeammateModelTaskType,
} from "../../../shared/types";
import type { PiDesktopApi } from "../../../preload";
import { t } from "../i18n";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { SelectField } from "../components/ui/SelectField";
import { ConfigComboboxInput } from "./ConfigShared";
import type { ModelsFile } from "./configTypes";
import { showNotice } from "../utils/notice";

const api: PiDesktopApi = (window as unknown as { piDesktop: PiDesktopApi }).piDesktop;
const EMPTY_CONFIG: TeammateModelRoutingFile = { mappings: {} };

const TASK_DESCRIPTIONS: Record<TeammateModelTaskType, { label: string; description: string }> = {
	explore: {
		label: t("maestro.task.explore"),
		description: t("maestro.task.exploreDescription"),
	},
	analysis: {
		label: t("maestro.task.analysis"),
		description: t("maestro.task.analysisDescription"),
	},
	debug: {
		label: t("maestro.task.debug"),
		description: t("maestro.task.debugDescription"),
	},
	planning: {
		label: t("maestro.task.planning"),
		description: t("maestro.task.planningDescription"),
	},
	development: {
		label: t("maestro.task.development"),
		description: t("maestro.task.developmentDescription"),
	},
	review: {
		label: t("maestro.task.review"),
		description: t("maestro.task.reviewDescription"),
	},
	testing: {
		label: t("maestro.task.testing"),
		description: t("maestro.task.testingDescription"),
	},
};

function hasOwn(object: object | undefined, key: PropertyKey) {
	return Object.hasOwn(object ?? {}, key);
}

function normalizeRoutingDraft(config: TeammateModelRoutingFile): TeammateModelRoutingFile {
	const mappings = { ...config.mappings };
	if (typeof config.global === "string" && config.global) {
		for (const taskType of TEAMMATE_MODEL_TASK_TYPES) {
			// PiDeck materializes the default into mappings for current runtimes; fold those copies back in the editor.
			if (mappings[taskType] === config.global) delete mappings[taskType];
		}
	}
	return { ...config, mappings };
}

function modelOptions(models: ModelsFile) {
	const options = new Map<string, { value: string; label: string }>();
	for (const [provider, config] of Object.entries(models.providers ?? {})) {
		for (const model of config.models ?? []) {
			const id = model.id?.trim();
			if (!provider.trim() || !id) continue;
			const value = `${provider}/${id}`;
			options.set(value, {
				value,
				label: model.name && model.name !== id ? `${value} · ${model.name}` : value,
			});
		}
	}
	return [...options.values()].sort((left, right) => left.value.localeCompare(right.value));
}

export function MaestroTab({
	models,
	workspacePath,
	onSave,
}: {
	models: ModelsFile;
	workspacePath?: string;
	onSave: () => void;
}) {
	const [snapshot, setSnapshot] = useState<TeammateModelConfigSnapshot | null>(null);
	const [scope, setScope] = useState<TeammateModelConfigScope>("global");
	const [drafts, setDrafts] = useState<Record<TeammateModelConfigScope, TeammateModelRoutingFile>>({
		global: EMPTY_CONFIG,
		workspace: EMPTY_CONFIG,
	});
	const [dirtyScopes, setDirtyScopes] = useState<Set<TeammateModelConfigScope>>(new Set());
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const availableModels = useMemo(() => modelOptions(models), [models]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await api.config.getTeammateModels(workspacePath);
			setSnapshot(result);
			setDrafts({
				global: normalizeRoutingDraft(result.global.parsed),
				workspace: normalizeRoutingDraft(result.workspace?.parsed ?? EMPTY_CONFIG),
			});
			setDirtyScopes(new Set());
			if (!workspacePath) setScope("global");
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		} finally {
			setLoading(false);
		}
	}, [workspacePath]);

	useEffect(() => {
		void load();
	}, [load]);

	const selectedSource = scope === "global" ? snapshot?.global : snapshot?.workspace;
	const draft = drafts[scope];
	const initial = selectedSource?.parsed ?? EMPTY_CONFIG;
	const hasDiagnostic = Boolean(selectedSource?.diagnostic);
	const isDirty = dirtyScopes.has(scope);
	const selectedDefault = hasOwn(draft, "global")
		? draft.global ?? ""
		: scope === "workspace"
			? snapshot?.global.parsed.global ?? ""
			: "";

	function updateDraft(update: (current: TeammateModelRoutingFile) => TeammateModelRoutingFile) {
		setDrafts((current) => ({ ...current, [scope]: update(current[scope]) }));
		setDirtyScopes((current) => new Set(current).add(scope));
	}

	function setDefaultModel(value: string) {
		updateDraft((current) => ({ ...current, global: value || null }));
	}

	function restoreDefault() {
		updateDraft((current) => {
			const next = { ...current };
			delete next.global;
			return next;
		});
	}

	function modelForTask(taskType: TeammateModelTaskType) {
		if (hasOwn(draft.mappings, taskType)) return draft.mappings?.[taskType] ?? "";
		if (typeof draft.global === "string" && draft.global) return draft.global;
		return snapshot?.effective.mappings?.[taskType] ?? "";
	}

	function setTaskModel(taskType: TeammateModelTaskType, value: string) {
		updateDraft((current) => ({
			...current,
			mappings: { ...current.mappings, [taskType]: value || null },
		}));
	}

	function restoreTaskMapping(taskType: TeammateModelTaskType) {
		updateDraft((current) => {
			const mappings = { ...current.mappings };
			delete mappings[taskType];
			return { ...current, mappings };
		});
	}

	function buildSaveRequest() {
		const changedMappings: TeammateModelRoutingFile["mappings"] = {};
		for (const taskType of TEAMMATE_MODEL_TASK_TYPES) {
			if (hasOwn(draft.mappings, taskType)) {
				const value = draft.mappings?.[taskType];
				if (value !== initial.mappings?.[taskType]) changedMappings![taskType] = value;
			} else if (typeof draft.global === "string" && draft.global) {
				// Current teammate runtimes route from mappings; materialize legacy/default values.
				if (initial.mappings?.[taskType] !== draft.global) changedMappings![taskType] = draft.global;
			}
		}
		const removeMappings = TEAMMATE_MODEL_TASK_TYPES.filter(
			(taskType) => hasOwn(initial.mappings, taskType) && !hasOwn(draft.mappings, taskType) && !draft.global,
		);
		const globalChanged = hasOwn(draft, "global") && draft.global !== initial.global;
		const removeGlobal = hasOwn(initial, "global") && !hasOwn(draft, "global");
		return {
			scope,
			workspacePath: scope === "workspace" ? workspacePath : undefined,
			config: {
				version: 2,
				...(globalChanged ? { global: draft.global } : {}),
				...(Object.keys(changedMappings ?? {}).length ? { mappings: changedMappings } : {}),
			},
			...(removeGlobal ? { removeGlobal: true } : {}),
			...(removeMappings.length ? { removeMappings } : {}),
		};
	}

	async function save() {
		if (hasDiagnostic || !isDirty) return;
		setSaving(true);
		setError(null);
		try {
			const result = await api.config.saveTeammateModels(buildSaveRequest());
			if (!result.valid) {
				const message = result.error ?? t("config.saveFailed");
				setError(message);
				showNotice(message, 4000);
				return;
			}
			showNotice(t("maestro.saved"), 3000);
			await load();
			onSave();
		} catch (saveError) {
			const message = saveError instanceof Error ? saveError.message : String(saveError);
			setError(message);
			showNotice(message, 4000);
		} finally {
			setSaving(false);
		}
	}

	if (loading) return <div className="config-loading">{t("common.loading")}</div>;

	return (
		<div className="config-maestro-tab">
			<div className="maestro-config-heading">
				<div>
					<h3>{t("maestro.title")}</h3>
					<p>{t("maestro.description")}</p>
				</div>
				<Button variant="ghost" buttonSize="sm" onClick={() => void load()}>
					<RefreshCw size={15} aria-hidden="true" />
					{t("common.refresh")}
				</Button>
			</div>

			<div className="maestro-config-toolbar">
				<div className="maestro-scope-card">
					<div className="maestro-scope-header">
						{scope === "global" ? (
							<Globe size={16} aria-hidden="true" />
						) : (
							<MapPin size={16} aria-hidden="true" />
						)}
						<span className="maestro-scope-label">{t("maestro.currentScope")}</span>
						<span className={`maestro-scope-badge ${scope}`}>
							{scope === "global" ? t("maestro.scope.global") : t("maestro.scope.workspace")}
						</span>
					</div>
					<SelectField
						className="maestro-scope-select"
						label=""
						value={scope}
						onChange={(value) => setScope(value as TeammateModelConfigScope)}
						options={[
							{ value: "global", label: t("maestro.scope.global") },
							{
								value: "workspace",
								label: t("maestro.scope.workspace"),
								disabled: !workspacePath,
							},
						]}
					/>
					<p className="maestro-scope-path">{selectedSource?.path ?? t("maestro.workspaceUnavailable")}</p>
				</div>
				<div className="maestro-model-count">
					{t("maestro.availableModels", { count: availableModels.length })}
				</div>
			</div>

			{scope === "workspace" && (
				<div className="maestro-scope-note">{t("maestro.workspaceHint")}</div>
			)}

			{selectedSource?.diagnostic && (
				<div className="maestro-config-diagnostic" role="alert">
					<AlertTriangle size={18} aria-hidden="true" />
					<div>
						<strong>{t("maestro.invalidConfig")}</strong>
						<span>{selectedSource.diagnostic.message}</span>
						<small>{t("maestro.invalidConfigHint", { path: selectedSource.path })}</small>
						{selectedSource.diagnostic.snippet && <pre>{selectedSource.diagnostic.snippet}</pre>}
					</div>
				</div>
			)}

			{error && <div className="config-error">{error}</div>}

			<div className="maestro-model-routing-list">
				<section className="maestro-model-routing-card maestro-default-model-card">
					<div className="maestro-model-routing-info">
						<strong>{t("maestro.globalModel")}</strong>
						<code>global</code>
						<p>{t("maestro.globalModelDescription")}</p>
					</div>
					<div className="maestro-model-routing-control">
						<ConfigComboboxInput
							value={selectedDefault}
							options={availableModels}
							onChange={setDefaultModel}
							placeholder={t("maestro.modelPlaceholder")}
						/>
						{scope === "workspace" && hasOwn(draft, "global") && (
							<IconButton
								label={t("maestro.restoreInherited")}
								disabled={hasDiagnostic}
								onClick={restoreDefault}
							>
								<RotateCcw size={15} aria-hidden="true" />
							</IconButton>
						)}
					</div>
				</section>

				{TEAMMATE_MODEL_TASK_TYPES.map((taskType) => {
					const ownMapping = hasOwn(draft.mappings, taskType);
					const inherited = scope === "workspace" && !ownMapping && !hasOwn(draft, "global");
					const usingDefault = !ownMapping && !inherited;
					return (
						<section className="maestro-model-routing-card" key={taskType}>
							<div className="maestro-model-routing-info">
								<strong>{TASK_DESCRIPTIONS[taskType].label}</strong>
								<code>{taskType}</code>
								{inherited && <span className="maestro-inherited-badge">{t("maestro.inherited")}</span>}
								{usingDefault && <span className="maestro-inherited-badge">{t("maestro.usesDefault")}</span>}
								<p>{TASK_DESCRIPTIONS[taskType].description}</p>
							</div>
							<div className="maestro-model-routing-control">
								<ConfigComboboxInput
									value={modelForTask(taskType)}
									options={availableModels}
									onChange={(value) => setTaskModel(taskType, value)}
									placeholder={t("maestro.modelPlaceholder")}
								/>
								{ownMapping && (
									<IconButton
										label={t("maestro.restoreMapping")}
										disabled={hasDiagnostic}
										onClick={() => restoreTaskMapping(taskType)}
									>
										<RotateCcw size={15} aria-hidden="true" />
									</IconButton>
								)}
							</div>
						</section>
					);
				})}
			</div>

			<div className="maestro-config-footer">
				<span>{isDirty ? t("maestro.unsaved") : t("maestro.noChanges")}</span>
				<Button
					variant="primary"
					loading={saving}
					disabled={hasDiagnostic || !isDirty}
					onClick={() => void save()}
				>
					<Check size={16} aria-hidden="true" />
					{t("common.save")}
				</Button>
			</div>
		</div>
	);
}
