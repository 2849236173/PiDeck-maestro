import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, FilePenLine, MessageCircle, X } from "lucide-react";
import type { PlanDraftSnapshot } from "../../../../shared/types";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";
import { Button } from "../ui/Button";
import { LazyMonacoEditor } from "../ui/LazyMonacoEditor";
import { Modal } from "../ui/Modal";

export type PlanConfirmAction =
	| { kind: "approve"; draft: PlanDraftSnapshot }
	| { kind: "reject"; reason: string; draft: PlanDraftSnapshot }
	| { kind: "discuss"; message: string; draft: PlanDraftSnapshot }
	| { kind: "change-request"; request: string; draft: PlanDraftSnapshot };

export function PlanConfirmModal(props: {
	agentId: string;
	open: boolean;
	onClose: () => void;
	onAction: (action: PlanConfirmAction) => Promise<void> | void;
}) {
	const [draft, setDraft] = useState<PlanDraftSnapshot | null>(null);
	const [markdown, setMarkdown] = useState("");
	const [mode, setMode] = useState<"preview" | "edit" | "reject" | "change-request" | "discuss">("preview");
	const [feedback, setFeedback] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [submitting, setSubmitting] = useState<PlanConfirmAction["kind"] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const feedbackRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		if (!props.open) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		setSubmitting(null);
		setMode("preview");
		setFeedback("");
		void window.piDesktop.agents.getPlanDraft(props.agentId)
			.then((snapshot) => {
				if (cancelled) return;
				setDraft(snapshot);
				setMarkdown(snapshot.markdown);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => { cancelled = true; };
	}, [props.agentId, props.open]);

	useEffect(() => {
		if (mode === "reject" || mode === "change-request" || mode === "discuss") {
			feedbackRef.current?.focus();
		}
	}, [mode]);

	const title = useMemo(() => {
		if (!draft) return t("planConfirm.title");
		return `${t("planConfirm.title")} · r${draft.revision}`;
	}, [draft]);

	const saveDraft = async () => {
		if (!draft) return null;
		setSaving(true);
		setError(null);
		try {
			const saved = await window.piDesktop.agents.savePlanDraft({
				agentId: props.agentId,
				markdown,
				expectedRevision: draft.revision,
			});
			setDraft(saved);
			setMarkdown(saved.markdown);
			setMode("preview");
			showNotice(t("planConfirm.saved"), 1600);
			return saved;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return null;
		} finally {
			setSaving(false);
		}
	};

	const currentDraft = draft ? { ...draft, markdown } : null;
	const draftDirty = Boolean(draft && markdown !== draft.markdown);

	const submitAction = async (action: PlanConfirmAction) => {
		if (submitting || loading) return;
		setSubmitting(action.kind);
		setError(null);
		try {
			await props.onAction(action);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(null);
		}
	};

	const handleApprove = async () => {
		if (!currentDraft) return;
		await submitAction({ kind: "approve", draft: currentDraft });
	};

	// 键盘快捷键：Ctrl+Enter 批准，Ctrl+E 编辑，Esc 关闭
	useEffect(() => {
		if (!props.open || mode !== "preview" || loading || submitting) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
				props.onClose();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				void handleApprove();
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
				e.preventDefault();
				setMode("edit");
				setError(null);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [props.open, mode, loading, submitting, currentDraft]);

	return (
		<Modal open={props.open} onClose={props.onClose} title={title} size="full" contentClassName="plan-confirm-modal">
			<div className="plan-confirm-shell">
				<div className="plan-confirm-meta">
					<span>{draft ? draft.status : t("planConfirm.loadingStatus")}</span>
					{draft?.revision !== undefined ? <span>r{draft.revision}</span> : null}
					{draft?.approvedAt ? <span>{t("planConfirm.approved")}</span> : null}
					{draft?.handoffKey ? <code title={draft.handoffKey}>{draft.handoffKey.slice(0, 12)}</code> : null}
					{draft?.path ? <code title={draft.path}>{draft.path}</code> : null}
				</div>

				{error ? <div className="config-error plan-confirm-error">{error}</div> : null}

				{loading ? (
					<div className="config-loading">{t("planConfirm.loading")}</div>
				) : mode === "edit" ? (
					<div className="plan-confirm-editor">
						<LazyMonacoEditor
							value={markdown}
							language="markdown"
							height="100%"
							onChange={(value) => setMarkdown(value ?? "")}
						/>
					</div>
				) : mode === "reject" || mode === "change-request" || mode === "discuss" ? (
					<div className="plan-confirm-feedback">
						<label>
							<span>{mode === "reject" ? t("planConfirm.rejectReason") : mode === "discuss" ? t("planConfirm.discussTopic") : t("planConfirm.changeRequest")}</span>
							<textarea
								ref={feedbackRef}
								value={feedback}
								placeholder={mode === "reject" ? t("planConfirm.rejectPlaceholder") : mode === "discuss" ? t("planConfirm.discussPlaceholder") : t("planConfirm.changePlaceholder")}
								onChange={(event) => setFeedback(event.target.value)}
							/>
						</label>
					</div>
				) : markdown.trim() ? (
					<div className="plan-confirm-preview markdown-body">
						<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
					</div>
				) : (
					<div className="config-empty">{t("planConfirm.empty")}</div>
				)}

				<div className="plan-confirm-actions">
					{mode === "preview" && (
						<>
							<div className="plan-confirm-keyboard-hint">
								<span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> {t("planConfirm.keyboardHint.approve")}</span>
								<span><kbd>Esc</kbd> {t("planConfirm.keyboardHint.close")}</span>
								<span><kbd>Ctrl</kbd>+<kbd>E</kbd> {t("planConfirm.keyboardHint.edit")}</span>
							</div>
							<Button variant="danger" onClick={() => setMode("reject")} disabled={!draft || loading || Boolean(submitting)}>
								<X size={15} aria-hidden="true" /> {t("planConfirm.reject")}
							</Button>
							<Button variant="secondary" onClick={() => setMode("change-request")} disabled={!draft || loading || Boolean(submitting)}>
								<FilePenLine size={15} aria-hidden="true" /> {t("planConfirm.requestChange")}
							</Button>
							<Button variant="secondary" onClick={() => setMode("discuss")} disabled={!draft || loading || Boolean(submitting)}>
								<MessageCircle size={15} aria-hidden="true" /> {t("planConfirm.discuss")}
							</Button>
							<Button
								variant="ghost"
								onClick={() => {
									setMode("edit");
									setError(null);
								}}
								disabled={!draft || loading || Boolean(submitting)}
							>
								{t("planConfirm.editMarkdown")}
							</Button>
							<Button
								variant="ghost"
								onClick={props.onClose}
								disabled={loading || Boolean(submitting)}
							>
								{t("common.close")}
							</Button>
							<Button
								variant="primary"
								loading={submitting === "approve" || saving}
								disabled={!currentDraft || loading || saving || Boolean(submitting)}
								onClick={() => void handleApprove()}
							>
								<Check size={15} aria-hidden="true" /> {t("planConfirm.approve")}
							</Button>
						</>
					)}
					{mode === "edit" && (
						<>
							<Button
								variant="secondary"
								disabled={saving || Boolean(submitting)}
								onClick={() => {
									setMarkdown(draft?.markdown ?? "");
									setMode("preview");
								}}
							>
								{t("common.cancel")}
							</Button>
							<Button variant="primary" loading={saving} disabled={saving || Boolean(submitting)} onClick={() => void saveDraft()}>
								{t("common.save")}
							</Button>
						</>
					)}
					{(mode === "reject" || mode === "change-request" || mode === "discuss") && (
						<>
							<Button
								variant="secondary"
								disabled={Boolean(submitting)}
								onClick={() => {
									setMode("preview");
									setFeedback("");
								}}
							>
								{t("common.cancel")}
							</Button>
							<Button
								variant="primary"
								loading={submitting === mode}
								disabled={!currentDraft || feedback.trim().length === 0 || Boolean(submitting)}
								onClick={() => {
									if (!currentDraft) return;
									const payload = feedback.trim();
									const action = mode === "reject"
										? { kind: "reject" as const, reason: payload, draft: currentDraft }
										: mode === "discuss"
										? { kind: "discuss" as const, message: payload, draft: currentDraft }
										: { kind: "change-request" as const, request: payload, draft: currentDraft };
									void submitAction(action);
								}}
							>
								{mode === "reject" ? t("planConfirm.sendReason") : mode === "discuss" ? t("planConfirm.sendDiscuss") : t("planConfirm.sendChangeRequest")}
							</Button>
						</>
					)}
				</div>
			</div>
		</Modal>
	);
}
