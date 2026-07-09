import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import { Pencil, Trash2 } from "lucide-react";
import type {
	CreatePiPromptTemplateInput,
	PiPromptTemplateListResult,
	PiPromptTemplateSummary,
} from "../../../shared/types";
import { t } from "../i18n";
import { CloseIconButton } from "../components/ui/IconButton";
import { setupMonaco } from "../utils/monacoSetup";

/** 只初始化一次 Monaco loader */
let monacoSetupOnce = false;
function ensureMonaco() {
	if (monacoSetupOnce) return;
	monacoSetupOnce = true;
	setupMonaco();
}

const DEFAULT_EDITOR_OPTIONS = {
	minimap: { enabled: false },
	lineNumbers: "on" as const,
	folding: true,
	fontSize: 13,
	padding: { top: 10, bottom: 10 },
	scrollBeyondLastLine: false,
	wordWrap: "on" as const,
	tabSize: 2,
	insertSpaces: true,
};

/** 根据 html[data-theme] 返回 Monaco 主题 */
function editorTheme(): "vs-dark" | "vs" {
	return document.documentElement.getAttribute("data-theme") === "dark" ? "vs-dark" : "vs";
}

export function PromptsTab(props: {
	data: PiPromptTemplateListResult;
	loading: boolean;
	creating: boolean;
	newName: string;
	newDescription: string;
	/** 当前正在编辑的模板，null 表示未打开编辑器 */
	editingTemplate: PiPromptTemplateSummary | null;
	/** 编辑器内容 */
	editContent: string;
	/** 编辑器是否正在加载 */
	editLoading: boolean;
	/** 编辑器是否正在保存 */
	editSaving: boolean;
	onRefresh: () => void;
	onOpenRoot: () => void;
	onChangeNewName: (value: string) => void;
	onChangeNewDescription: (value: string) => void;
	onCreate: () => void;
	onDelete: (template: PiPromptTemplateSummary) => void;
	onEdit: (template: PiPromptTemplateSummary) => void;
	onCancelEdit: () => void;
	onQuickSave: () => void;
	onChangeEditContent: (value: string) => void;
	onSaveEdit: () => void;
}) {
	const { data } = props;
	ensureMonaco();
	const canCreate = props.newName.trim().length > 0 && props.newDescription.trim().length > 0;

	// 编辑器提示状态
	const [showHint, setShowHint] = useState(false);
	const [savedHint, setSavedHint] = useState(false);
	const prevSaving = useRef(props.editSaving);

	// 当编辑器打开时，显示快捷键提示
	useEffect(() => {
		if (props.editingTemplate) {
			setShowHint(true);
			setSavedHint(false);
			const timer = setTimeout(() => setShowHint(false), 3000);
			return () => clearTimeout(timer);
		}
	}, [props.editingTemplate]);

	// 保存完成后显示临时 "已保存" 提示
	useEffect(() => {
		if (prevSaving.current && !props.editSaving) {
			setSavedHint(true);
			const timer = setTimeout(() => setSavedHint(false), 2000);
			return () => clearTimeout(timer);
		}
		prevSaving.current = props.editSaving;
	});

	// Ctrl+S / Cmd+S 快捷键保存
	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "s") {
			e.preventDefault();
			if (props.editingTemplate && !props.editSaving) {
				props.onQuickSave();
			}
		}
	}, [props.editingTemplate, props.editSaving, props.onQuickSave]);

	useEffect(() => {
		if (props.editingTemplate) {
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}
	}, [props.editingTemplate, handleKeyDown]);

	return (
		<div className="prompts-tab">
			<div className="config-toolbar">
				<div>
					<span className="config-count">
						{t("config.count.prompts", { count: data.templates.length })}
					</span>
					<small className="prompts-restart-hint">{t("config.restartHint")}</small>
				</div>
				<div className="prompts-toolbar-actions">
					<button
						className="config-btn"
						onClick={props.onRefresh}
						disabled={props.loading}
					>
						{t("common.refresh")}
					</button>
					<button className="config-btn blue" onClick={props.onOpenRoot}>
						{t("config.openFolder")}
					</button>
				</div>
			</div>

			<section className="prompt-create-card">
				<strong>{t("config.createPrompt")}</strong>
				<label className="prompt-create-label">
					<span>{t("config.name")}</span>
					<input
						value={props.newName}
						placeholder={t("config.promptNamePlaceholder")}
						onChange={(e) => props.onChangeNewName(e.target.value)}
					/>
				</label>
				<label className="prompt-create-label">
					<span>{t("config.description")}</span>
					<textarea
						className="prompt-create-textarea"
						value={props.newDescription}
						placeholder={t("config.promptDescriptionPlaceholder")}
						onChange={(e) => props.onChangeNewDescription(e.target.value)}
						rows={3}
					/>
				</label>
				<button
					className="config-btn primary"
					disabled={!canCreate || props.creating}
					onClick={props.onCreate}
				>
					{props.loading || props.creating ? t("common.loading") : t("config.create")}
				</button>
			</section>

			<section className="prompts-list">
				{data.templates.length === 0 ? (
					<div className="config-empty">{t("config.noPrompts")}</div>
				) : (
					data.templates.map((template) => (
						<div key={template.path} className="prompts-list-item">
							<button
								type="button"
								className="prompts-list-item-info"
								onClick={() => props.onEdit(template)}
								title={t("common.edit")}
							>
								<strong>/{template.name}</strong>
								<span className="prompts-list-item-desc">{template.description}</span>
							</button>
							<div className="prompts-list-item-actions">
								<button
									className="config-icon-btn"
									onClick={() => props.onEdit(template)}
									title={t("common.edit")}
								>
									<Pencil size={14} strokeWidth={1.8} />
								</button>
								<button
									className="config-icon-btn danger"
									onClick={() => props.onDelete(template)}
									title={t("common.delete")}
								>
									<Trash2 size={14} strokeWidth={1.8} />
								</button>
							</div>
						</div>
					))
				)}
			</section>

			{/* 编辑弹框 */}
			{props.editingTemplate && (
				<div
					className="prompts-editor-backdrop"
					onClick={props.onCancelEdit}
				>
					<div
						className="prompts-editor-modal"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="file-diff-header">
							<span className="file-diff-header-file">
								{props.editingTemplate.name}.md
								{showHint && <span className="file-diff-hint">{t("config.promptSaveHint")}</span>}
								{savedHint && <span className="file-diff-hint saved">{t("config.promptSavedHint")}</span>}
							</span>
							<div className="file-diff-header-actions">
								<CloseIconButton
									label={t("common.close")}
									onClick={props.onCancelEdit}
								/>
							</div>
						</div>
						{props.editLoading ? (
							<div className="config-empty">{t("common.loading")}</div>
						) : (
							<div className="prompts-monaco-wrap">
								<Editor
									height="100%"
									defaultLanguage="markdown"
									value={props.editContent}
									theme={editorTheme()}
									onChange={(val) => props.onChangeEditContent(val ?? "")}
									options={{
										...DEFAULT_EDITOR_OPTIONS,
										readOnly: false,
									}}
								/>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
