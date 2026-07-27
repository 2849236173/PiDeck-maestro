import { useState, useEffect } from "react";
import { Check, Info } from "lucide-react";
import { t } from "../i18n";
import { ConfigSelect } from "./ConfigShared";
import { TextField } from "../components/ui/TextField";
import { Button } from "../components/ui/Button";
import type { MaestroCliToolsFile } from "./configTypes";
import type { PiDesktopApi } from "../../../preload";
import { showNotice } from "../utils/notice";

const api: PiDesktopApi = (window as unknown as { piDesktop: PiDesktopApi }).piDesktop;

export function MaestroTab({
	models,
	onSave,
}: {
	models: { providers: Record<string, any> };
	onSave: () => void;
}) {
	const [config, setConfig] = useState<MaestroCliToolsFile>({ tools: {}, roles: {} });
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		api.config.getMaestroCliTools().then((res) => {
			if (res.parsed) setConfig(res.parsed);
			setLoading(false);
		});
	}, []);

	// 将所有提供商的可用模型展开，方便用户选择
	const allModels = Object.values(models.providers || {}).flatMap(
		(p: any) => p.models || []
	);

	const handleToolChange = (toolKey: string, field: string, value: any) => {
		setConfig((prev) => {
			const next = { ...prev };
			next.tools = { ...next.tools };
			next.tools[toolKey] = { ...next.tools[toolKey], [field]: value };
			return next;
		});
	};

	const save = async () => {
		setSaving(true);
		try {
			const res = await api.config.saveMaestroCliTools(config);
			if (res.valid) {
				showNotice(t("common.save") + " OK" as any, 3000);
				onSave();
			} else {
				showNotice(res.error || (t("common.save") + " Error" as any), 3000);
			}
		} finally {
			setSaving(false);
		}
	};

	if (loading) return <div className="config-loading">{t("common.loading")}</div>;

	return (
		<div className="config-tab-content config-maestro-tab">
			<div className="config-header">
				<h3>Maestro Models</h3>
				<p>Configure which models the Pi-Maestro-Flow tools should use in the terminal.</p>
			</div>

			<div className="config-section">
				{Object.entries(config.tools || {}).map(([key, tool]) => (
					<div key={key} className="config-card">
						<div className="config-card-header">
							<div className="config-card-title">
								<span className="config-model-id">{key}</span>
								<label className="config-checkbox-label">
									<input
										type="checkbox"
										checked={tool.enabled !== false}
										onChange={(e) => handleToolChange(key, "enabled", e.target.checked)}
									/>
									Enabled
								</label>
							</div>
						</div>
						
						{tool.enabled !== false && (
							<div className="config-card-body">
								<div className="config-field">
									<label>Primary Model</label>
									<ConfigSelect
										value={tool.primaryModel || ""}
										onChange={(val) => handleToolChange(key, "primaryModel", val)}
										options={allModels.map((m) => ({
											value: m.id,
											label: m.name ? `${m.name} (${m.id})` : m.id,
										}))}
										placeholder="Select a model..."
									/>
								</div>
							</div>
						)}
					</div>
				))}
			</div>

			<div className="config-footer">
				<Button
					variant="primary"
					loading={saving}
					onClick={save}
				>
					<Check size={16} style={{ marginRight: 4 }} />
					{t("common.save")}
				</Button>
			</div>
		</div>
	);
}
