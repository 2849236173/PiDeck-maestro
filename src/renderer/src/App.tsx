import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createPreviewApi } from "./previewApi";
import type { AgentRuntimeState, AgentTab, AppSettings, AvailableModel, ChatMessage, FileTreeNode, GitBranchInfo, PiCommand, Project, SessionSummary } from "../../shared/types";

type DrawerPanel = "files" | "sessions";

const api = window.piDesktop ?? createPreviewApi();

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<AgentTab[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [activeAgentId, setActiveAgentId] = useState<string>();
  const [activeAgentByProject, setActiveAgentByProject] = useState<Record<string, string>>({});
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [gitInfo, setGitInfo] = useState<GitBranchInfo>({ current: null, branches: [] });
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [runtimeStateByAgent, setRuntimeStateByAgent] = useState<Record<string, AgentRuntimeState>>({});
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; node: FileTreeNode } | null>(null);
  const [agentMenu, setAgentMenu] = useState<{ x: number; y: number; agent: AgentTab } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerPanel | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentLoading, setAgentLoading] = useState<{ text: string } | null>(null);
  const [settings, setSettings] = useState<AppSettings>({ useNativeTitleBar: true, showNativeMenu: false, sendShortcut: "enter-send" });
  const [settingsNotice, setSettingsNotice] = useState("");
  const [listWidth, setListWidth] = useState(300);
  const [drawerWidth, setDrawerWidth] = useState(360);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const timelineRef = useRef<HTMLElement | null>(null);

  const activeProject = projects.find(project => project.id === activeProjectId);
  const activeAgent = agents.find(agent => agent.id === activeAgentId);
  const activeMessages = activeAgentId ? messagesByAgent[activeAgentId] ?? [] : [];
  const activeRuntimeState = activeAgentId ? runtimeStateByAgent[activeAgentId] : undefined;
  const outlineItems = useMemo(() => buildOutline(activeMessages), [activeMessages]);
  const flatFiles = useMemo(() => flattenFiles(files), [files]);
  const visibleAgents = useMemo(() => agents.filter(agent => !activeProjectId || agent.projectId === activeProjectId), [agents, activeProjectId]);
  const filteredAgents = useMemo(() => visibleAgents.filter(agent => matches(agent.title + agent.cwd + (agent.sessionId ?? ""), search)), [visibleAgents, search]);
  const filteredProjects = useMemo(() => projects.filter(project => matches(project.name + project.path, search)), [projects, search]);

  useEffect(() => {
    void refreshProjects();
    void api.agents.list().then(setAgents);
    void api.settings.get().then(setSettings);

    const offState = api.agents.onState(nextAgents => {
      setAgents(nextAgents);
      setActiveAgentId(current => current && nextAgents.some(agent => agent.id === current) ? current : undefined);
    });
    const offMessages = api.agents.onMessages(payload => setMessagesByAgent(current => ({ ...current, [payload.agentId]: payload.messages })));
    const offLog = api.agents.onLog(payload => setLogs(current => [...current.slice(-200), `[${payload.agentId.slice(0, 8)}] ${payload.text}`]));
    const offSettings = api.settings.onApplyWindow(() => setSettingsNotice("标题栏样式需要重启应用后生效。"));

    return () => { offState(); offMessages(); offLog(); offSettings(); };
  }, []);

  useEffect(() => {
    if (activeAgentId) void refreshRuntimeState(activeAgentId);
  }, [activeAgentId]);

  useEffect(() => {
    if (activeProjectId && activeAgentId) setActiveAgentByProject(current => ({ ...current, [activeProjectId]: activeAgentId }));
  }, [activeProjectId, activeAgentId]);

  useEffect(() => {
    if (activeAgentId) void api.agents.commands(activeAgentId).then(setCommands).catch(() => setCommands([]));
    else setCommands([]);
  }, [activeAgentId]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    // 历史会话加载后默认跳到最新消息，符合聊天软件的阅读习惯，避免用户手动滚动到底部。
    requestAnimationFrame(() => { timeline.scrollTop = timeline.scrollHeight; });
  }, [activeAgentId, activeMessages.length]);

  useEffect(() => {
    if (!activeProjectId) {
      setFiles([]);
      setSessions([]);
      setGitInfo({ current: null, branches: [] });
      return;
    }
    const rememberedAgent = activeAgentByProject[activeProjectId];
    const fallbackAgent = agents.find(agent => agent.projectId === activeProjectId)?.id;
    setActiveAgentId(rememberedAgent && agents.some(agent => agent.id === rememberedAgent) ? rememberedAgent : fallbackAgent);

    setExpandedDirs(new Set());
    void api.files.list(activeProjectId).then(setFiles).catch(error => setLogs(current => [...current, String(error)]));
    void api.git.branches(activeProjectId).then(setGitInfo).catch(() => setGitInfo({ current: null, branches: [] }));
    void refreshSessions(activeProjectId);
  }, [activeProjectId, agents.length]);

  async function refreshProjects() {
    const next = await api.projects.list();
    setProjects(next);
    if (!activeProjectId && next.length > 0) setActiveProjectId(next[0].id);
  }

  async function refreshSessions(projectId = activeProjectId) {
    const next = await api.sessions.list(projectId);
    setSessions(next);
  }

  async function addProject() {
    const project = await api.projects.add();
    if (!project) return;
    await refreshProjects();
    setActiveProjectId(project.id);
    setActiveAgentId(undefined);
  }

  async function createAgent(projectId = activeProjectId, sessionPath?: string, title?: string) {
    if (!projectId) return;
    const existing = sessionPath ? agents.find(agent => agent.sessionPath === sessionPath) : undefined;
    if (existing) {
      setActiveAgentId(existing.id);
      setDrawer(null);
      return;
    }
    setAgentLoading({ text: sessionPath ? "正在打开历史会话…" : "正在创建 Agent…" });
    try {
      const tab = await api.agents.create({ projectId, sessionPath, title });
      setActiveAgentId(tab.id);
      void refreshRuntimeState(tab.id);
      setDrawer(null);
    } finally {
      setAgentLoading(null);
    }
  }

  async function refreshRuntimeState(agentId = activeAgentId) {
    if (!agentId) return;
    const state = await api.agents.runtimeState(agentId).catch(() => undefined);
    if (state) setRuntimeStateByAgent(current => ({ ...current, [agentId]: state }));
  }

  async function cycleModel() {
    if (!activeAgentId) return;
    const state = await api.agents.cycleModel(activeAgentId);
    setRuntimeStateByAgent(current => ({ ...current, [activeAgentId]: state }));
  }

  async function openModelPicker() {
    if (!activeAgentId) return;
    const models = await api.agents.availableModels(activeAgentId);
    setAvailableModels(models);
    setModelPickerOpen(true);
  }

  async function selectModel(model: AvailableModel) {
    if (!activeAgentId) return;
    const state = await api.agents.setModel(activeAgentId, model.provider, model.id);
    setRuntimeStateByAgent(current => ({ ...current, [activeAgentId]: state }));
    setModelPickerOpen(false);
  }

  async function cycleThinking() {
    if (!activeAgentId) return;
    const state = await api.agents.cycleThinking(activeAgentId);
    setRuntimeStateByAgent(current => ({ ...current, [activeAgentId]: state }));
  }

  async function closeAgent(agentId: string) {
    await api.agents.stop(agentId);
  }

  async function exportAgentHtml(agentId: string) {
    const result = await api.agents.exportHtml(agentId);
    setToast(`已导出：${result.path}`);
    setTimeout(() => setToast(null), 3500);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") { setPrompt(current => clearSuggestionTrigger(current)); setSuggestionsOpen(false); }
    if (event.key !== "Enter") return;

    const shouldSend =
      settings.sendShortcut === "enter-send" ? !event.ctrlKey && !event.metaKey && !event.shiftKey :
      settings.sendShortcut === "ctrl-enter-send" ? (event.ctrlKey || event.metaKey) :
      event.shiftKey;

    const shouldInsertNewline =
      settings.sendShortcut === "enter-send" ? (event.ctrlKey || event.metaKey || event.shiftKey) :
      !shouldSend;

    if (shouldSend) {
      event.preventDefault();
      void sendPrompt();
    } else if (shouldInsertNewline) {
      // 让 textarea 自己处理换行，保持输入体验接近普通聊天软件。
      return;
    }
  }

  async function sendPrompt() {
    if (!activeAgentId || !prompt.trim()) return;
    const message = prompt;
    setPrompt("");
    await api.agents.prompt({ agentId: activeAgentId, message });
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const next = await api.settings.update(patch);
    setSettings(next);
  }

  async function switchBranch(branch: string) {
    if (!activeProjectId || !branch || branch === gitInfo.current) return;
    const next = await api.git.checkout(activeProjectId, branch);
    setGitInfo(next);
  }

  function openDrawer(panel: DrawerPanel) {
    setDrawer(current => current === panel ? null : panel);
  }

  function toggleDirectory(path: string) {
    // 文件树默认折叠，只有用户显式展开目录才显示子项，避免大仓库一打开就产生视觉噪音。
    setExpandedDirs(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function startResize(target: "list" | "drawer", event: PointerEvent) {
    const startX = event.clientX;
    const startListWidth = listCollapsed ? 68 : listWidth;
    const startDrawerWidth = drawerCollapsed ? 0 : drawerWidth;
    let frame = 0;

    function onMove(moveEvent: globalThis.PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const delta = moveEvent.clientX - startX;
        if (target === "list") {
          const next = Math.min(440, Math.max(160, startListWidth + delta));
          setListCollapsed(next <= 170);
          setListWidth(next);
        } else {
          const next = Math.min(560, Math.max(180, startDrawerWidth - delta));
          setDrawerCollapsed(next <= 190);
          setDrawerWidth(next);
        }
      });
    }

    function onUp() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing");
    }

    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className={["wechat-shell", drawer ? "drawer-open" : "", listCollapsed ? "list-collapsed" : "", drawerCollapsed ? "drawer-collapsed" : ""].filter(Boolean).join(" ")} style={{ "--list-width": `${listCollapsed ? 68 : listWidth}px`, "--drawer-width": `${drawerCollapsed ? 0 : drawerWidth}px` } as React.CSSProperties}>
      <aside className="chat-list-pane">
        <div className="list-toolbar">
          <div className="app-badge"><LogoMark /><span>pi</span></div>
          <button className="icon-button" title="设置" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>
        <button className="collapse-button list-collapse" title={listCollapsed ? "展开列表" : "折叠列表"} onClick={() => setListCollapsed(value => !value)}>{listCollapsed ? "›" : "‹"}</button>

        <div className="search-row">
          <div className="search-box"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索" /></div>
          <button className="round-add" onClick={addProject}>＋</button>
        </div>

        <div className="conversation-list">
          {filteredProjects.map(project => {
            const projectAgents = filteredAgents.filter(agent => agent.projectId === project.id);
            return <div key={project.id} className="project-group">
              <button className={project.id === activeProjectId && !activeAgentId ? "conversation active" : "conversation"} onClick={() => { setActiveProjectId(project.id); setActiveAgentId(activeAgentByProject[project.id] ?? agents.find(agent => agent.projectId === project.id)?.id); }}>
                <ProjectAvatar name={project.name} />
                <div className="conversation-body">
                  <div className="conversation-title"><strong>{project.name}</strong><span>项目</span></div>
                  <p>{displayPath(project.path)}</p>
                </div>
                <span className="conversation-close" title="删除目录记录" onClick={async event => { event.stopPropagation(); const next = await api.projects.remove(project.id); setProjects(next); if (activeProjectId === project.id) { setActiveProjectId(next[0]?.id); setActiveAgentId(undefined); } }}>×</span>
              </button>
              {projectAgents.map(agent => (
                <button key={agent.id} className={agent.id === activeAgentId ? "conversation agent-row active" : "conversation agent-row"} onContextMenu={event => { event.preventDefault(); setAgentMenu({ x: event.clientX, y: event.clientY, agent }); }} onClick={() => { setActiveProjectId(project.id); setActiveAgentId(agent.id); }}>
                  <AgentAvatar status={agent.status} />
                  <div className="conversation-body">
                    <div className="conversation-title"><strong>{agent.title}</strong><span className={agent.status}>{agent.status}</span></div>
                    <p>{agent.sessionId ? `session ${agent.sessionId}` : displayPath(agent.cwd)}</p>
                  </div>
                  <span className="conversation-close" onClick={event => { event.stopPropagation(); void closeAgent(agent.id); }}>×</span>
                </button>
              ))}
            </div>;
          })}
        </div>
      </aside>

      <div className="splitter splitter-left" onPointerDown={event => startResize("list", event)} />

      <main className="chat-pane">
        <header className="chat-header">
          <div>
            <strong>{activeAgent?.title ?? activeProject?.name ?? "pi desktop"}</strong>
            <span>{activeAgent ? `${activeAgent.status} · ${displayPath(activeProject?.path ?? activeAgent.cwd)}` : "选择项目并创建 Agent"}</span>
            <SessionStatus state={activeRuntimeState} />
          </div>
          <div className="chat-header-actions">
            <BranchSelector gitInfo={gitInfo} onSwitch={switchBranch} />
            <button disabled={!activeAgentId} onClick={() => activeAgentId && api.agents.prompt({ agentId: activeAgentId, message: "/reload" })}>Reload</button>
            <button disabled={!activeProjectId} onClick={() => createAgent()}>New Agent</button>
            <button className={drawer === "files" ? "active" : ""} onClick={() => { setDrawerCollapsed(false); openDrawer("files"); }}>Files</button>
            <button className={drawer === "sessions" ? "active" : ""} onClick={() => { setDrawerCollapsed(false); openDrawer("sessions"); }}>History</button>
          </div>
        </header>

        <section className="message-timeline" ref={timelineRef}>
          {agentLoading && <div className="history-loading"><div className="loader" /><span>{agentLoading.text}</span></div>}
          {!agentLoading && !activeAgent && <EmptyState hasProject={Boolean(activeProjectId)} onCreate={() => createAgent()} />}
          <div className="message-list">
            {!agentLoading && activeMessages.map(message => <ChatBubble key={message.id} message={message} />)}
          </div>
          {!agentLoading && outlineItems.length > 1 && <ConversationOutline items={outlineItems} onJump={id => document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />}
        </section>

        <footer className="composer">
          <div className="composer-box">
            <ComposerToolbar state={activeRuntimeState} onCycleModel={cycleModel} onPickModel={openModelPicker} onCycleThinking={cycleThinking} />
            <textarea value={prompt} onFocus={() => setSuggestionsOpen(true)} onChange={event => { setPrompt(event.target.value); setSuggestionsOpen(true); }} onKeyDown={handleComposerKeyDown} placeholder={settings.sendShortcut === "enter-send" ? "输入消息，Enter 发送，Ctrl/Shift+Enter 换行。输入 / 或 @ 查看建议。" : "输入消息，按设置的快捷键发送。输入 / 或 @ 查看建议。"} />
            {suggestionsOpen && <PromptSuggestions prompt={prompt} commands={commands} files={flatFiles} onClose={() => { setPrompt(current => clearSuggestionTrigger(current)); setSuggestionsOpen(false); }} onPick={value => { setPrompt(current => applySuggestion(current, value)); setSuggestionsOpen(false); }} />}
            <div className="composer-footer"><span>{drawer ? "右侧面板可查看文件或恢复历史会话" : activeAgent?.sessionPath ?? ""}</span><button disabled={!activeAgentId || !prompt.trim()} onClick={sendPrompt}>发送</button></div>
          </div>
        </footer>
      </main>

      {drawer && !drawerCollapsed && <div className="splitter splitter-right" onPointerDown={event => startResize("drawer", event)} />}
      {drawer && !drawerCollapsed && <aside className="detail-drawer"><button className="collapse-button drawer-collapse" title="折叠面板" onClick={() => setDrawerCollapsed(true)}>›</button><DrawerContent panel={drawer} files={files} sessions={sessions} expandedDirs={expandedDirs} onToggleDirectory={toggleDirectory} onClose={() => setDrawer(null)} onFileContextMenu={(node, x, y) => setFileMenu({ node, x, y })} onRefreshSessions={() => refreshSessions()} onOpenSession={session => createAgent(activeProjectId, session.filePath, session.name || "历史会话")} /></aside>}
      {drawer && drawerCollapsed && <button className="drawer-restore" title="展开右侧面板" onClick={() => setDrawerCollapsed(false)}>{drawer === "files" ? "文件" : "历史"}</button>}
      {fileMenu && <FileContextMenu menu={fileMenu} onClose={() => setFileMenu(null)} onOpen={() => { void api.files.open(fileMenu.node.path); setFileMenu(null); }} onReveal={() => { void api.files.showInFolder(fileMenu.node.path); setFileMenu(null); }} onAttach={() => { setPrompt(current => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}@${fileMenu.node.relativePath} `); setFileMenu(null); }} />}
      {agentMenu && <AgentContextMenu menu={agentMenu} onClose={() => setAgentMenu(null)} onActivate={() => { setActiveAgentId(agentMenu.agent.id); setActiveProjectId(agentMenu.agent.projectId); setAgentMenu(null); }} onExport={() => { void exportAgentHtml(agentMenu.agent.id); setAgentMenu(null); }} onCloseAgent={() => { void closeAgent(agentMenu.agent.id); setAgentMenu(null); }} />}
      {toast && <div className="toast">{toast}</div>}
      {modelPickerOpen && <ModelPicker models={availableModels} onClose={() => setModelPickerOpen(false)} onPick={selectModel} />}
      {settingsOpen && <SettingsModal settings={settings} notice={settingsNotice} onClose={() => setSettingsOpen(false)} onChange={updateSettings} />}
    </div>
  );
}

function SessionStatus(props: { state?: AgentRuntimeState }) {
  if (!props.state) return null;
  return <div className="session-status"><span className="model-chip">{props.state.modelName ?? props.state.modelId ?? "model"}</span><span>think: {props.state.thinkingLevel ?? "-"}</span>{props.state.contextPercent != null && <span>ctx: {props.state.contextPercent?.toFixed?.(1) ?? props.state.contextPercent}% / {formatCompact(props.state.contextWindow)}</span>}{props.state.cacheTotal != null && <span>cache: {formatCompact(props.state.cacheTotal)}</span>}</div>;
}

function ComposerToolbar(props: { state?: AgentRuntimeState; onCycleModel: () => void; onPickModel: () => void; onCycleThinking: () => void }) {
  return <div className="composer-toolbar"><button onClick={props.onPickModel}>Model: {props.state?.modelName ?? "-"}</button><button onClick={props.onCycleModel}>Cycle Model</button><button onClick={props.onCycleThinking}>Think: {props.state?.thinkingLevel ?? "-"}</button></div>;
}

function ModelPicker(props: { models: AvailableModel[]; onClose: () => void; onPick: (model: AvailableModel) => void }) {
  return <div className="modal-backdrop" onClick={props.onClose}><div className="model-picker" onClick={event => event.stopPropagation()}><div className="modal-header"><strong>选择模型</strong><button onClick={props.onClose}>×</button></div><div className="model-list">{props.models.map(model => <button key={`${model.provider}/${model.id}`} onClick={() => props.onPick(model)}><strong>{model.name ?? model.id}</strong><span>{model.provider}/{model.id}</span></button>)}</div></div></div>;
}

function formatCompact(value?: number | null) {
  if (value == null) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function BranchSelector(props: { gitInfo: GitBranchInfo; onSwitch: (branch: string) => void }) {
  if (props.gitInfo.branches.length === 0) return null;
  return <label className="branch-select"><span className="branch-icon">⑂</span><select value={props.gitInfo.current ?? ""} onChange={event => props.onSwitch(event.target.value)}>{props.gitInfo.branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></label>;
}

function LogoMark() {
  return <div className="logo-mark" aria-label="pi desktop logo"><span>π</span><i /></div>;
}

function ProjectAvatar(props: { name: string }) {
  return <div className="conversation-avatar project-avatar"><span>{props.name.slice(0, 1).toUpperCase()}</span></div>;
}

function AgentAvatar(props: { status: string }) {
  return <div className={`conversation-avatar agent-avatar ${props.status}`}><span>π</span></div>;
}

function matches(value: string, keyword: string) {
  return !keyword.trim() || value.toLowerCase().includes(keyword.trim().toLowerCase());
}

function displayPath(path?: string) {
  if (!path) return "";
  const home = getHomePathPrefix();
  const normalized = path.replace(/\\/g, "/");
  const friendly = home && normalized.toLowerCase().startsWith(home.toLowerCase()) ? `~${normalized.slice(home.length)}` : normalized;
  return friendly.length > 36 ? `…${friendly.slice(-35)}` : friendly;
}

function getHomePathPrefix() {
  // 浏览器侧无法直接读取 OS home；从常见 Windows 用户路径中提取到 /Users/name，其他路径保持原样。
  const match = location.href.match(/file:\/\/\/([A-Za-z]:\/Users\/[^/]+)/i);
  return match?.[1] ?? "C:/Users/14012";
}

function EmptyState(props: { hasProject: boolean; onCreate: () => void }) {
  return <div className="empty-state"><div className="empty-logo">π</div><h2>开始一个 pi agent</h2><p>{props.hasProject ? "创建 agent 后即可开始对话。" : "先从左侧添加项目目录。"}</p>{props.hasProject && <button onClick={props.onCreate}>Create Agent</button>}</div>;
}

function ChatBubble(props: { message: ChatMessage }) {
  const { message } = props;
  const [expanded, setExpanded] = useState(false);
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const label = message.role === "assistant" ? "pi" : message.role;
  const detailText = typeof message.meta?.detailText === "string" ? message.meta.detailText : JSON.stringify(message.meta ?? {}, null, 2);
  return <article data-message-id={message.id} className={isUser ? "chat-message mine" : `chat-message ${message.role}`}><div className="msg-avatar">{isUser ? "我" : label.slice(0, 1).toUpperCase()}</div><div className="msg-content"><div className="msg-name"><span>{label}</span><time>{formatTime(message.timestamp)}</time></div><div className="msg-bubble markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>{expanded && <pre className="tool-detail">{detailText}</pre>}</div><div className="msg-actions"><button onClick={() => navigator.clipboard.writeText(expanded && isTool ? detailText : message.text)}>复制</button>{isTool && <button onClick={() => setExpanded(value => !value)}>{expanded ? "收起详情" : "查看详情"}</button>}</div></div></article>;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function buildOutline(messages: ChatMessage[]) {
  return messages.filter(message => message.role === "user" || message.role === "assistant").map(message => ({ id: message.id, role: message.role, title: summarizeMessage(message.text), time: formatTime(message.timestamp) })).filter(item => item.title);
}

function summarizeMessage(text: string) {
  const firstLine = text.replace(/```[\s\S]*?```/g, " ").split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "";
  return firstLine.length > 34 ? `${firstLine.slice(0, 34)}…` : firstLine;
}

function ConversationOutline(props: { items: Array<{ id: string; role: string; title: string; time: string }>; onJump: (id: string) => void }) {
  return <div className="outline-hover"><button className="outline-trigger" title="会话定位">☰</button><nav className="conversation-outline"><div className="outline-title">会话定位</div>{props.items.slice(-10).map(item => <button key={item.id} className={item.role === "user" ? "outline-user" : "outline-assistant"} onClick={() => props.onJump(item.id)}><strong>{item.title}</strong><span>{item.time}</span></button>)}</nav></div>;
}

function DrawerContent(props: { panel: DrawerPanel; files: FileTreeNode[]; sessions: SessionSummary[]; expandedDirs: Set<string>; onToggleDirectory: (path: string) => void; onClose: () => void; onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void; onRefreshSessions: () => void; onOpenSession: (session: SessionSummary) => void }) {
  const title = props.panel === "files" ? "文件" : "历史会话";
  return <><div className="drawer-header"><strong>{title}</strong><button onClick={props.onClose}>×</button></div>{props.panel === "files" && <FilesPanel files={props.files} expandedDirs={props.expandedDirs} onToggleDirectory={props.onToggleDirectory} onFileContextMenu={props.onFileContextMenu} />}{props.panel === "sessions" && <SessionsPanel sessions={props.sessions} onRefresh={props.onRefreshSessions} onOpen={props.onOpenSession} />}</>;
}

function FilesPanel(props: { files: FileTreeNode[]; expandedDirs: Set<string>; onToggleDirectory: (path: string) => void; onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void }) {
  return <div className="files-panel">{props.files.map(node => <FileNode key={node.path} node={node} expandedDirs={props.expandedDirs} onToggleDirectory={props.onToggleDirectory} onFileContextMenu={props.onFileContextMenu} />)}</div>;
}

function FileNode(props: { node: FileTreeNode; expandedDirs: Set<string>; onToggleDirectory: (path: string) => void; onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void }) {
  const { node, expandedDirs, onToggleDirectory } = props;
  const expanded = expandedDirs.has(node.path);
  const menu = (event: React.MouseEvent) => { event.preventDefault(); props.onFileContextMenu(node, event.clientX, event.clientY); };
  if (node.type === "file") return <div className="file-node"><button className="file" title={node.relativePath} onContextMenu={menu}><span>{fileIcon(node.name)}</span>{node.name}</button></div>;
  return <div className="file-node"><button className="directory" onClick={() => onToggleDirectory(node.path)} onContextMenu={menu} title={node.relativePath}><span>{expanded ? "▾" : "▸"}</span>{node.name}</button>{expanded && node.children && node.children.length > 0 && <div className="file-children">{node.children.map(child => <FileNode key={child.path} node={child} expandedDirs={expandedDirs} onToggleDirectory={onToggleDirectory} onFileContextMenu={props.onFileContextMenu} />)}</div>}</div>;
}

function fileIcon(name: string) {
  if (/\.(ts|tsx|js|jsx)$/.test(name)) return "◇";
  if (/\.(md|mdx)$/.test(name)) return "M";
  if (/\.(json|yaml|yml)$/.test(name)) return "{}";
  return "·";
}

function SessionsPanel(props: { sessions: SessionSummary[]; onRefresh: () => void; onOpen: (session: SessionSummary) => void }) {
  return <div className="sessions-panel"><div className="panel-action-row"><span>{props.sessions.length} sessions</span><button onClick={props.onRefresh}>刷新</button></div>{props.sessions.map(session => <button key={session.filePath} className="session-card" onClick={() => props.onOpen(session)} title={session.filePath}><strong>{session.name || "Untitled"}</strong><small>{new Date(session.updatedAt).toLocaleString()} · {session.messageCount} messages</small><p>{session.preview}</p></button>)}</div>;
}

function flattenFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap(node => node.type === "file" ? [node] : flattenFiles(node.children ?? []));
}

function applySuggestion(current: string, value: string) {
  const index = findTriggerIndex(current);
  if (index === -1) return `${current}${value} `;
  return `${current.slice(0, index)}${value} `;
}

function clearSuggestionTrigger(current: string) {
  const index = findTriggerIndex(current);
  if (index === -1) return current;
  return current.slice(0, index);
}

function findTriggerIndex(current: string) {
  const lastSlash = current.lastIndexOf("/");
  const lastAt = current.lastIndexOf("@");
  return Math.max(lastSlash, lastAt);
}

function PromptSuggestions(props: { prompt: string; commands: PiCommand[]; files: FileTreeNode[]; onClose: () => void; onPick: (value: string) => void }) {
  const tail = props.prompt.split(/\s/).at(-1) ?? "";
  if (tail.startsWith("/")) {
    const keyword = tail.slice(1).toLowerCase();
    const commands = props.commands.filter(command => command.name.toLowerCase().includes(keyword)).slice(0, 8);
    if (commands.length === 0) return null;
    return <div className="suggestions"><button className="suggestion-close" onClick={props.onClose}>关闭</button>{commands.map(command => <button key={command.name} onClick={() => props.onPick(`/${command.name}`)}><strong>/{command.name}</strong><span>{command.description}</span></button>)}</div>;
  }
  if (tail.startsWith("@")) {
    const keyword = tail.slice(1).toLowerCase();
    const files = props.files.map(file => ({ file, score: fuzzyScore(file.relativePath, keyword) + fuzzyScore(file.name, keyword) * 2 })).filter(item => item.score > 0 || !keyword).sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.file);
    if (files.length === 0) return null;
    return <div className="suggestions"><button className="suggestion-close" onClick={props.onClose}>关闭</button>{files.map(file => <button key={file.path} onClick={() => props.onPick(`@${file.relativePath}`)}><strong>@{file.name}</strong><span>{file.relativePath}</span></button>)}</div>;
  }
  return null;
}

function FileContextMenu(props: { menu: { x: number; y: number; node: FileTreeNode }; onClose: () => void; onOpen: () => void; onReveal: () => void; onAttach: () => void }) {
  const isFile = props.menu.node.type === "file";
  return <div className="context-backdrop" onClick={props.onClose}><div className="context-menu" style={{ left: props.menu.x, top: props.menu.y }} onClick={event => event.stopPropagation()}><button disabled={!isFile} onClick={props.onAttach}>加入对话引用</button><button disabled={!isFile} onClick={props.onOpen}>默认方式打开</button><button onClick={props.onReveal}>在文件夹中显示</button></div></div>;
}

function AgentContextMenu(props: { menu: { x: number; y: number; agent: AgentTab }; onClose: () => void; onActivate: () => void; onExport: () => void; onCloseAgent: () => void }) {
  return <div className="context-backdrop" onClick={props.onClose}><div className="context-menu" style={{ left: props.menu.x, top: props.menu.y }} onClick={event => event.stopPropagation()}><button onClick={props.onActivate}>打开会话</button><button onClick={props.onExport}>导出 HTML</button><button onClick={props.onCloseAgent}>关闭 Agent</button></div></div>;
}

function fuzzyScore(value: string, keyword: string) {
  if (!keyword) return 1;
  const text = value.toLowerCase();
  const query = keyword.toLowerCase();
  if (text.includes(query)) return 100 + query.length;
  let score = 0;
  let pos = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, pos);
    if (found === -1) return 0;
    score += found === pos ? 8 : 2;
    pos = found + 1;
  }
  return score;
}

function SettingsModal(props: { settings: AppSettings; notice: string; onClose: () => void; onChange: (patch: Partial<AppSettings>) => void }) {
  return <div className="modal-backdrop" onClick={props.onClose}><div className="settings-modal" onClick={event => event.stopPropagation()}><div className="modal-header"><strong>设置</strong><button onClick={props.onClose}>×</button></div><div className="settings-panel"><label><input type="checkbox" checked={props.settings.useNativeTitleBar} onChange={event => props.onChange({ useNativeTitleBar: event.target.checked })} /> 使用原生标题栏</label><label><input type="checkbox" checked={props.settings.showNativeMenu} onChange={event => props.onChange({ showNativeMenu: event.target.checked })} /> 显示原生菜单</label><div className="setting-field"><span>发送快捷键</span><select value={props.settings.sendShortcut} onChange={event => props.onChange({ sendShortcut: event.target.value as AppSettings["sendShortcut"] })}><option value="enter-send">Enter 发送，Ctrl/Shift+Enter 换行</option><option value="ctrl-enter-send">Ctrl/⌘ + Enter 发送，Enter 换行</option><option value="shift-enter-send">Shift + Enter 发送，Enter 换行</option></select></div><p>{props.notice || "标题栏设置保存后需要重启应用生效。"}</p></div></div></div>;
}
