import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleX, LoaderCircle, X } from 'lucide-react';
import type { PiDesktopApi } from '../../../../preload';
import type { MaestroGuiState, SubAgent, SubAgentStateUpdate } from '../../../../shared/types';
import { t } from '../../i18n';

interface SubAgentPanelProps {
  agentId: string;
  api: PiDesktopApi;
  onClose: () => void;
  /** 点击条目打开全屏详情弹层（弹层由 App 级持有，与对话流内嵌卡片共用） */
  onOpenDetail: (item: SubAgent) => void;
  /** 父会话是否空闲；用于标注未收尾的 workflow Run */
  agentIdle?: boolean;
  /** 把恢复指令填入 composer */
  onInsertPrompt?: (text: string) => void;
  /** 左侧边缘拖拽调宽的入口；宽度由 App 级 grid 列变量控制，面板只负责转发手势 */
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

const EMPTY_STATE: SubAgentStateUpdate = { running: [], completed: [] };
const EMPTY_MAESTRO_STATE: MaestroGuiState = { connected: false };

/** token 计数紧凑显示：1234 → 1.2k */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

const SECTION_COLLAPSE_KEY = 'pideck-subagent-sections';

function loadCollapsedSections(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SECTION_COLLAPSE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 可折叠分区标题；样式复用历史分区的 toggle */
function SectionToggle(props: { title: string; count?: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="subagent-history-toggle" onClick={props.onToggle} aria-expanded={!props.collapsed}>
      {props.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      <span>{props.title}</span>
      {props.count ? <span>{props.count}</span> : null}
    </button>
  );
}

/** maestro UCL 推送的目标/工作流/任务分区；字段形状由扩展决定，全部防御式解析，缺字段则不展示 */
function MaestroStateSections({ state, collapsed, onToggle, agentIdle, onInsertPrompt }: {
  state: MaestroGuiState;
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  /** 父会话已空闲；Run 仍挂 active 时说明未正常收尾（run-control done 未被调用） */
  agentIdle?: boolean;
  /** 把恢复指令填入 composer（不自动发送，用户确认后才走模型） */
  onInsertPrompt?: (text: string) => void;
}) {
  const [showAllTasks, setShowAllTasks] = useState(false);
  if (!state.connected) return null;

  const goal = state.goal && typeof state.goal === 'object' ? state.goal as Record<string, unknown> : undefined;
  const goalText = goal && typeof goal.text === 'string' ? goal.text : '';
  const goalStatus = goal && typeof goal.status === 'string' ? goal.status : '';
  const goalTokensUsed = goal && typeof goal.tokensUsed === 'number' ? goal.tokensUsed : undefined;
  const goalTokenBudget = goal && typeof goal.tokenBudget === 'number' ? goal.tokenBudget : undefined;

  const workflow = state.workflow && typeof state.workflow === 'object' ? state.workflow as Record<string, any> : undefined;
  const workflowLabel = workflow && typeof workflow.sessionLabel === 'string' ? workflow.sessionLabel : '';
  const workflowStatus = workflow && typeof workflow.status === 'string' ? workflow.status : '';
  const workflowRuns: any[] = workflow && Array.isArray(workflow.runs) ? workflow.runs : [];
  const activeRun = workflow && workflow.activeRun && typeof workflow.activeRun === 'object' ? workflow.activeRun : undefined;
  const completedRuns = workflowRuns.filter((run) => run && (run.status === 'completed' || run.status === 'done')).length;

  // UCL 在初始化/恢复窗口中可能短暂返回空对象或空 subject 占位项。
  // 渲染前统一标题字段并丢弃无可显示内容的记录，避免出现只有状态圆点的“空任务”；
  // title/name/description/command 兼容旧版本或其它 provider 的任务形状。
  const todos = Array.isArray(state.todos)
    ? state.todos.flatMap((task): Array<Record<string, any> & { displaySubject: string }> => {
        if (!task || typeof task !== 'object') return [];
        const record = task as Record<string, any>;
        const candidate = [record.subject, record.title, record.name, record.description, record.command]
          .find((value) => typeof value === 'string' && value.trim());
        if (typeof candidate !== 'string') return [];
        return [{ ...record, displaySubject: candidate.trim() }];
      })
    : [];

  return (
    <>
      {goalText ? (
        <section className="subagent-section maestro-panel-section">
          <SectionToggle title={t('maestroPanel.goal')} collapsed={Boolean(collapsed.goal)} onToggle={() => onToggle('goal')} />
          {collapsed.goal ? null : (
          <div className="maestro-panel-block">
            <div className="maestro-panel-line">
              {goalStatus ? <span className={`maestro-panel-chip ${goalStatus}`}>{goalStatus}</span> : null}
              {goalTokensUsed !== undefined ? (
                <span className="maestro-panel-meta">
                  {formatTokenCount(goalTokensUsed)}{goalTokenBudget ? ` / ${formatTokenCount(goalTokenBudget)}` : ''} {t('subAgent.tokens')}
                </span>
              ) : null}
            </div>
            <div className="maestro-panel-text">{goalText}</div>
          </div>
          )}
        </section>
      ) : null}
      {workflow ? (
        <section className="subagent-section maestro-panel-section">
          <SectionToggle
            title={t('maestroPanel.workflow')}
            count={workflowRuns.length > 0 ? `${completedRuns}/${workflowRuns.length}` : undefined}
            collapsed={Boolean(collapsed.workflow)}
            onToggle={() => onToggle('workflow')}
          />
          {collapsed.workflow ? null : (
          <div className="maestro-panel-block">
            {workflowRuns.length > 1 ? (
              <div className="maestro-run-dots">
                {workflowRuns.slice(0, 30).map((run, index) => {
                  const status = typeof run?.status === 'string' ? run.status : '';
                  const kind = status === 'completed' || status === 'done'
                    ? 'done'
                    : status === 'running' || status === 'active' || status === 'in_progress'
                      ? 'active'
                      : status === 'failed' || status === 'blocked'
                        ? 'failed'
                        : 'pending';
                  const label = `${typeof run?.sequence === 'number' ? `#${run.sequence} ` : ''}${typeof run?.command === 'string' ? run.command : ''}${status ? ` · ${status}` : ''}`.trim();
                  return <span key={index} className={`maestro-run-dot ${kind}`} title={label} />;
                })}
              </div>
            ) : null}
            <div className="maestro-panel-line">
              {workflowStatus ? <span className={`maestro-panel-chip ${workflowStatus}`}>{workflowStatus}</span> : null}
              {workflowLabel ? <span className="maestro-panel-meta">{workflowLabel}</span> : null}
            </div>
            {activeRun && typeof activeRun.command === 'string' ? (
              <div className="maestro-panel-text">
                {typeof activeRun.sequence === 'number' ? `#${activeRun.sequence} ` : ''}{activeRun.command}
                {typeof activeRun.status === 'string' ? ` · ${activeRun.status}` : ''}
              </div>
            ) : null}
            {typeof workflow.recoveryAction === 'string' && workflow.recoveryAction ? (
              <div className="maestro-panel-meta">{t('maestroPanel.recoveryHint')}: {workflow.recoveryAction}</div>
            ) : null}
            {activeRun && agentIdle ? (
              <div className="maestro-panel-stale">
                <span>{t('maestroPanel.runStale')}</span>
                {onInsertPrompt ? (
                  <button
                    type="button"
                    className="maestro-panel-recover-btn"
                    onClick={() => onInsertPrompt(t('maestroPanel.recoveryPrompt'))}
                  >
                    {t('maestroPanel.fillRecovery')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          )}
        </section>
      ) : null}
      {todos.length > 0 ? (
        <section className="subagent-section maestro-panel-section">
          <SectionToggle
            title={t('maestroPanel.tasks')}
            count={String(todos.length)}
            collapsed={Boolean(collapsed.tasks)}
            onToggle={() => onToggle('tasks')}
          />
          {collapsed.tasks ? null : (
          <>
          <ul className="maestro-todo-list maestro-panel-todos">
            {(showAllTasks ? todos : todos.slice(0, 20)).map((task, index) => {
              const status = typeof task.status === 'string' ? task.status : 'pending';
              const assignee = task.assignee && typeof task.assignee === 'object' && typeof task.assignee.label === 'string' && task.assignee.label !== 'root'
                ? task.assignee.label
                : undefined;
              return (
                <li key={typeof task.id === 'string' ? task.id : index} className={`maestro-todo-item ${status}`}>
                  <span className={`maestro-todo-status ${status}`} aria-hidden="true">
                    {status === 'completed'
                      ? <CheckCircle2 size={13} />
                      : status === 'in_progress'
                        ? <LoaderCircle size={13} className="maestro-todo-spinner" />
                        : status === 'blocked'
                          ? <CircleX size={13} />
                          : <span className="maestro-todo-dot" />}
                  </span>
                  <span className="maestro-todo-main">
                    <span className="maestro-todo-subject">{task.displaySubject}</span>
                    {assignee ? <span className="maestro-todo-assignee">@{assignee}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {!showAllTasks && todos.length > 20 ? (
            <button type="button" className="subagent-load-earlier" onClick={() => setShowAllTasks(true)}>
              {t('maestroPanel.showRemaining', { count: todos.length - 20 })}
            </button>
          ) : null}
          </>
          )}
        </section>
      ) : null}
    </>
  );
}

export function formatElapsed(startTime: number, endTime?: number) {
  const seconds = Math.max(0, Math.round(((endTime ?? Date.now()) - startTime) / 1000));
  if (seconds < 60) return t('subAgent.durationSeconds', { seconds });
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return t('subAgent.durationMinutesSeconds', { minutes, seconds: remainder });
}

const DETAIL_PAGE_SIZE = 24;

export function isSubAgentActive(status: string): boolean {
  return status === 'pending' || status === 'running' || status === 'finalizing';
}

/** 状态文案；面板条目与详情弹层共用 */
export function subAgentStatusLabel(status: string): string {
  return status === 'pending'
    ? t('subAgent.pending')
    : status === 'finalizing'
      ? t('subAgent.finalizing')
      : status === 'running'
        ? t('subAgent.statusRunning')
        : status === 'completed'
          ? t('subAgent.statusCompleted')
          : status === 'cancelled'
            ? t('subAgent.statusCancelled')
            : t('subAgent.failed');
}

/** 面板条目：一行概览，点击打开全屏详情弹层（Codex App 式体验）；详情渲染在 SubAgentDetailModal */
function SubAgentItem(props: { item: SubAgent; onOpenDetail: (item: SubAgent) => void }) {
  const { item, onOpenDetail } = props;
  const isActive = isSubAgentActive(item.status);
  // 停滞时用警示图标替换转圈：“停止输出 ≠ 完成”，避免用户误以为仍在正常运行
  const statusIcon = item.stalled
    ? <AlertTriangle size={15} aria-hidden="true" />
    : isActive
      ? <LoaderCircle size={15} className="subagent-status-spinner" aria-hidden="true" />
      : item.status === 'completed'
        ? <CheckCircle2 size={15} aria-hidden="true" />
        : <CircleX size={15} aria-hidden="true" />;

  return (
    <article className="subagent-item">
      <button
        type="button"
        className="subagent-item-trigger"
        onClick={() => onOpenDetail(item)}
        disabled={!item.sessionFile}
        title={item.sessionFile ? t('subAgent.openDetail') : undefined}
      >
        <span className={`subagent-item-status ${item.stalled ? 'stalled' : item.status}`}>{statusIcon}</span>
        <span className="subagent-item-main">
          <span className="subagent-item-name">{item.name || item.agent || item.id.slice(0, 8)}</span>
          <span className="subagent-item-meta">
            <span className={`subagent-status-label ${item.status}`}>{subAgentStatusLabel(item.status)}</span>
            {item.stalled ? <span className="subagent-stalled-chip">{t('subAgent.stalled')}</span> : null}
            {item.agent && item.name ? <span>{item.agent}</span> : null}
            <span>{formatElapsed(item.startTime, item.endTime)}</span>
            {typeof item.toolCount === 'number' ? <span>{item.toolCount} {t('subAgent.tools')}</span> : null}
            {typeof item.tokens === 'number' && item.tokens > 0 ? <span>{formatTokenCount(item.tokens)} {t('subAgent.tokens')}</span> : null}
          </span>
          {item.lastMessage ? <span className="subagent-item-preview">{item.lastMessage}</span> : null}
        </span>
        {item.sessionFile ? <ChevronRight size={15} /> : null}
      </button>
    </article>
  );
}

export function SubAgentPanel({ agentId, api, onClose, onOpenDetail, agentIdle, onInsertPrompt, onResizeStart }: SubAgentPanelProps) {
  const [state, setState] = useState<SubAgentStateUpdate>(EMPTY_STATE);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // 分区折叠状态持久化：面板内容变多后（目标/工作流/任务/运行中/历史）用户需要控制可见范围
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(loadCollapsedSections);
  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  };

  useEffect(() => {
    // IPC 事件携带父 Agent id；切换会话时先清空，避免短暂展示上一个会话的子代理。
    setState(EMPTY_STATE);
    const unsubscribe = api.subAgents.onState((payload) => {
      if (payload.agentId === agentId) setState(payload.update);
    });
    // 主动拉一次快照：推送已去重，无变化时不会再发事件，不拉取会一直空白。
    let cancelled = false;
    void api.subAgents.getState(agentId).then((snapshot) => {
      if (!cancelled && snapshot) setState(snapshot);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [agentId, api]);

  // maestro UCL（GUI SSE）状态：目标/工作流/任务分区；未连接时不展示任何内容
  const [maestroState, setMaestroState] = useState<MaestroGuiState>(EMPTY_MAESTRO_STATE);
  useEffect(() => {
    setMaestroState(EMPTY_MAESTRO_STATE);
    const unsubscribe = api.maestroGui.onState((payload) => {
      if (payload.agentId === agentId) setMaestroState(payload.state);
    });
    let cancelled = false;
    void api.maestroGui.getState(agentId).then((snapshot) => {
      if (!cancelled && snapshot) setMaestroState(snapshot);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [agentId, api]);

  // 主进程已对无变化状态去重推送；运行中条目的耗时需要本地计时器驱动重渲染才能每秒跳动。
  const hasRunning = state.running.length > 0;
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setElapsedTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunning]);

  const renderSection = (title: string, emptyText: string, items: SubAgent[]) => (
    <section className="subagent-section">
      <SectionToggle
        title={title}
        count={String(items.length)}
        collapsed={Boolean(collapsedSections.running)}
        onToggle={() => toggleSection('running')}
      />
      {collapsedSections.running ? null : items.length === 0 ? (
        <div className="subagent-empty">{emptyText}</div>
      ) : (
        items.map((item) => <SubAgentItem key={item.id} item={item} onOpenDetail={onOpenDetail} />)
      )}
    </section>
  );

  return (
    <aside className="subagent-panel" aria-label={t('subAgent.title')}>
      {onResizeStart ? (
        <div className="subagent-panel-resizer" onPointerDown={onResizeStart} aria-hidden="true" />
      ) : null}
      <header className="subagent-panel-header">
        <strong>{t('subAgent.title')}</strong>
        <span className="subagent-active-count">{t('subAgent.activeCount', { count: state.running.length })}</span>
        <button type="button" className="subagent-panel-close" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </header>
      <div className="subagent-panel-content">
        {/* 停滞警示：主会话空闲时没有人能接收完成通知，提供自助唤醒入口 */}
        {agentIdle && state.running.some((item) => item.stalled) ? (
          <div className="maestro-panel-stale subagent-stall-banner">
            <span>{t('subAgent.stallBanner', { count: state.running.filter((item) => item.stalled).length })}</span>
            {onInsertPrompt ? (
              <button
                type="button"
                className="maestro-panel-recover-btn"
                onClick={() => onInsertPrompt(t('subAgent.stallPrompt'))}
              >
                {t('maestroPanel.fillRecovery')}
              </button>
            ) : null}
          </div>
        ) : null}
        <MaestroStateSections state={maestroState} collapsed={collapsedSections} onToggle={toggleSection} agentIdle={agentIdle} onInsertPrompt={onInsertPrompt} />
        {renderSection(t('subAgent.running'), t('subAgent.noRunning'), state.running)}
        <section className="subagent-section subagent-history-section">
          <button type="button" className="subagent-history-toggle" onClick={() => setHistoryExpanded((expanded) => !expanded)} aria-expanded={historyExpanded}>
            {historyExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <span>{t('subAgent.history')}</span>
            <span>{state.completed.length}</span>
          </button>
          {historyExpanded && (state.completed.length === 0
            ? <div className="subagent-empty">{t('subAgent.noCompleted')}</div>
            : state.completed.map((item) => <SubAgentItem key={item.id} item={item} onOpenDetail={onOpenDetail} />))}
        </section>
      </div>
    </aside>
  );
}
