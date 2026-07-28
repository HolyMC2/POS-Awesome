/**
 * Geometry for the barcode label sheet (`/posapp/barcode`).
 *
 * Every dimension a printed label needs is derived here, in millimetres, from
 * the paper size and the requested column/row grid. Both output paths — the
 * browser print dialog and the html2pdf download — consume the same numbers,
 * so a label looks identical whichever button the cashier presses.
 *
 * Why this exists: the label markup used to hard-code its font sizes, paddings
 * and JsBarcode raster in CSS pixels while the cell height was computed in
 * millimetres from the row count. The two were unrelated, so a denser grid
 * shrank the cell but not its contents and `.label { overflow: hidden }`
 * sheared the bottom line of text off every label.
 */

/** CSS pixels per millimetre at the 96dpi CSS reference resolution. */
export const PX_PER_MM = 96 / 25.4;

/**
 * Raster resolution (px per mm) used for the JsBarcode bitmap.
 *
 * The bitmap is generated larger than its printed box and scaled down by CSS,
 * which keeps the bars crisp on a real printer (8 px/mm is ~203dpi, the usual
 * label-printer head resolution) without letting the raster dictate layout.
 */
export const BARCODE_RASTER_PX_PER_MM = 8;

/** Quiet zone either side of the symbol, expressed in modules. */
export const BARCODE_QUIET_MODULES = 10;

/** Vertical breathing room kept free on every sheet, top and bottom. */
export const PAGE_SAFETY_MM = 1.5;

/** Line-height multiplier applied to every text row on a label. */
export const LABEL_LINE_HEIGHT = 1.15;

const DEFAULT_GAP_MM = 3;
const MIN_GAP_MM = 0.5;

const MIN_BARCODE_MM = 6;
const MIN_BARCODE_FLOOR_MM = 3;
const BARCODE_MIN_SHARE = 0.45;

const MIN_FONT_MM = 1.4;
const NAME_FONT_MIN_MM = 1.7;
const NAME_FONT_MAX_MM = 3.2;
const META_FONT_MIN_MM = 1.4;
const META_FONT_MAX_MM = 2.6;

const MIN_MODULE_PX = 1;
const MAX_MODULE_PX = 6;

const MAX_COLS = 20;
const MAX_ROWS = 40;

/** Paper the label sheet can be laid out on. Margins are per-edge. */
export interface LabelPageFormat {
	widthMm: number;
	heightMm: number;
	marginMm: number;
}

/**
 * Page formats offered by the barcode printing screen.
 *
 * Keyed by the value stored in `BarcodePrinting.pageFormat`.
 */
export const LABEL_PAGE_FORMATS: Record<string, LabelPageFormat> = {
	A4: { widthMm: 210, heightMm: 297, marginMm: 10 },
};

export const DEFAULT_LABEL_PAGE_FORMAT = "A4";

export interface LabelLayoutInput {
	/** Key into {@link LABEL_PAGE_FORMATS}. Unknown keys fall back to A4. */
	pageFormat?: string;
	cols?: number;
	rows?: number;
	includePrice?: boolean;
	includeBatchSerial?: boolean;
	/** Overrides for non-catalogued paper (roll/thermal stock). */
	pageWidthMm?: number;
	pageHeightMm?: number;
	marginMm?: number;
	gapMm?: number;
	/** Longest barcode string in the job — drives the module width budget. */
	barcodeValueLength?: number;
	/** Longest barcode value itself, when available (picks the symbology). */
	barcodeValue?: string;
}

export interface BarcodeRasterSpec {
	/** `jsbarcode-height` — bar height of the bitmap, in raster px. */
	barHeightPx: number;
	/** `jsbarcode-fontsize` — human-readable value, in raster px. */
	fontSizePx: number;
	/** `jsbarcode-width` — module width. JsBarcode parseInt()s this. */
	moduleWidthPx: number;
	/** `jsbarcode-marginleft` / `-marginright` — quiet zone, in raster px. */
	marginXPx: number;
	/** Printed box the bitmap is scaled into. */
	maxHeightMm: number;
	maxWidthMm: number;
	displayValue: boolean;
	/** Estimated module count used to size {@link moduleWidthPx}. */
	modules: number;
}

export interface BarcodeLabelLayout {
	page: LabelPageFormat;
	printableWidthMm: number;
	printableHeightMm: number;
	/** Height the label grid may occupy — printable height less the safety band. */
	gridHeightMm: number;
	cols: number;
	rows: number;
	labelsPerPage: number;
	gapMm: number;
	cellWidthMm: number;
	cellHeightMm: number;
	paddingMm: number;
	borderMm: number;
	innerWidthMm: number;
	innerHeightMm: number;
	blockGapMm: number;
	nameFontMm: number;
	metaFontMm: number;
	priceFontMm: number;
	includePrice: boolean;
	includeBatchSerial: boolean;
	/** Combined height of the text rows plus the gaps between all blocks. */
	textHeightMm: number;
	/** Height handed to the barcode block. */
	barcodeAreaMm: number;
	/** Always equals {@link innerHeightMm} — the fit invariant. */
	contentHeightMm: number;
	barcode: BarcodeRasterSpec;
	/** False when the cell is too small to honour the readability minimums. */
	fits: boolean;
	warnings: string[];
}

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const toPositiveInt = (
	value: unknown,
	fallback: number,
	max: number,
): number => {
	const parsed = Math.floor(Number(value));
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback;
	}
	return Math.min(parsed, max);
};

const toPositiveNumber = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
};

/**
 * Resolves the paper the sheet is laid out on.
 *
 * Explicit millimetre overrides win over the catalogued format so roll stock
 * can reuse the same math.
 */
export const resolveLabelPageFormat = (
	input: LabelLayoutInput = {},
): LabelPageFormat => {
	const fallback: LabelPageFormat = {
		widthMm: 210,
		heightMm: 297,
		marginMm: 10,
	};
	const preset =
		LABEL_PAGE_FORMATS[String(input.pageFormat || "")] ||
		LABEL_PAGE_FORMATS[DEFAULT_LABEL_PAGE_FORMAT] ||
		fallback;

	const widthMm = toPositiveNumber(input.pageWidthMm, preset.widthMm);
	const heightMm = toPositiveNumber(input.pageHeightMm, preset.heightMm);
	const rawMargin =
		input.marginMm === undefined ? preset.marginMm : Number(input.marginMm);
	const marginMm =
		Number.isFinite(rawMargin) && rawMargin >= 0
			? rawMargin
			: preset.marginMm;

	// Never let the margins swallow the sheet.
	const safeMargin = Math.min(
		marginMm,
		(Math.min(widthMm, heightMm) - 10) / 2,
	);

	return { widthMm, heightMm, marginMm: Math.max(0, safeMargin) };
};

/**
 * Estimates how many modules (narrow-bar units) a barcode symbol occupies.
 *
 * JsBarcode's `format: "auto"` picks EAN/UPC for the well-known numeric
 * lengths and CODE128 for everything else. The estimate only has to be close:
 * `max-width` on the image is the backstop when it is short.
 */
export const estimateBarcodeModules = (
	value?: string,
	valueLength?: number,
): number => {
	const text = String(value ?? "").trim();
	const length = text
		? text.length
		: Math.max(0, Math.floor(Number(valueLength) || 0));
	if (!length) {
		return 106;
	}

	const numeric = text ? /^\d+$/.test(text) : true;
	if (numeric) {
		// EAN-13 / UPC-A are 95 modules; JsBarcode also draws the leading
		// digit outside the symbol, so budget a little extra.
		if (length === 13 || length === 12) return 106;
		if (length === 8) return 78;
	}

	// CODE128: start + data + checksum (11 modules each) + stop (13).
	return Math.max(40, 11 * length + 35);
};

/**
 * Computes every printed dimension of a barcode label sheet.
 *
 * The returned layout guarantees `contentHeightMm === innerHeightMm`: the
 * stacked blocks are sized to consume exactly the cell interior, so no text
 * can be clipped by the label's `overflow: hidden`. When the cell is too small
 * to keep the readability minimums, `fits` is false and `warnings` explains
 * which minimum was given up.
 */
export const computeBarcodeLabelLayout = (
	input: LabelLayoutInput = {},
): BarcodeLabelLayout => {
	const warnings: string[] = [];

	const page = resolveLabelPageFormat(input);
	const cols = toPositiveInt(input.cols, 3, MAX_COLS);
	const rows = toPositiveInt(input.rows, 7, MAX_ROWS);
	const includePrice = Boolean(input.includePrice);
	const includeBatchSerial = Boolean(input.includeBatchSerial);

	const printableWidthMm = Math.max(10, page.widthMm - 2 * page.marginMm);
	const printableHeightMm = Math.max(10, page.heightMm - 2 * page.marginMm);

	// Keep the grid strictly inside the fragmentainer. Filling the printable
	// box exactly leaves zero tolerance for sub-pixel rounding and pushes the
	// last row onto the next page (or gets it sliced by html2pdf).
	const safetyMm = Math.min(PAGE_SAFETY_MM, printableHeightMm * 0.05);
	const gridHeightMm = Math.max(5, printableHeightMm - 2 * safetyMm);

	// Gaps are cosmetic; shrink them before the cells get squeezed.
	const requestedGap = toPositiveNumber(input.gapMm, DEFAULT_GAP_MM);
	const gapCeilingW = cols > 1 ? printableWidthMm / (cols * 6) : requestedGap;
	const gapCeilingH = rows > 1 ? gridHeightMm / (rows * 6) : requestedGap;
	const gapMm = clamp(
		Math.min(requestedGap, gapCeilingW, gapCeilingH),
		MIN_GAP_MM,
		requestedGap,
	);

	const cellWidthMm = Math.max(
		1,
		(printableWidthMm - (cols - 1) * gapMm) / cols,
	);
	const cellHeightMm = Math.max(
		1,
		(gridHeightMm - (rows - 1) * gapMm) / rows,
	);

	const paddingMm = clamp(cellHeightMm * 0.04, 0.5, 1.5);
	const borderMm = 0.25;
	const frameMm = 2 * (paddingMm + borderMm);
	const innerWidthMm = Math.max(1, cellWidthMm - frameMm);
	const innerHeightMm = Math.max(1, cellHeightMm - frameMm);

	const blockGapMm = clamp(cellHeightMm * 0.02, 0.2, 0.8);

	// name + barcode are always present; meta and price are optional.
	const blockCount =
		2 + (includeBatchSerial ? 1 : 0) + (includePrice ? 1 : 0);
	const gapTotalMm = (blockCount - 1) * blockGapMm;

	let nameFontMm = clamp(
		cellHeightMm * 0.085,
		NAME_FONT_MIN_MM,
		NAME_FONT_MAX_MM,
	);
	let metaFontMm = includeBatchSerial
		? clamp(cellHeightMm * 0.07, META_FONT_MIN_MM, META_FONT_MAX_MM)
		: 0;
	let priceFontMm = includePrice ? nameFontMm : 0;

	const fontStackMm = () =>
		(nameFontMm + metaFontMm + priceFontMm) * LABEL_LINE_HEIGHT;

	let fontPartMm = fontStackMm();
	let textHeightMm = fontPartMm + gapTotalMm;
	let barcodeAreaMm = innerHeightMm - textHeightMm;
	let fits = true;

	if (barcodeAreaMm < MIN_BARCODE_MM) {
		// Shrink the text so the symbol keeps a scannable height.
		const availableForFonts = innerHeightMm - MIN_BARCODE_MM - gapTotalMm;
		const scale =
			fontPartMm > 0 ? Math.max(0, availableForFonts) / fontPartMm : 1;
		nameFontMm = Math.max(MIN_FONT_MM, nameFontMm * scale);
		metaFontMm = metaFontMm ? Math.max(MIN_FONT_MM, metaFontMm * scale) : 0;
		priceFontMm = priceFontMm
			? Math.max(MIN_FONT_MM, priceFontMm * scale)
			: 0;

		fontPartMm = fontStackMm();
		textHeightMm = fontPartMm + gapTotalMm;
		barcodeAreaMm = innerHeightMm - textHeightMm;
		fits = false;
		warnings.push("label-text-scaled-down");

		if (barcodeAreaMm < MIN_BARCODE_FLOOR_MM) {
			// The cell cannot hold both at legible sizes. Reserve a fixed
			// share for the symbol and let the text take whatever is left,
			// below the readability floor if it has to — clipped letters
			// are worse than small ones.
			barcodeAreaMm = Math.min(
				Math.max(
					innerHeightMm * BARCODE_MIN_SHARE,
					MIN_BARCODE_FLOOR_MM * 0.5,
				),
				Math.max(0, innerHeightMm - gapTotalMm),
			);
			const available = Math.max(
				0,
				innerHeightMm - barcodeAreaMm - gapTotalMm,
			);
			const tightScale = fontPartMm > 0 ? available / fontPartMm : 1;
			nameFontMm *= tightScale;
			metaFontMm *= tightScale;
			priceFontMm *= tightScale;

			fontPartMm = fontStackMm();
			textHeightMm = fontPartMm + gapTotalMm;
			barcodeAreaMm = innerHeightMm - textHeightMm;
			warnings.push("label-too-small-for-grid");
		}
	}

	// The invariant every consumer relies on: the stack is exactly the cell.
	const contentHeightMm = textHeightMm + barcodeAreaMm;

	const barcode = buildBarcodeRaster({
		barcodeAreaMm,
		innerWidthMm,
		value: input.barcodeValue,
		valueLength: input.barcodeValueLength,
	});

	return {
		page,
		printableWidthMm,
		printableHeightMm,
		gridHeightMm,
		cols,
		rows,
		labelsPerPage: cols * rows,
		gapMm,
		cellWidthMm,
		cellHeightMm,
		paddingMm,
		borderMm,
		innerWidthMm,
		innerHeightMm,
		blockGapMm,
		nameFontMm,
		metaFontMm,
		priceFontMm,
		includePrice,
		includeBatchSerial,
		textHeightMm,
		barcodeAreaMm,
		contentHeightMm,
		barcode,
		fits,
		warnings,
	};
};

interface RasterInput {
	barcodeAreaMm: number;
	innerWidthMm: number;
	value?: string;
	valueLength?: number;
}

/**
 * Sizes the JsBarcode bitmap for a given printed box.
 *
 * JsBarcode `parseInt()`s the `jsbarcode-*` numeric attributes, so the module
 * width has to be a whole number — which is why the bitmap is rendered at
 * {@link BARCODE_RASTER_PX_PER_MM} and scaled down by CSS rather than being
 * rendered at its printed size.
 */
const buildBarcodeRaster = ({
	barcodeAreaMm,
	innerWidthMm,
	value,
	valueLength,
}: RasterInput): BarcodeRasterSpec => {
	const areaMm = Math.max(1, barcodeAreaMm);
	const displayValue = true;

	const valueFontMm = displayValue ? clamp(areaMm * 0.22, 1.4, 2.8) : 0;
	const barsMm = Math.max(1, areaMm - valueFontMm * LABEL_LINE_HEIGHT);

	const modules = estimateBarcodeModules(value, valueLength);
	const widthBudgetPx = innerWidthMm * BARCODE_RASTER_PX_PER_MM;
	const moduleWidthPx = clamp(
		Math.floor(widthBudgetPx / (modules + 2 * BARCODE_QUIET_MODULES)),
		MIN_MODULE_PX,
		MAX_MODULE_PX,
	);

	return {
		barHeightPx: Math.max(8, Math.round(barsMm * BARCODE_RASTER_PX_PER_MM)),
		fontSizePx: Math.max(
			6,
			Math.round(valueFontMm * BARCODE_RASTER_PX_PER_MM),
		),
		moduleWidthPx,
		marginXPx: moduleWidthPx * BARCODE_QUIET_MODULES,
		maxHeightMm: areaMm,
		maxWidthMm: innerWidthMm,
		displayValue,
		modules,
	};
};

/** Rounds a millimetre value for embedding in a stylesheet. */
export const mm = (value: number): string =>
	`${Math.round(value * 1000) / 1000}mm`;

/**
 * Builds the stylesheet the print window and the PDF window both use.
 *
 * Columns are pinned to the paper rather than `1fr` of whatever the popup
 * happens to be wide, and the blocks inside a label add up to exactly the cell
 * interior, so `overflow: hidden` never has anything to clip.
 */
export const buildLabelSheetStyles = (layout: BarcodeLabelLayout): string => {
	// Split the reserved page slack evenly above and below the grid so the
	// last row never lands on the fragmentainer boundary.
	const safetyMm = Math.max(
		0,
		(layout.printableHeightMm - layout.gridHeightMm) / 2,
	);

	return `
          @page { size: ${mm(layout.page.widthMm)} ${mm(layout.page.heightMm)}; margin: ${mm(layout.page.marginMm)}; }
          html, body { margin: 0; padding: 0; }
          body { font-family: sans-serif; width: ${mm(layout.printableWidthMm)}; }
          .label-page {
            width: ${mm(layout.printableWidthMm)};
            height: ${mm(layout.printableHeightMm)};
            box-sizing: border-box;
            padding: ${mm(safetyMm)} 0;
            overflow: hidden;
            page-break-after: always;
            break-after: page;
          }
          .label-page:last-child { page-break-after: auto; break-after: auto; }
          .label-grid {
            display: grid;
            grid-template-columns: repeat(${layout.cols}, ${mm(layout.cellWidthMm)});
            grid-auto-rows: ${mm(layout.cellHeightMm)};
            gap: ${mm(layout.gapMm)};
            justify-content: start;
            align-content: start;
          }
          .label {
            width: ${mm(layout.cellWidthMm)};
            height: ${mm(layout.cellHeightMm)};
            border: ${mm(layout.borderMm)} dashed #ccc;
            padding: ${mm(layout.paddingMm)};
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: ${mm(layout.blockGapMm)};
            page-break-inside: avoid;
            break-inside: avoid;
            box-sizing: border-box;
            overflow: hidden;
          }
          .item-name {
            flex: 0 0 auto;
            width: 100%;
            font-size: ${mm(layout.nameFontMm)};
            line-height: ${LABEL_LINE_HEIGHT};
            font-weight: bold;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .barcode-container {
            flex: 0 1 auto;
            min-height: 0;
            width: 100%;
            height: ${mm(layout.barcodeAreaMm)};
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
          }
          .batch-serial {
            flex: 0 0 auto;
            width: 100%;
            font-size: ${mm(layout.metaFontMm || layout.nameFontMm)};
            line-height: ${LABEL_LINE_HEIGHT};
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .price {
            flex: 0 0 auto;
            width: 100%;
            font-size: ${mm(layout.priceFontMm || layout.nameFontMm)};
            line-height: ${LABEL_LINE_HEIGHT};
            font-weight: bold;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          img.barcode {
            display: block;
            width: auto;
            height: auto;
            max-width: ${mm(layout.barcode.maxWidthMm)};
            max-height: ${mm(layout.barcode.maxHeightMm)};
            object-fit: contain;
          }
        `;
};

/**
 * Renders the JsBarcode `<img>` placeholder for a label.
 *
 * `margin` has to be zeroed wholesale: JsBarcode's `fixOptions` falls back to
 * `margin` for any falsy per-side value, so `marginTop="0"` alone would keep
 * the default 10px band at the top and bottom of the bitmap. The value is
 * expected to be HTML-escaped already.
 */
export const buildBarcodeImageMarkup = (
	barcode: BarcodeRasterSpec,
	safeValue: string,
): string =>
	`<img class="barcode"
                      jsbarcode-format="auto"
                      jsbarcode-value="${safeValue}"
                      jsbarcode-margin="0"
                      jsbarcode-marginleft="${barcode.marginXPx}"
                      jsbarcode-marginright="${barcode.marginXPx}"
                      jsbarcode-textmargin="0"
                      jsbarcode-fontoptions="bold"
                      jsbarcode-height="${barcode.barHeightPx}"
                      jsbarcode-width="${barcode.moduleWidthPx}"
                      jsbarcode-displayValue="${barcode.displayValue}"
                      jsbarcode-fontSize="${barcode.fontSizePx}">`;

/**
 * Groups rendered labels into one grid per sheet.
 *
 * A single grid spanning every page gets fragmented by the browser and blindly
 * sliced by html2pdf, which is what used to shear the bottom row in half.
 */
export const buildLabelSheetMarkup = (
	labels: string[],
	layout: BarcodeLabelLayout,
): string => {
	const perPage = Math.max(1, layout.labelsPerPage);
	let html = "";
	for (let start = 0; start < labels.length; start += perPage) {
		const page = labels.slice(start, start + perPage).join("");
		html += `<div class="label-page"><div class="label-grid">${page}</div></div>`;
	}
	return html;
};
