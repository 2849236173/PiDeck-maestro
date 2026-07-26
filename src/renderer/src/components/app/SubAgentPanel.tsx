import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleX, LoaderCircle, X } from 'lucide-react';
import type { PiDesktopApi } from '../../../../preload';
import type { ChatMessage, SubAgent, SubAgentStateUpdate } from '../../../../shared/types';
import { t } from '../../i18n';
import { AssistantText, ThinkingBlock, ToolCard } from './AppParts';

interface SubAgentPanelProps {
  agentId: string;
  api: PiDesktopApi;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
  showThinking?: boolean;
}

const EMPTY_STATE: SubAgentStateUpdate = { running: [], completed: [] };

function formatElapsed(startTime: number, endTime?: number) {
  const seconds = Math.max(0, Math.round(((endTime ?? Date.now()) - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function SubAgentItem(props: { agentId: string; item: SubAgent; api: PiDesktopApi; onOpenFile?: (path: string) => void; showThinking?: boolean }) {
  const { agentId, item, api, onOpenFile, showThinking = true } = props;
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setMessages(null);
    setLoadFailed(false);
  }, [agentId, item.id]);

  const toggle = async () => {
    if (!item.sessionFile) return;
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || messages || loading) return;

    setLoading(true);
    setLoadFailed(false);
    try {
      setMessages(await api.subAgents.loadDetail(agentId, item.id));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const isActive = item.status === 'pending' || item.status === 'running' || item.status === 'finalizing';
  const statusIcon = isActive
    ? <LoaderCircle size={15} className="subagent-status-spinner" aria-hidden="true" />
    : item.status === 'completed'
      ? <CheckCircle2 size={15} aria-hidden="true" />
      : <CircleX size={15} aria-hidden="true" />;
  const statusLabel = item.status === 'pending'
    ? t('subAgent.pending')
    : item.status === 'finalizing'
      ? t('subAgent.finalizing')
      : item.status === 'running'
        ? t('subAgent.statusRunning')
        : item.status === 'completed'
          ? t('subAgent.statusCompleted')
          : item.status === 'cancelled'
            ? t('subAgent.statusCancelled')
            : t('subAgent.failed');

  return (
    <article className="subagent-item">
      <button type="button" className="subagent-item-trigger" onClick={() => void toggle()} aria-expanded={expanded} disabled={!item.sessionFile}>
        <span className={`subagent-item-status ${item.status}`}>{statusIcon}</span>
        <span className="subagent-item-main">
          <span className="subagent-item-name">{item.name || item.agent || item.id.slice(0, 8)}</span>
          <span className="subagent-item-meta">
            <span className={`subagent-status-label ${item.status}`}>{statusLabel}</span>
            {item.agent && item.name ? <span>{item.agent}</span> : null}
            <span>{formatElapsed(item.startTime, item.endTime)}</span>
            {typeof item.toolCount === 'number' ? <span>{item.toolCount} {t('subAgent.tools')}</span> : null}
          </span>
          {item.lastMessage ? <span className="subagent-item-preview">{item.lastMessage}</span> : null}
        </span>
        {item.sessionFile ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
      </button>
      {expanded && (
        <div className="subagent-item-details">
          {loading ? <div className="subagent-detail-state">{t('subAgent.loading')}</div> : null}
          {loadFailed ? <div className="subagent-detail-state error">{t('subAgent.loadFailed')}</div> : null}
          {messages && messages.length > 0 ? (
            <div className="subagent-message-list">
              {messages.slice(-24).map((message) => (
                <article key={message.id} className={`subagent-message ${message.role}`}>
                  <header>{message.role === 'assistant' ? t('subAgent.assistant') : message.role === 'user' ? t('subAgent.user') : message.role}</header>
                  {message.role === 'assistant' ? (
                    <>
                      {message.thinking ? <ThinkingBlock text={message.thinking} showThinking={showThinking} /> : null}
                      {message.text.trim() ? (
                        <AssistantText
                          text={message.text}
                          images={message.images}
                          onPreviewImage={() => undefined}
                          onOpenExternal={(url) => void api.app.openExternal(url)}
                          onOpenFile={onOpenFile}
                        />
                      ) : null}
                    </>
                  ) : message.role === 'tool' ? (
                    <ToolCard message={message} />
                  ) : (
                    <div className="subagent-message-plain">{message.text}</div>
                  )}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function SubAgentPanel({ agentId, api, onClose, onOpenFile, showThinking = true }: SubAgentPanelProps) {
  const [state, setState] = useState<SubAgentStateUpdate>(EMPTY_STATE);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    // IPC 事件携带父 Agent id；切换会话时先清空，避免短暂展示上一个会话的子代理。
    setState(EMPTY_STATE);
    return api.subAgents.onState((payload) => {
      if (payload.agentId === agentId) setState(payload.update);
    });
  }, [agentId, api]);

  const renderSection = (title: string, emptyText: string, items: SubAgent[]) => (
    <section className="subagent-section">
      <h3 className="subagent-section-title">{title} ({items.length})</h3>
      {items.length === 0 ? (
        <div className="subagent-empty">{emptyText}</div>
      ) : (
        items.map((item) => <SubAgentItem key={item.id} agentId={agentId} item={item} api={api} onOpenFile={onOpenFile} showThinking={showThinking} />)
      )}
    </section>
  );

  return (
    <aside className="subagent-panel" aria-label={t('subAgent.title')}>
      <header className="subagent-panel-header">
        <strong>{t('subAgent.title')}</strong>
        <span className="subagent-active-count">{t('subAgent.activeCount', { count: state.running.length })}</span>
        <button type="button" className="subagent-panel-close" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </header>
      <div className="subagent-panel-content">
        {renderSection(t('subAgent.running'), t('subAgent.noRunning'), state.running)}
        <section className="subagent-section subagent-history-section">
          <button type="button" className="subagent-history-toggle" onClick={() => setHistoryExpanded((expanded) => !expanded)} aria-expanded={historyExpanded}>
            {historyExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <span>{t('subAgent.history')}</span>
            <span>{state.completed.length}</span>
          </button>
          {historyExpanded && (state.completed.length === 0
            ? <div className="subagent-empty">{t('subAgent.noCompleted')}</div>
            : state.completed.map((item) => <SubAgentItem key={item.id} agentId={agentId} item={item} api={api} onOpenFile={onOpenFile} showThinking={showThinking} />))}
        </section>
      </div>
    </aside>
  );
}
