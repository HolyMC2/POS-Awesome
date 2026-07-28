import { describe, expect, it } from "vitest";

import {
	BARCODE_QUIET_MODULES,
	BARCODE_RASTER_PX_PER_MM,
	LABEL_LINE_HEIGHT,
	computeBarcodeLabelLayout,
	estimateBarcodeModules,
	mm,
	resolveLabelPageFormat,
} from "../src/posapp/utils/barcodeLabelLayout";

const EPSILON = 1e-6;

const GRIDS = [
	{ cols: 1, rows: 1 },
	{ cols: 2, rows: 4 },
	{ cols: 3, rows: 7 },
	{ cols: 3, rows: 8 },
	{ cols: 3, rows: 9 },
	{ cols: 4, rows: 10 },
	{ cols: 5, rows: 13 },
	{ cols: 6, rows: 20 },
	{ cols: 8, rows: 30 },
];

const TOGGLES = [
	{ includePrice: false, includeBatchSerial: false },
	{ includePrice: true, includeBatchSerial: false },
	{ includePrice: false, includeBatchSerial: true },
	{ includePrice: true, includeBatchSerial: true },
];

describe("computeBarcodeLabelLayout", () => {
	it("derives the A4 3x7 cell from the printable page, not from CSS pixels", () => {
		const layout = computeBarcodeLabelLayout({
			pageFormat: "A4",
			cols: 3,
			rows: 7,
			includePrice: true,
			barcodeValue: "7501234567890",
		});

		// A4 210x297 less 10mm margins => 190 x 277mm printable.
		expect(layout.printableWidthMm).toBe(190);
		expect(layout.printableHeightMm).toBe(277);
		// 3 columns, 3mm gutters: (190 - 6) / 3
		expect(layout.cellWidthMm).toBeCloseTo(61.333, 3);
		// 7 rows inside the printable height less the 1.5mm safety band
		// either side: (274 - 18) / 7
		expect(layout.cellHeightMm).toBeCloseTo(36.571, 3);
		expect(layout.labelsPerPage).toBe(21);
		expect(layout.fits).toBe(true);
		expect(layout.warnings).toEqual([]);
	});

	it("gives the barcode the room the old fixed 40px raster never had", () => {
		const layout = computeBarcodeLabelLayout({
			pageFormat: "A4",
			cols: 3,
			rows: 7,
			includePrice: true,
			barcodeValue: "7501234567890",
		});

		// The old markup spent 72 CSS px (19.05mm) on the barcode image, of
		// which 20px was dead JsBarcode margin. The derived layout hands the
		// symbol the whole leftover interior instead.
		expect(layout.barcodeAreaMm).toBeGreaterThan(19.05);
		expect(layout.barcodeAreaMm).toBeLessThan(layout.innerHeightMm);
	});

	it("keeps the stacked blocks exactly equal to the cell interior", () => {
		for (const grid of GRIDS) {
			for (const toggles of TOGGLES) {
				const layout = computeBarcodeLabelLayout({
					...grid,
					...toggles,
				});
				const label = `${grid.cols}x${grid.rows} ${JSON.stringify(toggles)}`;

				expect(layout.contentHeightMm, label).toBeCloseTo(
					layout.innerHeightMm,
					6,
				);
				expect(layout.contentHeightMm, label).toBeLessThanOrEqual(
					layout.innerHeightMm + EPSILON,
				);
				expect(layout.barcodeAreaMm, label).toBeGreaterThan(0);
				expect(layout.textHeightMm, label).toBeGreaterThan(0);
			}
		}
	});

	it("recomputes the text stack from the fonts it reports", () => {
		for (const grid of GRIDS) {
			for (const toggles of TOGGLES) {
				const layout = computeBarcodeLabelLayout({
					...grid,
					...toggles,
				});
				const blocks =
					2 +
					(toggles.includeBatchSerial ? 1 : 0) +
					(toggles.includePrice ? 1 : 0);
				const expected =
					(layout.nameFontMm +
						layout.metaFontMm +
						layout.priceFontMm) *
						LABEL_LINE_HEIGHT +
					(blocks - 1) * layout.blockGapMm;

				expect(layout.textHeightMm).toBeCloseTo(expected, 6);
			}
		}
	});

	it("only emits the optional blocks that were asked for", () => {
		const bare = computeBarcodeLabelLayout({ cols: 3, rows: 7 });
		expect(bare.priceFontMm).toBe(0);
		expect(bare.metaFontMm).toBe(0);

		const full = computeBarcodeLabelLayout({
			cols: 3,
			rows: 7,
			includePrice: true,
			includeBatchSerial: true,
		});
		expect(full.priceFontMm).toBeGreaterThan(0);
		expect(full.metaFontMm).toBeGreaterThan(0);
		// The extra lines come out of the barcode, never out of the cell.
		expect(full.barcodeAreaMm).toBeLessThan(bare.barcodeAreaMm);
		expect(full.contentHeightMm).toBeCloseTo(full.innerHeightMm, 6);
	});

	it("keeps the grid inside the printable page with slack to spare", () => {
		for (const grid of GRIDS) {
			const layout = computeBarcodeLabelLayout({
				...grid,
				includePrice: true,
			});
			const label = `${grid.cols}x${grid.rows}`;

			const gridWidth =
				layout.cols * layout.cellWidthMm +
				(layout.cols - 1) * layout.gapMm;
			const gridHeight =
				layout.rows * layout.cellHeightMm +
				(layout.rows - 1) * layout.gapMm;

			expect(gridWidth, label).toBeCloseTo(layout.printableWidthMm, 6);
			// The old math filled the printable height exactly (7 * 37 + 6 * 3
			// == 277), leaving the last row to spill onto the next page.
			expect(gridHeight, label).toBeLessThan(
				layout.printableHeightMm - 1,
			);
			expect(gridHeight, label).toBeCloseTo(layout.gridHeightMm, 6);
		}
	});

	it("shrinks fonts monotonically as the grid gets denser", () => {
		const fonts = [4, 7, 10, 14, 20].map(
			(rows) =>
				computeBarcodeLabelLayout({ cols: 3, rows, includePrice: true })
					.nameFontMm,
		);

		for (let i = 1; i < fonts.length; i += 1) {
			expect(fonts[i]).toBeLessThanOrEqual(fonts[i - 1] + EPSILON);
		}
		expect(fonts[fonts.length - 1]).toBeLessThan(fonts[0]);
	});

	it("flags grids that cannot hold a legible label", () => {
		const layout = computeBarcodeLabelLayout({
			cols: 6,
			rows: 30,
			includePrice: true,
			includeBatchSerial: true,
		});

		expect(layout.fits).toBe(false);
		expect(layout.warnings.length).toBeGreaterThan(0);
		// Still no overflow — the label shrinks instead of being clipped.
		expect(layout.contentHeightMm).toBeCloseTo(layout.innerHeightMm, 6);
		expect(layout.barcodeAreaMm).toBeGreaterThan(0);
		expect(layout.nameFontMm).toBeGreaterThan(0);
	});

	it("falls back to the default grid for missing or nonsense input", () => {
		const fallback = computeBarcodeLabelLayout();
		expect(fallback.cols).toBe(3);
		expect(fallback.rows).toBe(7);

		for (const bad of [0, -4, Number.NaN, "abc", null, undefined]) {
			const layout = computeBarcodeLabelLayout({
				cols: bad as never,
				rows: bad as never,
			});
			expect(layout.cols).toBe(3);
			expect(layout.rows).toBe(7);
			expect(layout.contentHeightMm).toBeCloseTo(layout.innerHeightMm, 6);
		}
	});

	it("caps absurd grids instead of producing zero-sized cells", () => {
		const layout = computeBarcodeLabelLayout({ cols: 500, rows: 500 });
		expect(layout.cols).toBeLessThanOrEqual(20);
		expect(layout.rows).toBeLessThanOrEqual(40);
		expect(layout.cellWidthMm).toBeGreaterThan(0);
		expect(layout.cellHeightMm).toBeGreaterThan(0);
		expect(layout.contentHeightMm).toBeCloseTo(layout.innerHeightMm, 6);
	});
});

describe("computeBarcodeLabelLayout barcode raster", () => {
	it("emits an integer module width — JsBarcode parseInt()s the attribute", () => {
		for (const grid of GRIDS) {
			const layout = computeBarcodeLabelLayout({
				...grid,
				barcodeValue: "7501234567890",
			});
			expect(Number.isInteger(layout.barcode.moduleWidthPx)).toBe(true);
			expect(layout.barcode.moduleWidthPx).toBeGreaterThanOrEqual(1);
			expect(Number.isInteger(layout.barcode.barHeightPx)).toBe(true);
			expect(Number.isInteger(layout.barcode.fontSizePx)).toBe(true);
			expect(Number.isInteger(layout.barcode.marginXPx)).toBe(true);
		}
	});

	it("keeps the symbol plus its quiet zones inside the cell width", () => {
		for (const grid of GRIDS) {
			for (const value of [
				"7501234567890",
				"12345678",
				"ITEM-ABC-0001-XYZ",
			]) {
				const layout = computeBarcodeLabelLayout({
					...grid,
					barcodeValue: value,
				});
				const { modules, moduleWidthPx, marginXPx } = layout.barcode;
				const symbolPx = modules * moduleWidthPx + 2 * marginXPx;
				const budgetPx = layout.innerWidthMm * BARCODE_RASTER_PX_PER_MM;

				// A single module is the floor; below that the raster cannot
				// shrink further and `max-width` on the image takes over.
				if (moduleWidthPx > 1) {
					expect(symbolPx).toBeLessThanOrEqual(budgetPx + EPSILON);
				}
				expect(marginXPx).toBe(moduleWidthPx * BARCODE_QUIET_MODULES);
			}
		}
	});

	it("scales the raster with the printed box it will be shrunk into", () => {
		const roomy = computeBarcodeLabelLayout({
			cols: 2,
			rows: 4,
			barcodeValue: "7501234567890",
		});
		const tight = computeBarcodeLabelLayout({
			cols: 4,
			rows: 12,
			barcodeValue: "7501234567890",
		});

		expect(roomy.barcode.barHeightPx).toBeGreaterThan(
			tight.barcode.barHeightPx,
		);
		expect(roomy.barcode.maxHeightMm).toBeCloseTo(roomy.barcodeAreaMm, 6);
		expect(roomy.barcode.maxWidthMm).toBeCloseTo(roomy.innerWidthMm, 6);
		// Oversampled so CSS can scale it down onto paper without softening.
		expect(roomy.barcode.barHeightPx).toBeGreaterThan(
			roomy.barcodeAreaMm * 2,
		);
	});
});

describe("estimateBarcodeModules", () => {
	it("recognises the numeric EAN/UPC lengths JsBarcode auto-detects", () => {
		expect(estimateBarcodeModules("7501234567890")).toBe(106); // EAN-13
		expect(estimateBarcodeModules("750123456789")).toBe(106); // UPC-A
		expect(estimateBarcodeModules("75012345")).toBe(78); // EAN-8
	});

	it("uses the CODE128 module formula for everything else", () => {
		expect(estimateBarcodeModules("ITEM-0001")).toBe(11 * 9 + 35);
		expect(estimateBarcodeModules("1234567890123456")).toBe(11 * 16 + 35);
	});

	it("falls back to a sane default when the value is unknown", () => {
		expect(estimateBarcodeModules()).toBe(106);
		expect(estimateBarcodeModules("")).toBe(106);
		expect(estimateBarcodeModules(undefined, 13)).toBe(106);
		expect(estimateBarcodeModules("A")).toBeGreaterThanOrEqual(40);
	});
});

describe("resolveLabelPageFormat", () => {
	it("defaults unknown formats to A4", () => {
		expect(resolveLabelPageFormat({ pageFormat: "Letter" })).toEqual({
			widthMm: 210,
			heightMm: 297,
			marginMm: 10,
		});
		expect(resolveLabelPageFormat()).toEqual({
			widthMm: 210,
			heightMm: 297,
			marginMm: 10,
		});
	});

	it("accepts explicit millimetre overrides for roll stock", () => {
		expect(
			resolveLabelPageFormat({
				pageWidthMm: 58,
				pageHeightMm: 40,
				marginMm: 0,
			}),
		).toEqual({
			widthMm: 58,
			heightMm: 40,
			marginMm: 0,
		});
	});

	it("never lets the margins swallow the sheet", () => {
		const format = resolveLabelPageFormat({
			pageWidthMm: 40,
			pageHeightMm: 30,
			marginMm: 25,
		});
		expect(format.marginMm).toBeLessThanOrEqual(10);
		expect(format.widthMm - 2 * format.marginMm).toBeGreaterThan(0);
	});

	it("lays a small roll label out without overflowing it", () => {
		const layout = computeBarcodeLabelLayout({
			cols: 1,
			rows: 1,
			pageWidthMm: 58,
			pageHeightMm: 40,
			marginMm: 1,
			gapMm: 0.5,
			includePrice: true,
			barcodeValue: "7501234567890",
		});

		expect(layout.cellWidthMm).toBeCloseTo(56, 6);
		expect(layout.contentHeightMm).toBeCloseTo(layout.innerHeightMm, 6);
		expect(layout.barcodeAreaMm).toBeGreaterThan(0);
	});
});

describe("mm", () => {
	it("formats millimetre values for a stylesheet", () => {
		expect(mm(36.5714285)).toBe("36.571mm");
		expect(mm(3)).toBe("3mm");
		expect(mm(0)).toBe("0mm");
	});
});
