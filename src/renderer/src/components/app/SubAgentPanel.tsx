import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleX, LoaderCircle, X } from 'lucide-react';
import type { PiDesktopApi } from '../../../../preload';
import type { ChatMessage, SubAgent, SubAgentStateUpdate } from '../../../../shared/types';
import { t } from '../../i18n';

interface SubAgentPanelProps {
  agentId: string;
  api: PiDesktopApi;
  onClose: () => void;
}

const EMPTY_STATE: SubAgentStateUpdate = { running: [], completed: [] };

function formatElapsed(startTime: number, endTime?: number) {
  const seconds = Math.max(0, Math.round(((endTime ?? Date.now()) - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function SubAgentItem(props: { agentId: string; item: SubAgent; api: PiDesktopApi }) {
  const { agentId, item, api } = props;
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

  const statusIcon = item.status === 'running'
    ? <LoaderCircle size={15} className="subagent-status-spinner" aria-hidden="true" />
    : item.status === 'completed'
      ? <CheckCircle2 size={15} aria-hidden="true" />
      : <CircleX size={15} aria-hidden="true" />;

  return (
    <article className="subagent-item">
      <button type="button" className="subagent-item-trigger" onClick={() => void toggle()} aria-expanded={expanded}>
        <span className={`subagent-item-status ${item.status}`}>{statusIcon}</span>
        <span className="subagent-item-main">
          <span className="subagent-item-name">{item.name || item.agent || item.id.slice(0, 8)}</span>
          <span className="subagent-item-meta">
            {item.agent && item.name ? <span>{item.agent}</span> : null}
            <span>{formatElapsed(item.startTime, item.endTime)}</span>
            {typeof item.toolCount === 'number' ? <span>{item.toolCount} {t('subAgent.tools')}</span> : null}
          </span>
          {item.lastMessage ? <span className="subagent-item-preview">{item.lastMessage}</span> : null}
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {expanded && (
        <div className="subagent-item-details">
          {loading ? <div className="subagent-detail-state">{t('subAgent.loading')}</div> : null}
          {loadFailed ? <div className="subagent-detail-state error">{t('subAgent.loadFailed')}</div> : null}
          {messages && messages.length > 0 ? (
            <div className="subagent-message-list">
              {messages.slice(-12).map((message) => (
                <div key={message.id} className={`subagent-message ${message.role}`}>
                  <span>{message.role}</span>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function SubAgentPanel({ agentId, api, onClose }: SubAgentPanelProps) {
  const [state, setState] = useState<SubAgentStateUpdate>(EMPTY_STATE);

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
        items.map((item) => <SubAgentItem key={item.id} agentId={agentId} item={item} api={api} />)
      )}
    </section>
  );

  return (
    <aside className="subagent-panel" aria-label={t('subAgent.title')}>
      <header className="subagent-panel-header">
        <strong>{t('subAgent.title')}</strong>
        <button type="button" className="subagent-panel-close" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </header>
      <div className="subagent-panel-content">
        {renderSection(t('subAgent.running'), t('subAgent.noRunning'), state.running)}
        {renderSection(t('subAgent.completed'), t('subAgent.noCompleted'), state.completed)}
      </div>
    </aside>
  );
}
