/**
 * Curated label stock for the barcode printing screen (`/posapp/barcode`).
 *
 * A preset is pure data: the paper it prints on and the grid that paper
 * carries. Nothing here knows about Vue — {@link presetLayoutInput} turns a
 * preset into the {@link LabelLayoutInput} that `computeBarcodeLabelLayout`
 * already understood, so every printer type goes through the one geometry
 * path and inherits its invariants.
 *
 * Three kinds of stock, because they are bought and loaded differently:
 *
 * - `sheet` — laser/inkjet A4 or Letter, many labels per page, grid as before.
 * - `roll` — continuous thermal roll. The page *is* one label: the printer
 *   advances to the next gap after every one, so `cols * rows` is 1 (or the
 *   number that fit across an 80mm head) and the sheet chunker emits one grid
 *   per label.
 * - `diecut` — pre-cut label stock on a carrier, plus the free-form "custom"
 *   entry where the operator types the millimetres off the box.
 *
 * Source strings stay English and are rendered through `__()` like the rest of
 * the screen; the es-MX wording lives in `posawesome/translations/es.csv`.
 */

import type { LabelLayoutInput } from "./barcodeLabelLayout";

export type LabelPrinterType = "sheet" | "roll" | "diecut";

export interface LabelPrinterTypeOption {
	value: LabelPrinterType;
	/** English source string; translated at render time. */
	title: string;
}

export const LABEL_PRINTER_TYPES: LabelPrinterTypeOption[] = [
	{ value: "sheet", title: "Sheet (A4 / Letter)" },
	{ value: "roll", title: "Thermal roll" },
	{ value: "diecut", title: "Die-cut / custom" },
];

export interface LabelPreset {
	id: string;
	type: LabelPrinterType;
	/** English source string; translated at render time. */
	title: string;
	cols: number;
	rows: number;
	/** Sheet stock: key into `LABEL_PAGE_FORMATS`. */
	pageFormat?: string;
	/** Roll / die-cut stock: the media itself, in millimetres. */
	pageWidthMm?: number;
	pageHeightMm?: number;
	marginMm?: number;
	gapMm?: number;
	/**
	 * True when the operator types the dimensions instead of picking stock.
	 * The screen reveals the millimetre inputs for this one.
	 */
	custom?: boolean;
}

/**
 * The preset the screen opens with — identical to the hard-coded A4 3x7 the
 * screen used before presets existed, so an operator with no stored settings
 * sees exactly what they saw yesterday.
 */
export const DEFAULT_LABEL_PRESET_ID = "a4-3x7";

export const CUSTOM_LABEL_PRESET_ID = "custom";

/**
 * Roll and die-cut media get a 1-1.5mm margin rather than the sheet's 10mm:
 * the media *is* the label, so anything bigger is thrown-away face area.
 * `computeBarcodeLabelLayout` then reserves its own safety band on top,
 * capped at 5% of the printable height, which is what keeps a 20mm-tall
 * jewelry tag from losing a third of its face to slack.
 */
const A4_3X7: LabelPreset = {
	id: DEFAULT_LABEL_PRESET_ID,
	type: "sheet",
	title: "A4 3 x 7 (21 labels)",
	pageFormat: "A4",
	cols: 3,
	rows: 7,
	gapMm: 3,
};

export const LABEL_PRESETS: LabelPreset[] = [
	// ---- Sheet: A4 -------------------------------------------------------
	A4_3X7,
	{
		id: "a4-3x8",
		type: "sheet",
		title: "A4 3 x 8 (24 labels)",
		pageFormat: "A4",
		cols: 3,
		rows: 8,
		gapMm: 3,
	},
	{
		id: "a4-4x11",
		type: "sheet",
		title: "A4 4 x 11 (44 labels)",
		pageFormat: "A4",
		cols: 4,
		rows: 11,
		gapMm: 3,
	},
	{
		id: "a4-2x5",
		type: "sheet",
		title: "A4 2 x 5 (10 large labels)",
		pageFormat: "A4",
		cols: 2,
		rows: 5,
		gapMm: 3,
	},
	// ---- Sheet: Letter ---------------------------------------------------
	{
		id: "letter-3x7",
		type: "sheet",
		title: "Letter 3 x 7 (21 labels)",
		pageFormat: "Letter",
		cols: 3,
		rows: 7,
		gapMm: 3,
	},
	{
		id: "letter-3x8",
		type: "sheet",
		title: "Letter 3 x 8 (24 labels)",
		pageFormat: "Letter",
		cols: 3,
		rows: 8,
		gapMm: 3,
	},
	{
		id: "letter-4x10",
		type: "sheet",
		title: "Letter 4 x 10 (40 labels)",
		pageFormat: "Letter",
		cols: 4,
		rows: 10,
		gapMm: 3,
	},
	// ---- Thermal roll ----------------------------------------------------
	{
		id: "roll-58x40",
		type: "roll",
		title: "Roll 58 x 40 mm",
		pageWidthMm: 58,
		pageHeightMm: 40,
		marginMm: 1.5,
		gapMm: 1,
		cols: 1,
		rows: 1,
	},
	{
		id: "roll-58x30",
		type: "roll",
		title: "Roll 58 x 30 mm",
		pageWidthMm: 58,
		pageHeightMm: 30,
		marginMm: 1.5,
		gapMm: 1,
		cols: 1,
		rows: 1,
	},
	{
		id: "roll-80x50",
		type: "roll",
		title: "Roll 80 x 50 mm",
		pageWidthMm: 80,
		pageHeightMm: 50,
		marginMm: 1.5,
		gapMm: 1,
		cols: 1,
		rows: 1,
	},
	{
		// An 80mm head is wide enough for two 37.5mm faces side by side.
		id: "roll-80x40-2up",
		type: "roll",
		title: "Roll 80 x 40 mm (2 across)",
		pageWidthMm: 80,
		pageHeightMm: 40,
		marginMm: 1.5,
		gapMm: 2,
		cols: 2,
		rows: 1,
	},
	// ---- Die-cut ---------------------------------------------------------
	{
		// 104mm carrier: 2 x 50mm faces with a 2mm gutter inside 1mm margins.
		id: "diecut-50x25-2up",
		type: "diecut",
		title: "Die-cut 50 x 25 mm (2 across)",
		pageWidthMm: 104,
		pageHeightMm: 27,
		marginMm: 1,
		gapMm: 2,
		cols: 2,
		rows: 1,
	},
	{
		id: "diecut-40x30",
		type: "diecut",
		title: "Die-cut 40 x 30 mm",
		pageWidthMm: 40,
		pageHeightMm: 30,
		marginMm: 1,
		gapMm: 1,
		cols: 1,
		rows: 1,
	},
	{
		id: "diecut-30x20",
		type: "diecut",
		title: "Die-cut 30 x 20 mm (jewelry)",
		pageWidthMm: 30,
		pageHeightMm: 20,
		marginMm: 1,
		gapMm: 1,
		cols: 1,
		rows: 1,
	},
	{
		id: CUSTOM_LABEL_PRESET_ID,
		type: "diecut",
		title: "Custom size",
		custom: true,
		pageWidthMm: 50,
		pageHeightMm: 30,
		marginMm: 1,
		gapMm: 2,
		cols: 1,
		rows: 1,
	},
];

const PRESETS_BY_ID: Record<string, LabelPreset> = LABEL_PRESETS.reduce(
	(map, preset) => {
		map[preset.id] = preset;
		return map;
	},
	{} as Record<string, LabelPreset>,
);

/** Looks a preset up, falling back to the default rather than throwing. */
export const findLabelPreset = (id?: string | null): LabelPreset =>
	PRESETS_BY_ID[String(id || "")] || A4_3X7;

export const labelPresetsForType = (type?: string): LabelPreset[] =>
	LABEL_PRESETS.filter((preset) => preset.type === type);

/** The preset a printer type opens with — its first entry. */
export const defaultPresetIdForType = (type?: string): string => {
	const first = labelPresetsForType(type)[0];
	return first ? first.id : DEFAULT_LABEL_PRESET_ID;
};

export interface PresetOverrides {
	cols?: number;
	rows?: number;
	pageWidthMm?: number;
	pageHeightMm?: number;
	marginMm?: number;
	gapMm?: number;
}

/**
 * Turns a preset (plus, for the custom entry, what the operator typed) into
 * the layout input.
 *
 * Only the custom preset honours the overrides: picking "Roll 58 x 40 mm" and
 * getting something else because a stale column count was still in the box is
 * exactly the surprise presets exist to remove.
 */
export const presetLayoutInput = (
	preset: LabelPreset,
	overrides: PresetOverrides = {},
): LabelLayoutInput => {
	const base: LabelLayoutInput = {
		pageFormat: preset.pageFormat,
		cols: preset.cols,
		rows: preset.rows,
		pageWidthMm: preset.pageWidthMm,
		pageHeightMm: preset.pageHeightMm,
		marginMm: preset.marginMm,
		gapMm: preset.gapMm,
	};

	if (!preset.custom) {
		return base;
	}

	const pick = (value: unknown, fallback?: number): number | undefined => {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	};

	return {
		...base,
		cols: pick(overrides.cols, preset.cols),
		rows: pick(overrides.rows, preset.rows),
		pageWidthMm: pick(overrides.pageWidthMm, preset.pageWidthMm),
		pageHeightMm: pick(overrides.pageHeightMm, preset.pageHeightMm),
		// A zero margin is a legitimate choice on die-cut stock, so it cannot
		// go through `pick` — which treats 0 as "unset".
		marginMm: Number.isFinite(Number(overrides.marginMm))
			? Math.max(0, Number(overrides.marginMm))
			: preset.marginMm,
		gapMm: pick(overrides.gapMm, preset.gapMm),
	};
};
