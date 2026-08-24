/**
 * Labelling-scale barcodes — the parser.
 *
 * A báscula that prints labels encodes the measurement INTO the barcode, using
 * the EAN-13 prefixes GS1 reserves for restricted circulation inside one store:
 * **20–25**. Those codes are meaningless outside the shop that printed them,
 * which is exactly why a scale may mint them by the thousand.
 *
 *     2 0 | 0 1 2 3 4 | 0 0 3 1 2 | 8
 *     ^^^   ^^^^^^^^^   ^^^^^^^^^   ^
 *     |     |           |           check digit (mod 10)
 *     |     |           the measurement — five digits
 *     |     the item's short code — five digits
 *     the restricted-circulation prefix
 *
 * The five measurement digits mean one of two things and the label does not say
 * which — the register has to be told, once, by its profile
 * (`posa_embedded_barcode_scheme`):
 *
 * - **weight**: grams. `00312` is 0.312 kg.
 * - **price**: centavos. `04992` is $49.92, from which the qty is derived
 *   against the item's rate by the customer-favour rule in `fractionalMath`.
 *
 * Reading a weight label as a price (or the reverse) mis-charges by orders of
 * magnitude, so there is no sniffing and no default: a register with no scheme
 * configured treats a 20–25 code as an ordinary barcode, which is what it was
 * before this module existed.
 *
 * ## Three outcomes, deliberately
 *
 * `not_embedded` is not a failure. Most scans are ordinary barcodes and some of
 * them start with 20; the caller must fall through to its normal lookup without
 * showing the operator anything. `invalid` IS a failure and must be loud: the
 * prefix claimed a scale label and the contents contradicted it, and the one
 * thing a register must never do with a corrupt price label is guess.
 */

import {
	DEFAULT_CURRENCY_PRECISION,
	DEFAULT_QTY_PRECISION,
	qtyFromImporte,
	quantizeQty,
} from "./fractionalMath";

/** GS1 restricted circulation within a company. Fixed by the standard. */
export const EMBEDDED_PREFIX_MIN = 20;
export const EMBEDDED_PREFIX_MAX = 25;

/** prefix(2) + short code(5) + value(5) + check(1). */
const LABEL_LENGTH = 13;
const PREFIX_LENGTH = 2;
const SHORT_CODE_LENGTH = 5;
const VALUE_LENGTH = 5;

/** Grams per kilogram, and centavos per peso — the two implied scales. */
const WEIGHT_DIVISOR = 1000;
const PRICE_DIVISOR = 100;

/** What `posa_embedded_barcode_scheme` may hold. Blank = the feature is off. */
export type EmbeddedScheme = "weight" | "price";

export interface EmbeddedParsed {
	kind: "parsed";
	scheme: EmbeddedScheme;
	prefix: string;
	/** Five digits identifying the item. Never an item_code by itself. */
	shortCode: string;
	/** Kilograms, three decimals. Null under the price scheme. */
	weight: number | null;
	/** Pesos, two decimals. Null under the weight scheme. */
	importe: number | null;
	/**
	 * The same label with its measurement zeroed and the check digit
	 * recomputed — what a shop registers on the Item as its scale barcode,
	 * since the printed value changes with every package.
	 */
	template: string;
	raw: string;
}

export interface EmbeddedNotLabel {
	kind: "not_embedded";
	raw: string;
	why: "no_scheme" | "not_numeric" | "length" | "prefix";
}

export type EmbeddedInvalidReason = "check_digit" | "empty_value" | "empty_short_code";

export interface EmbeddedInvalid {
	kind: "invalid";
	raw: string;
	reason: EmbeddedInvalidReason;
	/** The digits the refusal is about, for the operator-facing sentence. */
	detail: string;
}

export type EmbeddedBarcodeResult = EmbeddedParsed | EmbeddedNotLabel | EmbeddedInvalid;

/** Normalises `posa_embedded_barcode_scheme` — anything else means "off". */
export function readEmbeddedScheme(value: unknown): EmbeddedScheme | null {
	const text = String(value ?? "")
		.trim()
		.toLowerCase();
	if (text === "weight" || text === "price") return text;
	return null;
}

/** EAN-13 mod 10: odd positions ×1, even ×3, complement to the next ten. */
export function ean13CheckDigit(first12: string): string {
	if (first12.length !== 12 || !/^\d{12}$/.test(first12)) return "";
	let total = 0;
	for (let index = 0; index < 12; index += 1) {
		const digit = Number(first12[index]);
		total += index % 2 === 0 ? digit : digit * 3;
	}
	return String((10 - (total % 10)) % 10);
}

/**
 * Does this code even look like a scale label? Length, digits and prefix only —
 * no check digit, no scheme. Used to decide whether a miss deserves the
 * parser's reason or the ordinary "item not found".
 */
export function isEmbeddedCandidate(code: unknown): boolean {
	const raw = String(code ?? "").trim();
	if (raw.length !== LABEL_LENGTH || !/^\d+$/.test(raw)) return false;
	const prefix = Number(raw.slice(0, PREFIX_LENGTH));
	return prefix >= EMBEDDED_PREFIX_MIN && prefix <= EMBEDDED_PREFIX_MAX;
}

/**
 * Parse a scanned code under the register's configured scheme.
 *
 * `scheme` null (no register config) short-circuits to `not_embedded` before
 * anything is inspected: a shop that has not told the register what its labels
 * mean gets the behaviour it had yesterday, not a guess.
 */
export function parseEmbeddedBarcode(
	code: unknown,
	scheme: EmbeddedScheme | null,
): EmbeddedBarcodeResult {
	const raw = String(code ?? "").trim();

	if (!scheme) return { kind: "not_embedded", raw, why: "no_scheme" };
	if (!/^\d+$/.test(raw)) return { kind: "not_embedded", raw, why: "not_numeric" };
	if (raw.length !== LABEL_LENGTH) return { kind: "not_embedded", raw, why: "length" };

	const prefix = raw.slice(0, PREFIX_LENGTH);
	const prefixValue = Number(prefix);
	if (prefixValue < EMBEDDED_PREFIX_MIN || prefixValue > EMBEDDED_PREFIX_MAX) {
		return { kind: "not_embedded", raw, why: "prefix" };
	}

	// Past this point the code has CLAIMED to be a scale label. Everything that
	// follows refuses loudly rather than falling through, because a 13-digit
	// 20–25 code that fails its own check digit is a misread, and the ordinary
	// lookup would either miss (confusing) or hit the wrong item (worse).
	const expected = ean13CheckDigit(raw.slice(0, LABEL_LENGTH - 1));
	if (expected !== raw.slice(LABEL_LENGTH - 1)) {
		return {
			kind: "invalid",
			raw,
			reason: "check_digit",
			detail: `${raw.slice(LABEL_LENGTH - 1)}≠${expected}`,
		};
	}

	const shortCode = raw.slice(PREFIX_LENGTH, PREFIX_LENGTH + SHORT_CODE_LENGTH);
	const valueDigits = raw.slice(
		PREFIX_LENGTH + SHORT_CODE_LENGTH,
		PREFIX_LENGTH + SHORT_CODE_LENGTH + VALUE_LENGTH,
	);

	if (Number(shortCode) === 0) {
		return { kind: "invalid", raw, reason: "empty_short_code", detail: shortCode };
	}
	if (Number(valueDigits) === 0) {
		return { kind: "invalid", raw, reason: "empty_value", detail: valueDigits };
	}

	const template = embeddedTemplateFor(prefix, shortCode);
	if (scheme === "weight") {
		return {
			kind: "parsed",
			scheme,
			prefix,
			shortCode,
			weight: Number(valueDigits) / WEIGHT_DIVISOR,
			importe: null,
			template,
			raw,
		};
	}

	return {
		kind: "parsed",
		scheme,
		prefix,
		shortCode,
		weight: null,
		importe: Number(valueDigits) / PRICE_DIVISOR,
		template,
		raw,
	};
}

/** The zero-valued label for an item: what the Item Barcode row holds. */
export function embeddedTemplateFor(prefix: string, shortCode: string): string {
	const body = `${prefix}${shortCode}${"0".repeat(VALUE_LENGTH)}`;
	return `${body}${ean13CheckDigit(body)}`;
}

/**
 * What to look the item up by, most specific first.
 *
 * A shop may have registered the exact printed label (rare — the value changes
 * per package), the zero-valued template (the usual arrangement), or nothing at
 * all, in which case the five-digit short code is tried as a code in its own
 * right. Order matters: an exact match must never lose to a template.
 */
export function embeddedLookupCodes(parsed: EmbeddedParsed): string[] {
	const codes = [parsed.raw, parsed.template, parsed.shortCode];
	return codes.filter((code, index) => code && codes.indexOf(code) === index);
}

export type LabelQtyRefusal =
	/** The label priced a line for an item the register has no rate for. */
	| "no_rate"
	/** The measurement is smaller than the register's qty precision. */
	| "below_minimum_qty"
	/** The label reports a weight or price of zero. Already refused earlier. */
	| "empty_value";

export interface LabelQtyOk {
	ok: true;
	qty: number;
	/** Set under the price scheme: what the label asked and what will be charged. */
	asked: number | null;
	charged: number | null;
	/** True when the register's precision could not hold what the label said. */
	rounded: boolean;
}

export type LabelQtyResult = LabelQtyOk | { ok: false; reason: LabelQtyRefusal };

export interface LabelQtyInput {
	parsed: EmbeddedParsed;
	/** The line's rate per UOM. Only consulted under the price scheme. */
	rate?: number | null;
	qtyPrecision?: number;
	currencyPrecision?: number;
}

/**
 * What quantity does this label put on the line?
 *
 * The weight scheme is direct — the scale already did the arithmetic — but the
 * figure still passes through `quantizeQty`, because the label weighs in grams
 * and the line may only keep two decimals. The price scheme goes through the
 * same customer-favour rule a typed «$ Importe» does: the label is a request
 * for that many pesos of product, and the register may not exceed it.
 *
 * Deliberately NOT the fork's legacy scale-barcode behaviour, which assigned an
 * embedded price straight to the line's RATE. A $49.92 label on a $160/kg ham
 * would have repriced the kilo to $49.92 and then sold one of them.
 */
export function qtyFromEmbeddedLabel(input: LabelQtyInput): LabelQtyResult {
	const qtyPrecision = Number.isFinite(input.qtyPrecision as number)
		? (input.qtyPrecision as number)
		: DEFAULT_QTY_PRECISION;
	const currencyPrecision = Number.isFinite(input.currencyPrecision as number)
		? (input.currencyPrecision as number)
		: DEFAULT_CURRENCY_PRECISION;

	if (input.parsed.scheme === "weight") {
		const weight = input.parsed.weight;
		if (!weight || weight <= 0) return { ok: false, reason: "empty_value" };

		const quantized = quantizeQty(weight, qtyPrecision);
		if (!quantized.ok) return { ok: false, reason: "below_minimum_qty" };

		return { ok: true, qty: quantized.qty, asked: null, charged: null, rounded: quantized.rounded };
	}

	const importe = input.parsed.importe;
	if (!importe || importe <= 0) return { ok: false, reason: "empty_value" };

	const rate = Number(input.rate);
	if (!Number.isFinite(rate) || rate <= 0) return { ok: false, reason: "no_rate" };

	const derived = qtyFromImporte({ importe, rate, qtyPrecision, currencyPrecision });
	if (!derived.ok) {
		return { ok: false, reason: derived.reason === "below_minimum_qty" ? "below_minimum_qty" : "no_rate" };
	}

	return {
		ok: true,
		qty: derived.qty,
		asked: derived.asked,
		charged: derived.charged,
		rounded: derived.charged !== derived.asked,
	};
}
