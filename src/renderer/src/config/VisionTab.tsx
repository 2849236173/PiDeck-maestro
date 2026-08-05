import { Check, Eye, Settings2 } from "lucide-react";
import type { VisionConfig } from "./configTypes";
import { Button } from "../components/ui/Button";
import { SelectField } from "../components/ui/SelectField";
import { TextField } from "../components/ui/TextField";
import { t } from "../i18n";

const REASONING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export function VisionTab(props: {
	data: VisionConfig;
	saving: boolean;
	diagnostic: boolean;
	onChange: (data: VisionConfig) => void;
	onSave: () => void;
}) {
	const { data } = props;
	const providerModelMismatch = Boolean(data.provider) !== Boolean(data.model);

	function update<K extends keyof VisionConfig>(key: K, value: VisionConfig[K]) {
		props.onChange({ ...data, [key]: value });
	}

	function updateNumber<K extends "maxDimension" | "jpegQuality" | "cacheMaxEntries" | "retryAttempts" | "retryBackoffMs">(
		key: K,
		value: string,
	) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) update(key, parsed);
	}

	return (
		<div className="vision-tab">
			<div className="vision-header">
				<div>
					<h3>{t("vision.title")}</h3>
					<p>{t("vision.description")}</p>
				</div>
				<Button
					variant="primary"
					onClick={props.onSave}
					disabled={props.saving || props.diagnostic}
					loading={props.saving}
				>
					<Check size={16} aria-hidden="true" />
					{t("common.save")}
				</Button>
			</div>

			<div className="vision-config-grid">
				<section className="vision-config-section">
					<div className="vision-config-section-heading">
						<Eye size={18} aria-hidden="true" />
						<div>
							<strong>{t("vision.connectionTitle")}</strong>
							<span>{t("vision.connectionHint")}</span>
						</div>
					</div>
					<label className="setting-switch-row">
						<span>{t("vision.enabled")}</span>
						<input
							type="checkbox"
							checked={data.enabled}
							onChange={(event) => update("enabled", event.target.checked)}
						/>
					</label>
					<TextField
						label={t("vision.provider")}
						value={data.provider ?? ""}
						onChange={(value) => update("provider", value || undefined)}
						placeholder={t("vision.providerPlaceholder")}
					/>
					<TextField
						label={t("vision.model")}
						value={data.model ?? ""}
						onChange={(value) => update("model", value || undefined)}
						placeholder={t("vision.modelPlaceholder")}
					/>
					{providerModelMismatch && <div className="vision-config-warning">{t("vision.providerModelRequired")}</div>}
					<SelectField
						label={t("vision.reasoningEffort")}
						value={data.defaultReasoningEffort}
						onChange={(value) => update("defaultReasoningEffort", value as VisionConfig["defaultReasoningEffort"])}
						options={REASONING_OPTIONS.map((value) => ({ value, label: t(`vision.reasoning.${value}`) }))}
					/>
					<TextField
						label={t("vision.systemPrompt")}
						value={data.systemPrompt ?? ""}
						onChange={(value) => update("systemPrompt", value || undefined)}
						placeholder={t("vision.systemPromptPlaceholder")}
					/>
				</section>

				<section className="vision-config-section">
					<div className="vision-config-section-heading">
						<Settings2 size={18} aria-hidden="true" />
						<div>
							<strong>{t("vision.processingTitle")}</strong>
							<span>{t("vision.processingHint")}</span>
						</div>
					</div>
					<div className="vision-config-field-row">
						<TextField label={t("vision.maxDimension")} type="number" min={1} max={8000} value={String(data.maxDimension)} onChange={(value) => updateNumber("maxDimension", value)} />
						<TextField label={t("vision.jpegQuality")} type="number" min={1} max={100} value={String(data.jpegQuality)} onChange={(value) => updateNumber("jpegQuality", value)} />
					</div>
					<label className="setting-switch-row">
						<span>{t("vision.cacheEnabled")}</span>
						<input type="checkbox" checked={data.cacheEnabled} onChange={(event) => update("cacheEnabled", event.target.checked)} />
					</label>
					<label className="setting-switch-row">
						<span>{t("vision.cachePersist")}</span>
						<input type="checkbox" checked={data.cachePersist} onChange={(event) => update("cachePersist", event.target.checked)} />
					</label>
					<TextField label={t("vision.cacheMaxEntries")} type="number" min={1} max={100000} value={String(data.cacheMaxEntries)} onChange={(value) => updateNumber("cacheMaxEntries", value)} />
					<div className="vision-config-field-row">
						<TextField label={t("vision.retryAttempts")} type="number" min={0} max={10} value={String(data.retryAttempts)} onChange={(value) => updateNumber("retryAttempts", value)} />
						<TextField label={t("vision.retryBackoffMs")} type="number" min={0} max={60000} value={String(data.retryBackoffMs)} onChange={(value) => updateNumber("retryBackoffMs", value)} />
					</div>
					<TextField label={t("vision.fallbackProvider")} value={data.fallbackProvider ?? ""} onChange={(value) => update("fallbackProvider", value || undefined)} placeholder={t("vision.optionalPlaceholder")} />
					<TextField label={t("vision.fallbackModel")} value={data.fallbackModel ?? ""} onChange={(value) => update("fallbackModel", value || undefined)} placeholder={t("vision.optionalPlaceholder")} />
				</section>
			</div>
		</div>
	);
}
