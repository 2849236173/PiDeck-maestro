import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	Check,
	RefreshCw,
	RotateCcw,
	Trash2,
} from "lucide-react";
import {
	MAESTRO_DELEGATE_ROLES,
	type MaestroCliToolConfig,
	type MaestroCliToolsFile,
	type MaestroConfigScope,
	type MaestroConfigSnapshot,
	type MaestroDelegateRole,
	type MaestroReasoningEffort,
	type MaestroRoleMapping,
} from "../../../shared/types";
import type { PiDesktopApi } from "../../../preload";
import { t } from "../i18n";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { SelectField } from "../components/ui/SelectField";
import { TextField } from "../components/ui/TextField";
import { showNotice } from "../utils/notice";

const api: PiDesktopApi = (window as unknown as { piDesktop: PiDesktopApi }).piDesktop;
const EMPTY_CONFIG: MaestroCliToolsFile = { tools: {}, roles: {} };
const EFFORT_OPTIONS: Array<{ value: "" | MaestroReasoningEffort; labelKey: string }> = [
	{ value: "", labelKey: "maestro.effort.default" },
	{ value: "low", labelKey: "maestro.effort.low" },
	{ value: "medium", labelKey: "maestro.effort.medium" },
	{ value: "high", labelKey: "maestro.effort.high" },
	{ value: "max", labelKey: "maestro.effort.max" },
];

function mergeScopes(
	globalConfig: MaestroCliToolsFile,
	workspaceConfig: MaestroCliToolsFile,
): MaestroCliToolsFile {
	return {
		...globalConfig,
		...workspaceConfig,
		version: workspaceConfig.version ?? globalConfig.version,
		tools: { ...globalConfig.tools, ...workspaceConfig.tools },
		roles: { ...globalConfig.roles, ...workspaceConfig.roles },
		proxy: workspaceConfig.proxy ?? globalConfig.proxy,
	};
}

function roleLabel(role: MaestroDelegateRole) {
	const labels: Record<MaestroDelegateRole, string> = {
		analyze: t("maestro.role.analyze"),
		explore: t("maestro.role.explore"),
		review: t("maestro.role.review"),
		implement: t("maestro.role.implement"),
		plan: t("maestro.role.plan"),
		brainstorm: t("maestro.role.brainstorm"),
		research: t("maestro.role.research"),
	};
	return labels[role];
}

function resolveRoleTool(mapping: MaestroRoleMapping | undefined, config: MaestroCliToolsFile) {
	const tools = config.tools ?? {};
	const firstEnabled = Object.entries(tools).find(([, entry]) => entry.enabled === true)?.[0];
	if (mapping?.tool && tools[mapping.tool]?.enabled === true) return mapping.tool;
	for (const toolName of mapping?.fallbackChain ?? []) {
		if (tools[toolName]?.enabled === true) return toolName;
	}
	return firstEnabled;
}

export function MaestroTab({
	workspacePath,
	onSave,
}: {
	workspacePath?: string;
	onSave: () => void;
}) {
	const [snapshot, setSnapshot] = useState<MaestroConfigSnapshot | null>(null);
	const [scope, setScope] = useState<MaestroConfigScope>("global");
	const [view, setView] = useState<"tools" | "roles">("tools");
	const [drafts, setDrafts] = useState<Record<MaestroConfigScope, MaestroCliToolsFile>>({
		global: EMPTY_CONFIG,
		workspace: EMPTY_CONFIG,
	});
	const [dirtyScopes, setDirtyScopes] = useState<Set<MaestroConfigScope>>(new Set());
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await api.config.getMaestroCliTools(workspacePath);
			setSnapshot(result);
			setDrafts({
				global: result.global.parsed,
				workspace: result.workspace?.parsed ?? EMPTY_CONFIG,
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

	const displayConfig = useMemo(() => {
		if (scope === "global") return drafts.global;
		return mergeScopes(snapshot?.global.parsed ?? EMPTY_CONFIG, drafts.workspace);
	}, [drafts, scope, snapshot]);

	const selectedSource = scope === "global" ? snapshot?.global : snapshot?.workspace;
	const scopedConfig = drafts[scope];
	const tools = displayConfig.tools ?? {};
	const toolNames = Object.keys(tools);
	const enabledToolNames = toolNames.filter((name) => tools[name]?.enabled === true);
	const hasDiagnostic = Boolean(selectedSource?.diagnostic);
	const isDirty = dirtyScopes.has(scope);

	function updateScopeConfig(update: (current: MaestroCliToolsFile) => MaestroCliToolsFile) {
		setDrafts((current) => ({ ...current, [scope]: update(current[scope]) }));
		setDirtyScopes((current) => new Set(current).add(scope));
	}

	function updateTool(name: string, patch: Partial<MaestroCliToolConfig>) {
		const base = scopedConfig.tools?.[name] ?? tools[name] ?? {};
		updateScopeConfig((current) => ({
			...current,
			tools: {
				...current.tools,
				[name]: { ...base, ...patch },
			},
		}));
	}

	function updateRole(role: MaestroDelegateRole, mapping: MaestroRoleMapping) {
		const base = scopedConfig.roles?.[role] ?? displayConfig.roles?.[role] ?? {};
		updateScopeConfig((current) => ({
			...current,
			roles: {
				...current.roles,
				[role]: { ...base, ...mapping },
			},
		}));
	}

	function moveFallback(role: MaestroDelegateRole, index: number, direction: -1 | 1) {
		const mapping = displayConfig.roles?.[role];
		const chain = [...(mapping?.fallbackChain ?? enabledToolNames)];
		const target = index + direction;
		if (target < 0 || target >= chain.length) return;
		[chain[index], chain[target]] = [chain[target], chain[index]];
		updateRole(role, { tool: undefined, fallbackChain: chain });
	}

	function restoreInheritedTool(name: string) {
		updateScopeConfig((current) => {
			const nextTools = { ...current.tools };
			delete nextTools[name];
			return { ...current, tools: nextTools };
		});
	}

	function restoreInheritedRole(role: MaestroDelegateRole) {
		updateScopeConfig((current) => {
			const nextRoles = { ...current.roles };
			delete nextRoles[role];
			return { ...current, roles: nextRoles };
		});
	}

	function buildRoutingUpdate() {
		const initial = scope === "global"
			? snapshot?.global.parsed ?? EMPTY_CONFIG
			: snapshot?.workspace?.parsed ?? EMPTY_CONFIG;
		const draft = drafts[scope];
		const tools = Object.fromEntries(
			Object.entries(draft.tools ?? {}).filter(([name, entry]) =>
				JSON.stringify(entry) !== JSON.stringify(initial.tools?.[name]),
			),
		);
		const roles = Object.fromEntries(
			Object.entries(draft.roles ?? {}).filter(([name, mapping]) =>
				JSON.stringify(mapping) !== JSON.stringify(initial.roles?.[name]),
			),
		);
		const removeTools = scope === "workspace"
			? Object.keys(initial.tools ?? {}).filter((name) => !Object.hasOwn(draft.tools ?? {}, name))
			: [];
		const removeRoles = scope === "workspace"
			? MAESTRO_DELEGATE_ROLES.filter(
				(role) => Object.hasOwn(initial.roles ?? {}, role) && !Object.hasOwn(draft.roles ?? {}, role),
			)
			: [];
		return {
			config: {
				...(Object.keys(tools).length ? { tools } : {}),
				...(Object.keys(roles).length ? { roles } : {}),
			},
			...(removeTools.length ? { removeTools } : {}),
			...(removeRoles.length ? { removeRoles } : {}),
		};
	}

	async function save() {
		if (hasDiagnostic || !isDirty) return;
		setSaving(true);
		setError(null);
		try {
			const update = buildRoutingUpdate();
			const result = await api.config.saveMaestroCliTools({
				scope,
				workspacePath: scope === "workspace" ? workspacePath : undefined,
				...update,
			});
			if (!result.valid) {
				setError(result.error ?? t("config.saveFailed"));
				showNotice(result.error ?? t("config.saveFailed"), 4000);
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
				<SelectField
					className="maestro-scope-select"
					label={t("maestro.scope")}
					value={scope}
					onChange={(value) => setScope(value as MaestroConfigScope)}
					options={[
						{ value: "global", label: t("maestro.scope.global") },
						{
							value: "workspace",
							label: t("maestro.scope.workspace"),
							disabled: !workspacePath,
						},
					]}
					description={selectedSource?.path ?? t("maestro.workspaceUnavailable")}
				/>
				<div className="maestro-config-view-switch" role="tablist" aria-label={t("maestro.view") }>
					<Button
						role="tab"
						aria-selected={view === "tools"}
						variant={view === "tools" ? "primary" : "secondary"}
						buttonSize="sm"
						onClick={() => setView("tools")}
					>
						{t("maestro.tools")}
					</Button>
					<Button
						role="tab"
						aria-selected={view === "roles"}
						variant={view === "roles" ? "primary" : "secondary"}
						buttonSize="sm"
						onClick={() => setView("roles")}
					>
						{t("maestro.roles")}
					</Button>
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

			{view === "tools" && (
				<div className="maestro-routing-list">
					{toolNames.length === 0 && (
						<div className="config-empty">{t("maestro.noTools")}</div>
					)}
					{Object.entries(tools).map(([name, tool]) => {
						const inherited = scope === "workspace" && !Object.hasOwn(scopedConfig.tools ?? {}, name);
						return (
							<section className="maestro-routing-card" key={name}>
								<header>
									<div>
										<strong>{name}</strong>
										{inherited && <span className="maestro-inherited-badge">{t("maestro.inherited")}</span>}
									</div>
									<div className="maestro-card-actions">
										{scope === "workspace" && !inherited && (
											<IconButton
												label={t("maestro.restoreInherited")}
												disabled={hasDiagnostic}
												onClick={() => restoreInheritedTool(name)}
											>
												<RotateCcw size={14} aria-hidden="true" />
											</IconButton>
										)}
										<label className="config-checkbox-label">
											<input
												type="checkbox"
												checked={tool.enabled === true}
												disabled={hasDiagnostic}
												onChange={(event) => updateTool(name, { enabled: event.target.checked })}
											/>
											{t("maestro.enabled")}
										</label>
									</div>
								</header>
								<div className="maestro-tool-fields">
									<TextField
										label={t("maestro.primaryModel")}
										value={tool.primaryModel ?? ""}
										placeholder={t("maestro.modelPlaceholder")}
										disabled={hasDiagnostic}
										onChange={(value) => updateTool(name, { primaryModel: value })}
										description={t("maestro.modelHint")}
									/>
									<TextField
										label={t("maestro.secondaryModel")}
										value={tool.secondaryModel ?? ""}
										placeholder={t("maestro.optional")}
										disabled={hasDiagnostic}
										onChange={(value) => updateTool(name, { secondaryModel: value || undefined })}
									/>
									<SelectField
										label={t("maestro.reasoningEffort")}
										value={tool.reasoningEffort ?? ""}
										disabled={hasDiagnostic}
										onChange={(value) => updateTool(name, {
											reasoningEffort: (value || undefined) as MaestroReasoningEffort | undefined,
										})}
										options={EFFORT_OPTIONS.map((option) => ({
											value: option.value,
											label: t(option.labelKey as Parameters<typeof t>[0]),
										}))}
									/>
								</div>
							</section>
						);
					})}
				</div>
			)}

			{view === "roles" && (
				<div className="maestro-routing-list">
					{MAESTRO_DELEGATE_ROLES.map((role) => {
						const mapping = displayConfig.roles?.[role];
						const strategy = mapping?.tool ? "direct" : "fallback";
						const chain = mapping?.fallbackChain ?? enabledToolNames;
						const inherited = scope === "workspace" && !Object.hasOwn(scopedConfig.roles ?? {}, role);
						const resolved = resolveRoleTool(mapping, displayConfig);
						return (
							<section className="maestro-routing-card maestro-role-card" key={role}>
								<header>
									<div>
										<strong>{roleLabel(role)}</strong>
										<code>{role}</code>
										{inherited && <span className="maestro-inherited-badge">{t("maestro.inherited")}</span>}
									</div>
									<div className="maestro-card-actions">
										<span className="maestro-resolved-tool">
											{t("maestro.resolvedTool", { tool: resolved ?? t("maestro.none") })}
										</span>
										{scope === "workspace" && !inherited && (
											<IconButton
												label={t("maestro.restoreInherited")}
												disabled={hasDiagnostic}
												onClick={() => restoreInheritedRole(role)}
											>
												<RotateCcw size={14} aria-hidden="true" />
											</IconButton>
										)}
									</div>
								</header>
								<div className="maestro-role-fields">
									<SelectField
										label={t("maestro.routingMode")}
										value={strategy}
										disabled={hasDiagnostic || toolNames.length === 0}
										onChange={(value) => {
											if (value === "direct") {
												updateRole(role, { tool: resolved ?? enabledToolNames[0], fallbackChain: undefined });
											} else {
												updateRole(role, { tool: undefined, fallbackChain: chain.length ? chain : enabledToolNames });
											}
										}}
										options={[
											{ value: "fallback", label: t("maestro.routingFallback") },
											{ value: "direct", label: t("maestro.routingDirect") },
										]}
									/>
									{strategy === "direct" ? (
										<SelectField
											label={t("maestro.directTool")}
											value={mapping?.tool ?? resolved ?? ""}
											disabled={hasDiagnostic || toolNames.length === 0}
											onChange={(value) => updateRole(role, { tool: value, fallbackChain: undefined })}
											options={toolNames.map((name) => ({ value: name, label: name }))}
										/>
									) : (
										<div className="maestro-fallback-editor">
											<span className="ui-field-label">{t("maestro.fallbackChain")}</span>
											{chain.map((toolName, index) => (
												<div className="maestro-fallback-row" key={`${toolName}-${index}`}>
													<span>{index + 1}</span>
													<code>{toolName}</code>
													<div>
														<IconButton
															label={t("maestro.moveUp")}
															disabled={hasDiagnostic || index === 0}
															onClick={() => moveFallback(role, index, -1)}
														>
															<ArrowUp size={14} aria-hidden="true" />
														</IconButton>
														<IconButton
															label={t("maestro.moveDown")}
															disabled={hasDiagnostic || index === chain.length - 1}
															onClick={() => moveFallback(role, index, 1)}
														>
															<ArrowDown size={14} aria-hidden="true" />
														</IconButton>
														<IconButton
															label={t("maestro.removeTool")}
															disabled={hasDiagnostic}
															onClick={() => updateRole(role, {
																tool: undefined,
																fallbackChain: chain.filter((_, itemIndex) => itemIndex !== index),
															})}
														>
															<Trash2 size={14} aria-hidden="true" />
														</IconButton>
													</div>
												</div>
											))}
											<SelectField
												label={t("maestro.addFallback")}
												value=""
												disabled={hasDiagnostic || chain.length >= toolNames.length}
												onChange={(value) => {
													if (value) updateRole(role, { tool: undefined, fallbackChain: [...chain, value] });
												}}
												options={[
													{ value: "", label: t("maestro.selectTool") },
													...toolNames
														.filter((name) => !chain.includes(name))
														.map((name) => ({ value: name, label: name })),
												]}
											/>
										</div>
									)}
								</div>
							</section>
						);
					})}
				</div>
			)}

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
