import { describe, expect, it } from "vitest";

import {
	BARCODE_RASTER_PX_PER_MM,
	buildLabelSheetMarkup,
	computeBarcodeLabelLayout,
} from "../src/posapp/utils/barcodeLabelLayout";
import {
	CUSTOM_LABEL_PRESET_ID,
	DEFAULT_LABEL_PRESET_ID,
	LABEL_PRESETS,
	LABEL_PRINTER_TYPES,
	defaultPresetIdForType,
	findLabelPreset,
	labelPresetsForType,
	presetLayoutInput,
} from "../src/posapp/utils/barcodeLabelPresets";

const EPSILON = 1e-6;

/**
 * The toggle combinations a preset has to survive. Every optional block steals
 * height from the barcode, so the densest case is the one that breaks a cell.
 */
const TOGGLES = [
	{},
	{ includePrice: true },
	{ includePrice: true, includeBatchSerial: true },
	{
		includePrice: true,
		includeBatchSerial: true,
		includeCompany: true,
	},
	{
		includePrice: true,
		includeBatchSerial: true,
		includeCompany: true,
		showBarcodeText: false,
	},
];

const layoutFor = (
	preset: (typeof LABEL_PRESETS)[number],
	toggles: Record<string, unknown> = {},
) =>
	computeBarcodeLabelLayout({
		...presetLayoutInput(preset),
		barcodeValue: "7501234567890",
		...toggles,
	});

describe("label preset table", () => {
	it("keeps the ids unique and every printer type populated", () => {
		const ids = LABEL_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);

		for (const type of LABEL_PRINTER_TYPES) {
			expect(
				labelPresetsForType(type.value).length,
				type.value,
			).toBeGreaterThan(0);
			expect(findLabelPreset(defaultPresetIdForType(type.value)).type).toBe(
				type.value,
			);
		}
	});

	it("opens on the grid the screen used before presets existed", () => {
		const preset = findLabelPreset(DEFAULT_LABEL_PRESET_ID);
		expect(preset.pageFormat).toBe("A4");
		expect(preset.cols).toBe(3);
		expect(preset.rows).toBe(7);

		// Identical geometry to the pre-preset hard-coded call.
		const before = computeBarcodeLabelLayout({
			pageFormat: "A4",
			cols: 3,
			rows: 7,
			includePrice: true,
			barcodeValue: "7501234567890",
		});
		const after = layoutFor(preset, { includePrice: true });
		expect(after.cellWidthMm).toBeCloseTo(before.cellWidthMm, 6);
		expect(after.cellHeightMm).toBeCloseTo(before.cellHeightMm, 6);
		expect(after.labelsPerPage).toBe(before.labelsPerPage);
	});

	it("falls back to the default preset for unknown ids", () => {
		expect(findLabelPreset("nope").id).toBe(DEFAULT_LABEL_PRESET_ID);
		expect(findLabelPreset("").id).toBe(DEFAULT_LABEL_PRESET_ID);
		expect(findLabelPreset(null).id).toBe(DEFAULT_LABEL_PRESET_ID);
		expect(findLabelPreset(undefined).id).toBe(DEFAULT_LABEL_PRESET_ID);
	});
});

describe("every preset honours the label geometry invariants", () => {
	for (const preset of LABEL_PRESETS) {
		for (const toggles of TOGGLES) {
			const name = `${preset.id} ${JSON.stringify(toggles)}`;

			it(`keeps the stack exactly the cell interior — ${name}`, () => {
				const layout = layoutFor(preset, toggles);

				// The invariant from 627e744d: nothing to clip, ever.
				expect(layout.contentHeightMm).toBeCloseTo(
					layout.innerHeightMm,
					6,
				);
				expect(layout.contentHeightMm).toBeLessThanOrEqual(
					layout.innerHeightMm + EPSILON,
				);
				expect(layout.barcodeAreaMm).toBeGreaterThan(0);
				expect(layout.textHeightMm).toBeGreaterThan(0);
				expect(layout.nameFontMm).toBeGreaterThan(0);
			});

			it(`emits an integer JsBarcode raster — ${name}`, () => {
				const { barcode } = layoutFor(preset, toggles);

				// JsBarcode parseInt()s these attributes.
				expect(Number.isInteger(barcode.moduleWidthPx)).toBe(true);
				expect(Number.isInteger(barcode.barHeightPx)).toBe(true);
				expect(Number.isInteger(barcode.fontSizePx)).toBe(true);
				expect(Number.isInteger(barcode.marginXPx)).toBe(true);
				expect(barcode.moduleWidthPx).toBeGreaterThanOrEqual(1);
				expect(barcode.barHeightPx).toBeGreaterThanOrEqual(8);
			});

			it(`fits the grid inside the printable area — ${name}`, () => {
				const layout = layoutFor(preset, toggles);

				const gridWidth =
					layout.cols * layout.cellWidthMm +
					(layout.cols - 1) * layout.gapMm;
				const gridHeight =
					layout.rows * layout.cellHeightMm +
					(layout.rows - 1) * layout.gapMm;

				expect(gridWidth).toBeLessThanOrEqual(
					layout.printableWidthMm + EPSILON,
				);
				expect(gridHeight).toBeLessThanOrEqual(
					layout.printableHeightMm + EPSILON,
				);
				// And inside the physical media once the margins are added back.
				expect(
					gridWidth + 2 * layout.page.marginMm,
				).toBeLessThanOrEqual(layout.page.widthMm + EPSILON);
				expect(
					gridHeight + 2 * layout.page.marginMm,
				).toBeLessThanOrEqual(layout.page.heightMm + EPSILON);
			});

			it(`keeps the symbol inside the cell width — ${name}`, () => {
				const layout = layoutFor(preset, toggles);
				const { modules, moduleWidthPx, marginXPx } = layout.barcode;
				const symbolPx = modules * moduleWidthPx + 2 * marginXPx;
				const budgetPx = layout.innerWidthMm * BARCODE_RASTER_PX_PER_MM;

				// A single module is the floor; below it `max-width` on the
				// image takes over.
				if (moduleWidthPx > 1) {
					expect(symbolPx).toBeLessThanOrEqual(budgetPx + EPSILON);
				}
			});
		}
	}
});

describe("thermal roll presets", () => {
	const rollPresets = labelPresetsForType("roll");

	it("prints one label per page on single-up roll stock", () => {
		for (const preset of rollPresets.filter((p) => p.cols === 1)) {
			const layout = layoutFor(preset, { includePrice: true });
			expect(layout.labelsPerPage, preset.id).toBe(1);

			// Five labels must become five pages — the roll advances to the
			// next gap after each one.
			const html = buildLabelSheetMarkup(
				["a", "b", "c", "d", "e"].map((v) => `<i>${v}</i>`),
				layout,
			);
			expect(
				(html.match(/class="label-page"/g) || []).length,
				preset.id,
			).toBe(5);
		}
	});

	it("uses the media as the page — no sheet margins on a roll", () => {
		for (const preset of rollPresets) {
			const layout = layoutFor(preset);
			expect(layout.page.widthMm, preset.id).toBe(preset.pageWidthMm);
			expect(layout.page.heightMm, preset.id).toBe(preset.pageHeightMm);
			expect(layout.page.marginMm, preset.id).toBeLessThanOrEqual(2);
		}
	});

	it("lays two faces across an 80mm head", () => {
		const twoUp = findLabelPreset("roll-80x40-2up");
		const layout = layoutFor(twoUp, { includePrice: true });

		expect(layout.cols).toBe(2);
		expect(layout.labelsPerPage).toBe(2);
		// (80 - 2*1.5 - 2) / 2
		expect(layout.cellWidthMm).toBeCloseTo(37.5, 3);
	});
});

describe("die-cut presets", () => {
	it("lands the nominal face width the stock is sold as", () => {
		// 104mm carrier, 1mm margins, 2mm gutter => two 50mm faces.
		const layout = layoutFor(findLabelPreset("diecut-50x25-2up"));
		expect(layout.cellWidthMm).toBeCloseTo(50, 3);
	});

	it("still lays out the smallest jewelry tag legibly", () => {
		const layout = layoutFor(findLabelPreset("diecut-30x20"), {
			includePrice: true,
		});

		expect(layout.contentHeightMm).toBeCloseTo(layout.innerHeightMm, 6);
		expect(layout.barcodeAreaMm).toBeGreaterThan(0);
		expect(layout.labelsPerPage).toBe(1);
	});
});

describe("presetLayoutInput", () => {
	it("ignores stray overrides on catalogued stock", () => {
		const preset = findLabelPreset("roll-58x40");
		const input = presetLayoutInput(preset, {
			cols: 9,
			rows: 9,
			pageWidthMm: 999,
		});

		// Picking known stock and getting something else because a stale
		// column count was still in the box is the surprise presets remove.
		expect(input.cols).toBe(1);
		expect(input.rows).toBe(1);
		expect(input.pageWidthMm).toBe(58);
	});

	it("takes the operator's millimetres on the custom preset", () => {
		const preset = findLabelPreset(CUSTOM_LABEL_PRESET_ID);
		const input = presetLayoutInput(preset, {
			cols: 2,
			rows: 3,
			pageWidthMm: 90,
			pageHeightMm: 60,
			marginMm: 0,
			gapMm: 1.5,
		});

		expect(input.cols).toBe(2);
		expect(input.rows).toBe(3);
		expect(input.pageWidthMm).toBe(90);
		expect(input.pageHeightMm).toBe(60);
		// Zero is a real choice on die-cut stock, not "unset".
		expect(input.marginMm).toBe(0);
		expect(input.gapMm).toBe(1.5);
	});

	it("falls back to the preset for missing or nonsense custom input", () => {
		const preset = findLabelPreset(CUSTOM_LABEL_PRESET_ID);
		const input = presetLayoutInput(preset, {
			cols: 0,
			rows: Number.NaN,
			pageWidthMm: -5,
			marginMm: Number.NaN,
		});

		expect(input.cols).toBe(preset.cols);
		expect(input.rows).toBe(preset.rows);
		expect(input.pageWidthMm).toBe(preset.pageWidthMm);
		expect(input.marginMm).toBe(preset.marginMm);
	});

	it("holds the invariants for a hand-typed custom size", () => {
		const preset = findLabelPreset(CUSTOM_LABEL_PRESET_ID);
		for (const size of [
			{ pageWidthMm: 25, pageHeightMm: 15, cols: 1, rows: 1 },
			{ pageWidthMm: 100, pageHeightMm: 150, cols: 2, rows: 4 },
			{ pageWidthMm: 76, pageHeightMm: 25, cols: 2, rows: 1 },
		]) {
			const layout = computeBarcodeLabelLayout({
				...presetLayoutInput(preset, size),
				includePrice: true,
				includeCompany: true,
				barcodeValue: "7501234567890",
			});
			const label = JSON.stringify(size);

			expect(layout.contentHeightMm, label).toBeCloseTo(
				layout.innerHeightMm,
				6,
			);
			expect(layout.barcodeAreaMm, label).toBeGreaterThan(0);
			expect(Number.isInteger(layout.barcode.moduleWidthPx), label).toBe(
				true,
			);
		}
	});
});
