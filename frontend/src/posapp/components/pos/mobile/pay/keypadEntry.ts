/**
 * What the phone's keypad composes (artboard `MovilCobro.dc.html`).
 *
 * The pad is `7 8 9 Borrar / 4 5 6 00 / 1 2 3 Dividir pago / 0 .` — fourteen
 * targets, and on a phone register it is the single most-tapped surface in the
 * product. Two of those keys are not digits and both are there for a reason:
 * `00` because most Mexican counters key whole pesos and `1200` is two taps
 * shorter with it, and `Dividir pago` because the split decision is made at
 * the pad, with the amount already in hand.
 *
 * ⚠ WHAT THIS COMPOSES IS AN ENTRY, NOT A PAYMENT. The result is a number of
 * minor units, handed to the screen, handed to the payment path. Nothing here
 * writes a payment row, decides a tender, rounds a total or submits anything —
 * `Payments.vue` still does all of that, untouched.
 *
 * **The buffer is a STRING and the value is an INTEGER.** Keys append text;
 * `entryMinor` converts that text to minor units by splitting on the decimal
 * point and padding, never by `parseFloat(entry) * 100`. `"0.29" * 100` is
 * 28.999999999999996 in this language, and while a `Math.round` hides it for
 * 0.29 it is the same class of defect `closing/denominations.ts` was written
 * to keep out of the drawer. Digits in, digits out, one conversion, exact.
 *
 * Pure: no Vue, no store, no `__()`. Labels come out as translation keys and
 * the component calls `__()` on them.
 */

/** Every key the pad can press. `split` is an action, not an entry edit. */
export type KeypadKey =
	| "0"
	| "1"
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "00"
	| "."
	| "backspace"
	| "split";

export interface KeypadButton {
	key: KeypadKey;
	/** A digit's own glyph, or a translation key for the worded keys. */
	label: string;
	/** False for digits — `__("7")` is not a string anybody translates. */
	translate: boolean;
	kind: "digit" | "edit" | "action";
	/** Grid spans, straight off the artboard. */
	rowSpan?: number;
	colSpan?: number;
}

/**
 * The pad, in DOM order. Auto-placement puts `Dividir pago` in the fourth
 * column across the last two rows and `0` across the first two of the bottom
 * row, which is the artboard's arrangement exactly.
 *
 * Exported so the component renders the layout and the spec counts it, rather
 * than each carrying its own copy of fourteen buttons.
 */
export const KEYPAD_LAYOUT: readonly KeypadButton[] = [
	{ key: "7", label: "7", translate: false, kind: "digit" },
	{ key: "8", label: "8", translate: false, kind: "digit" },
	{ key: "9", label: "9", translate: false, kind: "digit" },
	{ key: "backspace", label: "Backspace", translate: true, kind: "edit" },
	{ key: "4", label: "4", translate: false, kind: "digit" },
	{ key: "5", label: "5", translate: false, kind: "digit" },
	{ key: "6", label: "6", translate: false, kind: "digit" },
	{ key: "00", label: "00", translate: false, kind: "digit" },
	{ key: "1", label: "1", translate: false, kind: "digit" },
	{ key: "2", label: "2", translate: false, kind: "digit" },
	{ key: "3", label: "3", translate: false, kind: "digit" },
	{ key: "split", label: "Split payment", translate: true, kind: "action", rowSpan: 2 },
	{ key: "0", label: "0", translate: false, kind: "digit", colSpan: 2 },
	{ key: ".", label: ".", translate: false, kind: "digit" },
];

/** Nothing keyed. A distinct value from `"0"`, which is a keyed zero. */
export const EMPTY_ENTRY = "";

/**
 * Total digits accepted. Twelve is far past any counter's largest sale and far
 * short of where integer arithmetic stops being exact, so the cap exists only
 * to stop a stuck key from composing a number that cannot be represented.
 */
const MAX_DIGITS = 12;

/** How many decimal digits this currency has. 100 minor units → 2. */
export const decimalPlaces = (minorPerMajor: number): number => {
	const divisor = Number(minorPerMajor);
	if (!Number.isFinite(divisor) || divisor <= 1) return 0;
	return Math.max(0, Math.round(Math.log10(divisor)));
};

const digitCount = (entry: string): number => entry.replace(/\D/g, "").length;

const appendDigit = (entry: string, digit: string, minorPerMajor: number): string => {
	const decimals = decimalPlaces(minorPerMajor);
	const dot = entry.indexOf(".");

	// Past the currency's precision. Silently ignored rather than rounded: a
	// third centavo the cashier can see on screen but the register discards is
	// how a receipt and a drawer come to disagree.
	if (dot >= 0 && entry.length - dot - 1 >= decimals) return entry;
	if (digitCount(entry) >= MAX_DIGITS) return entry;

	// A single leading zero is a placeholder, not a digit. `0` then `5` is five
	// pesos, and `05` on the display would read as a mis-key.
	if (entry === "0") return digit === "0" ? entry : digit;

	return entry + digit;
};

/**
 * One key press.
 *
 * `backspace` deletes ONE character rather than clearing the buffer. Both
 * readings of `Borrar` are defensible and this one is recoverable: a cashier
 * who mis-keys the last digit of `1200` gets it back with one tap, where a
 * clear-all costs them the whole amount and the customer's attention. Clearing
 * is still four taps away and no sale is longer than that.
 *
 * `split` returns the entry untouched — it acts on the amount, it does not
 * edit it. The screen decides whether the split is even possible.
 */
export const applyKeypadKey = (entry: string, key: KeypadKey, minorPerMajor: number): string => {
	const current = String(entry ?? "");

	if (key === "split") return current;

	if (key === "backspace") return current.slice(0, -1);

	if (key === ".") {
		const decimals = decimalPlaces(minorPerMajor);
		// A currency with no minor unit has no decimal point to offer, and a
		// dot the pad accepts but the value ignores is a lie on the display.
		if (decimals === 0) return current;
		if (current.includes(".")) return current;
		return current === EMPTY_ENTRY ? "0." : `${current}.`;
	}

	if (key === "00") {
		// Nothing keyed yet: `00` alone is a zero amount dressed as an entry.
		// The first press of the sale is never meaningfully `00`.
		if (current === EMPTY_ENTRY) return current;
		return appendDigit(appendDigit(current, "0", minorPerMajor), "0", minorPerMajor);
	}

	return appendDigit(current, key, minorPerMajor);
};

/** Has the cashier keyed anything at all? A keyed `0` is not nothing. */
export const entryIsEmpty = (entry: string): boolean => String(entry ?? "") === EMPTY_ENTRY;

/**
 * The entry as minor units — the ONE conversion, and it never multiplies a
 * fraction by a hundred.
 *
 * The whole part and the fraction are read as separate integers and combined,
 * which is exact for every currency whose minor unit is a power of ten. The
 * fallback covers a hand-edited table that is not one; it is unreachable for
 * MXN and USD and exists so the function cannot silently return nonsense.
 */
export const entryMinor = (entry: string, minorPerMajor: number): number => {
	const text = String(entry ?? "");
	if (text === EMPTY_ENTRY) return 0;

	const divisor = Number(minorPerMajor) || 1;
	const decimals = decimalPlaces(divisor);

	if (10 ** decimals !== divisor) {
		const parsed = Number(text);
		return Number.isFinite(parsed) ? Math.round(parsed * divisor) : 0;
	}

	const [wholeText = "", fractionText = ""] = text.split(".");
	const whole = wholeText === "" ? 0 : Number(wholeText.replace(/\D/g, "") || "0");
	if (!Number.isFinite(whole)) return 0;
	if (decimals === 0) return whole * divisor;

	const fraction = Number(`${fractionText.replace(/\D/g, "")}${"0".repeat(decimals)}`.slice(0, decimals) || "0");
	return whole * divisor + fraction;
};

export default applyKeypadKey;
