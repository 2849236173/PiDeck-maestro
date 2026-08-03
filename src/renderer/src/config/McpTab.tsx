import { useEffect, useMemo, useState } from "react";
import { DatabaseZap, RefreshCw, ServerCog } from "lucide-react";
import type { McpConfigScope, McpConfigSnapshot, McpConfigSource } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { LazyMonacoEditor } from "../components/ui/LazyMonacoEditor";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import { ConfigEntryList, type ConfigEntryListItem } from "./ConfigEntryList";

type McpApi = {
	getMcp: (workspacePath?: string) => Promise<McpConfigSnapshot>;
	saveMcp: (request: { scope: McpConfigScope; workspacePath?: string; raw: string }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): McpApi {
	const api = (window as unknown as { piDesktop?: { config?: McpApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

function sourceLabel(source: McpConfigSource) {
	if (source.id === "shared-global") return t("mcp.source.sharedGlobal");
	if (source.id === "pi-global") return t("mcp.source.piGlobal");
	if (source.id === "shared-project") return t("mcp.source.sharedProject");
	return t("mcp.source.piProject");
}

export function McpTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<McpConfigSnapshot | null>(null);
	const [selectedScope, setSelectedScope] = useState<McpConfigScope>("global");
	const [raw, setRaw] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const editableSource = useMemo(() => {
		if (!snapshot) return null;
		const id = selectedScope === "workspace" ? "shared-project" : "pi-global";
		return snapshot.sources.find((source) => source.id === id) ?? null;
	}, [selectedScope, snapshot]);

	const entries = useMemo<ConfigEntryListItem[]>(() => {
		try {
			const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
			const servers = parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
			return Object.entries(servers).map(([id, value]) => ({
				id,
				label: id,
				summary: value && typeof value === "object" ? String((value as Record<string, unknown>).command ?? (value as Record<string, unknown>).url ?? t("mcp.serverNoCommand")) : t("config.entries.invalid"),
				invalid: !value || typeof value !== "object" || Array.isArray(value),
			}));
		} catch {
			return [];
		}
	}, [raw]);

	const updateServers = (mutate: (servers: Record<string, unknown>) => void) => {
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const servers = parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
				? { ...(parsed.mcpServers as Record<string, unknown>) }
				: {};
			mutate(servers);
			setRaw(JSON.stringify({ ...parsed, mcpServers: servers }, null, 2));
		} catch {
			setError(t("mcp.invalidJson"));
		}
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getMcp(props.workspacePath);
			setSnapshot(next);
			const globalSource = next.sources.find((source) => source.id === "pi-global");
			setSelectedScope("global");
			setRaw(globalSource?.raw ?? JSON.stringify({ mcpServers: {} }, null, 2));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [props.workspacePath]);

	const selectScope = (scope: McpConfigScope) => {
		setSelectedScope(scope);
		const id = scope === "workspace" ? "shared-project" : "pi-global";
		const source = snapshot?.sources.find((item) => item.id === id);
		setRaw(source?.raw ?? JSON.stringify({ mcpServers: {} }, null, 2));
		setError(null);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const result = await getConfigApi().saveMcp({
				scope: selectedScope,
				workspacePath: props.workspacePath,
				raw,
			});
			if (!result.valid) {
				setError(result.error ?? t("mcp.saveFailed"));
				return;
			}
			showNotice(t("mcp.saved"), 1600);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mcp-tab">
			<div className="config-toolbar mcp-toolbar">
				<div>
					<strong>{t("mcp.title")}</strong>
					<p>{t("mcp.description")}</p>
				</div>
				<div className="config-toolbar-actions">
					<Button variant="secondary" onClick={() => void load()} loading={loading}>
						<RefreshCw size={15} aria-hidden="true" /> {t("common.refresh")}
					</Button>
					<Button variant="primary" onClick={() => void save()} loading={saving} disabled={loading}>
						{t("common.save")}
					</Button>
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}

			<div className="config-hint-card mcp-auth-hint">
				<div>
					<strong>{t("mcp.auth.title")}</strong>
					<p>{t("mcp.auth.description")}</p>
				</div>
				<Button
					variant="secondary"
					onClick={() => {
						void navigator.clipboard.writeText("/mcp-auth");
						showNotice(t("mcp.auth.copied"), 1600);
					}}
				>
					{t("mcp.auth.copyCommand")}
				</Button>
			</div>

			<ConfigEntryList
				items={entries}
				onAdd={() => updateServers((servers) => {
					let index = Object.keys(servers).length + 1;
					let name = `server-${index}`;
					while (servers[name]) name = `server-${++index}`;
					servers[name] = { command: "" };
				})}
				onDelete={(id) => updateServers((servers) => { delete servers[id]; })}
			/>

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : snapshot ? (
				<>
					<div className="mcp-summary-grid">
						{snapshot.sources.map((source) => (
							<div className="mcp-source-card" key={source.id} data-empty={source.serverCount === 0}>
								<div className="mcp-source-card-title">
									<DatabaseZap size={16} aria-hidden="true" />
									<strong>{sourceLabel(source)}</strong>
								</div>
								<span>{source.exists ? t("mcp.source.exists") : t("mcp.source.missing")}</span>
								<code title={source.path}>{source.path}</code>
								<small>{t("mcp.serverCount", { count: source.serverCount })}</small>
								{source.diagnostic ? <small className="config-error">{source.diagnostic.message}</small> : null}
							</div>
						))}
					</div>

					<div className="mcp-server-list">
						<div className="mcp-section-heading">
							<ServerCog size={16} aria-hidden="true" />
							<strong>{t("mcp.servers")}</strong>
						</div>
						{snapshot.servers.length === 0 ? (
							<div className="config-empty-sm">{t("mcp.noServers")}</div>
						) : (
							snapshot.servers.map((server) => (
								<div className="mcp-server-row" key={`${server.path}:${server.name}`}>
									<div>
										<strong>{server.name}</strong>
										<small>{server.entry.command ?? server.entry.url ?? t("mcp.serverNoCommand")}</small>
										<code title={server.path}>{server.path}</code>
									</div>
									<span>{server.importKind ? `import:${server.importKind}` : server.scope}</span>
									{server.readOnly ? <span>{t("mcp.readOnly")}</span> : null}
									{server.entry.enabled === false ? <span>{t("mcp.disabled")}</span> : null}
								</div>
							))
						)}
					</div>

					<div className="mcp-editor-card">
						<div className="mcp-editor-header">
							<div className="mcp-scope-switch" role="group" aria-label={t("mcp.editScope")}>
								<Button
									buttonSize="sm"
									variant={selectedScope === "global" ? "primary" : "secondary"}
									aria-pressed={selectedScope === "global"}
									onClick={() => selectScope("global")}
								>
									{t("mcp.scope.global")}
								</Button>
								<Button
									buttonSize="sm"
									variant={selectedScope === "workspace" ? "primary" : "secondary"}
									aria-pressed={selectedScope === "workspace"}
									onClick={() => selectScope("workspace")}
									disabled={!props.workspacePath}
								>
									{t("mcp.scope.project")}
								</Button>
							</div>
							<code title={editableSource?.path}>{editableSource?.path ?? snapshot.globalPath}</code>
						</div>
						<div className="mcp-monaco-wrap">
							<LazyMonacoEditor value={raw} language="json" height="100%" onChange={(value) => setRaw(value ?? "")} />
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
