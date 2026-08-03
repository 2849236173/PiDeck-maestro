import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RefreshCw, ShieldCheck, Trash2, Zap } from "lucide-react";
import type { HookEventName, HooksConfigFile, HooksConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

type HooksApi = {
	getHooks: (workspacePath?: string) => Promise<HooksConfigSnapshot>;
	saveHooks: (request: { workspacePath: string; configRaw?: string; trustRaw?: string }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): HooksApi {
	const api = (window as unknown as { piDesktop?: { config?: HooksApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

const HOOK_EVENTS: Array<{ id: HookEventName; descriptionKey: Parameters<typeof t>[0] }> = [
	{ id: "SessionStart", descriptionKey: "hooks.event.SessionStart" },
	{ id: "SubagentStart", descriptionKey: "hooks.event.SubagentStart" },
	{ id: "PreToolUse", descriptionKey: "hooks.event.PreToolUse" },
	{ id: "PermissionRequest", descriptionKey: "hooks.event.PermissionRequest" },
	{ id: "PostToolUse", descriptionKey: "hooks.event.PostToolUse" },
	{ id: "PreCompact", descriptionKey: "hooks.event.PreCompact" },
	{ id: "PostCompact", descriptionKey: "hooks.event.PostCompact" },
	{ id: "UserPromptSubmit", descriptionKey: "hooks.event.UserPromptSubmit" },
	{ id: "SubagentStop", descriptionKey: "hooks.event.SubagentStop" },
	{ id: "Stop", descriptionKey: "hooks.event.Stop" },
];

type CommandHook = {
	type: "command";
	command: string;
	timeout: number;
	statusMessage?: string;
};

type MatcherGroup = {
	matcher?: string;
	hooks: CommandHook[];
};

function emptyConfig(): HooksConfigFile {
	return { hooks: {} };
}

/**
 * 对标 pi-maestro-flow Codex hooks 基础流：
 * 选择事件 → 添加 command handler（命令 + 超时）→ 保存 hooks.json。
 */
export function HooksTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<HooksConfigSnapshot | null>(null);
	const [config, setConfig] = useState<HooksConfigFile>(emptyConfig());
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set(["SessionStart"]));
	const [drafts, setDrafts] = useState<Record<string, { command: string; timeout: string }>>({});

	const handlerCounts = useMemo(() => {
		const map = new Map<string, number>();
		for (const event of HOOK_EVENTS) {
			const groups = config.hooks[event.id] ?? [];
			const count = groups.reduce((sum, group) => sum + (Array.isArray(group.hooks) ? group.hooks.length : 0), 0);
			if (count > 0) map.set(event.id, count);
		}
		return map;
	}, [config]);

	const load = async () => {
		if (!props.workspacePath) return;
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getHooks(props.workspacePath);
			setSnapshot(next);
			setConfig(next.configParsed ?? emptyConfig());
			setDirty(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [props.workspacePath]);

	const toggleEvent = (eventId: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(eventId)) next.delete(eventId);
			else next.add(eventId);
			return next;
		});
	};

	const getDraft = (eventId: string) => drafts[eventId] ?? { command: "", timeout: "600" };

	const setDraft = (eventId: string, patch: Partial<{ command: string; timeout: string }>) => {
		setDrafts((prev) => ({ ...prev, [eventId]: { ...getDraft(eventId), ...patch } }));
	};

	const addHandler = (eventId: HookEventName) => {
		const draft = getDraft(eventId);
		const command = draft.command.trim();
		if (!command) {
			setError(t("hooks.commandRequired"));
			return;
		}
		const timeout = Number(draft.timeout);
		if (!Number.isInteger(timeout) || timeout < 1) {
			setError(t("hooks.timeoutInvalid"));
			return;
		}
		const handler: CommandHook = { type: "command", command, timeout };
		setConfig((prev) => {
			const groups = [...(prev.hooks[eventId] ?? [])] as MatcherGroup[];
			if (groups.length === 0) groups.push({ hooks: [handler] });
			else groups[0] = { ...groups[0], hooks: [...(groups[0].hooks ?? []), handler] };
			return { ...prev, hooks: { ...prev.hooks, [eventId]: groups } };
		});
		setDraft(eventId, { command: "", timeout: "600" });
		setDirty(true);
		setError(null);
	};

	const removeHandler = (eventId: HookEventName, groupIndex: number, hookIndex: number) => {
		setConfig((prev) => {
			const groups = [...(prev.hooks[eventId] ?? [])] as MatcherGroup[];
			const group = groups[groupIndex];
			if (!group) return prev;
			const hooks = [...(group.hooks ?? [])];
			hooks.splice(hookIndex, 1);
			if (hooks.length === 0) groups.splice(groupIndex, 1);
			else groups[groupIndex] = { ...group, hooks };
			const nextHooks = { ...prev.hooks };
			if (groups.length === 0) delete nextHooks[eventId];
			else nextHooks[eventId] = groups;
			return { ...prev, hooks: nextHooks };
		});
		setDirty(true);
	};

	const save = async () => {
		if (!props.workspacePath) return;
		setSaving(true);
		setError(null);
		try {
			const result = await getConfigApi().saveHooks({
				workspacePath: props.workspacePath,
				configRaw: JSON.stringify(config, null, 2),
			});
			if (!result.valid) {
				setError(result.error ?? t("hooks.saveFailed"));
				return;
			}
			showNotice(t("hooks.saved"), 1600);
			setDirty(false);
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
					<Button variant="primary" onClick={() => void save()} loading={saving} disabled={loading || !dirty}>
						{t("common.save")}
					</Button>
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}

			{snapshot ? (
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
					</div>
				</div>
			) : null}

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : (
				<div className="hooks-event-panel">
					<div className="hooks-event-header">
						<Zap size={16} aria-hidden="true" />
						<strong>{t("hooks.eventPanel")}</strong>
						<span>{t("hooks.flowHint")}</span>
					</div>
					<div className="hooks-event-list">
						{HOOK_EVENTS.map((event) => {
							const count = handlerCounts.get(event.id) ?? 0;
							const isExpanded = expanded.has(event.id);
							const groups = (config.hooks[event.id] ?? []) as MatcherGroup[];
							const draft = getDraft(event.id);
							return (
								<div key={event.id} className="hooks-event-item">
									<button type="button" className="hooks-event-toggle" onClick={() => toggleEvent(event.id)}>
										{isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
										<code className="hooks-event-name">{event.id}</code>
										{count > 0 ? <span className="hooks-event-count">{count}</span> : null}
									</button>
									{isExpanded ? (
										<div className="hooks-event-details">
											<p className="hooks-event-description">{t(event.descriptionKey)}</p>
											{groups.map((group, groupIndex) =>
												(group.hooks ?? []).map((hook, hookIndex) => (
													<div key={`${event.id}-${groupIndex}-${hookIndex}`} className="hooks-handler-row">
														<div>
															<code>{hook.command || t("hooks.emptyCommand")}</code>
															<small>{t("hooks.timeoutSeconds", { seconds: hook.timeout })}</small>
														</div>
														<IconButton
															label={t("common.delete")}
															onClick={() => removeHandler(event.id, groupIndex, hookIndex)}
														>
															<Trash2 size={14} aria-hidden="true" />
														</IconButton>
													</div>
												)),
											)}
											<div className="hooks-add-form">
												<TextField
													label={t("hooks.commandLabel")}
													value={draft.command}
													onChange={(value) => setDraft(event.id, { command: value })}
													placeholder={t("hooks.commandPlaceholder")}
												/>
												<TextField
													label={t("hooks.timeoutLabel")}
													value={draft.timeout}
													onChange={(value) => setDraft(event.id, { timeout: value })}
													type="number"
													min={1}
												/>
												<Button variant="secondary" buttonSize="sm" onClick={() => addHandler(event.id)}>
													<Plus size={14} aria-hidden="true" />
													{t("hooks.addHandler")}
												</Button>
											</div>
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
