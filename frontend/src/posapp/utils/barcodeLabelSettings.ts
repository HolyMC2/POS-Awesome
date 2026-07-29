import {
	CUSTOM_LABEL_PRESET_ID,
	DEFAULT_LABEL_PRESET_ID,
	findLabelPreset,
	type LabelPrinterType,
} from "./barcodeLabelPresets";

const SETTINGS_KEY = "posawesome_barcode_label_settings";

/**
 * What the barcode screen remembers between sessions.
 *
 * localStorage is already per-origin, so a cashier who works two tenants in
 * one browser keeps a set of settings for each without any keying of ours.
 */
export interface BarcodeLabelSettings {
	printerType: LabelPrinterType;
	presetId: string;
	includePrice: boolean;
	includeBatchSerial: boolean;
	includeCompany: boolean;
	showBarcodeText: boolean;
	/** Only meaningful for the custom preset. */
	customCols: number;
	customRows: number;
	customPageWidthMm: number;
	customPageHeightMm: number;
	customMarginMm: number;
	customGapMm: number;
}

/**
 * The screen's behaviour before it had settings: A4, three columns, seven
 * rows, price on, batch/serial off. Absent or unreadable storage must land
 * here exactly — an operator's sheet stock should not change under them
 * because we shipped a feature.
 */
export const DEFAULT_BARCODE_LABEL_SETTINGS: BarcodeLabelSettings = {
	printerType: "sheet",
	presetId: DEFAULT_LABEL_PRESET_ID,
	includePrice: true,
	includeBatchSerial: false,
	includeCompany: false,
	showBarcodeText: true,
	customCols: 1,
	customRows: 1,
	customPageWidthMm: 50,
	customPageHeightMm: 30,
	customMarginMm: 1,
	customGapMm: 2,
};

const bool = (value: unknown, fallback: boolean): boolean =>
	typeof value === "boolean" ? value : fallback;

const positive = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const nonNegative = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Coerces whatever is in storage into a usable settings object.
 *
 * Anything unrecognised falls back per-field rather than wholesale, so one
 * stale key from an older build cannot reset an operator's whole setup. The
 * preset id is resolved against the table and the printer type is taken from
 * the preset that survived, which keeps the two from disagreeing.
 */
export const normalizeBarcodeLabelSettings = (
	raw: unknown,
): BarcodeLabelSettings => {
	const source = (raw && typeof raw === "object" ? raw : {}) as Record<
		string,
		unknown
	>;
	const defaults = DEFAULT_BARCODE_LABEL_SETTINGS;
	const preset = findLabelPreset(source.presetId as string);

	return {
		presetId: preset.id,
		printerType: preset.type,
		includePrice: bool(source.includePrice, defaults.includePrice),
		includeBatchSerial: bool(
			source.includeBatchSerial,
			defaults.includeBatchSerial,
		),
		includeCompany: bool(source.includeCompany, defaults.includeCompany),
		showBarcodeText: bool(source.showBarcodeText, defaults.showBarcodeText),
		customCols: positive(source.customCols, defaults.customCols),
		customRows: positive(source.customRows, defaults.customRows),
		customPageWidthMm: positive(
			source.customPageWidthMm,
			defaults.customPageWidthMm,
		),
		customPageHeightMm: positive(
			source.customPageHeightMm,
			defaults.customPageHeightMm,
		),
		customMarginMm: nonNegative(
			source.customMarginMm,
			defaults.customMarginMm,
		),
		customGapMm: positive(source.customGapMm, defaults.customGapMm),
	};
};

/** Reads the stored settings, or the defaults when there are none. */
export const loadBarcodeLabelSettings = (): BarcodeLabelSettings => {
	try {
		const saved = localStorage.getItem(SETTINGS_KEY);
		if (!saved) {
			return { ...DEFAULT_BARCODE_LABEL_SETTINGS };
		}
		return normalizeBarcodeLabelSettings(JSON.parse(saved));
	} catch (error) {
		console.error("Failed to load barcode label settings:", error);
		return { ...DEFAULT_BARCODE_LABEL_SETTINGS };
	}
};

export const saveBarcodeLabelSettings = (
	settings: Partial<BarcodeLabelSettings>,
): boolean => {
	try {
		localStorage.setItem(
			SETTINGS_KEY,
			JSON.stringify(normalizeBarcodeLabelSettings(settings)),
		);
		return true;
	} catch (error) {
		console.error("Failed to save barcode label settings:", error);
		return false;
	}
};

export { CUSTOM_LABEL_PRESET_ID };
