import { useMemo, useState } from "react";
import { Copy, Eye, Pencil, Plus, Rocket, Check } from "lucide-react";
import type { ModelsFile, SettingsFile } from "./configTypes";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

/**
 * Vision 配置面板。
 *
 * 重要约束：flow 0.14 实际上没有 vision.json 这个持久化文件，视觉模型选择由
 * `/vision` session 命令内嵌的 UI 交互决定（pi-mono RPC 模式不支持 ui.custom，
 * 但 select / input 是支持的，所以 /vision 命令本身在 PiDeck 桌面下理论可工作）。
 *
 * 此面板不能假装"保存 vision 配置"——它做的是：
 * 1. 引导用户在当前会话里执行 /vision 命令（复制按钮 + 一键插入）。
 * 2. 聚合当前 settings.json / models.json 中的候选图像模型，方便用户对照选择。
 * 3. 显示当前默认 Provider/Model，作为视觉模型的默认 fallback。
 *
 * B1(5) ui.custom 兼容性问题见 .workflow/issues/issues.jsonl；此处不持久化。
 */
export function VisionTab(props: {
	data: SettingsFile;
	modelsData: ModelsFile;
	/** 把字符串插入到当前活跃 agent 的输入框（用于一键发送 /vision 命令） */
	onInsertPrompt?: (text: string) => void;
}) {
	const defaultProvider = typeof props.data["defaultProvider"] === "string" ? props.data["defaultProvider"] : "";
	const defaultModel = typeof props.data["defaultModel"] === "string" ? props.data["defaultModel"] : "";

	// 聚合所有支持 image 输入的模型（input 含 "image"），按供应商分组。
	const imageCandidates = useMemo(() => {
		const out: Array<{ provider: string; id: string; name?: string }> = [];
		for (const [provider, cfg] of Object.entries(props.modelsData.providers ?? {})) {
			for (const model of cfg.models ?? []) {
				if (Array.isArray(model.input) && model.input.includes("image")) {
					out.push({ provider, id: model.id, name: model.name });
				}
			}
		}
		return out;
	}, [props.modelsData]);

	// 给候选列表一个轻量过滤输入。
	const [filter, setFilter] = useState("");
	const normalizedFilter = filter.trim().toLowerCase();
	const filtered = normalizedFilter
		? imageCandidates.filter((c) =>
			[c.id, c.name, c.provider, `${c.provider}/${c.id}`]
				.filter(Boolean)
				.some((v) => v!.toLowerCase().includes(normalizedFilter)),
		)
		: imageCandidates;

	const [draft, setDraft] = useState("");
	const sendDraft = () => {
		const text = draft.trim();
		if (!text || !props.onInsertPrompt) return;
		props.onInsertPrompt(text);
		setDraft("");
		showNotice(t("vision.inserted"), 1500);
	};

	const copyVisionCommand = (suffix?: string) => {
		const cmd = suffix ? `/vision ${suffix}` : "/vision";
		void navigator.clipboard.writeText(cmd);
		showNotice(t("vision.copied"), 1500);
	};

	// 点击候选模型 → 直接发送到会话并执行
	const handleSelectAndSend = (provider: string, modelId: string) => {
		if (!props.onInsertPrompt) return;
		const cmd = `/vision ${provider}/${modelId}`;
		props.onInsertPrompt(cmd);
		showNotice(t("vision.modelSent"), 1500);
	};

	// 点击候选模型 → 追加到命令草稿
	const handleAppendDraft = (provider: string, modelId: string) => {
		setDraft((prev) => (prev.trim() ? `${prev.trim()} ${provider}/${modelId}` : `${provider}/${modelId}`));
	};

	// 当前选中的模型（用于高亮）
	const selectedModel = draft.match(/\/vision\s+(\S+\/\S+)/)?.[1] ?? "";

	return (
		<div className="vision-tab">
			<div className="vision-header">
				<div>
					<h3>{t("vision.title")}</h3>
					<p>{t("vision.description")}</p>
				</div>
				<Button variant="secondary" buttonSize="sm" onClick={() => copyVisionCommand()}>
					<Copy size={14} aria-hidden="true" />
					{t("vision.copyCommand")}
				</Button>
			</div>

			<div className="vision-summary">
				<div className="vision-card">
					<Eye size={18} aria-hidden="true" />
					<div>
						<strong>{t("vision.defaultFallback")}</strong>
						<span>
							{defaultProvider || t("vision.unsetProvider")}
							{defaultModel ? ` / ${defaultModel}` : ""}
						</span>
						<small>{t("vision.defaultFallbackHint")}</small>
					</div>
				</div>
				<div className="vision-card">
					<Rocket size={18} aria-hidden="true" />
					<div>
						<strong>{t("vision.runInline")}</strong>
						<span>{t("vision.runInlineHint")}</span>
						<small>{t("vision.runInlineNote")}</small>
					</div>
				</div>
			</div>

			<div className="vision-command-row">
				<TextField
					label={t("vision.insertLabel")}
					value={draft}
					onChange={setDraft}
					placeholder={t("vision.insertPlaceholder")}
				/>
				<Button
					variant="primary"
					onClick={sendDraft}
					disabled={!draft.trim() || !props.onInsertPrompt}
				>
					<Rocket size={14} aria-hidden="true" />
					{t("vision.sendAndExecute")}
				</Button>
			</div>

			<div className="vision-candidates">
				<div className="vision-candidates-header">
					<div className="vision-candidates-title">
						<strong>{t("vision.candidates")}</strong>
						<span className="vision-candidates-count">
							{filtered.length} / {imageCandidates.length}
						</span>
					</div>
					<input
						className="config-settings-input vision-candidates-filter"
						type="text"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder={t("vision.candidatesFilter")}
					/>
				</div>
				<p className="vision-candidates-hint">{t("vision.selectHint")}</p>
				{filtered.length === 0 ? (
					<div className="config-empty">{t("vision.noImageModel")}</div>
				) : (
					<ul className="vision-candidates-list">
						{filtered.map((c) => {
							const modelKey = `${c.provider}/${c.id}`;
							const isSelected = selectedModel === modelKey;
							return (
								<li
									key={modelKey}
									className={`vision-candidates-item${isSelected ? " selected" : ""}`}
									onClick={() => handleSelectAndSend(c.provider, c.id)}
								>
									<div className="vision-candidates-info">
										<span className="vision-candidates-name">{c.name ?? c.id}</span>
										<code className="vision-candidates-provider">{modelKey}</code>
									</div>
									<div className="vision-candidates-actions">
										<IconButton
											label={t("vision.sendToSession")}
											onClick={(e) => {
												e.stopPropagation();
												handleSelectAndSend(c.provider, c.id);
											}}
										>
											<Rocket size={14} />
										</IconButton>
										<IconButton
											label={t("vision.appendDraft")}
											onClick={(e) => {
												e.stopPropagation();
												handleAppendDraft(c.provider, c.id);
											}}
										>
											<Plus size={14} />
										</IconButton>
										{isSelected && (
											<span className="vision-candidates-selected-badge">
												<Check size={12} aria-hidden="true" />
											</span>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
