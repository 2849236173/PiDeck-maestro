import { t } from '../../i18n';

interface SubAgentPanelProps {
  agentId: string;
}

export function SubAgentPanel({ agentId }: SubAgentPanelProps) {
  // TODO: 实现完整的子代理状态追踪
  // 需要在 preload API 中添加 subAgents 相关的方法
  // 需要在 AgentManager 中实现子代理状态扫描和缓存逻辑
  
  return (
    <div className="sub-agent-panel">
      <div className="sub-agent-section">
        <div className="sub-agent-section-header">
          {t('subAgent.running')} (0)
        </div>
        <div className="sub-agent-list sub-agent-empty">
          {t('subAgent.noRunning')}
        </div>
      </div>
      
      <div className="sub-agent-section">
        <div className="sub-agent-section-header">
          {t('subAgent.completed')} (0)
        </div>
        <div className="sub-agent-list sub-agent-empty">
          {t('subAgent.noCompleted')}
        </div>
      </div>
    </div>
  );
}
