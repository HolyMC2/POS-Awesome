import { describe, expect, it } from "vitest";
import { rateBandWindow, rateOutsideBand } from "../src/posapp/utils/rateBand";

describe("rateBand preview · the client mirror of _resolve_band_pct (C3)", () => {
	it("blank and 0 both mean the 20% default — 0 is 'not configured', never zero-width", () => {
		expect(rateBandWindow(100, null)).toMatchObject({ low: 80, high: 120, bandPct: 20 });
		expect(rateBandWindow(100, 0)).toMatchObject({ low: 80, high: 120, bandPct: 20 });
		expect(rateBandWindow(100, "")).toMatchObject({ bandPct: 20 });
	});

	it("a negative band is the register's kill switch — no window at all", () => {
		expect(rateBandWindow(100, -1)).toBeNull();
	});

	it("a skip-band SKU (cambiar pantalla) never warns", () => {
		expect(rateBandWindow(150, 20, true)).toBeNull();
		expect(rateOutsideBand(400, 150, 20, true)).toBeNull();
	});

	it("no price-list rate means no source of truth, so no warning", () => {
		expect(rateBandWindow(0, 20)).toBeNull();
		expect(rateBandWindow(undefined, 20)).toBeNull();
	});

	it("flags the enganche-shaped case: 285 typed against a 3049 list", () => {
		const window = rateOutsideBand(285, 3049, 20);
		expect(window).not.toBeNull();
		expect(window?.low).toBeCloseTo(2439.2, 1);
		expect(window?.high).toBeCloseTo(3658.8, 1);
	});

	it("stays quiet inside the window and on the tolerant edges", () => {
		expect(rateOutsideBand(100, 100, 20)).toBeNull();
		expect(rateOutsideBand(80, 100, 20)).toBeNull();
		expect(rateOutsideBand(120.005, 100, 20)).toBeNull();
		expect(rateOutsideBand(79.98, 100, 20)).not.toBeNull();
	});

	it("zero and junk typed rates are the operator's call, not the preview's", () => {
		expect(rateOutsideBand(0, 100, 20)).toBeNull();
		expect(rateOutsideBand("garbage", 100, 20)).toBeNull();
	});
});
