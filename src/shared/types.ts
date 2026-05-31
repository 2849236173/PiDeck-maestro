export type Project = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  pinned?: boolean;
};

export type AgentStatus = "starting" | "idle" | "running" | "error" | "closed";

export type AgentTab = {
  id: string;
  projectId: string;
  cwd: string;
  title: string;
  status: AgentStatus;
  sessionId?: string;
  sessionPath?: string;
  createdAt: number;
};

export type ChatRole = "user" | "assistant" | "tool" | "system" | "error";

export type ChatMessage = {
  id: string;
  agentId: string;
  role: ChatRole;
  text: string;
  timestamp: number;
  meta?: Record<string, unknown>;
};

export type FileTreeNode = {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

export type SessionSummary = {
  id: string;
  filePath: string;
  projectPath?: string;
  name?: string;
  preview: string;
  updatedAt: number;
  messageCount: number;
};

export type PiCommand = {
  name: string;
  description?: string;
  source?: string;
};

export type AgentRuntimeState = {
  modelName?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  contextTokens?: number | null;
  contextWindow?: number | null;
  contextPercent?: number | null;
  cacheRead?: number;
  cacheWrite?: number;
  cacheTotal?: number;
  cost?: number;
};

export type AvailableModel = {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
};

export type SendShortcutMode = "enter-send" | "ctrl-enter-send" | "shift-enter-send";

export type AppSettings = {
  useNativeTitleBar: boolean;
  showNativeMenu: boolean;
  sendShortcut: SendShortcutMode;
};

export type PiRuntimeEvent = {
  agentId: string;
  event: unknown;
};

export type GitBranchInfo = {
  current: string | null;
  branches: string[];
};

export type CreateAgentInput = {
  projectId: string;
  title?: string;
  sessionPath?: string;
};

export type SendPromptInput = {
  agentId: string;
  message: string;
  streamingBehavior?: "steer" | "followUp";
};
