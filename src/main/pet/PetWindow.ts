import { app, BrowserWindow, screen } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import type { PetWindowCaps } from "../../shared/types";

/** 三端宠物窗能力探测；Wayland 降级 */
export function detectPetWindowCaps(): PetWindowCaps {
	if (process.platform === "darwin" || process.platform === "win32") {
		return { transparent: true, clickThrough: true, freePosition: true };
	}
	const wayland = !!process.env.WAYLAND_DISPLAY;
	return { transparent: !wayland, clickThrough: true, freePosition: !wayland };
}

const BASE_W = 160, BASE_H = 176;

function posPath() { return join(app.getPath("userData"), "pet-position.json"); }

async function loadPos(): Promise<{ x: number; y: number } | null> {
	try {
		const raw = await readFile(posPath(), "utf8");
		const p = JSON.parse(raw);
		return typeof p.x === "number" && typeof p.y === "number" ? p : null;
	} catch { return null; }
}

async function savePos(bounds: { x: number; y: number }) {
	try {
		await mkdir(app.getPath("userData"), { recursive: true });
		await writeFile(posPath(), JSON.stringify(bounds, null, 2), "utf8");
	} catch { /* 保存失败不影响宠物运行 */ }
}

export class PetWindow {
	private win: BrowserWindow | null = null;
	/** 位置持久化防抖：巡游每 50ms 移动一次，避免高频写盘拖慢主进程 */
	private saveTimer: NodeJS.Timeout | null = null;
	private pendingPos: { x: number; y: number } | null = null;

	get window(): BrowserWindow | null { return this.win; }
	get exists(): boolean { return !!this.win && !this.win.isDestroyed(); }

	async create(scale = 1) {
		if (this.exists) return this.win!;

		const w = Math.round(BASE_W * scale), h = Math.round(BASE_H * scale);
		const caps = detectPetWindowCaps();
		const isMac = process.platform === "darwin";

		const persisted = await loadPos();
		const display = screen.getDisplayMatching(persisted ? { x: persisted.x, y: persisted.y, width: w, height: h } : { x: 0, y: 0, width: w, height: h });
		const wa = display.workArea;
		const x = persisted?.x ?? wa.x + wa.width - w - 24;
		const y = persisted?.y ?? wa.y + wa.height - h - 24;

		this.win = new BrowserWindow({
			width: w, height: h, x, y,
			...(isMac ? { type: "panel" as const } : {}),
			frame: false, transparent: caps.transparent, resizable: false,
			maximizable: false, fullscreenable: false, hasShadow: false,
			skipTaskbar: true, alwaysOnTop: true, backgroundColor: "#00000000",
			webPreferences: {
				preload: join(__dirname, "../preload/index.js"),
				partition: "persist:pet",
				sandbox: false, contextIsolation: true, nodeIntegration: false,
			},
		});

		this.win.setAlwaysOnTop(true, "floating");
		// moved 高频触发（巡游每 50ms 一次、拖拽每次 pointermove 一次），
		// 直接落盘会拖慢主进程、间接放大 tick 抖动。这里防抖 400ms 合并写盘。
		this.win.on("moved", () => {
			if (!this.exists) return;
			const b = this.win!.getBounds();
			this.pendingPos = { x: b.x, y: b.y };
			if (this.saveTimer) return;
			this.saveTimer = setTimeout(() => {
				this.saveTimer = null;
				if (this.pendingPos) { const p = this.pendingPos; this.pendingPos = null; void savePos(p); }
			}, 400);
		});

		if (!is.dev) {
			this.win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
				cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": ["default-src 'self'; img-src 'self' file: data:; script-src 'self'; style-src 'self' 'unsafe-inline'"] } });
			});
		}

		const url = is.dev && process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/pet.html` : join(__dirname, "../renderer/pet.html");
		await (is.dev && process.env.ELECTRON_RENDERER_URL ? this.win.loadURL(url) : this.win.loadFile(url));

		if (isMac) this.win.showInactive();
		return this.win;
	}

	destroy() {
		if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
		this.pendingPos = null;
		if (this.win && !this.win.isDestroyed()) this.win.destroy();
		this.win = null;
	}

	moveTo(x: number, y: number) {
		if (!this.exists) return;
		this.win!.setPosition(Math.round(x), Math.round(y));
		void savePos({ x, y });
	}

	setAlwaysOnTop(v: boolean) { if (this.exists) this.win!.setAlwaysOnTop(v, "floating"); }

	resize(scale: number) {
		if (!this.exists) return;
		const w = Math.round(BASE_W * scale), h = Math.round(BASE_H * scale);
		this.win!.setSize(w, h);
		const [x, y] = this.win!.getPosition();
		const wa = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
		this.win!.setPosition(Math.min(x, wa.x + wa.width - w - 8), Math.min(y, wa.y + wa.height - h - 8));
	}

	show() { if (this.exists) process.platform === "darwin" ? this.win!.showInactive() : this.win!.show(); }
	hide() { if (this.exists) this.win!.hide(); }
}
