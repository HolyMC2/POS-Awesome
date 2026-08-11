// @vitest-environment jsdom
// jsdom because importing floorGeometry pulls the floorStore module chain,
// and floorOrderActions reads `window.__` at module top level.
import { describe, expect, it } from "vitest";

import {
	DEFAULT_CANVAS,
	ROTATION_STEP,
	clampToCanvas,
	colorHex,
	cycleShape,
	duplicateLayout,
	fitScale,
	labelStyle,
	nudgeLayout,
	resizeLayout,
	resolveCanvas,
	resolveTableLayout,
	rotateLayout,
	scaledCanvasStyle,
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

	it("counter-scales the label so a fitted plan stays readable", () => {
		// The table number is what the plan exists to tell you; letting it shrink
		// with the room puts it near 6px on a phone.
		const upright: PlacedLayout = { x: 0, y: 0, w: 2, h: 2, rotation: 0, shape: "rect" };
		expect(labelStyle(upright, 2)).toEqual({ transform: "scale(2)" });
		expect(labelStyle({ ...upright, rotation: 90 }, 2)).toEqual({
			transform: "rotate(-90deg) scale(2)",
		});
		// 1:1 must stay style-free — an identity transform still promotes the
		// element to its own layer on every tile of the board.
		expect(labelStyle(upright, 1)).toEqual({});
	});
});

describe("colorHex", () => {
	it("maps the named palette and falls back to slate for unknowns", () => {
		expect(colorHex("teal")).toBe("#0d9488");
		expect(colorHex(undefined)).toBe("#94a3b8");
		expect(colorHex("not-a-color")).toBe("#94a3b8");
	});
});

describe("resizeLayout", () => {
	const canvas = { cols: 10, rows: 8, cell: 44 };
	const layout: PlacedLayout = { x: 2, y: 2, w: 2, h: 2, rotation: 0, shape: "rect" };

	it("moves each axis independently so long-thin tables are drawable", () => {
		// The v1 stepper coupled w and h, which made a bar counter or a banquet
		// run — the shapes a real room is full of — impossible to author.
		expect(resizeLayout(layout, 2, 0, canvas)).toMatchObject({ w: 4, h: 2 });
		expect(resizeLayout(layout, 0, 1, canvas)).toMatchObject({ w: 2, h: 3 });
	});

	it("never shrinks below one cell", () => {
		expect(resizeLayout(layout, -9, -9, canvas)).toMatchObject({ w: 1, h: 1 });
	});

	it("pulls the tile back inside instead of refusing to grow at the wall", () => {
		const atEdge: PlacedLayout = { ...layout, x: 8, y: 6 };
		expect(resizeLayout(atEdge, 2, 2, canvas)).toMatchObject({ x: 6, y: 4, w: 4, h: 4 });
	});
});

describe("nudgeLayout", () => {
	const canvas = { cols: 10, rows: 8, cell: 44 };
	const layout: PlacedLayout = { x: 1, y: 1, w: 2, h: 2, rotation: 0, shape: "rect" };

	it("steps by whole cells and stops at the edge", () => {
		expect(nudgeLayout(layout, 1, -1, canvas)).toMatchObject({ x: 2, y: 0 });
		expect(nudgeLayout(layout, 0, -5, canvas)).toMatchObject({ y: 0 });
		expect(nudgeLayout(layout, 20, 0, canvas)).toMatchObject({ x: 8 });
	});
});

describe("rotateLayout", () => {
	const layout: PlacedLayout = { x: 0, y: 0, w: 2, h: 2, rotation: 0, shape: "rect" };

	it("cycles in 45° steps and wraps through zero in both directions", () => {
		expect(rotateLayout(layout).rotation).toBe(ROTATION_STEP);
		expect(rotateLayout({ ...layout, rotation: 315 }).rotation).toBe(0);
		expect(rotateLayout({ ...layout, rotation: 0 }, -1).rotation).toBe(315);
	});
});

describe("cycleShape", () => {
	const layout: PlacedLayout = { x: 0, y: 0, w: 2, h: 2, rotation: 0, shape: "rect" };

	it("toggles rect and round, normalising anything else to rect first", () => {
		expect(cycleShape(layout).shape).toBe("round");
		expect(cycleShape({ ...layout, shape: "round" }).shape).toBe("rect");
		expect(cycleShape({ ...layout, shape: "hexagon" }).shape).toBe("round");
	});
});

describe("duplicateLayout", () => {
	const canvas = { cols: 10, rows: 8, cell: 44 };

	it("offsets the copy so it is visible rather than hidden behind its source", () => {
		const source: PlacedLayout = { x: 1, y: 1, w: 2, h: 2, rotation: 45, shape: "round" };
		expect(duplicateLayout(source, canvas)).toMatchObject({
			x: 2,
			y: 2,
			w: 2,
			h: 2,
			rotation: 45,
			shape: "round",
		});
	});

	it("keeps the copy on the canvas when the source sits at the far edge", () => {
		const source: PlacedLayout = { x: 8, y: 6, w: 2, h: 2, rotation: 0, shape: "rect" };
		expect(duplicateLayout(source, canvas)).toMatchObject({ x: 8, y: 6 });
	});
});

describe("fitScale", () => {
	const canvas = { cols: 24, rows: 16, cell: 44 }; // 1056px across

	it("shrinks a desk-authored room to fit a phone", () => {
		// 390px viewport minus the scrollport padding.
		expect(fitScale(canvas, 390)).toBeCloseTo((390 - 16) / 1056);
	});

	it("never scales UP — a dining room is not a poster", () => {
		expect(fitScale(canvas, 4000)).toBe(1);
	});

	it("falls back to 1:1 when the width has not been measured yet", () => {
		expect(fitScale(canvas, 0)).toBe(1);
		expect(fitScale(canvas, Number.NaN)).toBe(1);
	});

	it("floors at a quarter so a huge canvas stays a plan, not a smudge", () => {
		expect(fitScale({ cols: 200, rows: 200, cell: 44 }, 390)).toBe(0.25);
	});
});

describe("scaledCanvasStyle", () => {
	it("reports the footprint the scaled plane actually occupies", () => {
		// The canvas keeps its authored pixel size and is shrunk by a transform,
		// which does not affect layout — without this the scrollport would scroll
		// the unscaled distance and leave dead space past the last table.
		expect(scaledCanvasStyle({ cols: 10, rows: 8, cell: 50 }, 0.5)).toEqual({
			width: "250px",
			height: "200px",
		});
	});
});
