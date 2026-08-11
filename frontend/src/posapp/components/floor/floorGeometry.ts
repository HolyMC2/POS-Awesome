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

/** Counter-rotation keeps the label upright on a rotated tile (§4). */
export const labelStyle = (layout: PlacedLayout): Record<string, string> =>
	layout.rotation ? { transform: `rotate(${-layout.rotation}deg)` } : {};

/** Clamp a move so a tile cannot be dragged off the canvas. */
export const clampToCanvas = (layout: PlacedLayout, canvas: FloorCanvas): PlacedLayout => ({
	...layout,
	x: Math.max(0, Math.min(canvas.cols - layout.w, layout.x)),
	y: Math.max(0, Math.min(canvas.rows - layout.h, layout.y)),
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
