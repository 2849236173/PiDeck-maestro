import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { t } from "../i18n";

/**
 * trust.json 结构：{ "C:\\Users": true, "D:\\project": false }
 * true = 已信任，false = 显式不信任（忽略）
 */
export type TrustFile = Record<string, boolean>;

export function TrustTab(props: {
	data: TrustFile;
	saving: boolean;
	onChange: (data: TrustFile) => void;
	onSave: () => void;
}) {
	const [addPath, setAddPath] = useState("");
	const entries = Object.entries(props.data).sort(([left], [right]) => left.localeCompare(right));

	const addEntry = () => {
		// trust.json 由 pi 读取，保留用户输入的原生路径分隔符，仅去掉末尾多余斜杠。
		const path = addPath.trim().replace(/[\\/]+$/, "");
		if (!path) return;
		props.onChange({ ...props.data, [path]: true });
		setAddPath("");
	};

	const toggleEntry = (path: string, trusted: boolean) => {
		props.onChange({ ...props.data, [path]: trusted });
	};

	const removeEntry = (path: string) => {
		const next = { ...props.data };
		delete next[path];
		props.onChange(next);
	};

	return (
		<div className="config-trust-tab">
			<div className="config-toolbar">
				<div>
					<strong>{t("config.nav.trust")}</strong>
					<p>{t("config.trust.hint")}</p>
				</div>
				<Button
					variant="primary"
					onClick={props.onSave}
					disabled={props.saving}
				>
					{props.saving ? t("common.saving") : t("common.save")}
				</Button>
			</div>

			<div className="config-trust-add" style={{ display: "flex", gap: "8px", alignItems: "end", marginBottom: "16px" }}>
				<TextField
					label=""
					className="config-trust-input"
					value={addPath}
					onChange={(v) => setAddPath(v)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addEntry();
					}}
					placeholder={t("config.trust.addPlaceholder")}
				/>
				<Button
					variant="secondary"
					onClick={addEntry}
					disabled={!addPath.trim() || props.saving}
				>
					<Plus size={14} />
					{t("config.trust.add")}
				</Button>
			</div>

			{entries.length === 0 ? (
				<div className="config-trust-empty">
					<strong>{t("config.trust.emptyTitle")}</strong>
					<span>{t("config.trust.emptyDesc")}</span>
				</div>
			) : (
				<div className="config-trust-list">
					{entries.map(([path, trusted]) => (
						<div key={path} className="config-trust-row" data-trusted={trusted || undefined} style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
							<label className="setting-switch-row" style={{ flex: 1, padding: "8px 12px", margin: 0, borderRadius: "var(--radius-sm)" }}>
								<span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
									<span className="config-trust-path" title={path} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{path}
									</span>
									<span className="config-trust-status" style={{ fontSize: "var(--font-size-caption)", color: "var(--color-text-tertiary)" }}>
										{trusted ? t("config.trust.statusTrusted") : t("config.trust.statusIgnored")}
									</span>
								</span>
								<input
									type="checkbox"
									checked={trusted}
									onChange={(e) => toggleEntry(path, e.target.checked)}
								/>
							</label>
							<IconButton
								label={t("common.delete")}
								className="danger"
								onClick={() => removeEntry(path)}
								disabled={props.saving}
							>
								<Trash2 size={13} />
							</IconButton>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
