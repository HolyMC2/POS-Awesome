/**
 * Venta fraccionada — the arithmetic, and nothing else.
 *
 * Three gestures sell a fraction of a stocked unit: type the weight, type the
 * pesos, or scan a labelling scale's barcode. All three end at the same place —
 * a plain `qty` on a cart line — and all three go through the functions here so
 * that one rule about money is stated once.
 *
 * ## The rule: the rounding is always the customer's
 *
 * «Dame $50 de jamón» at $160/kg is 0.3125 kg, and a cart line carries three
 * decimals. 0.313 kg charges $50.08; 0.312 kg charges $49.92. The register
 * hands over 0.312 kg — **charged ≤ asked, for every rate, always** — and says
 * so on screen («$50.00 → 0.312 kg · se cobran $49.92»). The eight centavos are
 * the shop's; the alternative is a register that quietly charges eight centavos
 * more than the customer asked for, on every weighed line, forever.
 *
 * That invariant is the whole point of this module and is property-tested. It
 * is also why the importe is floored to the currency's precision before
 * anything else happens: you cannot ask for $49.9987, and pretending you can is
 * how a half-centavo of overcharge sneaks back in through the rounding.
 *
 * ## Eligibility is ERPNext's answer, not ours
 *
 * A line may carry a fraction when its UOM says so — `UOM.must_be_whole_number`
 * = 0 (kg, g, L, m). There is no POS-side flag and there must not be one: the
 * server refuses a decimal qty on a whole-number UOM at save
 * (`validate_uom_is_integer`, called from `Sales Invoice.validate`), so a POS
 * flag that disagreed would only produce a cart the shop cannot invoice.
 *
 * An ABSENT fact reads as ineligible — see `isFractionEligible`.
 */

/** Cart lines carry three decimals of qty; a labelling scale weighs in grams. */
export const DEFAULT_QTY_PRECISION = 3;

/** Pesos. Overridable because the register's currency precision is a setting. */
export const DEFAULT_CURRENCY_PRECISION = 2;

/**
 * Move a decimal point without going through binary floating point.
 *
 * `0.1 * 1000` is 100.00000000000001 and `Math.floor` of it is 100 by luck;
 * `1.005 * 100` is 100.49999999999999 and `Math.round` of it is 100, which
 * rounds a peso down that every human would round up. Both are avoided by
 * shifting through the decimal STRING, which is the shortest representation
 * that round-trips — exactly the digits a person typed.
 */
function shiftDecimal(value: number, places: number): number {
	if (!Number.isFinite(value)) return NaN;
	const [mantissa, exponent] = String(value).split("e");
	const exp = exponent === undefined ? 0 : Number(exponent);
	return Number(`${mantissa}e${exp + places}`);
}

/** Half-up at `decimals`, the way money is rounded and the server rounds it. */
export function roundTo(value: number, decimals: number): number {
	if (!Number.isFinite(value)) return NaN;
	return shiftDecimal(Math.round(shiftDecimal(value, decimals)), -decimals);
}

/** Toward zero-side truncation at `decimals`. The customer-favour direction. */
export function floorTo(value: number, decimals: number): number {
	if (!Number.isFinite(value)) return NaN;
	return shiftDecimal(Math.floor(shiftDecimal(value, decimals)), -decimals);
}

/**
 * The UOM facts a line needs to answer "may this carry a fraction?".
 *
 * `mustBeWholeNumber` is ERPNext's `UOM.must_be_whole_number` for the LINE's
 * current UOM — not the item's stock UOM. A kg item sold by `Caja` is a
 * whole-number line while that UOM is selected.
 */
export interface UomFractionFacts {
	uom?: string | null;
	mustBeWholeNumber?: unknown;
	/** Optional per-register float precision; capped to 0–6. */
	precision?: unknown;
	/**
	 * The everyday smaller unit a cashier thinks in — grams under a kilo,
	 * millilitres under a litre. Server-supplied and NEVER inferred here; see
	 * `readSubUnit`.
	 */
	subUnit?: unknown;
}

/**
 * A smaller unit the same quantity can be typed in.
 *
 * `perUnit` is how many of it make ONE pricing unit — 1000 g to the kilo. The
 * factor comes from ERPNext's `UOM Conversion Factor` table and rides the item
 * payload; nothing in the SPA computes it. That matters more than it looks:
 * "everyone knows a kilo is 1000 grams" is true, and it is exactly the
 * reasoning that would later hand a pound shop a factor of 1000.
 */
export interface SubUnit {
	uom: string;
	perUnit: number;
}

/**
 * Validate a server-supplied sub-unit, or answer null.
 *
 * A factor of 1 or less is not a sub-unit — it is the same unit or a LARGER
 * one, and offering it as a sub-unit would multiply where it should divide.
 * Absent, malformed or unnamed all answer null, and a null sub-unit simply
 * means the line offers no entry chips: today's behaviour.
 */
const toFiniteOrNull = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = typeof value === "number" ? value : parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : null;
};

export function readSubUnit(raw: unknown): SubUnit | null {
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as { uom?: unknown; perUnit?: unknown; per_unit?: unknown };
	const uom = String(candidate.uom ?? "").trim();
	if (!uom) return null;
	const perUnit = toFiniteOrNull(candidate.perUnit ?? candidate.per_unit);
	if (perUnit === null || !(perUnit > 1)) return null;
	return { uom, perUnit };
}

/**
 * Frappe `Check` fields reach the SPA as 1/0, "1"/"0" or true/false depending
 * on which endpoint served the row, and a bare truthiness test reads the string
 * "0" as checked. Returns null for ABSENT, which is a different answer from 0.
 */
function readCheck(value: unknown): boolean | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	const text = String(value).trim().toLowerCase();
	if (text === "" || text === "undefined" || text === "null") return null;
	return text !== "0" && text !== "false";
}

/**
 * May this line carry a decimal qty?
 *
 * **Absent reads as NO.** A payload that never carried the fact — an offline
 * row cached before the field shipped, a draft resumed from an older build — is
 * not evidence that the UOM takes decimals. Guessing "yes" puts a grams pad on
 * a phone case and lets a cashier build a cart the server then refuses at save;
 * guessing "no" hides an affordance on a kg item while the plain qty field
 * keeps working exactly as it does today. Only one of those costs a sale.
 */
export function isFractionEligible(facts: UomFractionFacts | null | undefined): boolean {
	if (!facts) return false;
	const wholeNumber = readCheck(facts.mustBeWholeNumber);
	if (wholeNumber === null) return false;
	return wholeNumber === false;
}

/**
 * How many decimals this line's qty may carry. A whole-number UOM answers 0,
 * which is what makes «0.5 piezas» unrepresentable rather than merely refused.
 */
export function qtyPrecisionForUom(
	facts: UomFractionFacts | null | undefined,
	fallback: number = DEFAULT_QTY_PRECISION,
): number {
	if (!isFractionEligible(facts)) return 0;
	const declared = toFiniteOrNull(facts?.precision);
	const raw = declared === null ? fallback : declared;
	if (!Number.isFinite(raw)) return DEFAULT_QTY_PRECISION;
	return Math.min(Math.max(Math.trunc(raw), 0), 6);
}

export type ImporteRefusal =
	/** Nothing was asked for. */
	| "importe_not_positive"
	/** The line has no price to divide by; deriving a qty would invent one. */
	| "rate_not_positive"
	/** The rate is so high that a whole step of qty already costs more. */
	| "below_minimum_qty"
	/** Should be unreachable; returned rather than shipping an overcharge. */
	| "rounding_unstable";

export interface ImporteToQtyOk {
	ok: true;
	/** What the line records. Plain qty — the importe is a gesture, not a fact. */
	qty: number;
	/** `round(qty × rate)` at currency precision. Never greater than `asked`. */
	charged: number;
	/** The pesos actually requested, floored to currency precision. */
	asked: number;
	/** `asked − charged` — the sentence's «se cobran» delta. Never negative. */
	difference: number;
	rate: number;
}

export interface ImporteToQtyRefused {
	ok: false;
	reason: ImporteRefusal;
}

export type ImporteToQtyResult = ImporteToQtyOk | ImporteToQtyRefused;

export interface ImporteToQtyInput {
	/** Pesos the customer asked for. */
	importe: number;
	/** The line's rate per UOM. */
	rate: number;
	qtyPrecision?: number;
	currencyPrecision?: number;
}

/**
 * «Dame $50» → the qty that charges at most $50.
 *
 * The answer is the largest qty at this precision whose UNROUNDED cost fits
 * inside the ask. Two different things are being protected and only one of them
 * is the money: `charged ≤ asked` keeps the customer from paying more than they
 * said, and `qty × rate ≤ asked` keeps the shop from handing over more product
 * than that money buys. A rule that maximised qty against the ROUNDED charge
 * would satisfy the first and quietly break the second — at $1/kg it would give
 * away 4 g on every «dame $10», because 10.004 kg still rounds to $10.00.
 *
 * Floor the division, then attempt exactly ONE step up, kept only if it passes
 * both tests. That step exists because binary division sometimes lands a hair
 * under an exact result — 0.29999999999999993 where 0.3 was meant — and
 * flooring that sells 0.299 kg to someone who asked for a round number.
 *
 * The correction loop below is a belt on top of braces: with `asked` floored to
 * currency precision the floored qty already satisfies `charged ≤ asked` by
 * construction. It is here because "by construction" is an argument, and an
 * argument is not what should stand between a shop and a systematic overcharge.
 */
export function qtyFromImporte(input: ImporteToQtyInput): ImporteToQtyResult {
	const currencyPrecision = Number.isFinite(input.currencyPrecision as number)
		? Math.min(Math.max(Math.trunc(input.currencyPrecision as number), 0), 6)
		: DEFAULT_CURRENCY_PRECISION;
	const qtyPrecision = Number.isFinite(input.qtyPrecision as number)
		? Math.min(Math.max(Math.trunc(input.qtyPrecision as number), 0), 6)
		: DEFAULT_QTY_PRECISION;

	const rate = toFiniteOrNull(input.rate);
	const importe = toFiniteOrNull(input.importe);

	if (rate === null || rate <= 0) return { ok: false, reason: "rate_not_positive" };
	if (importe === null || importe <= 0) return { ok: false, reason: "importe_not_positive" };

	// You cannot ask for $49.9987. Floor rather than round: rounding the ASK
	// upward would let the charge exceed what was typed and still pass the
	// invariant below, which is the overcharge wearing a different hat.
	const asked = floorTo(importe, currencyPrecision);
	if (!(asked > 0)) return { ok: false, reason: "importe_not_positive" };

	const step = shiftDecimal(1, -qtyPrecision);
	let qty = floorTo(asked / rate, qtyPrecision);

	const reachedUp = roundTo(qty + step, qtyPrecision);
	if (
		reachedUp * rate <= asked &&
		roundTo(reachedUp * rate, currencyPrecision) <= asked
	) {
		qty = reachedUp;
	}

	let guard = 0;
	while (qty > 0 && roundTo(qty * rate, currencyPrecision) > asked && guard < 8) {
		qty = roundTo(qty - step, qtyPrecision);
		guard += 1;
	}

	if (!(qty > 0)) return { ok: false, reason: "below_minimum_qty" };

	const charged = roundTo(qty * rate, currencyPrecision);
	if (charged > asked) return { ok: false, reason: "rounding_unstable" };

	return {
		ok: true,
		qty,
		charged,
		asked,
		difference: roundTo(asked - charged, currencyPrecision),
		rate,
	};
}

export type QuantizeRefusal = "qty_not_positive" | "below_minimum_qty";

export type QuantizeResult =
	| { ok: true; qty: number; requested: number; rounded: boolean }
	| { ok: false; reason: QuantizeRefusal };

/**
 * Bring a MEASURED quantity down to the precision the line will actually keep.
 *
 * A labelling scale weighs in grams and a `Sales Invoice Item.qty` is a plain
 * Float stored at the site's `float_precision` — which on the doco mirror is 2.
 * Forward 0.312 kg to a register configured that way and the invoice comes back
 * holding 0.31 kg while the ticket the customer is reading says 0.312 and
 * $49.92, for a line that charged $49.60. Two different weights and two
 * different totals for one sale, and the paper disagrees with the books.
 *
 * So the register quantizes first and then quotes what it quantized. FLOOR, not
 * round, for the same reason everything else here floors: the shop absorbs the
 * remainder rather than charging for grams the customer is not taking.
 * `rounded` says whether anything was lost, so the caller can name it.
 */
export function quantizeQty(qty: number, qtyPrecision: number): QuantizeResult {
	const precision = Number.isFinite(qtyPrecision)
		? Math.min(Math.max(Math.trunc(qtyPrecision), 0), 6)
		: DEFAULT_QTY_PRECISION;
	const requested = toFiniteOrNull(qty);

	if (requested === null || requested <= 0) return { ok: false, reason: "qty_not_positive" };

	const quantized = floorTo(requested, precision);
	if (!(quantized > 0)) return { ok: false, reason: "below_minimum_qty" };

	return { ok: true, qty: quantized, requested, rounded: quantized !== requested };
}

/**
 * Decimals kept while subtracting a tare in sub-units.
 *
 * Deliberately generous and NOT the line's precision: a cashier types whole
 * grams, and the subtraction is an intermediate step. The floor that actually
 * governs happens once, after the conversion, at the precision the line keeps —
 * rounding twice is how 495 − 20 stops being 475.
 */
export const SUB_UNIT_ENTRY_PRECISION = 6;

export interface SubUnitQtyInput {
	/** What was typed, in the SUB-unit (475, meaning 475 g). */
	value: number;
	subUnit: SubUnit;
	/** Decimals the LINE keeps, in the pricing unit. */
	qtyPrecision?: number;
}

export interface SubUnitQtyOk {
	ok: true;
	/** What the line records — always in the PRICING unit. */
	qty: number;
	/** Echoed back for the readout: «475 g = 0.475 kg». */
	entered: number;
	subUnit: SubUnit;
	/** The register's precision could not hold the exact conversion. */
	rounded: boolean;
}

export type SubUnitQtyResult = SubUnitQtyOk | { ok: false; reason: QuantizeRefusal };

/**
 * «475 g» → 0.475 kg, in the unit the line is priced in.
 *
 * Grams are an INPUT GESTURE, exactly like an importe: nothing downstream ever
 * sees them. Convert first, then floor once at the line's precision — the order
 * matters, because flooring in grams and then converting would quantize against
 * the wrong grid and hand back a number the line cannot hold anyway.
 *
 * The floor keeps the same direction everything else here does: on a register
 * that keeps two decimals, 475 g becomes 0.47 kg rather than 0.48. The readout
 * says both numbers so the operator can see the five grams the shop absorbed
 * rather than discovering them on the ticket.
 */
export function qtyFromSubUnit(input: SubUnitQtyInput): SubUnitQtyResult {
	const subUnit = readSubUnit(input.subUnit);
	if (!subUnit) return { ok: false, reason: "qty_not_positive" };

	const value = toFiniteOrNull(input.value);
	if (value === null || value <= 0) return { ok: false, reason: "qty_not_positive" };

	const converted = value / subUnit.perUnit;
	const quantized = quantizeQty(converted, input.qtyPrecision ?? DEFAULT_QTY_PRECISION);
	if (!quantized.ok) return { ok: false, reason: quantized.reason };

	return {
		ok: true,
		qty: quantized.qty,
		entered: value,
		subUnit,
		rounded: quantized.rounded,
	};
}

/** The pricing-unit quantity shown back in sub-units, for the readout. */
export function toSubUnit(qty: number, subUnit: SubUnit): number {
	return roundTo(qty * subUnit.perUnit, SUB_UNIT_ENTRY_PRECISION);
}

export type TaraRefusal =
	| "bruto_not_positive"
	| "tara_negative"
	| "tara_exceeds_bruto"
	| "net_empty";

export interface TaraOk {
	ok: true;
	/** What the line records: bruto − tara, at the UOM's precision. */
	neto: number;
	bruto: number;
	tara: number;
}

export type TaraResult = TaraOk | { ok: false; reason: TaraRefusal };

export interface TaraInput {
	/** What the scale reads with the tray on it. */
	bruto: number;
	/** The tray. Absent or 0 means the scale was already tared. */
	tara?: number;
	qtyPrecision?: number;
}

/**
 * Peso bruto − tara. Refuses rather than clamping.
 *
 * A tara heavier than the gross weight is a typo or the wrong tray, and the two
 * repairs a register could make silently — clamp to zero, or take the absolute
 * value — both end with a line whose weight is not what is on the scale. Saying
 * so costs one dialog; guessing costs the difference on every sale until
 * somebody notices.
 */
export function netFromTara(input: TaraInput): TaraResult {
	const qtyPrecision = Number.isFinite(input.qtyPrecision as number)
		? Math.min(Math.max(Math.trunc(input.qtyPrecision as number), 0), 6)
		: DEFAULT_QTY_PRECISION;

	const bruto = toFiniteOrNull(input.bruto);
	const taraRaw = input.tara === undefined || input.tara === null ? 0 : toFiniteOrNull(input.tara);

	if (bruto === null || bruto <= 0) return { ok: false, reason: "bruto_not_positive" };
	if (taraRaw === null || taraRaw < 0) return { ok: false, reason: "tara_negative" };

	const neto = roundTo(bruto - taraRaw, qtyPrecision);
	if (neto < 0) return { ok: false, reason: "tara_exceeds_bruto" };
	if (neto === 0) return { ok: false, reason: "net_empty" };

	return { ok: true, neto, bruto, tara: taraRaw };
}
