import { Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { t } from "../i18n";

export type ConfigEntryListItem = {
	id: string;
	label: string;
	summary?: string;
	invalid?: boolean;
};

export function ConfigEntryList(props: {
	items: ConfigEntryListItem[];
	onAdd: () => void;
	onDelete: (id: string) => void;
	onSelect?: (id: string) => void;
	selectedId?: string;
}) {
	return (
		<section className="config-entry-list" aria-label={t("config.entries.title")}>
			<div className="config-entry-list-header">
				<strong>{t("config.entries.title")}</strong>
				<Button buttonSize="sm" variant="secondary" onClick={props.onAdd}>
					<Plus size={14} aria-hidden="true" /> {t("config.entries.add")}
				</Button>
			</div>
			{props.items.length === 0 ? (
				<div className="config-empty-sm">{t("config.entries.empty")}</div>
			) : (
				<div className="config-entry-list-items">
					{props.items.map((item) => (
						<div
							key={item.id}
							className={`config-entry-row${props.selectedId === item.id ? " selected" : ""}${item.invalid ? " invalid" : ""}`}
							role={props.onSelect ? "button" : undefined}
							tabIndex={props.onSelect ? 0 : undefined}
							onClick={() => props.onSelect?.(item.id)}
							onKeyDown={(event) => {
								if (props.onSelect && (event.key === "Enter" || event.key === " ")) {
									event.preventDefault();
									props.onSelect(item.id);
								}
							}}
						>
							<div className="config-entry-row-copy">
								<strong>{item.label}</strong>
								{item.summary ? <span>{item.summary}</span> : null}
								{item.invalid ? <small className="config-error">{t("config.entries.invalid")}</small> : null}
							</div>
							<IconButton
								label={t("config.entries.delete")}
								onClick={(event) => {
									event.stopPropagation();
									props.onDelete(item.id);
								}}
							>
								<Trash2 size={14} aria-hidden="true" />
							</IconButton>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
