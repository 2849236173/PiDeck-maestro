import { t } from "../i18n";
import { Button } from "../components/ui/Button";
import { SelectField } from "../components/ui/SelectField";
import { LazyMonacoEditor } from "../components/ui/LazyMonacoEditor";

// ── Raw Tab ─────────────────────────────────────────────

const RAW_FILE_OPTIONS = [
	{ value: "models.json", label: "models.json" },
	{ value: "auth.json", label: "auth.json" },
	{ value: "settings.json", label: "settings.json" },
	{ value: "trust.json", label: "trust.json" },
	{ value: "api-manager.json", label: "api-manager.json" },
	{ value: "permissions.json", label: "permissions.json" },
	{ value: "vision.json", label: "vision.json" },
	{ value: "lsp.json", label: "lsp.json" },
];

export function RawTab(props: {
	fileName: string;
	content: string;
	saving: boolean;
	onChangeFileName: (name: string) => void;
	onChangeContent: (content: string) => void;
	onSave: () => void;
}) {
	return (
		<div className="config-raw-tab">
			<div className="config-toolbar">
				<SelectField
					label={t("config.openRawFile")}
					value={props.fileName}
					options={RAW_FILE_OPTIONS}
					onChange={props.onChangeFileName}
				/>
				<Button
					variant="primary"
					onClick={props.onSave}
					disabled={props.saving}
					loading={props.saving}
				>
					{t("common.save")}
				</Button>
			</div>
			<div className="config-raw-editor">
				<LazyMonacoEditor
					value={props.content}
					language="json"
					height="100%"
					onChange={(value) => props.onChangeContent(value ?? "")}
				/>
			</div>
		</div>
	);
}
