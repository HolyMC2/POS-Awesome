// @vitest-environment jsdom
// jsdom because importing floorGeometry pulls the floorStore module chain,
// and floorOrderActions reads `window.__` at module top level.
import { describe, expect, it } from "vitest";

import {
	DEFAULT_CANVAS,
	clampToCanvas,
	colorHex,
	labelStyle,
	resolveCanvas,
	resolveTableLayout,
	tileStyle,
	type PlacedLayout,
} from "../src/posapp/components/floor/floorGeometry";
import type { FloorRow, TableRow } from "../src/posapp/stores/floorStore";

// Geometry is stored in GRID UNITS against the floor's own canvas (spec §2.2);
// pixels exist only at render. These are the invariants the editor and the
// plan renderer both assume.

const floor = (layout: unknown): FloorRow => ({ layout: JSON.stringify(layout) }) as FloorRow;
const table = (layout: unknown): TableRow =>
	({ layout: layout == null ? null : JSON.stringify(layout) }) as TableRow;

describe("resolveCanvas", () => {
	it("falls back to the default frame when the floor has no layout", () => {
		expect(resolveCanvas(null)).toEqual(DEFAULT_CANVAS);
		expect(resolveCanvas({ layout: null } as FloorRow)).toEqual(DEFAULT_CANVAS);
	});

	it("reads the FLAT {cols, rows, cell} shape — not nested under canvas", () => {
		expect(resolveCanvas(floor({ cols: 30, rows: 20, cell: 40 }))).toEqual({
			cols: 30,
			rows: 20,
			cell: 40,
		});
		// The nested shape must NOT resolve — it would silently render the
		// default frame while the editor saved something else.
		expect(resolveCanvas(floor({ canvas: { cols: 30, rows: 20, cell: 40 } }))).toEqual(
			DEFAULT_CANVAS,
		);
	});

	it("rejects non-positive and non-numeric dimensions per-field", () => {
		expect(resolveCanvas(floor({ cols: -5, rows: "abc", cell: 52 }))).toEqual({
			cols: DEFAULT_CANVAS.cols,
			rows: DEFAULT_CANVAS.rows,
			cell: 52,
		});
	});
});

describe("resolveTableLayout", () => {
	const canvas = { cols: 24, rows: 16, cell: 44 };

	it("honours stored geometry and floors negatives at 0", () => {
		const placed = resolveTableLayout(
			table({ x: -3, y: 5, w: 3, h: 2, rotation: 45, shape: "round", color: "teal" }),
			0,
			canvas,
		);
		expect(placed).toEqual({ x: 0, y: 5, w: 3, h: 2, rotation: 45, shape: "round", color: "teal" });
	});

	it("flows unplaced tables in reading order so a Desk-created floor still renders", () => {
		const first = resolveTableLayout(table(null), 0, canvas);
		const second = resolveTableLayout(table(null), 1, canvas);
		expect(first).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
		expect(second.x).toBeGreaterThan(0);
		expect(second.y).toBe(0);
	});

	it("wraps the flow onto the next row instead of overflowing the canvas", () => {
		const perRow = Math.max(1, Math.floor(canvas.cols / 3)); // w+1 pitch for w=2
		const wrapped = resolveTableLayout(table(null), perRow, canvas);
		expect(wrapped.x).toBe(0);
		expect(wrapped.y).toBeGreaterThan(0);
	});
});

describe("clampToCanvas", () => {
	const canvas = { cols: 10, rows: 8, cell: 44 };
	const layout: PlacedLayout = { x: 0, y: 0, w: 2, h: 2, rotation: 0, shape: "rect" };

	it("keeps a dragged tile inside every edge", () => {
		expect(clampToCanvas({ ...layout, x: -4, y: -1 }, canvas)).toMatchObject({ x: 0, y: 0 });
		expect(clampToCanvas({ ...layout, x: 99, y: 99 }, canvas)).toMatchObject({ x: 8, y: 6 });
	});

	it("is a no-op for a tile already inside", () => {
		expect(clampToCanvas({ ...layout, x: 3, y: 2 }, canvas)).toMatchObject({ x: 3, y: 2 });
	});
});

describe("render styles", () => {
	const canvas = { cols: 10, rows: 8, cell: 50 };

	it("positions with transform, never left/top, in cell multiples", () => {
		const style = tileStyle({ x: 2, y: 1, w: 3, h: 2, rotation: 90, shape: "rect" }, canvas);
		expect(style.width).toBe("150px");
		expect(style.height).toBe("100px");
		expect(style.transform).toBe("translate(100px, 50px) rotate(90deg)");
		expect(style).not.toHaveProperty("left");
		expect(style).not.toHaveProperty("top");
	});

	it("counter-rotates the label only on rotated tiles", () => {
		expect(labelStyle({ x: 0, y: 0, w: 2, h: 2, rotation: 45, shape: "rect" })).toEqual({
			transform: "rotate(-45deg)",
		});
		expect(labelStyle({ x: 0, y: 0, w: 2, h: 2, rotation: 0, shape: "rect" })).toEqual({});
	});
});

describe("colorHex", () => {
	it("maps the named palette and falls back to slate for unknowns", () => {
		expect(colorHex("teal")).toBe("#0d9488");
		expect(colorHex(undefined)).toBe("#94a3b8");
		expect(colorHex("not-a-color")).toBe("#94a3b8");
	});
});
