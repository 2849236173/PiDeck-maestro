import { useCallback, useEffect, useRef } from "react";

/**
 * 官方 pi.dev 风格的 canvas 像素 logo。
 * 逻辑参考 pi 官网 home-inline.js 的 createHeroLogoController：
 * - 8×9 棋盘上的 FINAL_LOGO 点阵
 * - 彩色方块带 bevel 立体边
 * - 四块 tetromino 下落拼装 → 消行闪烁 → 定格为单色 logo
 * - 点击可重播（尊重 prefers-reduced-motion）
 */

type ColorKey = "cyan" | "red" | "green" | "orange" | "flash" | "white" | "ink" | "logoGreen";

type Piece = {
	color: ColorKey;
	cells: Array<[number, number]>;
	startX: number;
	startY: number;
	targetX: number;
	targetY: number;
};

const LOGO_FPS = 18;
const BOARD_W = 8;
const BOARD_H = 9;
const CLEAR_ROW = 6;

const COLORS: Record<ColorKey, string> = {
	cyan: "#4B607C",
	red: "#8F4632",
	green: "#A3A473",
	orange: "#D4904E",
	flash: "#fff5b4",
	white: "#ffffff",
	ink: "#09090B",
	// 与侧栏 LogoMark / --color-logo-green 对齐
	logoGreen: "#14b814",
};

const BORDER_COLORS: Partial<Record<ColorKey, string>> = {
	cyan: "#2D3D55",
	red: "#4F271C",
	green: "#5A5A3F",
	orange: "#754F2B",
	// 单色定格 / 字标：给 ink、white 也配边色，bevel 才立得住
	ink: "#000000",
	white: "#9ca3af",
	logoGreen: "#0b8f0b",
};

const TOP: Piece = {
	color: "cyan",
	cells: [[0, 0], [0, 1], [0, 2], [1, 2]],
	startX: 2,
	startY: -2,
	targetX: 2,
	targetY: 2,
};

const LEFT: Piece = {
	color: "red",
	cells: [[0, 0], [1, 0], [1, 1], [2, 0]],
	startX: 0,
	startY: -3,
	targetX: 2,
	targetY: 3,
};

const RIGHT: Piece = {
	color: "green",
	cells: [[0, 0], [1, 0], [2, 0], [2, 1]],
	startX: 5,
	startY: -3,
	targetX: 5,
	targetY: 4,
};

const BASE: Piece = {
	color: "orange",
	cells: [[0, 0], [0, 1], [0, 2], [0, 3]],
	startX: 1,
	startY: -2,
	targetX: 1,
	targetY: 6,
};

const LOGO_SEQUENCE: Array<{ piece: Piece; duration: number; holdAfter: number }> = [
	{ piece: BASE, duration: 91, holdAfter: 11 },
	{ piece: LEFT, duration: 91, holdAfter: 11 },
	{ piece: TOP, duration: 91, holdAfter: 11 },
	{ piece: RIGHT, duration: 91, holdAfter: 49 },
];

const LOGO_TIMING = {
	initialHold: 28,
	clearFlashCount: 5,
	clearFlashStep: 35,
	postClearHold: 49,
	postDropHold: 80,
};

/** 定格后的 pi 几何（y:x） */
const FINAL_LOGO = ["3:2", "3:3", "3:4", "4:2", "4:4", "5:2", "5:3", "5:5", "6:2", "6:5"];

function toCellKey(y: number, x: number) {
	return `${y}:${x}`;
}

function parseCellKey(key: string) {
	const [y, x] = key.split(":").map(Number);
	return { y, x };
}

function easeOutCubic(t: number) {
	return 1 - (1 - t) ** 3;
}

function prefersReducedMotion() {
	return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isLightTheme() {
	return document.documentElement.getAttribute("data-theme") !== "dark";
}

/** 定格色：浅色主题墨黑 / 深色主题白（动画过程仍用彩色 tetromino） */
function settledLogoColor(): ColorKey {
	return isLightTheme() ? "ink" : "white";
}

/** 字标色（若再启用右侧 PiDeck 字标时用） */
function wordmarkColor(): ColorKey {
	return isLightTheme() ? "ink" : "white";
}

function sleep(ms: number, signal?: { cancelled: boolean }) {
	return new Promise<void>((resolve) => {
		window.setTimeout(() => resolve(), ms);
	}).then(() => {
		if (signal?.cancelled) throw new Error("logo-cancelled");
	});
}

type Cells = Record<string, ColorKey>;

function copyCells(cells: Cells): Cells {
	return { ...cells };
}

function mergePiece(cells: Cells, piece: Piece, x: number, y: number) {
	for (const [dy, dx] of piece.cells) {
		cells[toCellKey(y + dy, x + dx)] = piece.color;
	}
}

function finalLogoCells(color: ColorKey): Cells {
	const cells: Cells = {};
	for (const key of FINAL_LOGO) cells[key] = color;
	return cells;
}

function drawBlock(
	ctx: CanvasRenderingContext2D,
	left: number,
	top: number,
	width: number,
	height: number,
	color: ColorKey,
	neighbors: { top?: string; right?: string; bottom?: string; left?: string },
) {
	const fillColor = COLORS[color] ?? COLORS.white;
	const borderColor = BORDER_COLORS[color] ?? fillColor;
	const sameTop = neighbors.top === color;
	const sameRight = neighbors.right === color;
	const sameBottom = neighbors.bottom === color;
	const sameLeft = neighbors.left === color;

	ctx.globalAlpha = 1;
	ctx.fillStyle = fillColor;
	ctx.fillRect(left, top, width, height);

	// 小尺寸时退化为平面块，避免边线糊成灰斑
	if (width < 5 || height < 5) return;

	const inset = width >= 8 ? 2 : 1;
	const innerLeft = left + inset;
	const innerTop = top + inset;
	const innerWidth = width - inset * 2;
	const innerHeight = height - inset * 2;
	if (innerWidth <= 0 || innerHeight <= 0) return;

	const fillAlpha = (fill: string, alpha: number, x: number, y: number, w: number, h: number) => {
		if (alpha <= 0 || w <= 0 || h <= 0) return;
		ctx.globalAlpha = alpha;
		ctx.fillStyle = fill;
		ctx.fillRect(x, y, w, h);
		ctx.globalAlpha = 1;
	};

	// 面部分亮/暗
	const faceTopH = Math.max(1, Math.floor(innerHeight * 0.55));
	fillAlpha("#ffffff", 0.08, innerLeft, innerTop, innerWidth, faceTopH);
	fillAlpha("#000000", 0.06, innerLeft, innerTop + faceTopH, innerWidth, innerHeight - faceTopH);

	// 顶/底边
	const topOuter = sameTop ? 1 : 2;
	const bottomOuter = sameBottom ? 1 : 2;
	fillAlpha("#ffffff", sameTop ? 0.12 : 0.28, left, top, width, topOuter);
	fillAlpha(borderColor, sameBottom ? 0.24 : 1, left, top + height - bottomOuter, width, bottomOuter);

	// 左右边
	const sideOuter = 2;
	fillAlpha(borderColor, sameLeft ? 0.22 : 0.62, left, top, sameLeft ? 1 : sideOuter, height);
	fillAlpha(borderColor, sameRight ? 0.22 : 0.62, left + width - (sameRight ? 1 : sideOuter), top, sameRight ? 1 : sideOuter, height);
}

function paintCells(canvas: HTMLCanvasElement, cells: Cells, cssSize: number) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const dpr = window.devicePixelRatio || 1;
	const cssW = cssSize;
	const cssH = (cssSize / BOARD_W) * BOARD_H;
	const bitmapW = Math.max(1, Math.round(cssW * dpr));
	const bitmapH = Math.max(1, Math.round(cssH * dpr));

	if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
		canvas.width = bitmapW;
		canvas.height = bitmapH;
	}
	canvas.style.width = `${cssW}px`;
	canvas.style.height = `${cssH}px`;

	const cellW = bitmapW / BOARD_W;
	const cellH = bitmapH / BOARD_H;
	const xLines = Array.from({ length: BOARD_W + 1 }, (_, i) => Math.round(i * cellW));
	const yLines = Array.from({ length: BOARD_H + 1 }, (_, i) => Math.round(i * cellH));

	const colorAt = (y: number, x: number) => cells[toCellKey(y, x)];

	ctx.clearRect(0, 0, bitmapW, bitmapH);

	for (const [position, color] of Object.entries(cells)) {
		const { y, x } = parseCellKey(position);
		if (y < 0 || y >= BOARD_H || x < 0 || x >= BOARD_W) continue;
		const left = xLines[x];
		const top = yLines[y];
		const right = xLines[x + 1];
		const bottom = yLines[y + 1];
		drawBlock(ctx, left, top, right - left, bottom - top, color, {
			top: colorAt(y - 1, x),
			right: colorAt(y, x + 1),
			bottom: colorAt(y + 1, x),
			left: colorAt(y, x - 1),
		});
	}
}

export type PiLogoCanvasProps = {
	/** 画布 CSS 宽度（高度按 8:9 棋盘比例） */
	size?: number;
	/** 挂载后是否自动播放一次 intro */
	autoPlay?: boolean;
	/** 点击是否重播 */
	playOnClick?: boolean;
	className?: string;
};

/**
 * 官方 pi 风格 canvas logo。
 * 侧栏等处用 size≈32；需要完整动画感可稍大。
 */
export function PiLogoCanvas(props: PiLogoCanvasProps) {
	const size = props.size ?? 32;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const busyRef = useRef(false);
	const cancelRef = useRef({ cancelled: false });

	const showStatic = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		paintCells(canvas, finalLogoCells(settledLogoColor()), size);
	}, [size]);

	const playIntro = useCallback(async () => {
		const canvas = canvasRef.current;
		if (!canvas || busyRef.current) return;
		if (prefersReducedMotion()) {
			showStatic();
			return;
		}

		busyRef.current = true;
		const run = { cancelled: false };
		cancelRef.current = run;

		const frameMs = 1000 / LOGO_FPS;
		const paint = (cells: Cells) => {
			if (run.cancelled) return;
			paintCells(canvas, cells, size);
		};

		const hold = async (cells: Cells, ms: number) => {
			const frames = Math.max(1, Math.round(ms / frameMs));
			for (let i = 0; i < frames; i++) {
				if (run.cancelled) throw new Error("logo-cancelled");
				paint(cells);
				await sleep(frameMs, run);
			}
		};

		try {
			let settled: Cells = {};
			await hold(settled, LOGO_TIMING.initialHold);

			for (const step of LOGO_SEQUENCE) {
				const piece = step.piece;
				const startY = piece.startY;
				const frames = Math.max(Math.round(step.duration / frameMs), 7);
				for (let i = 0; i < frames; i++) {
					if (run.cancelled) throw new Error("logo-cancelled");
					const t = easeOutCubic((i + 1) / frames);
					const x = Math.round(piece.startX + (piece.targetX - piece.startX) * t);
					const y = Math.round(startY + (piece.targetY - startY) * t);
					const frame = copyCells(settled);
					mergePiece(frame, piece, x, y);
					paint(frame);
					await sleep(frameMs, run);
				}
				mergePiece(settled, piece, piece.targetX, piece.targetY);
				paint(settled);
				await sleep(35, run);
				if (step.holdAfter > 0) await hold(settled, step.holdAfter);
			}

			// 消行闪烁 → 其余块下沉定格为 monochrome pi
			const finalColor = settledLogoColor();
			for (let i = 0; i < LOGO_TIMING.clearFlashCount; i++) {
				const flash = i % 2 === 0;
				const cells = copyCells(settled);
				for (const key of Object.keys(cells)) {
					if (cells[key] !== "flash") cells[key] = finalColor;
				}
				if (flash) {
					for (let x = 1; x <= 6; x++) cells[toCellKey(CLEAR_ROW, x)] = "flash";
				}
				await hold(cells, LOGO_TIMING.clearFlashStep);
			}

			const floating: Cells = {};
			for (const [position] of Object.entries(settled)) {
				if (parseCellKey(position).y !== CLEAR_ROW) floating[position] = finalColor;
			}
			await hold(floating, LOGO_TIMING.postClearHold);

			// 官方会再下移一行；侧栏定格直接用 FINAL_LOGO，形状更稳
			await hold(finalLogoCells(finalColor), LOGO_TIMING.postDropHold);
			paint(finalLogoCells(finalColor));
		} catch {
			// cancelled
		} finally {
			if (!run.cancelled) showStatic();
			busyRef.current = false;
		}
	}, [showStatic, size]);

	useEffect(() => {
		showStatic();
		if (props.autoPlay !== false) {
			void playIntro();
		}

		const onTheme = () => {
			if (!busyRef.current) showStatic();
		};
		// PiDeck 主题切换会改 data-theme
		const observer = new MutationObserver(onTheme);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

		return () => {
			cancelRef.current.cancelled = true;
			observer.disconnect();
		};
	}, [playIntro, props.autoPlay, showStatic]);

	const handleActivate = () => {
		if (props.playOnClick === false) return;
		if (busyRef.current) return;
		void playIntro();
	};

	return (
		<button
			type="button"
			className={props.className ?? "pi-logo-canvas-stage"}
			aria-label="Play Pi logo animation"
			onClick={handleActivate}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleActivate();
				}
			}}
		>
			<canvas ref={canvasRef} className="pi-logo-canvas" aria-hidden="true" />
		</button>
	);
}

// ── 右侧「PiDeck」字标：与 logo 同一套 canvas 方块绘制 ──────────────

/**
 * 5×7 点阵（i 为 3×7）。笔画加粗：竖干双列 / 横画更满，小字号下仍够「重」。
 */
const WORDMARK_GLYPHS: Record<string, number[][]> = {
	P: [
		[1, 1, 1, 1, 0],
		[1, 1, 0, 0, 1],
		[1, 1, 0, 0, 1],
		[1, 1, 1, 1, 0],
		[1, 1, 0, 0, 0],
		[1, 1, 0, 0, 0],
		[1, 1, 0, 0, 0],
	],
	i: [
		[1, 1, 0],
		[0, 0, 0],
		[1, 1, 0],
		[1, 1, 0],
		[1, 1, 0],
		[1, 1, 0],
		[1, 1, 1],
	],
	D: [
		[1, 1, 1, 1, 0],
		[1, 1, 0, 0, 1],
		[1, 1, 0, 0, 1],
		[1, 1, 0, 0, 1],
		[1, 1, 0, 0, 1],
		[1, 1, 0, 0, 1],
		[1, 1, 1, 1, 0],
	],
	e: [
		[0, 0, 0, 0, 0],
		[0, 1, 1, 1, 0],
		[1, 1, 0, 0, 1],
		[1, 1, 1, 1, 1],
		[1, 1, 0, 0, 0],
		[1, 1, 0, 0, 1],
		[0, 1, 1, 1, 0],
	],
	c: [
		[0, 0, 0, 0, 0],
		[0, 1, 1, 1, 0],
		[1, 1, 0, 0, 1],
		[1, 1, 0, 0, 0],
		[1, 1, 0, 0, 0],
		[1, 1, 0, 0, 1],
		[0, 1, 1, 1, 0],
	],
	k: [
		[1, 1, 0, 0, 1],
		[1, 1, 0, 1, 0],
		[1, 1, 1, 0, 0],
		[1, 1, 0, 0, 0],
		[1, 1, 1, 0, 0],
		[1, 1, 0, 1, 0],
		[1, 1, 0, 0, 1],
	],
};

const WORDMARK_ROWS = 7;
const WORDMARK_GAP = 1;

function buildWordmarkCells(text: string): { cells: Cells; cols: number; rows: number } {
	const cells: Cells = {};
	let cursorX = 0;
	const color = wordmarkColor();

	for (const ch of text) {
		const glyph = WORDMARK_GLYPHS[ch];
		if (!glyph) {
			cursorX += 3 + WORDMARK_GAP;
			continue;
		}
		const width = glyph[0]?.length ?? 0;
		for (let y = 0; y < WORDMARK_ROWS; y += 1) {
			const row = glyph[y] ?? [];
			for (let x = 0; x < width; x += 1) {
				if (!row[x]) continue;
				cells[toCellKey(y, cursorX + x)] = color;
			}
		}
		cursorX += width + WORDMARK_GAP;
	}

	return {
		cells,
		cols: Math.max(cursorX - WORDMARK_GAP, 1),
		rows: WORDMARK_ROWS,
	};
}

function paintWordmark(canvas: HTMLCanvasElement, text: string, cellCss: number) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const { cells, cols, rows } = buildWordmarkCells(text);
	const dpr = window.devicePixelRatio || 1;
	const cssW = cols * cellCss;
	const cssH = rows * cellCss;
	const bitmapW = Math.max(1, Math.round(cssW * dpr));
	const bitmapH = Math.max(1, Math.round(cssH * dpr));

	if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
		canvas.width = bitmapW;
		canvas.height = bitmapH;
	}
	canvas.style.width = `${cssW}px`;
	canvas.style.height = `${cssH}px`;

	const cellW = bitmapW / cols;
	const cellH = bitmapH / rows;
	const xLines = Array.from({ length: cols + 1 }, (_, i) => Math.round(i * cellW));
	const yLines = Array.from({ length: rows + 1 }, (_, i) => Math.round(i * cellH));
	const colorAt = (y: number, x: number) => cells[toCellKey(y, x)];

	ctx.clearRect(0, 0, bitmapW, bitmapH);

	for (const [position, color] of Object.entries(cells)) {
		const { y, x } = parseCellKey(position);
		if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
		const left = xLines[x];
		const top = yLines[y];
		const right = xLines[x + 1];
		const bottom = yLines[y + 1];
		drawBlock(ctx, left, top, right - left, bottom - top, color, {
			top: colorAt(y - 1, x),
			right: colorAt(y, x + 1),
			bottom: colorAt(y + 1, x),
			left: colorAt(y, x - 1),
		});
	}
}

export type PiDeckWordmarkCanvasProps = {
	/** 每个点阵格的 CSS 边长；与 logo 并排时建议 4~5 */
	cellSize?: number;
	text?: string;
	className?: string;
};

/**
 * 右侧 PiDeck 字标：与左侧 logo 同一套 bevel 方块 canvas 绘制。
 * 主题切换时自动重绘 ink/white。
 */
export function PiDeckWordmarkCanvas(props: PiDeckWordmarkCanvasProps) {
	const cellSize = props.cellSize ?? 5;
	const text = props.text ?? "PiDeck";
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const paint = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		paintWordmark(canvas, text, cellSize);
	}, [cellSize, text]);

	useEffect(() => {
		paint();
		const observer = new MutationObserver(paint);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, [paint]);

	return (
		<canvas
			ref={canvasRef}
			className={props.className ?? "pi-deck-wordmark-canvas"}
			aria-hidden="true"
		/>
	);
}
