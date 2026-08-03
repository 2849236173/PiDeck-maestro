import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Copy, Info, Plus, RefreshCw, ServerCog, Trash2 } from "lucide-react";
import type { McpConfigScope, McpConfigSnapshot, McpServerEntry } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

type McpApi = {
	getMcp: (workspacePath?: string) => Promise<McpConfigSnapshot>;
	saveMcp: (request: { scope: McpConfigScope; workspacePath?: string; raw: string }) => Promise<{ valid: boolean; error?: string }>;
};

function getConfigApi(): McpApi {
	const api = (window as unknown as { piDesktop?: { config?: McpApi } }).piDesktop?.config;
	if (!api) throw new Error("PiDeck config API is not available");
	return api;
}

const IMPORT_KINDS = [
	{ id: "cursor", label: "Cursor" },
	{ id: "claude-code", label: "Claude Code" },
	{ id: "claude-desktop", label: "Claude Desktop" },
	{ id: "codex", label: "Codex" },
	{ id: "vscode", label: "VS Code" },
	{ id: "windsurf", label: "Windsurf" },
] as const;

type EditableServer = {
	name: string;
	command: string;
	url: string;
	enabled: boolean;
	auth?: string;
};

function serversFromRaw(raw: string): { servers: EditableServer[]; imports: string[] } {
	const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerEntry>; imports?: string[] };
	const servers = Object.entries(parsed.mcpServers ?? {}).map(([name, entry]) => ({
		name,
		command: typeof entry?.command === "string" ? entry.command : "",
		url: typeof entry?.url === "string" ? entry.url : "",
		enabled: entry?.enabled !== false,
		auth: typeof entry?.auth === "string" ? entry.auth : undefined,
	}));
	return {
		servers,
		imports: Array.isArray(parsed.imports) ? parsed.imports.filter((item): item is string => typeof item === "string") : [],
	};
}

function toRaw(servers: EditableServer[], imports: string[]): string {
	const mcpServers: Record<string, McpServerEntry> = {};
	for (const server of servers) {
		const entry: McpServerEntry = { enabled: server.enabled };
		if (server.command.trim()) entry.command = server.command.trim();
		if (server.url.trim()) entry.url = server.url.trim();
		if (server.auth) entry.auth = server.auth;
		mcpServers[server.name] = entry;
	}
	return JSON.stringify({ mcpServers, ...(imports.length > 0 ? { imports } : {}) }, null, 2);
}

/**
 * 对标 pi-maestro-flow MCP setup 基础流：
 * 选作用域 → 管理服务器（增删改/启用）→ 勾选兼容导入 → 需要时 OAuth → 保存。
 */
export function McpTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<McpConfigSnapshot | null>(null);
	const [selectedScope, setSelectedScope] = useState<McpConfigScope>("global");
	const [servers, setServers] = useState<EditableServer[]>([]);
	const [imports, setImports] = useState<string[]>([]);
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [showPrecedence, setShowPrecedence] = useState(false);
	const [newName, setNewName] = useState("");

	const selected = useMemo(
		() => servers.find((server) => server.name === selectedName) ?? null,
		[selectedName, servers],
	);

	const editableSource = useMemo(() => {
		if (!snapshot) return null;
		const id = selectedScope === "workspace" ? "shared-project" : "pi-global";
		return snapshot.sources.find((source) => source.id === id) ?? null;
	}, [selectedScope, snapshot]);

	const applyRaw = (raw: string) => {
		const next = serversFromRaw(raw);
		setServers(next.servers);
		setImports(next.imports);
		setSelectedName(next.servers[0]?.name ?? null);
		setDirty(false);
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getMcp(props.workspacePath);
			setSnapshot(next);
			setSelectedScope("global");
			const globalSource = next.sources.find((source) => source.id === "pi-global");
			applyRaw(globalSource?.raw ?? JSON.stringify({ mcpServers: {} }, null, 2));
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
		try {
			applyRaw(source?.raw ?? JSON.stringify({ mcpServers: {} }, null, 2));
			setError(null);
		} catch {
			setError(t("mcp.invalidJson"));
		}
	};

	const updateSelected = (patch: Partial<EditableServer>) => {
		if (!selectedName) return;
		setServers((prev) => prev.map((server) => (server.name === selectedName ? { ...server, ...patch } : server)));
		setDirty(true);
	};

	const addServer = () => {
		const base = newName.trim() || "server";
		let name = base;
		let index = 1;
		while (servers.some((server) => server.name === name)) name = `${base}-${++index}`;
		setServers((prev) => [...prev, { name, command: "", url: "", enabled: true }]);
		setSelectedName(name);
		setNewName("");
		setDirty(true);
	};

	const deleteSelected = () => {
		if (!selectedName) return;
		setServers((prev) => prev.filter((server) => server.name !== selectedName));
		setSelectedName(null);
		setDirty(true);
	};

	const toggleImport = (kind: string) => {
		setImports((prev) => (prev.includes(kind) ? prev.filter((item) => item !== kind) : [...prev, kind]));
		setDirty(true);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const result = await getConfigApi().saveMcp({
				scope: selectedScope,
				workspacePath: props.workspacePath,
				raw: toRaw(servers, imports),
			});
			if (!result.valid) {
				setError(result.error ?? t("mcp.saveFailed"));
				return;
			}
			showNotice(t("mcp.saved"), 1600);
			setDirty(false);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	const copyAuth = () => {
		void navigator.clipboard.writeText("/mcp-auth");
		showNotice(t("mcp.auth.copied"), 1600);
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
					<Button variant="primary" onClick={() => void save()} loading={saving} disabled={loading || !dirty}>
						{t("common.save")}
					</Button>
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}

			<div className="mcp-flow-bar">
				<div className="mcp-scope-switch" role="group" aria-label={t("mcp.editScope")}>
					<Button buttonSize="sm" variant={selectedScope === "global" ? "primary" : "secondary"} aria-pressed={selectedScope === "global"} onClick={() => selectScope("global")}>
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
				{editableSource?.path ? <code title={editableSource.path}>{editableSource.path}</code> : null}
			</div>

			<div className="mcp-import-panel">
				<div className="mcp-import-header">
					<strong>{t("mcp.import.title")}</strong>
					<span>{t("mcp.import.flowHint")}</span>
				</div>
				<div className="mcp-import-sources">
					{IMPORT_KINDS.map((kind) => (
						<label key={kind.id} className={`mcp-import-source ${imports.includes(kind.id) ? "selected" : ""}`}>
							<input type="checkbox" checked={imports.includes(kind.id)} onChange={() => toggleImport(kind.id)} />
							<span className="mcp-import-label">{kind.label}</span>
							<code>{kind.id}</code>
						</label>
					))}
				</div>
			</div>

			<button type="button" className="mcp-precedence-toggle" onClick={() => setShowPrecedence((v) => !v)}>
				<Info size={16} aria-hidden="true" />
				<strong>{t("mcp.precedence.title")}</strong>
				<span>{showPrecedence ? t("mcp.precedence.hide") : t("mcp.precedence.show")}</span>
			</button>
			{showPrecedence ? (
				<ol className="mcp-precedence-list">
					<li><span>{t("mcp.precedence.globalShared")}</span><code>~/.config/mcp/mcp.json</code></li>
					<li><span>{t("mcp.precedence.piGlobal")}</span><code>&lt;Pi agent dir&gt;/mcp.json</code></li>
					<li><span>{t("mcp.precedence.projectShared")}</span><code>.mcp.json</code></li>
					<li><span>{t("mcp.precedence.projectPi")}</span><code>.pi/mcp.json</code></li>
				</ol>
			) : null}

			{loading && !snapshot ? (
				<div className="config-loading">{t("common.loading")}</div>
			) : (
				<div className="mcp-dual-pane">
					<section className="mcp-pane">
						<header>
							<ServerCog size={16} aria-hidden="true" />
							<strong>{t("mcp.servers")}</strong>
						</header>
						<div className="mcp-add-row">
							<TextField label="" value={newName} onChange={setNewName} placeholder={t("mcp.newServerPlaceholder")} />
							<Button buttonSize="sm" variant="secondary" onClick={addServer}>
								<Plus size={14} aria-hidden="true" /> {t("mcp.addServer")}
							</Button>
						</div>
						<div className="mcp-server-list-pane">
							{servers.length === 0 ? (
								<div className="config-empty-sm">{t("mcp.noServers")}</div>
							) : (
								servers.map((server) => (
									<button
										key={server.name}
										type="button"
										className={`mcp-server-list-item ${selectedName === server.name ? "selected" : ""}`}
										onClick={() => setSelectedName(server.name)}
									>
										<strong>{server.name}</strong>
										<small>{server.command || server.url || t("mcp.serverNoCommand")}</small>
										{!server.enabled ? <span>{t("mcp.disabled")}</span> : null}
										{server.auth === "oauth" ? <span>{t("mcp.server.needAuth")}</span> : null}
									</button>
								))
							)}
						</div>
					</section>

					<section className="mcp-pane">
						<header>
							<strong>{t("mcp.editServer")}</strong>
							{selected ? (
								<IconButton label={t("common.delete")} onClick={deleteSelected}>
									<Trash2 size={14} aria-hidden="true" />
								</IconButton>
							) : null}
						</header>
						{!selected ? (
							<div className="config-empty-sm">{t("mcp.selectServerFirst")}</div>
						) : (
							<div className="mcp-edit-form">
								<TextField label={t("mcp.field.command")} value={selected.command} onChange={(value) => updateSelected({ command: value })} placeholder="npx -y @modelcontextprotocol/server-filesystem" />
								<TextField label={t("mcp.field.url")} value={selected.url} onChange={(value) => updateSelected({ url: value })} placeholder="https://..." />
								<label className="mcp-enable-row">
									<input type="checkbox" checked={selected.enabled} onChange={(event) => updateSelected({ enabled: event.target.checked })} />
									<span>{t("mcp.field.enabled")}</span>
								</label>
								<label className="mcp-enable-row">
									<input
										type="checkbox"
										checked={selected.auth === "oauth"}
										onChange={(event) => updateSelected({ auth: event.target.checked ? "oauth" : undefined })}
									/>
									<span>{t("mcp.field.oauth")}</span>
								</label>
								{selected.auth === "oauth" ? (
									<div className="mcp-auth-inline">
										<span>{t("mcp.auth.description")}</span>
										<Button buttonSize="sm" variant="secondary" onClick={copyAuth}>
											<Copy size={12} aria-hidden="true" /> {t("mcp.auth.copyCommand")}
										</Button>
										<small><CheckCircle size={12} aria-hidden="true" /> {t("mcp.auth.step2")}</small>
									</div>
								) : null}
							</div>
						)}
					</section>
				</div>
			)}
		</div>
	);
}
