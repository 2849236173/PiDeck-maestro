import { get as httpGet, type IncomingMessage, type ClientRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MaestroGuiState } from "../../shared/types";

/**
 * pi-maestro-flow UCL（GUI SSE）侧车的桌面端客户端。
 *
 * 每个 agent 一个实例：PiDeck 启动 pi 时注入 PI_GUI=1 + PI_GUI_PORT，
 * maestro 扩展在该端口起 loopback HTTP+SSE 服务，并把 token 写入
 * `<cwd>/.workflow/gui.json`。本类轮询发现文件（按端口匹配自己的记录，
 * 规避同项目多会话互踩），拿到 token 后拉取聚合状态并订阅事件流。
 *
 * 设计约束（对应风险评估结论）：
 * - 只读：只用 /state 拉取与 /events 订阅，不调用工具路由；
 * - 增强不替换：teammate.* 事件仅透传给 AgentManager 补充 tokens 等字段，
 *   子代理面板的主状态机仍走既有反推路径；
 * - 静默降级：会话未装 maestro（发现文件永不出现）或 SSE 断连时，
 *   snapshot.connected=false，上层 UI 隐藏相关分区即可。
 */

/** 推送给渲染端的 maestro 状态快照；共享类型见 shared/types.ts */
export type MaestroGuiSnapshot = MaestroGuiState;

interface MaestroGuiChannelOptions {
	agentId: string;
	/** 项目目录（发现文件所在位置的父目录） */
	cwd: string;
	/** 通过 PI_GUI_PORT 注入的端口，用于匹配发现文件中属于本会话的记录 */
	port: number;
	onSnapshot: (snapshot: MaestroGuiSnapshot) => void;
	onTeammateEvent?: (eventName: string, payload: unknown) => void;
}

/** 发现文件轮询间隔：前 2 分钟 1.5s（等扩展启动），之后降到 15s（大概率没装 maestro） */
const DISCOVER_FAST_MS = 1500;
const DISCOVER_SLOW_MS = 15000;
const DISCOVER_FAST_WINDOW_MS = 2 * 60 * 1000;
const RECONNECT_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 5000;
const REFETCH_DEBOUNCE_MS = 300;
/** 周期性安全刷新：兼容事件丢失/上游未发事件的状态变化（如 run 被外部收尾） */
const SAFETY_REFRESH_MS = 30_000;

export class MaestroGuiChannel {
	private token: string | null = null;
	private stopped = false;
	private discoverTimer: NodeJS.Timeout | null = null;
	private discoverStartedAt = 0;
	private sseRequest: ClientRequest | null = null;
	private safetyTimer: NodeJS.Timeout | null = null;
	private readonly refetchTimers = new Map<string, NodeJS.Timeout>();
	private readonly snapshot: MaestroGuiSnapshot = { connected: false };

	constructor(private readonly options: MaestroGuiChannelOptions) {}

	start() {
		if (this.stopped) return;
		this.discoverStartedAt = Date.now();
		this.scheduleDiscover(0);
	}

	stop() {
		this.stopped = true;
		if (this.discoverTimer) clearTimeout(this.discoverTimer);
		this.discoverTimer = null;
		if (this.safetyTimer) clearInterval(this.safetyTimer);
		this.safetyTimer = null;
		for (const timer of this.refetchTimers.values()) clearTimeout(timer);
		this.refetchTimers.clear();
		this.teardownSse();
	}

	getSnapshot(): MaestroGuiSnapshot {
		return { ...this.snapshot };
	}

	// ── 发现阶段 ──────────────────────────────────────────────

	private scheduleDiscover(delay?: number) {
		if (this.stopped) return;
		const elapsed = Date.now() - this.discoverStartedAt;
		const interval = delay ?? (elapsed < DISCOVER_FAST_WINDOW_MS ? DISCOVER_FAST_MS : DISCOVER_SLOW_MS);
		this.discoverTimer = setTimeout(() => {
			void this.tryDiscover();
		}, interval);
	}

	private async tryDiscover() {
		if (this.stopped) return;
		try {
			const raw = await readFile(join(this.options.cwd, ".workflow", "gui.json"), "utf-8");
			const parsed = JSON.parse(raw) as { port?: number; token?: string };
			// 端口匹配才是本会话的记录；同项目多会话时文件可能被其它会话覆盖，此时继续等本会话重写或依赖已缓存 token。
			if (parsed.port === this.options.port && typeof parsed.token === "string" && parsed.token) {
				this.token = parsed.token;
				this.connect();
				return;
			}
		} catch {
			// 文件尚不存在或格式错误：会话可能没装 maestro，按退避节奏继续轮询
		}
		this.scheduleDiscover();
	}

	// ── 连接与事件流 ──────────────────────────────────────────

	private connect() {
		if (this.stopped || !this.token) return;
		void this.refreshAllState();

		const request = httpGet(
			{
				host: "127.0.0.1",
				port: this.options.port,
				path: `/events?session=${encodeURIComponent(this.token)}`,
				headers: { accept: "text/event-stream" },
			},
			(response) => this.handleSseResponse(response),
		);
		request.on("error", () => this.handleDisconnect());
		this.sseRequest = request;
	}

	private handleSseResponse(response: IncomingMessage) {
		if (this.stopped) {
			response.destroy();
			return;
		}
		if (response.statusCode !== 200) {
			response.destroy();
			// token 失效（session 重启会换 token）：回到发现阶段重读文件
			this.handleDisconnect();
			return;
		}

		this.snapshot.connected = true;
		this.emitSnapshot();

		if (this.safetyTimer) clearInterval(this.safetyTimer);
		this.safetyTimer = setInterval(() => { void this.refreshAllState(); }, SAFETY_REFRESH_MS);

		let buffer = "";
		response.setEncoding("utf-8");
		response.on("data", (chunk: string) => {
			buffer += chunk;
			// SSE 帧以空行分隔；心跳为 ": ping" 注释行，解析时自然跳过
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				this.handleSseFrame(frame);
				boundary = buffer.indexOf("\n\n");
			}
			// 防御：异常服务端不发空行时避免 buffer 无限增长
			if (buffer.length > 1024 * 1024) buffer = "";
		});
		response.on("end", () => this.handleDisconnect());
		response.on("error", () => this.handleDisconnect());
	}

	private handleSseFrame(frame: string) {
		let eventName = "message";
		let data = "";
		for (const line of frame.split("\n")) {
			if (line.startsWith("event:")) eventName = line.slice(6).trim();
			else if (line.startsWith("data:")) data += line.slice(5).trim();
		}
		let payload: unknown;
		if (data) {
			try { payload = JSON.parse(data); } catch { payload = undefined; }
		}
		this.handleEvent(eventName, payload);
	}

	private handleEvent(eventName: string, payload: unknown) {
		switch (eventName) {
			case "todo.updated": {
				const tasks = (payload as { tasks?: unknown[] } | undefined)?.tasks;
				if (Array.isArray(tasks)) {
					this.snapshot.todos = tasks;
					this.emitSnapshot();
				} else {
					this.scheduleRefetch("todos");
				}
				break;
			}
			case "goal.changed":
				this.scheduleRefetch("goal");
				break;
			case "state.changed":
				void this.refreshAllState();
				break;
			case "plan.mode":
				this.scheduleRefetch("plan");
				void this.refreshAllState();
				break;
			case "run.transition": {
				const info = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
				this.snapshot.lastRun = {
					runId: typeof info.runId === "string" ? info.runId : undefined,
					from: typeof info.from === "string" ? info.from : undefined,
					to: typeof info.to === "string" ? info.to : undefined,
					command: typeof info.command === "string" ? info.command : undefined,
					at: Date.now(),
				};
				this.emitSnapshot();
				this.scheduleRefetch("workflow");
				break;
			}
			case "teammate.started":
			case "teammate.progress":
			case "teammate.complete":
				this.options.onTeammateEvent?.(eventName, payload);
				break;
			case "server-close":
				this.handleDisconnect();
				break;
			default:
				break;
		}
	}

	private handleDisconnect() {
		if (this.stopped) return;
		this.teardownSse();
		if (this.safetyTimer) clearInterval(this.safetyTimer);
		this.safetyTimer = null;
		if (this.snapshot.connected) {
			this.snapshot.connected = false;
			this.emitSnapshot();
		}
		// session 重启会重建 server 并更换 token，必须回到发现阶段重读文件
		this.token = null;
		this.discoverStartedAt = Date.now();
		this.scheduleDiscover(RECONNECT_DELAY_MS);
	}

	private teardownSse() {
		if (this.sseRequest) {
			try { this.sseRequest.destroy(); } catch { /* 忽略 */ }
			this.sseRequest = null;
		}
	}

	// ── 状态拉取 ──────────────────────────────────────────────

	private async refreshAllState() {
		const result = await this.fetchJson("/state");
		if (!result || typeof result !== "object") return;
		const state = result as Record<string, unknown>;
		if (Array.isArray(state.todos)) this.snapshot.todos = state.todos;
		this.snapshot.goal = state.goal ?? undefined;
		this.snapshot.workflow = state.workflow ?? undefined;
		this.snapshot.plan = state.plan ?? undefined;
		this.snapshot.teammates = state.teammates ?? undefined;
		this.snapshot.swarm = state.swarm ?? undefined;
		this.snapshot.approvalMode = typeof state.approvalMode === "string" ? state.approvalMode : null;
		this.snapshot.sessionId = typeof state.sessionId === "string" ? state.sessionId : null;
		this.emitSnapshot();
	}

	/** 同一子系统的事件可能连发（如批量 todo 更新），按子系统防抖后拉取 */
	private scheduleRefetch(subsystem: "todos" | "goal" | "workflow" | "plan" | "teammates" | "swarm") {
		const existing = this.refetchTimers.get(subsystem);
		if (existing) clearTimeout(existing);
		this.refetchTimers.set(subsystem, setTimeout(() => {
			this.refetchTimers.delete(subsystem);
			void this.refetchSubsystem(subsystem);
		}, REFETCH_DEBOUNCE_MS));
	}

	private async refetchSubsystem(subsystem: "todos" | "goal" | "workflow" | "plan" | "teammates" | "swarm") {
		const result = await this.fetchJson(`/state/${subsystem}`);
		if (result === undefined) return;
		if (subsystem === "todos") {
			if (Array.isArray(result)) this.snapshot.todos = result;
		} else {
			this.snapshot[subsystem] = result ?? undefined;
		}
		this.emitSnapshot();
	}

	/** GET 并解开 { ok, result } 信封；失败返回 undefined（不打断事件流） */
	private fetchJson(path: string): Promise<unknown> {
		return new Promise((resolve) => {
			if (this.stopped || !this.token) {
				resolve(undefined);
				return;
			}
			const separator = path.includes("?") ? "&" : "?";
			const request = httpGet(
				{
					host: "127.0.0.1",
					port: this.options.port,
					path: `${path}${separator}session=${encodeURIComponent(this.token)}`,
					timeout: FETCH_TIMEOUT_MS,
				},
				(response) => {
					if (response.statusCode !== 200) {
						response.resume();
						resolve(undefined);
						return;
					}
					let body = "";
					response.setEncoding("utf-8");
					response.on("data", (chunk: string) => { body += chunk; });
					response.on("end", () => {
						try {
							const parsed = JSON.parse(body) as { ok?: boolean; result?: unknown };
							resolve(parsed && parsed.ok ? parsed.result : undefined);
						} catch {
							resolve(undefined);
						}
					});
					response.on("error", () => resolve(undefined));
				},
			);
			request.on("timeout", () => {
				request.destroy();
				resolve(undefined);
			});
			request.on("error", () => resolve(undefined));
		});
	}

	private emitSnapshot() {
		try {
			this.options.onSnapshot(this.getSnapshot());
		} catch {
			// 上层回调异常不应打断事件流
		}
	}
}
