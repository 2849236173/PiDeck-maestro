import type { AgentShellMode } from "../../shared/types";

function isLegacyWslShellPath(value: string): boolean {
	return /^[a-z]:[\\/]windows[\\/](?:system32|sysnative)[\\/]bash(?:\.exe)?$/i.test(value.trim());
}

export type AgentShellSyncInput = {
	mode: AgentShellMode;
	wslEnabled: boolean;
	currentPath: string;
	selectedPath: string;
	resolveAuto: () => Promise<string | undefined>;
	validate: (path: string) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * Decide whether the global pi settings shellPath needs an update.
 * The caller owns persistence; returning undefined means "leave the file unchanged".
 */
export async function resolveAgentShellPath(input: AgentShellSyncInput): Promise<string | undefined> {
	if (input.wslEnabled) return undefined;

	const current = input.currentPath.trim();
	if (input.mode === "auto") {
		if (current && !isLegacyWslShellPath(current) && (await input.validate(current)).ok) {
			return undefined;
		}
		return input.resolveAuto();
	}

	const selected = input.selectedPath.trim();
	if (!selected) throw new Error("Agent Shell path is required");
	const validation = await input.validate(selected);
	if (!validation.ok) throw new Error(validation.error ?? "Agent Shell validation failed");
	return selected === current ? undefined : selected;
}
