import { AlertTriangle, ArrowUpCircle, Check, Package } from "lucide-react";
import type { MaestroExtensionHealth } from "../../../../shared/types";
import { t } from "../../i18n";
import { Button } from "../ui/Button";
import { CloseIconButton } from "../ui/IconButton";

/**
 * 非模态健康提示：启动检查只给出可操作建议，不夺取焦点或阻断当前工作。
 */
export function MaestroHealthPrompt(props: {
	health: MaestroExtensionHealth;
	onClose: () => void;
	onOpenExtensions: () => void;
}) {
	const missing = props.health.packages.filter((pkg) => !pkg.installed);
	const flow = props.health.packages.find((pkg) => pkg.source === "npm:pi-maestro-flow");
	const isMissing = missing.length > 0;

	return (
		<aside className="maestro-health-prompt" role="status" aria-live="polite">
			<header className={`maestro-health-header ${isMissing ? "warning" : "update"}`}>
				{isMissing
					? <AlertTriangle size={20} strokeWidth={1.8} aria-hidden="true" />
					: <ArrowUpCircle size={20} strokeWidth={1.8} aria-hidden="true" />}
				<strong>
					{isMissing ? t("maestroHealth.missingTitle") : t("maestroHealth.updateTitle")}
				</strong>
				<CloseIconButton label={t("common.close")} onClick={props.onClose} />
			</header>

			<div className="maestro-health-content">
				<p>
					{isMissing
						? t("maestroHealth.missingDescription")
						: t("maestroHealth.updateDescription", {
							current: flow?.currentVersion ?? t("common.unknown"),
							latest: flow?.latestVersion ?? t("common.unknown"),
						})}
				</p>

				<div className="maestro-health-packages">
					{props.health.packages.map((pkg) => (
						<div className="maestro-health-package" key={pkg.source}>
							<Package size={16} strokeWidth={1.8} aria-hidden="true" />
							<div>
								<strong>{pkg.name}</strong>
								<small>
									{pkg.installed
										? t("maestroHealth.installedVersion", {
											version: pkg.currentVersion ?? t("common.unknown"),
										})
										: t("maestroHealth.notInstalled")}
								</small>
							</div>
							{pkg.installed && <Check size={16} strokeWidth={2} aria-hidden="true" />}
						</div>
					))}
				</div>

				<div className="maestro-health-actions">
					<Button variant="ghost" onClick={props.onClose}>
						{t("maestroHealth.later")}
					</Button>
					<Button variant="primary" onClick={props.onOpenExtensions}>
						{t("maestroHealth.openExtensions")}
					</Button>
				</div>
			</div>
		</aside>
	);
}
