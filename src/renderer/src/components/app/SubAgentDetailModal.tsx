import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageContent } from '../../../../shared/types';
import { CheckCircle2, CircleX, Copy, LoaderCircle } from 'lucide-react';
import type { PiDesktopApi } from '../../../../preload';
import type { ChatMessage, SubAgent } from '../../../../shared/types';
import { t } from '../../i18n';
import { showNotice } from '../../utils/notice';
import { IconButton, CloseIconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { AssistantText, ThinkingBlock, ToolCard } from './AppParts';
import { formatElapsed, formatTokenCount, isSubAgentActive, subAgentStatusLabel } from './SubAgentPanel';

/**
 * 子代理全屏详情弹层（Codex App 式的"点击查看完整会话"体验）。
 *
 * - refId 支持面板条目 id 或 teammate correlationId（对话流内嵌卡片只有后者），
 *   主进程 loadSubAgentDetail 会按两者依次寻址；
 * - 打开期间对运行中的子代理 2s 轮询刷新，转入终态后补拉一次并停止；
 * - 消息渲染复用主会话同款组件（AssistantText/ThinkingBlock/ToolCard）。
 */
interface SubAgentDetailModalProps {
	api: PiDesktopApi;
	agentId: string;
	/** 面板条目 id 或 correlationId */
	refId: string;
	onClose: () => void;
	onOpenFile?: (path: string) => void;
	showThinking?: boolean;
	/** 全局 lightbox 预览（z-index 高于 Radix 弹层，可直接叠加） */
	onPreviewImage?: (image: ImageContent) => void;
}

const MODAL_PAGE_SIZE = 100;

export function SubAgentDetailModal({ api, agentId, refId, onClose, onOpenFile, showThinking = true, onPreviewImage }: SubAgentDetailModalProps) {
	const [messages, setMessages] = useState<ChatMessage[] | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [visibleCount, setVisibleCount] = useState(MODAL_PAGE_SIZE);
	const [item, setItem] = useState<SubAgent | null>(null);
	const refreshingRef = useRef(false);
	// 终态后已经补拉过一次，避免继续无意义轮询
	const finalLoadedRef = useRef(false);
	// 运行中自动跟随到底部；用户向上滚动后停止跟随，回到底部附近恢复
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const stickToBottomRef = useRef(true);

	const refresh = useCallback(async () => {
		if (refreshingRef.current) return;
		refreshingRef.current = true;
		try {
			const [detail, state] = await Promise.all([
				api.subAgents.loadDetail(agentId, refId),
				api.subAgents.getState(agentId),
			]);
			const matched = [...state.running, ...state.completed].find(
				(candidate) => candidate.id === refId || candidate.correlationId === refId,
			);
			setItem(matched ?? null);
			setMessages(detail);
			setLoadFailed(detail.length === 0 && !matched);
		} catch {
			setLoadFailed(true);
		} finally {
			refreshingRef.current = false;
		}
	}, [agentId, api, refId]);

	useEffect(() => {
		setMessages(null);
		setItem(null);
		setLoadFailed(false);
		setVisibleCount(MODAL_PAGE_SIZE);
		finalLoadedRef.current = false;
		void refresh();
	}, [refresh]);

	const active = item ? isSubAgentActive(item.status) : true;
	useEffect(() => {
		if (!active) {
			// 转入终态后补拉一次，确保拿到最终回答
			if (!finalLoadedRef.current) {
				finalLoadedRef.current = true;
				void refresh();
			}
			return;
		}
		const timer = setInterval(() => { void refresh(); }, 2000);
		return () => clearInterval(timer);
	}, [active, refresh]);

	useEffect(() => {
		if (!stickToBottomRef.current) return;
		const body = bodyRef.current;
		if (body) body.scrollTop = body.scrollHeight;
	}, [messages]);

	const handleBodyScroll = () => {
		const body = bodyRef.current;
		if (!body) return;
		stickToBottomRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
	};

	const copyFinalReply = async () => {
		try {
			const source = messages ?? [];
			const lastAssistant = [...source].reverse().find((message) => message.role === 'assistant' && message.text.trim());
			const text = lastAssistant?.text.trim() || item?.lastMessage;
			if (!text) return;
			await navigator.clipboard.writeText(text);
			showNotice(t('subAgent.copied'), 1200);
		} catch {
			showNotice(t('copy.failed'), 2000);
		}
	};

	const statusIcon = !item || isSubAgentActive(item.status)
		? <LoaderCircle size={16} className="subagent-status-spinner" aria-hidden="true" />
		: item.status === 'completed'
			? <CheckCircle2 size={16} aria-hidden="true" />
			: <CircleX size={16} aria-hidden="true" />;

	return (
		<Modal open onClose={onClose} size="medium" contentClassName="subagent-detail-modal">
			<header className="subagent-detail-header">
				<span className={`subagent-item-status ${item?.status ?? 'running'}`}>{statusIcon}</span>
				<div className="subagent-detail-titles">
					<strong>{item?.name || item?.agent || refId.slice(0, 8)}</strong>
					<span className="subagent-item-meta">
						{item ? <span className={`subagent-status-label ${item.status}`}>{subAgentStatusLabel(item.status)}</span> : null}
						{item?.agent && item?.name ? <span>{item.agent}</span> : null}
						{item ? <span>{formatElapsed(item.startTime, item.endTime)}</span> : null}
						{typeof item?.toolCount === 'number' ? <span>{item.toolCount} {t('subAgent.tools')}</span> : null}
						{typeof item?.tokens === 'number' && item.tokens > 0 ? <span>{formatTokenCount(item.tokens)} {t('subAgent.tokens')}</span> : null}
					</span>
				</div>
				<IconButton label={t('subAgent.copyLastMessage')} className="subagent-copy-btn" onClick={() => void copyFinalReply()}>
					<Copy size={15} aria-hidden="true" />
				</IconButton>
				<CloseIconButton label={t('common.close')} onClick={onClose} />
			</header>
			<div className="subagent-detail-body" ref={bodyRef} onScroll={handleBodyScroll}>
				{messages === null && !loadFailed ? <div className="subagent-detail-state">{t('subAgent.loading')}</div> : null}
				{loadFailed ? <div className="subagent-detail-state error">{t('subAgent.loadFailed')}</div> : null}
				{messages && messages.length > visibleCount ? (
					<button
						type="button"
						className="subagent-load-earlier"
						onClick={() => setVisibleCount((count) => count + MODAL_PAGE_SIZE)}
					>
						{t('subAgent.showEarlier', { count: messages.length - visibleCount })}
					</button>
				) : null}
				{messages && messages.length > 0 ? (
					<div className="subagent-message-list subagent-detail-messages">
						{messages.slice(-visibleCount).map((message) => (
							<article key={message.id} className={`subagent-message ${message.role}`}>
								<header>{message.role === 'assistant' ? t('subAgent.assistant') : message.role === 'user' ? t('subAgent.user') : message.role}</header>
								{message.role === 'assistant' ? (
									<>
										{message.thinking ? <ThinkingBlock text={message.thinking} showThinking={showThinking} /> : null}
										{message.text.trim() ? (
											<AssistantText
												text={message.text}
												images={message.images}
												onPreviewImage={onPreviewImage ?? (() => undefined)}
												onOpenExternal={(url) => void api.app.openExternal(url)}
												onOpenFile={onOpenFile}
											/>
										) : null}
									</>
								) : message.role === 'tool' ? (
									<ToolCard message={message} onPreviewImage={onPreviewImage} />
								) : (
									<div className="subagent-message-plain">{message.text}</div>
								)}
							</article>
						))}
					</div>
				) : null}
			</div>
		</Modal>
	);
}
