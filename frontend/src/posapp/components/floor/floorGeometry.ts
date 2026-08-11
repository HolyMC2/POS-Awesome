/**
 * Floor geometry — the grid reference frame and the CSS it produces.
 *
 * Positions are stored in GRID UNITS against the floor's own
 * `{cols, rows, cell}` canvas, never in bare pixels: a plan authored on a desk
 * screen has to land on a tablet without guesswork (spec §2.2, and the taller
 * `BinsConstructor` precedent it cites). Pixels appear only here, at render.
 *
 * Tiles are positioned with `transform`, not `left/top`, so drag and zoom stay
 * on the compositor (§4).
 */
import {
	parseLayout,
	type FloorCanvas,
	type FloorLayout,
	type FloorRow,
	type TableLayout,
	type TableRow,
} from "../../stores/floorStore";

/** A layout with every field resolved — what the render code may assume. */
export interface PlacedLayout {
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	shape: string;
	color?: string;
}

export const DEFAULT_CANVAS: FloorCanvas = { cols: 24, rows: 16, cell: 44 };
export const DEFAULT_TABLE_SIZE = { w: 2, h: 2 };

/** The shapes the plan renderer knows how to draw. */
export const TABLE_SHAPES = ["rect", "round"] as const;
/** Rotation is offered in eighths — a dining room is not a CAD drawing. */
export const ROTATION_STEP = 45;

const positive = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resolveCanvas = (floor: FloorRow | null | undefined): FloorCanvas => {
	const layout = parseLayout<FloorLayout>(floor?.layout);
	return {
		cols: Math.round(positive(layout?.cols, DEFAULT_CANVAS.cols)),
		rows: Math.round(positive(layout?.rows, DEFAULT_CANVAS.rows)),
		cell: Math.round(positive(layout?.cell, DEFAULT_CANVAS.cell)),
	};
};

/**
 * A table with no authored geometry still has to appear — a floor created from
 * the Desk form would otherwise render an empty plan with no way back. Unplaced
 * tables flow left-to-right in reading order.
 */
export const resolveTableLayout = (
	table: TableRow,
	index: number,
	canvas: FloorCanvas,
): PlacedLayout => {
	const stored = parseLayout<TableLayout>(table.layout);
	const w = Math.round(positive(stored?.w, DEFAULT_TABLE_SIZE.w));
	const h = Math.round(positive(stored?.h, DEFAULT_TABLE_SIZE.h));
	if (stored && Number.isFinite(Number(stored.x)) && Number.isFinite(Number(stored.y))) {
		return {
			x: Math.max(0, Math.round(Number(stored.x))),
			y: Math.max(0, Math.round(Number(stored.y))),
			w,
			h,
			rotation: Number(stored.rotation) || 0,
			shape: stored.shape || "rect",
			color: stored.color || undefined,
		};
	}
	const perRow = Math.max(1, Math.floor(canvas.cols / (w + 1)));
	return {
		x: (index % perRow) * (w + 1),
		y: Math.floor(index / perRow) * (h + 1),
		w,
		h,
		rotation: 0,
		shape: "rect",
	};
};

export const canvasStyle = (canvas: FloorCanvas): Record<string, string> => ({
	width: `${canvas.cols * canvas.cell}px`,
	height: `${canvas.rows * canvas.cell}px`,
	backgroundSize: `${canvas.cell}px ${canvas.cell}px`,
});

export const tileStyle = (layout: PlacedLayout, canvas: FloorCanvas): Record<string, string> => ({
	width: `${layout.w * canvas.cell}px`,
	height: `${layout.h * canvas.cell}px`,
	transform: `translate(${layout.x * canvas.cell}px, ${layout.y * canvas.cell}px) rotate(${
		layout.rotation || 0
	}deg)`,
});

/**
 * Counter-rotation keeps the label upright on a rotated tile (§4), and the
 * optional counter-SCALE keeps it readable on a fitted plan.
 *
 * Fitting the room shrinks the canvas as one transform, which shrinks the text
 * with it: at the scale a 24-column floor needs on a phone, a 13px table number
 * lands near 6px. The number on the tile is the single thing the plan exists to
 * tell you, so it is held at a constant SCREEN size while the geometry around
 * it scales.
 */
export const labelStyle = (layout: PlacedLayout, inverseScale = 1): Record<string, string> => {
	const parts: string[] = [];
	if (layout.rotation) parts.push(`rotate(${-layout.rotation}deg)`);
	if (inverseScale !== 1) parts.push(`scale(${inverseScale})`);
	return parts.length ? { transform: parts.join(" ") } : {};
};

/** Clamp a move so a tile cannot be dragged off the canvas. */
export const clampToCanvas = (layout: PlacedLayout, canvas: FloorCanvas): PlacedLayout => ({
	...layout,
	x: Math.max(0, Math.min(canvas.cols - layout.w, layout.x)),
	y: Math.max(0, Math.min(canvas.rows - layout.h, layout.y)),
});

/**
 * Resize by whole cells, each axis on its own. The v1 stepper moved width and
 * height together, which made a bar counter or a banquet run — the long-thin
 * shapes a real room is full of — impossible to draw.
 *
 * A tile is clamped to the canvas rather than allowed to grow past the wall,
 * and the position is pulled back in when growth would push the far edge out,
 * so the tile keeps the size the operator asked for instead of silently
 * refusing at the boundary.
 */
export const resizeLayout = (
	layout: PlacedLayout,
	deltaW: number,
	deltaH: number,
	canvas: FloorCanvas,
): PlacedLayout => {
	const w = Math.max(1, Math.min(canvas.cols, layout.w + deltaW));
	const h = Math.max(1, Math.min(canvas.rows, layout.h + deltaH));
	return clampToCanvas({ ...layout, w, h }, canvas);
};

/** Nudge by whole cells — the arrow pad that replaces precision dragging. */
export const nudgeLayout = (
	layout: PlacedLayout,
	deltaX: number,
	deltaY: number,
	canvas: FloorCanvas,
): PlacedLayout => clampToCanvas({ ...layout, x: layout.x + deltaX, y: layout.y + deltaY }, canvas);

/** Next rotation in the 45° cycle, normalised to [0, 360). */
export const rotateLayout = (layout: PlacedLayout, steps = 1): PlacedLayout => ({
	...layout,
	rotation: (((layout.rotation || 0) + steps * ROTATION_STEP) % 360 + 360) % 360,
});

/**
 * Toggle rect ⇄ round.
 *
 * An unrecognised stored shape already DRAWS as a rect (the renderer only has a
 * rule for `round`), so it advances from rect rather than resetting to it —
 * resetting would spend a press on a change nobody can see, and the operator
 * presses again.
 */
export const cycleShape = (layout: PlacedLayout): PlacedLayout => {
	const index = TABLE_SHAPES.indexOf(layout.shape as (typeof TABLE_SHAPES)[number]);
	const current = index < 0 ? 0 : index;
	const next = TABLE_SHAPES[(current + 1) % TABLE_SHAPES.length];
	return { ...layout, shape: next ?? "rect" };
};

/**
 * Where a duplicate lands: one cell down-right of its source, pulled back
 * inside the canvas. Offsetting rather than stacking is what makes the copy
 * visible — a duplicate hidden exactly behind its original reads as "the button
 * did nothing", and the operator presses it four more times.
 */
export const duplicateLayout = (layout: PlacedLayout, canvas: FloorCanvas): PlacedLayout =>
	clampToCanvas({ ...layout, x: layout.x + 1, y: layout.y + 1 }, canvas);

/**
 * The scale that fits the whole plan across `available` pixels.
 *
 * A floor is authored on a desk screen against a fixed grid, so on a 390px
 * phone the default 24×16 frame is 1056px wide — the waiter sees a third of
 * the room and has to pan to find out whether table 14 is free. Because
 * geometry is in grid units, fitting is one multiplier at render (§2.2), not a
 * re-layout.
 *
 * Never scales UP: a plan blown past 1:1 on a wide screen turns a dining room
 * into a poster and pushes the far tables off the fold.
 */
export const fitScale = (canvas: FloorCanvas, available: number, padding = 16): number => {
	const width = canvas.cols * canvas.cell;
	if (!Number.isFinite(available) || available <= 0 || width <= 0) return 1;
	return Math.min(1, Math.max(0.25, (available - padding) / width));
};

/** The footprint a scaled canvas actually occupies, for the scrollport. */
export const scaledCanvasStyle = (canvas: FloorCanvas, scale: number): Record<string, string> => ({
	width: `${canvas.cols * canvas.cell * scale}px`,
	height: `${canvas.rows * canvas.cell * scale}px`,
});

/**
 * Colour is the USER's semantic (section / station / VIP), never a status —
 * opacity already carries free/occupied, and one visual variable per meaning is
 * what makes the plan readable without a legend (§4).
 */
export const TABLE_COLORS: ReadonlyArray<{ value?: string; hex: string }> = [
	{ value: undefined, hex: "#94a3b8" },
	{ value: "teal", hex: "#0d9488" },
	{ value: "indigo", hex: "#4f46e5" },
	{ value: "amber", hex: "#d97706" },
	{ value: "rose", hex: "#e11d48" },
	{ value: "emerald", hex: "#059669" },
];

export const colorHex = (color: string | undefined): string =>
	TABLE_COLORS.find((entry) => entry.value === (color || undefined))?.hex || "#94a3b8";
