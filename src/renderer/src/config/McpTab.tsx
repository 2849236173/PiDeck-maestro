import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Copy, Info, Plus, RefreshCw, ServerCog, Trash2, Edit2, ShieldAlert } from "lucide-react";
import type { McpConfigScope, McpConfigSnapshot, McpServerEntry, McpManagedServer } from "../../../shared/types";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { TextField } from "../components/ui/TextField";
import { SelectField } from "../components/ui/SelectField";
import { Modal } from "../components/ui/Modal";
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

type WizardDraft = {
	isEdit: boolean;
	originalName: string;
	originalScope: McpConfigScope;
	originalServerPath?: string;
	scope: McpConfigScope;
	name: string;
	transport: "stdio" | "http";
	lifecycle: string;
	timeout: string;
	command: string;
	args: string;
	cwd: string;
	env: string;
	url: string;
	auth: string;
	bearerEnv: string;
	headers: string;
	exposeResources: boolean;
	toolExposure: "proxy" | "directProxy" | "selected";
	selectedTools: string;
	enabled: boolean;
	originalEntry?: McpServerEntry;
};

function mapEntryToDraft(name: string, scope: McpConfigScope, entry: McpServerEntry, serverPath?: string): WizardDraft {
	const t = entry.transport || (entry.url ? "http" : "stdio");
	let toolExposure: "proxy" | "directProxy" | "selected" = "proxy";
	let selectedTools = "[]";
	if (Array.isArray(entry.directTools)) {
		toolExposure = "selected";
		selectedTools = JSON.stringify(entry.directTools);
	} else if (entry.directTools === true) {
		toolExposure = "directProxy";
	}
	return {
		isEdit: true,
		originalName: name,
		originalScope: scope,
		originalServerPath: serverPath,
		scope,
		name,
		transport: (t === "sse" || t === "http" ? "http" : "stdio") as any,
		lifecycle: entry.lifecycle || "none",
		timeout: entry.timeout ? String(entry.timeout) : "",
		command: entry.command || "",
		args: Array.isArray(entry.args) ? JSON.stringify(entry.args) : "[]",
		cwd: typeof entry.cwd === "string" ? entry.cwd : "",
		env: entry.env ? JSON.stringify(entry.env) : "{}",
		url: entry.url || "",
		auth: entry.auth || "none",
		bearerEnv: typeof entry.bearerEnv === "string" ? entry.bearerEnv : "",
		headers: entry.headers ? JSON.stringify(entry.headers) : "{}",
		exposeResources: entry.exposeResources === true,
		toolExposure,
		selectedTools,
		enabled: entry.enabled !== false,
		originalEntry: entry,
	};
}

function draftToEntry(draft: WizardDraft): McpServerEntry {
	const base = draft.originalEntry ? { ...draft.originalEntry } : {};

	if (draft.transport === "stdio") {
		delete base.url;
		delete base.auth;
		delete base.bearerEnv;
		delete base.headers;
	} else {
		delete base.command;
		delete base.args;
		delete base.cwd;
		delete base.env;
	}

	base.transport = draft.transport;
	base.enabled = draft.enabled;

	if (draft.lifecycle !== "none") base.lifecycle = draft.lifecycle;
	else delete base.lifecycle;

	if (draft.timeout && parseInt(draft.timeout, 10) > 0) base.timeout = parseInt(draft.timeout, 10);
	else delete base.timeout;

	if (draft.toolExposure === "selected") {
		try {
			const parsed = JSON.parse(draft.selectedTools);
			if (Array.isArray(parsed)) base.directTools = parsed;
			else base.directTools = true;
		} catch {
			base.directTools = true;
		}
	} else if (draft.toolExposure === "directProxy") {
		base.directTools = true;
	} else {
		base.directTools = false;
	}

	if (draft.exposeResources) {
		base.exposeResources = true;
	} else {
		delete base.exposeResources;
	}

	if (draft.transport === "stdio") {
		base.command = draft.command;
		try {
			const parsedArgs = JSON.parse(draft.args);
			if (Array.isArray(parsedArgs) && parsedArgs.length > 0) base.args = parsedArgs;
			else delete base.args;
		} catch {}

		if (draft.cwd) base.cwd = draft.cwd;
		else delete base.cwd;

		try {
			const parsedEnv = JSON.parse(draft.env);
			if (parsedEnv && Object.keys(parsedEnv).length > 0) base.env = parsedEnv;
			else delete base.env;
		} catch {}
	} else {
		base.url = draft.url;
		if (draft.auth !== "none") base.auth = draft.auth;
		else delete base.auth;

		if (draft.auth === "bearer" && draft.bearerEnv) base.bearerEnv = draft.bearerEnv;
		else delete base.bearerEnv;

		try {
			const parsedHeaders = JSON.parse(draft.headers);
			if (parsedHeaders && Object.keys(parsedHeaders).length > 0) base.headers = parsedHeaders;
			else delete base.headers;
		} catch {}
	}

	return base;
}

export function McpTab(props: { workspacePath?: string }) {
	const [snapshot, setSnapshot] = useState<McpConfigSnapshot | null>(null);
	const [selectedScope, setSelectedScope] = useState<McpConfigScope>("global");
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showPrecedence, setShowPrecedence] = useState(false);

	const [wizardOpen, setWizardOpen] = useState(false);
	const [wizardStep, setWizardStep] = useState(0);
	const [wizardDraft, setWizardDraft] = useState<WizardDraft | null>(null);
	const [wizardError, setWizardError] = useState<string | null>(null);
	const [wizardSaving, setWizardSaving] = useState(false);

	const displayServers = useMemo(() => {
		if (!snapshot) return [];
		return snapshot.servers.filter((s) => {
			if (selectedScope === "workspace") return s.scope === "workspace";
			return s.scope === "global" || s.scope === "import";
		});
	}, [snapshot, selectedScope]);

	const currentSource = useMemo(() => {
		if (!snapshot) return null;
		const id = selectedScope === "workspace" ? "shared-project" : "pi-global";
		return snapshot.sources.find((s) => s.id === id) ?? null;
	}, [snapshot, selectedScope]);

	const currentImports = useMemo(() => {
		if (!currentSource?.raw) return [];
		try {
			const parsed = JSON.parse(currentSource.raw);
			return Array.isArray(parsed.imports) ? parsed.imports : [];
		} catch {
			return [];
		}
	}, [currentSource]);

	const load = async (nameToSelect?: string) => {
		setLoading(true);
		setError(null);
		try {
			const next = await getConfigApi().getMcp(props.workspacePath);
			setSnapshot(next);
			if (nameToSelect) setSelectedName(nameToSelect);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [props.workspacePath]);

	const toggleImport = async (kind: string) => {
		if (!currentSource) return;
		try {
			const parsed = JSON.parse(currentSource.raw || "{}");
			const arr = Array.isArray(parsed.imports) ? parsed.imports : [];
			if (arr.includes(kind)) parsed.imports = arr.filter((i: string) => i !== kind);
			else parsed.imports = [...arr, kind];

			const result = await getConfigApi().saveMcp({
				scope: selectedScope,
				workspacePath: props.workspacePath,
				raw: JSON.stringify(parsed, null, 2),
			});
			if (!result.valid) throw new Error(result.error || t("mcp.saveFailed"));
			void load();
		} catch (err) {
			showNotice(t("mcp.saveFailed"), 1600);
		}
	};

	const deleteServer = async (server: McpManagedServer) => {
		if (server.readOnly) return;
		const src = snapshot?.sources.find((s) => s.path === server.path) || snapshot?.sources.find((s) => s.id === (server.scope === "workspace" ? "shared-project" : "pi-global"));
		if (!src) return;
		try {
			const parsed = JSON.parse(src.raw || "{}");
			if (parsed.mcpServers && parsed.mcpServers[server.name]) {
				delete parsed.mcpServers[server.name];
			}
			const result = await getConfigApi().saveMcp({
				scope: src.scope as McpConfigScope,
				workspacePath: props.workspacePath,
				raw: JSON.stringify(parsed, null, 2),
			});
			if (!result.valid) throw new Error(result.error || t("mcp.deleteFailed"));
			if (selectedName === server.name) setSelectedName(null);
			void load();
		} catch (err) {
			showNotice(t("mcp.deleteFailed"), 1600);
		}
	};

	const openCreateWizard = () => {
		setWizardDraft({
			isEdit: false,
			originalName: "",
			originalScope: selectedScope,
			scope: selectedScope,
			name: "",
			transport: "stdio",
			lifecycle: "none",
			timeout: "",
			command: "",
			args: "[]",
			cwd: "",
			env: "{}",
			url: "",
			auth: "none",
			bearerEnv: "",
			headers: "{}",
			exposeResources: false,
			toolExposure: "proxy",
			selectedTools: "[]",
			enabled: true,
		});
		setWizardStep(0);
		setWizardError(null);
		setWizardOpen(true);
	};

	const openEditWizard = (server: McpManagedServer) => {
		if (server.readOnly) return;
		setWizardDraft(mapEntryToDraft(server.name, server.scope as McpConfigScope, server.entry, server.path));
		setWizardStep(0);
		setWizardError(null);
		setWizardOpen(true);
	};

	const validateWizardStep = (step: number, draft: WizardDraft): string | null => {
		if (step === 0) {
			if (!draft.name.trim()) return t("mcp.wizard.error.required");
			const exists = displayServers.some((s) => s.name === draft.name);
			if (!draft.isEdit && exists) return t("mcp.wizard.nameExists");
			if (draft.isEdit && draft.name !== draft.originalName && exists) return t("mcp.wizard.nameExists");
		}
		if (step === 3) {
			if (draft.timeout && (!/^\d+$/.test(draft.timeout) || parseInt(draft.timeout, 10) <= 0)) {
				return t("mcp.wizard.timeoutInvalid");
			}
			if (draft.toolExposure === "selected") {
				try {
					const selectedTools = JSON.parse(draft.selectedTools);
					if (!Array.isArray(selectedTools) || selectedTools.some((tool: unknown) => typeof tool !== "string" || !tool.trim())) throw new Error();
				} catch {
					return t("mcp.wizard.selectedToolsInvalid");
				}
			}
		}
		if (step === 4) {
			if (draft.transport === "stdio") {
				if (!draft.command.trim()) return t("mcp.wizard.error.required");
				try {
					const arr = JSON.parse(draft.args);
					if (!Array.isArray(arr) || arr.some((x: any) => typeof x !== "string")) throw new Error();
				} catch {
					return `${t("mcp.wizard.argsPrefix")}${t("mcp.wizard.error.json")}`;
				}
				try {
					const obj = JSON.parse(draft.env);
					if (typeof obj !== "object" || obj === null || Array.isArray(obj) || Object.values(obj).some((x: any) => typeof x !== "string")) throw new Error();
				} catch {
					return `${t("mcp.wizard.envPrefix")}${t("mcp.wizard.error.json")}`;
				}
			} else {
				try {
					const u = new URL(draft.url);
					if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
				} catch {
					return t("mcp.wizard.error.url");
				}
				try {
					const obj = JSON.parse(draft.headers);
					if (typeof obj !== "object" || obj === null || Array.isArray(obj) || Object.values(obj).some((x: any) => typeof x !== "string")) throw new Error();
				} catch {
					return `${t("mcp.wizard.headersPrefix")}${t("mcp.wizard.error.json")}`;
				}
			}
		}
		return null;
	};

	const handleWizardNext = () => {
		if (!wizardDraft) return;
		const err = validateWizardStep(wizardStep, wizardDraft);
		if (err) {
			setWizardError(err);
			return;
		}
		setWizardError(null);

		let nextStep = wizardStep + 1;
		if (nextStep === 2 && wizardDraft.isEdit) nextStep = 3; // skip scope if edit
		setWizardStep(nextStep);
	};

	const handleWizardPrevious = () => {
		if (wizardStep === 0 || wizardSaving) return;
		setWizardError(null);
		// The edit flow omits scope (step 2), so moving back from lifecycle must return to transport.
		setWizardStep(wizardStep === 3 && wizardDraft?.isEdit ? 1 : wizardStep - 1);
	};

	const handleWizardSave = async () => {
		if (!wizardDraft) return;
		setWizardSaving(true);
		setWizardError(null);
		try {
			let src = snapshot?.sources.find((s) => s.id === (wizardDraft.scope === "workspace" ? "shared-project" : "pi-global"));
			if (wizardDraft.isEdit && wizardDraft.originalServerPath) {
				const existingSrc = snapshot?.sources.find((s) => s.path === wizardDraft.originalServerPath);
				if (existingSrc) src = existingSrc;
			}
			const parsed = JSON.parse(src?.raw || "{\"mcpServers\":{}}");
			if (!parsed.mcpServers) parsed.mcpServers = {};

			if (wizardDraft.isEdit && wizardDraft.name !== wizardDraft.originalName) {
				delete parsed.mcpServers[wizardDraft.originalName];
			}
			parsed.mcpServers[wizardDraft.name] = draftToEntry(wizardDraft);

			const result = await getConfigApi().saveMcp({
				scope: src?.scope || wizardDraft.scope,
				workspacePath: props.workspacePath,
				raw: JSON.stringify(parsed, null, 2),
			});
			if (!result.valid) throw new Error(result.error || t("mcp.saveFailed"));

			showNotice(t("mcp.saved"), 1600);
			setWizardOpen(false);
			void load(wizardDraft.name);
		} catch (err) {
			setWizardError(err instanceof Error ? err.message : String(err));
		} finally {
			setWizardSaving(false);
		}
	};

	const copyAuth = () => {
		void navigator.clipboard.writeText("/mcp-auth");
		showNotice(t("mcp.auth.copied"), 1600);
	};

	const renderWizardStep = () => {
		if (!wizardDraft) return null;
		switch (wizardStep) {
			case 0:
				return (
					<div className="mcp-wizard-section">
						<strong>{t("mcp.wizard.step.name")}</strong>
						<TextField
							label={t("mcp.wizard.nameLabel")}
							placeholder={t("mcp.wizard.namePlaceholder")}
							value={wizardDraft.name}
							onChange={(v) => setWizardDraft({ ...wizardDraft, name: v })}
						/>
					</div>
				);
			case 1:
				return (
					<div className="mcp-wizard-section">
						<strong>{t("mcp.wizard.step.transport")}</strong>
						<SelectField
							label=""
							value={wizardDraft.transport}
							options={[
								{ value: "stdio", label: t("mcp.wizard.transport.stdio") },
								{ value: "http", label: t("mcp.wizard.transport.http") },
							]}
							onChange={(v) => setWizardDraft({ ...wizardDraft, transport: v as any })}
						/>
					</div>
				);
			case 2:
				return (
					<div className="mcp-wizard-section">
						<strong>{t("mcp.wizard.step.scope")}</strong>
						<div className="mcp-wizard-radio-group">
							<label className="mcp-wizard-radio-label">
								<input
									type="radio"
									name="mcp-scope"
									checked={wizardDraft.scope === "global"}
									onChange={() => setWizardDraft({ ...wizardDraft, scope: "global" })}
								/>
								<div className="mcp-wizard-radio-text">
									<span>{t("mcp.scope.global")}</span>
									<span className="mcp-wizard-radio-desc">{t("mcp.wizard.scope.globalDesc")}</span>
								</div>
							</label>
							<label className="mcp-wizard-radio-label">
								<input
									type="radio"
									name="mcp-scope"
									checked={wizardDraft.scope === "workspace"}
									onChange={() => setWizardDraft({ ...wizardDraft, scope: "workspace" })}
									disabled={!props.workspacePath}
								/>
								<div className="mcp-wizard-radio-text">
									<span>{t("mcp.scope.project")}</span>
									<span className="mcp-wizard-radio-desc">{t("mcp.wizard.scope.projectDesc")}</span>
								</div>
							</label>
						</div>
					</div>
				);
			case 3:
				return (
					<div className="mcp-wizard-section">
						<strong>{t("mcp.wizard.step.lifecycle")}</strong>
						<SelectField
							label={t("mcp.wizard.lifecycleLabel")}
							value={wizardDraft.lifecycle}
							options={[
								{ value: "none", label: t("mcp.wizard.lifecycle.none") },
								{ value: "lazy", label: t("mcp.wizard.lifecycle.lazy") },
								{ value: "keep-alive", label: t("mcp.wizard.lifecycle.keep-alive") },
								{ value: "eager", label: t("mcp.wizard.lifecycle.eager") },
								{ value: "startup", label: t("mcp.wizard.lifecycle.startup") },
							]}
							onChange={(v) => setWizardDraft({ ...wizardDraft, lifecycle: v })}
						/>
						<TextField
							label={t("mcp.wizard.timeoutLabel")}
							value={wizardDraft.timeout}
							onChange={(v) => setWizardDraft({ ...wizardDraft, timeout: v })}
						/>
						<SelectField
							label={t("mcp.wizard.resourcesLabel")}
							value={wizardDraft.exposeResources ? "expose" : "hidden"}
							options={[
								{ value: "hidden", label: t("mcp.wizard.resources.hidden") },
								{ value: "expose", label: t("mcp.wizard.resources.expose") },
							]}
							onChange={(v) => setWizardDraft({ ...wizardDraft, exposeResources: v === "expose" })}
						/>
						<SelectField
							label={t("mcp.wizard.toolExposureLabel")}
							value={wizardDraft.toolExposure}
							options={[
								{ value: "proxy", label: t("mcp.wizard.toolExposure.proxy") },
								{ value: "directProxy", label: t("mcp.wizard.toolExposure.directProxy") },
								{ value: "selected", label: t("mcp.wizard.toolExposure.selected") },
							]}
							onChange={(v) => setWizardDraft({ ...wizardDraft, toolExposure: v as any })}
						/>
						{wizardDraft.toolExposure === "selected" && (
							<TextField
								label={t("mcp.wizard.selectedToolsLabel")}
								value={wizardDraft.selectedTools}
								onChange={(v) => setWizardDraft({ ...wizardDraft, selectedTools: v })}
							/>
						)}
					</div>
				);
			case 4:
				if (wizardDraft.transport === "stdio") {
					return (
						<div className="mcp-wizard-section">
							<strong>{t("mcp.wizard.step.details")} - stdio</strong>
							<TextField
								label={t("mcp.field.command")}
								value={wizardDraft.command}
								onChange={(v) => setWizardDraft({ ...wizardDraft, command: v })}
								placeholder="npx"
							/>
							<TextField
								label={t("mcp.wizard.argsLabel")}
								value={wizardDraft.args}
								onChange={(v) => setWizardDraft({ ...wizardDraft, args: v })}
							/>
							<TextField
								label={t("mcp.wizard.cwdLabel")}
								value={wizardDraft.cwd}
								onChange={(v) => setWizardDraft({ ...wizardDraft, cwd: v })}
							/>
							<TextField
								label={t("mcp.wizard.envLabel")}
								value={wizardDraft.env}
								onChange={(v) => setWizardDraft({ ...wizardDraft, env: v })}
							/>
						</div>
					);
				} else {
					return (
						<div className="mcp-wizard-section">
							<strong>{t("mcp.wizard.step.details")} - http</strong>
							<TextField
								label={t("mcp.field.url")}
								value={wizardDraft.url}
								onChange={(v) => setWizardDraft({ ...wizardDraft, url: v })}
								placeholder="https://..."
							/>
							<SelectField
								label={t("mcp.wizard.authLabel")}
								value={wizardDraft.auth}
								options={[
									{ value: "none", label: t("mcp.wizard.auth.none") },
									{ value: "auto", label: t("mcp.wizard.auth.auto") },
									{ value: "oauth", label: t("mcp.wizard.auth.oauth") },
									{ value: "bearer", label: t("mcp.wizard.auth.bearer") },
								]}
								onChange={(v) => setWizardDraft({ ...wizardDraft, auth: v })}
							/>
							{wizardDraft.auth === "bearer" && (
								<TextField
									label={t("mcp.wizard.bearerEnvLabel")}
									value={wizardDraft.bearerEnv}
									onChange={(v) => setWizardDraft({ ...wizardDraft, bearerEnv: v })}
								/>
							)}
							<TextField
								label={t("mcp.wizard.headersLabel")}
								value={wizardDraft.headers}
								onChange={(v) => setWizardDraft({ ...wizardDraft, headers: v })}
							/>
						</div>
					);
				}
			case 5:
				return (
					<div className="mcp-wizard-section">
						<strong>{t("mcp.wizard.summaryTitle")}</strong>
						<pre className="mcp-wizard-summary">
							{JSON.stringify(draftToEntry(wizardDraft), null, 2)}
						</pre>
					</div>
				);
			default:
				return null;
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
				</div>
			</div>

			{error ? <div className="config-error">{error}</div> : null}

			<div className="mcp-flow-bar">
				<div className="mcp-scope-switch" role="group" aria-label={t("mcp.editScope")}>
					<Button
						buttonSize="sm"
						variant={selectedScope === "global" ? "primary" : "secondary"}
						aria-pressed={selectedScope === "global"}
						onClick={() => setSelectedScope("global")}
					>
						{t("mcp.scope.global")}
					</Button>
					<Button
						buttonSize="sm"
						variant={selectedScope === "workspace" ? "primary" : "secondary"}
						aria-pressed={selectedScope === "workspace"}
						onClick={() => setSelectedScope("workspace")}
						disabled={!props.workspacePath}
					>
						{t("mcp.scope.project")}
					</Button>
				</div>
				{currentSource?.path ? <code title={currentSource.path}>{currentSource.path}</code> : null}
			</div>

			{selectedScope === "global" && (
				<div className="mcp-import-panel">
					<div className="mcp-import-header">
						<strong>{t("mcp.import.title")}</strong>
						<span>{t("mcp.import.flowHint")}</span>
					</div>
					<div className="mcp-import-sources">
						{IMPORT_KINDS.map((kind) => (
							<label key={kind.id} className={`mcp-import-source ${currentImports.includes(kind.id) ? "selected" : ""}`}>
								<input type="checkbox" checked={currentImports.includes(kind.id)} onChange={() => toggleImport(kind.id)} />
								<span className="mcp-import-label">{kind.label}</span>
								<code>{kind.id}</code>
							</label>
						))}
					</div>
				</div>
			)}

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
				<div className="mcp-dual-pane mcp-list-layout">
					<section className="mcp-pane mcp-list-pane-full">
						<header>
							<div className="mcp-list-header">
								<ServerCog size={16} aria-hidden="true" />
								<strong>{t("mcp.servers")}</strong>
							</div>
							<Button buttonSize="sm" variant="secondary" onClick={openCreateWizard}>
								<Plus size={14} aria-hidden="true" /> {t("mcp.addServer")}
							</Button>
						</header>
						<div className="mcp-server-list-pane mcp-list-scroll">
							{displayServers.length === 0 ? (
								<div className="config-empty-sm">{t("mcp.noServers")}</div>
							) : (
								displayServers.map((server) => {
									const isOauth = server.entry.auth === "oauth";
									const transport = server.entry.transport || (server.entry.url ? "http" : "stdio");
									const isConfigured = !server.readOnly && !isOauth && server.entry.enabled !== false;
									const toolCount = typeof server.entry.toolCount === "number" ? server.entry.toolCount : Array.isArray(server.entry.tools) ? server.entry.tools.length : 0;
									return (
										<div
											key={server.name}
											className={`mcp-server-list-item wizard-mode ${selectedName === server.name ? "selected" : ""}`}
											onClick={() => setSelectedName(server.name)}
										>
											<div className="mcp-list-item-title-row">
												<strong className="mcp-list-item-name">{server.name}</strong>
												<div className="mcp-list-item-actions">
													{!server.readOnly && (
														<>
															<IconButton label={t("common.edit")} onClick={() => openEditWizard(server)}>
																<Edit2 size={14} aria-hidden="true" />
															</IconButton>
															<IconButton label={t("common.delete")} onClick={() => deleteServer(server)}>
																<Trash2 size={14} aria-hidden="true" />
															</IconButton>
														</>
													)}
												</div>
											</div>
											<small className="mcp-list-item-cmd">{server.entry.command || server.entry.url || t("mcp.serverNoCommand")}</small>

											<div className="mcp-list-item-details">
												<div className="mcp-list-item-badges">
													<span className="mcp-list-item-status">{transport}</span>
													{server.entry.enabled === false ? (
														<span className="mcp-list-item-status disabled">{t("mcp.disabled")}</span>
													) : isOauth ? (
														<span className="mcp-list-item-status needs-auth">{t("mcp.status.needsAuth")}</span>
													) : isConfigured ? (
														<span className="mcp-list-item-status configured">{t("mcp.status.configured")}</span>
													) : (
														<span className="mcp-list-item-status">{t("mcp.status.unknown")}</span>
													)}
													{toolCount > 0 && (
														<span className="mcp-list-item-status">
															{t("mcp.server.tools").replace("{count}", String(toolCount))}
														</span>
													)}
													{server.readOnly && <span className="mcp-list-item-status">{t("mcp.readOnly")}</span>}
												</div>
											</div>

											{isOauth && (
												<div className="mcp-auth-inline auth-guide">
													<span className="mcp-auth-guide-text"><ShieldAlert size={12} /> {t("mcp.auth.guide")}</span>
													<Button buttonSize="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); copyAuth(); }}>
														<Copy size={12} aria-hidden="true" /> {t("mcp.auth.step1")}
													</Button>
												</div>
											)}
										</div>
									);
								})
							)}
						</div>
					</section>
				</div>
			)}

			<Modal
				open={wizardOpen}
				onClose={() => setWizardOpen(false)}
				title={wizardDraft?.isEdit ? t("mcp.wizard.editTitle") : t("mcp.wizard.createTitle")}
				size="medium"
			>
				<div className="mcp-wizard-content">
					<div className="mcp-wizard-body">
						{renderWizardStep()}
						{wizardError && <div className="mcp-wizard-error">{wizardError}</div>}
					</div>
					<div className="mcp-wizard-footer">
						<Button variant="secondary" onClick={handleWizardPrevious} disabled={wizardStep === 0 || wizardSaving}>
							{t("mcp.wizard.prev")}
						</Button>
						{wizardStep < 5 ? (
							<Button variant="primary" onClick={handleWizardNext}>
								{t("mcp.wizard.next")}
							</Button>
						) : (
							<Button variant="primary" onClick={handleWizardSave} loading={wizardSaving}>
								{t("mcp.wizard.save")}
							</Button>
						)}
					</div>
				</div>
			</Modal>
		</div>
	);
}
