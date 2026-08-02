/**
 * 消息分页加载 Hook
 * 实现首屏加载最新消息，向上滚动时加载更多历史消息
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ChatMessage } from "../../../shared/types";

interface MessagePaginationOptions {
  messages: ChatMessage[];
  initialPageSize?: number;
  pageSize?: number;
  maxVisibleMessages?: number;
  /** 切换 Agent/会话时重置分页窗口。 */
  resetKey?: string | number | null;
  enabled?: boolean;
}

interface MessagePaginationResult {
  visibleMessages: ChatMessage[];
  hasMore: boolean;
  loadMore: () => void;
  /** 一次性扩展分页窗口直到包含指定索引的消息（用于会话定位跳转）。 */
  loadUntilIncluded: (index: number) => void;
  isLoading: boolean;
  reset: () => void;
  totalCount: number;
  visibleCount: number;
}

const DEFAULT_INITIAL_PAGE_SIZE = 100; // 首屏加载最近100条消息
const DEFAULT_PAGE_SIZE = 100; // 每次加载100条历史消息
const DEFAULT_MAX_VISIBLE = Infinity; // 默认无限制，但分批加载

export function useMessagePagination({
  messages,
  initialPageSize = DEFAULT_INITIAL_PAGE_SIZE,
  pageSize = DEFAULT_PAGE_SIZE,
  maxVisibleMessages = DEFAULT_MAX_VISIBLE,
  resetKey = null,
  enabled = true,
}: MessagePaginationOptions): MessagePaginationResult {
  const [visibleCount, setVisibleCount] = useState(initialPageSize);
  const [isLoading, setIsLoading] = useState(false);

  // 重置分页状态
  const reset = useCallback(() => {
    setVisibleCount(initialPageSize);
    setIsLoading(false);
  }, [initialPageSize]);

  // 跟踪上一次的完整消息数量，用于区分追加、收缩和分页操作。
  const prevMessageCountRef = useRef(messages.length);

  // 切换 Agent 时重新从首屏窗口开始，并同步长度基线，避免切换瞬间被误判为压缩收缩。
  useEffect(() => {
    prevMessageCountRef.current = messages.length;
    reset();
  }, [resetKey, reset]);

  // 会话切换到空列表时也恢复初始窗口。
  useEffect(() => {
    if (messages.length === 0) reset();
  }, [messages.length, reset]);

  // 消息因压缩而收缩时，旧的尾部分页窗口已不再对应原来的消息边界；
  // 临时展示当前全量，确保压缩卡片和归档区不会落在分页窗口之外。
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const delta = messages.length - prev;
    prevMessageCountRef.current = messages.length;
    if (delta < 0) {
      setVisibleCount(Math.min(messages.length, maxVisibleMessages));
      return;
    }
    if (!enabled || delta === 0 || delta >= 10) return;
    setVisibleCount((prevCount) =>
      Math.min(prevCount + delta, messages.length, maxVisibleMessages),
    );
  }, [messages.length, enabled, maxVisibleMessages]);

  // 加载更多历史消息
  const loadMore = useCallback(() => {
    if (!enabled || isLoading) return;

    setIsLoading(true);

    // 模拟异步加载，使用 requestAnimationFrame 保持流畅
    requestAnimationFrame(() => {
      setVisibleCount((prev) => {
        const next = prev + pageSize;
        const capped = Math.min(next, maxVisibleMessages, messages.length);
        return capped;
      });
      setIsLoading(false);
    });
  }, [enabled, isLoading, pageSize, maxVisibleMessages, messages.length]);

  // 一次性把分页窗口扩展到包含 `index`（在完整 messages 数组中的下标）。
  // 可见窗口始终取末尾 visibleCount 条，起始 = length - visibleCount；
  // 要包含 index 需要 visibleCount >= length - index，取较大值并封顶。
  // 用于右侧“会话定位”点击未加载的旧消息时，先把该消息加载进可视范围再滚动定位。
  const loadUntilIncluded = useCallback(
    (index: number) => {
      if (!enabled || index < 0 || index >= messages.length) return;
      const needed = messages.length - index;
      setVisibleCount((prev) =>
        Math.min(Math.max(prev, needed), messages.length, maxVisibleMessages),
      );
    },
    [enabled, messages.length, maxVisibleMessages],
  );

  // 可见的消息列表（从末尾开始取）
  const visibleMessages = useMemo(() => {
    if (!enabled) return messages;

    const start = Math.max(0, messages.length - visibleCount);
    return messages.slice(start);
  }, [messages, visibleCount, enabled]);

  const hasMore = enabled && visibleCount < messages.length && visibleCount < maxVisibleMessages;

  return {
    visibleMessages,
    hasMore,
    loadMore,
    loadUntilIncluded,
    isLoading,
    reset,
    totalCount: messages.length,
    visibleCount: visibleMessages.length,
  };
}
