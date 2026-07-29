import { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import type {
	CompactionConfigPatch,
	CompactionConfigScope,
	CompactionConfigSnapshot,
	Project,
} from "../../../../shared/types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { SelectField } from "../ui/SelectField";
import { TextField } from "../ui/TextField";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";

const DEFAULT_VALUES: Required<Pick<CompactionConfigPatch, "enabled" | "reserveTokens" | "keepRecentTokens">> & { model: string; soft: { enabled: boolean } } = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
	model: "",
	soft: { enabled: true },
};

type Draft = {
	enabled: boolean;
	reserveTokens: string;
	keepRecentTokens: string;
	model: string;
	softEnabled: boolean;
};

function toDraft(config: CompactionConfigPatch): Draft {
	return {
		enabled: config.enabled ?? DEFAULT_VALUES.enabled,
		reserveTokens: String(config.reserveTokens ?? DEFAULT_VALUES.reserveTokens),
		keepRecentTokens: String(config.keepRecentTokens ?? DEFAULT_VALUES.keepRecentTokens),
		model: config.model ?? DEFAULT_VALUES.model,
		softEnabled: config.soft?.enabled ?? DEFAULT_VALUES.soft.enabled,
	};
}

function draftToConfig(draft: Draft): CompactionConfigPatch {
	return {
		enabled: draft.enabled,
		reserveTokens: Number(draft.reserveTokens),
		keepRecentTokens: Number(draft.keepRecentTokens),
		...(draft.model.trim() ? { model: draft.model.trim() } : {}),
		soft: { enabled: draft.softEnabled },
	};
}

function validateDraft(draft: Draft) {
	const reserveTokens = Number(draft.reserveTokens);
	const keepRecentTokens = Number(draft.keepRecentTokens);
	if (!Number.isFinite(reserveTokens) || reserveTokens < 1024) {
		return t("compactionSettings.validation.reserveTokens");
	}
	if (!Number.isFinite(keepRecentTokens) || keepRecentTokens < 1024) {
		return t("compactionSettings.validation.keepRecentTokens");
	}
	return undefined;
}

export function CompactionSettingsModal(props: {
	open: boolean;
	onClose: () => void;
	project?: Project;
}) {
	const [scope, setScope] = useState<CompactionConfigScope>("workspace");
	const [snapshot, setSnapshot] = useState<CompactionConfigSnapshot | null>(null);
	const [draft, setDraft] = useState<Draft>(() => toDraft(DEFAULT_VALUES));
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const workspacePath = props.project?.kind ? undefined : props.project?.path;
	const scopeOptions = useMemo(() => [
		{
			value: "workspace",
			label: t("compactionSettings.scope.workspace"),
			disabled: !workspacePath,
		},
		{ value: "global", label: t("compactionSettings.scope.global") },
	], [workspacePath]);

	useEffect(() => {
		if (!props.open) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		window.piDesktop.config.getCompaction(workspacePath)
			.then((result) => {
				if (cancelled) return;
				setSnapshot(result);
				const nextScope: CompactionConfigScope = workspacePath ? "workspace" : "global";
				setScope(nextScope);
				setDraft(toDraft(nextScope === "workspace" ? (result.workspace?.parsed ?? result.effective) : result.global.parsed));
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => { cancelled = true; };
	}, [props.open, workspacePath]);

	function handleScopeChange(value: string) {
		const nextScope = value as CompactionConfigScope;
		setScope(nextScope);
		if (!snapshot) return;
		setDraft(toDraft(nextScope === "workspace" ? (snapshot.workspace?.parsed ?? snapshot.effective) : snapshot.global.parsed));
	}

	async function handleSave() {
		const validation = validateDraft(draft);
		if (validation) {
			setError(validation);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const result = await window.piDesktop.config.saveCompaction({
				scope,
				...(scope === "workspace" ? { workspacePath } : {}),
				config: draftToConfig(draft),
			});
			if (!result.valid) throw new Error(result.error ?? t("config.saveFailed"));
			showNotice(t("compactionSettings.saved"));
			props.onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Modal
			open={props.open}
			onClose={props.onClose}
			title={t("compactionSettings.title")}
			size="medium"
			contentClassName="compaction-settings-modal"
		>
			<div className="compaction-settings-header">
				<Settings2 size={18} aria-hidden="true" />
				<p>{t("compactionSettings.description")}</p>
			</div>
			{error && <div className="config-error">{error}</div>}
			{loading ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : (
				<div className="compaction-settings-form">
					<SelectField
						label={t("compactionSettings.scope")}
						value={scope}
						options={scopeOptions}
						onChange={handleScopeChange}
						description={scope === "workspace" ? snapshot?.workspace?.path : snapshot?.global.path}
					/>
					<SelectField
						label={t("compactionSettings.enabled")}
						value={draft.enabled ? "true" : "false"}
						options={[
							{ value: "true", label: t("common.enabled") },
							{ value: "false", label: t("common.disabled") },
						]}
						onChange={(value) => setDraft((current) => ({ ...current, enabled: value === "true" }))}
					/>
					<TextField
						label={t("compactionSettings.reserveTokens")}
						type="number"
						min={1024}
						value={draft.reserveTokens}
						onChange={(value) => setDraft((current) => ({ ...current, reserveTokens: value }))}
						description={t("compactionSettings.reserveTokensDesc")}
					/>
					<TextField
						label={t("compactionSettings.keepRecentTokens")}
						type="number"
						min={1024}
						value={draft.keepRecentTokens}
						onChange={(value) => setDraft((current) => ({ ...current, keepRecentTokens: value }))}
						description={t("compactionSettings.keepRecentTokensDesc")}
					/>
					<TextField
						label={t("compactionSettings.model")}
						value={draft.model}
						onChange={(value) => setDraft((current) => ({ ...current, model: value }))}
						placeholder="provider/model"
						description={t("compactionSettings.modelDesc")}
					/>
					<SelectField
						label={t("compactionSettings.softEnabled")}
						value={draft.softEnabled ? "true" : "false"}
						options={[
							{ value: "true", label: t("common.enabled") },
							{ value: "false", label: t("common.disabled") },
						]}
						onChange={(value) => setDraft((current) => ({ ...current, softEnabled: value === "true" }))}
						description={t("compactionSettings.softEnabledDesc")}
					/>
				</div>
			)}
			<div className="config-modal-actions">
				<Button variant="secondary" onClick={props.onClose}>{t("common.cancel")}</Button>
				<Button variant="primary" loading={saving} disabled={loading} onClick={handleSave}>{t("common.save")}</Button>
			</div>
		</Modal>
	);
}
