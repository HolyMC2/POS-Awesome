import { describe, expect, it } from "vitest";

import {
	buildBarcodeImageMarkup,
	buildLabelSheetMarkup,
	buildLabelSheetStyles,
	computeBarcodeLabelLayout,
} from "../src/posapp/utils/barcodeLabelLayout";

const a4Layout = (over: Record<string, unknown> = {}) =>
	computeBarcodeLabelLayout({
		pageFormat: "A4",
		cols: 3,
		rows: 7,
		includePrice: true,
		barcodeValue: "7501234567890",
		...over,
	});

const round = (value: number) => Math.round(value * 1000) / 1000;

describe("buildLabelSheetStyles", () => {
	it("pins the grid to the paper instead of the popup width", () => {
		const style = buildLabelSheetStyles(a4Layout());

		// The bug: `repeat(3, 1fr)` made the column width whatever the print
		// popup happened to be, so html2pdf laid out 68mm labels on a
		// full-bleed 210mm page instead of 61.33mm ones inside the margins.
		expect(style).not.toContain("1fr");
		expect(style).toContain("grid-template-columns: repeat(3, 61.333mm)");
		expect(style).toContain("grid-auto-rows: 36.571mm");
		expect(style).toContain("@page { size: 210mm 297mm; margin: 10mm; }");
		expect(style).toContain("width: 190mm");
	});

	it("sizes every label block in millimetres derived from the cell", () => {
		const layout = a4Layout();
		const style = buildLabelSheetStyles(layout);

		// No hard-coded pixel type sizes survive in the label stylesheet.
		expect(style).not.toMatch(/font-size:\s*\d+px/);
		expect(style).toContain(`font-size: ${round(layout.nameFontMm)}mm`);
		expect(style).toContain(`height: ${round(layout.barcodeAreaMm)}mm`);
		expect(style).toContain(`max-height: ${round(layout.barcodeAreaMm)}mm`);
		expect(style).toContain(`max-width: ${round(layout.innerWidthMm)}mm`);
	});

	it("clamps every text row so long names cannot push the label taller", () => {
		const style = buildLabelSheetStyles(
			a4Layout({ includeBatchSerial: true }),
		);

		// shop name, item name, batch/serial and price all ellipsise.
		expect(style.match(/text-overflow: ellipsis/g) || []).toHaveLength(4);
		expect(style.match(/white-space: nowrap/g) || []).toHaveLength(4);
	});

	it("sizes the shop-name caption below the item name", () => {
		const layout = a4Layout({ includeCompany: true });
		const style = buildLabelSheetStyles(layout);

		expect(layout.companyFontMm).toBeGreaterThan(0);
		expect(layout.companyFontMm).toBeLessThan(layout.nameFontMm);
		expect(style).toContain(`font-size: ${round(layout.companyFontMm)}mm`);
	});

	it("keeps the page wrapper inside the printable box", () => {
		const layout = a4Layout();
		const style = buildLabelSheetStyles(layout);
		const safetyMm = (layout.printableHeightMm - layout.gridHeightMm) / 2;

		expect(style).toContain(`padding: ${round(safetyMm)}mm 0`);
		expect(style).toContain("page-break-after: always");
		expect(style).toContain(
			".label-page:last-child { page-break-after: auto",
		);
		// The barcode block is the only one allowed to give ground.
		expect(style).toContain("flex: 0 1 auto");
		expect(style).toContain("min-height: 0");
	});
});

describe("buildLabelSheetMarkup", () => {
	it("breaks the labels into one grid per sheet", () => {
		const layout = a4Layout();
		const labels = Array.from(
			{ length: 50 },
			(_unused, i) => `<div class="label">${i}</div>`,
		);
		const html = buildLabelSheetMarkup(labels, layout);

		// 21 per page => 50 labels span three sheets.
		expect(layout.labelsPerPage).toBe(21);
		expect(html.match(/class="label-page"/g) || []).toHaveLength(3);
		expect(html.match(/class="label-grid"/g) || []).toHaveLength(3);
		expect(html.match(/class="label"/g) || []).toHaveLength(50);
	});

	it("fills each sheet before starting the next", () => {
		const layout = computeBarcodeLabelLayout({ cols: 2, rows: 2 });
		const labels = ["a", "b", "c", "d", "e"].map((v) => `<i>${v}</i>`);
		const html = buildLabelSheetMarkup(labels, layout);

		expect(html).toContain(
			'<div class="label-grid"><i>a</i><i>b</i><i>c</i><i>d</i></div>',
		);
		expect(html).toContain('<div class="label-grid"><i>e</i></div>');
	});

	it("emits nothing for an empty job", () => {
		expect(buildLabelSheetMarkup([], a4Layout())).toBe("");
	});
});

describe("buildBarcodeImageMarkup", () => {
	it("feeds JsBarcode the raster the layout computed", () => {
		const layout = a4Layout();
		const html = buildBarcodeImageMarkup(layout.barcode, "7501234567890");

		expect(html).toContain(
			`jsbarcode-height="${layout.barcode.barHeightPx}"`,
		);
		expect(html).toContain(
			`jsbarcode-width="${layout.barcode.moduleWidthPx}"`,
		);
		expect(html).toContain(
			`jsbarcode-fontSize="${layout.barcode.fontSizePx}"`,
		);
		expect(html).toContain('jsbarcode-value="7501234567890"');
		// The old markup was fixed at a 40px bar height and a 1.5 module
		// width — which JsBarcode parseInt()s down to 1.
		expect(html).not.toContain('jsbarcode-height="40"');
		expect(html).not.toContain('jsbarcode-width="1.5"');
	});

	it("zeroes the whole margin so the vertical band disappears", () => {
		const layout = a4Layout();
		const html = buildBarcodeImageMarkup(layout.barcode, "7501234567890");

		// JsBarcode's fixOptions falls back to `margin` for any falsy
		// per-side value, so marginTop="0" alone would keep the 10px band.
		expect(html).toContain('jsbarcode-margin="0"');
		expect(html).toContain(
			`jsbarcode-marginleft="${layout.barcode.marginXPx}"`,
		);
		expect(html).toContain(
			`jsbarcode-marginright="${layout.barcode.marginXPx}"`,
		);
		expect(html).not.toContain("jsbarcode-margintop");
	});

	it("shrinks the raster along with the cell", () => {
		const roomy = buildBarcodeImageMarkup(
			a4Layout({ rows: 4 }).barcode,
			"7501234567890",
		);
		const tight = buildBarcodeImageMarkup(
			a4Layout({ rows: 14 }).barcode,
			"7501234567890",
		);

		const heightOf = (html: string) =>
			Number(/jsbarcode-height="(\d+)"/.exec(html)?.[1]);
		expect(heightOf(roomy)).toBeGreaterThan(heightOf(tight));
	});
});
