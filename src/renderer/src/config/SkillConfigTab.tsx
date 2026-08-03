import { useEffect, useMemo, useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import type { SkillConfigSnapshot } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { LazyMonacoEditor } from "../components/ui/LazyMonacoEditor";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import { ConfigEntryList, type ConfigEntryListItem } from "./ConfigEntryList";

type Scope = "global" | "workspace";

type SkillConfigApi = {
	getSkillConfig: (workspacePath?: string) => Promise<SkillConfigSnapshot>;
	saveSkillConfig: (request: { scope: Scope; workspacePath?: string; raw: string }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): SkillConfigApi {
	const api = (window as unknown as { piDesktop?: { config?: SkillConfigApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

function skillParamCount(snapshot: SkillConfigSnapshot | null) {
	if (!snapshot) return 0;
	return Object.values(snapshot.effective.skills).reduce((sum, skill) => sum + Object.keys(skill.params ?? {}).length, 0);
}

export function SkillConfigTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<SkillConfigSnapshot | null>(null);
	const [scope, setScope] = useState<Scope>("global");
	const [raw, setRaw] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedSource = useMemo(() => scope === "workspace" ? snapshot?.workspace : snapshot?.global, [scope, snapshot]);
	const selectedDiagnostic = selectedSource?.diagnostic;
	const entries = useMemo<ConfigEntryListItem[]>(() => {
		try {
			const parsed = JSON.parse(raw) as { skills?: Record<string, unknown> };
			const skills = parsed.skills && typeof parsed.skills === "object" ? parsed.skills : {};
			return Object.entries(skills).map(([id, value]) => ({
				id,
				label: id,
				summary: value && typeof value === "object" ? t("skillConfig.paramCount", { count: Object.keys((value as Record<string, unknown>).params ?? {}).length }) : t("config.entries.invalid"),
				invalid: !value || typeof value !== "object" || Array.isArray(value),
			}));
		} catch {
			return [];
		}
	}, [raw]);
	const updateSkills = (mutate: (skills: Record<string, unknown>) => void) => {
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const skills = parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills) ? { ...(parsed.skills as Record<string, unknown>) } : {};
			mutate(skills);
			setRaw(JSON.stringify({ ...parsed, skills }, null, 2));
		} catch {
			setError(t("skillConfig.invalidJson"));
		}
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getSkillConfig(props.workspacePath);
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
		setRaw(source?.raw ?? JSON.stringify({ version: "1.0.0", skills: {}, groups: {}, limits: { maxFileBytes: 131072, maxTotalBytes: 524288 } }, null, 2));
		setError(null);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			JSON.parse(raw);
			const result = await getConfigApi().saveSkillConfig({ scope, workspacePath: props.workspacePath, raw });
			if (!result.valid) {
				setError(result.error ?? t("skillConfig.saveFailed"));
				return;
			}
			showNotice(t("skillConfig.saved"), 1600);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="skill-config-tab">
			<div className="config-toolbar skill-config-toolbar">
				<div>
					<strong>{t("skillConfig.title")}</strong>
					<p>{t("skillConfig.description")}</p>
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
			{selectedDiagnostic ? <div className="config-error">{selectedDiagnostic.message}</div> : null}

			<ConfigEntryList
				items={entries}
				onAdd={() => updateSkills((skills) => {
					let index = Object.keys(skills).length + 1;
					let name = `skill-${index}`;
					while (skills[name]) name = `skill-${++index}`;
					skills[name] = { enabled: true, params: {} };
				})}
				onDelete={(id) => updateSkills((skills) => { delete skills[id]; })}
			/>

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : snapshot ? (
				<>
					<div className="skill-config-summary">
						<div className="skill-config-card">
							<SlidersHorizontal size={18} aria-hidden="true" />
							<div>
								<strong>{t("skillConfig.effective")}</strong>
								<span>{t("skillConfig.skillCount", { count: Object.keys(snapshot.effective.skills).length })}</span>
								<span>{t("skillConfig.paramCount", { count: skillParamCount(snapshot) })}</span>
								<span>{t("skillConfig.groupCount", { count: Object.keys(snapshot.effective.groups).length })}</span>
							</div>
						</div>
						<div className="skill-config-card">
							<strong>{t("modelFailover.global")}</strong>
							<code title={snapshot.global.path}>{snapshot.global.path}</code>
							<span>{snapshot.global.exists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
						</div>
						{snapshot.workspace ? (
							<div className="skill-config-card">
								<strong>{t("modelFailover.project")}</strong>
								<code title={snapshot.workspace.path}>{snapshot.workspace.path}</code>
								<span>{snapshot.workspace.exists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
							</div>
						) : null}
					</div>

					<div className="skill-config-editor-card">
						<div className="skill-config-editor-header">
							<div className="mcp-scope-switch" role="group" aria-label={t("skillConfig.editScope")}>
								<Button buttonSize="sm" variant={scope === "global" ? "primary" : "secondary"} aria-pressed={scope === "global"} onClick={() => selectScope("global")}>{t("modelFailover.global")}</Button>
								<Button buttonSize="sm" variant={scope === "workspace" ? "primary" : "secondary"} aria-pressed={scope === "workspace"} onClick={() => selectScope("workspace")} disabled={!props.workspacePath}>{t("modelFailover.project")}</Button>
							</div>
							<code title={selectedSource?.path}>{selectedSource?.path}</code>
						</div>
						<div className="skill-config-monaco-wrap">
							<LazyMonacoEditor value={raw} language="json" height="100%" onChange={(value) => setRaw(value ?? "")} />
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
