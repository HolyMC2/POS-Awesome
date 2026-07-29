// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_BARCODE_LABEL_SETTINGS,
	loadBarcodeLabelSettings,
	normalizeBarcodeLabelSettings,
	saveBarcodeLabelSettings,
} from "../src/posapp/utils/barcodeLabelSettings";

const KEY = "posawesome_barcode_label_settings";

describe("barcode label settings", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("falls back to the pre-preset A4 3x7 behaviour with nothing stored", () => {
		const settings = loadBarcodeLabelSettings();

		expect(settings.printerType).toBe("sheet");
		expect(settings.presetId).toBe("a4-3x7");
		expect(settings.includePrice).toBe(true);
		expect(settings.includeBatchSerial).toBe(false);
		// New toggles default to off / today's rendering.
		expect(settings.includeCompany).toBe(false);
		expect(settings.showBarcodeText).toBe(true);
	});

	it("round-trips a saved selection", () => {
		saveBarcodeLabelSettings({
			...DEFAULT_BARCODE_LABEL_SETTINGS,
			presetId: "roll-58x40",
			includeCompany: true,
			showBarcodeText: false,
		});

		const restored = loadBarcodeLabelSettings();
		expect(restored.presetId).toBe("roll-58x40");
		expect(restored.printerType).toBe("roll");
		expect(restored.includeCompany).toBe(true);
		expect(restored.showBarcodeText).toBe(false);
	});

	it("derives the printer type from the preset so the two cannot disagree", () => {
		const settings = normalizeBarcodeLabelSettings({
			presetId: "diecut-40x30",
			printerType: "sheet",
		});

		expect(settings.printerType).toBe("diecut");
	});

	it("repairs a single bad field instead of resetting the lot", () => {
		const settings = normalizeBarcodeLabelSettings({
			presetId: "letter-3x8",
			includeCompany: true,
			customPageWidthMm: -12,
			customCols: "nonsense",
		});

		expect(settings.presetId).toBe("letter-3x8");
		expect(settings.includeCompany).toBe(true);
		expect(settings.customPageWidthMm).toBe(
			DEFAULT_BARCODE_LABEL_SETTINGS.customPageWidthMm,
		);
		expect(settings.customCols).toBe(
			DEFAULT_BARCODE_LABEL_SETTINGS.customCols,
		);
	});

	it("keeps a zero custom margin — it is a real choice on die-cut stock", () => {
		expect(normalizeBarcodeLabelSettings({ customMarginMm: 0 }).customMarginMm).toBe(0);
	});

	it("survives an unknown preset id from an older build", () => {
		localStorage.setItem(KEY, JSON.stringify({ presetId: "a4-9x9-gone" }));
		expect(loadBarcodeLabelSettings().presetId).toBe("a4-3x7");
	});

	it("survives unparseable storage", () => {
		localStorage.setItem(KEY, "{not json");
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		expect(loadBarcodeLabelSettings()).toEqual(
			DEFAULT_BARCODE_LABEL_SETTINGS,
		);
	});
});
