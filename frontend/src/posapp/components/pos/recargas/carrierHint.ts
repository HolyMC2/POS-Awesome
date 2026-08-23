/**
 * Which company does this number belong to? (build plan §12 item F,
 * `Recargas.dc.html` — *"Telcel detectado por prefijo"*.)
 *
 * ## Why this file is so careful about saying "I don't know"
 *
 * A recharge is irreversible at the carrier. TAECEL's own spec is explicit —
 * *toda solicitud que llega a `requestTXN` genera cargo* — and a wrong company
 * does not bounce: it credits a stranger's phone on a network the customer
 * does not use, and the owner pays for it out of the saldo bolsa. So the cost
 * of a wrong guess here is real money, every time, while the cost of asking is
 * one tap. That asymmetry is the whole design.
 *
 * ## The premise the artboard states is not true in Mexico
 *
 * The canvas annotates the number field *"detectado por prefijo"*, which is how
 * it works in countries where the operator owns a number block for good.
 * Mexico has had full mobile portability since 2019 and every mobile number is
 * a flat ten digits: the IFT's numbering plan records the ORIGINAL
 * concessionaire of a range, not who serves the line today. A prefix table
 * built from it is right about a number that was never ported and confidently
 * wrong about one that was — and nothing in the digits tells the two apart.
 *
 * That is why `MX_CARRIER_RANGES` below is EMPTY rather than seeded from a
 * plausible-looking list. Shipping invented ranges would have produced a
 * feature that looks like it works and mis-sends money at some rate nobody
 * measured. Absence over fabrication, the same call the cart line's category
 * and Cobro's warranty already made.
 *
 * ## What we can honestly know
 *
 * Our own ledger. `saldo.api.status.list_transactions` returns every recharge
 * this shop has made, each with its `referencia` and its `saldo_carrier`, so
 * "this number has been topped up on Telcel here before" is a FACT we recorded,
 * not an inference from a numbering plan. It is the same evidence the operator
 * uses when they recognise a regular. History is therefore the primary source,
 * the range table is a secondary one for the day an authoritative feed exists,
 * and any disagreement between them resolves to `ask` rather than to a winner.
 *
 * Pure and Vue-free on purpose: a gate that can only be exercised by mounting a
 * screen is a gate nobody tests properly (`useDestinationRouting.ts` says the
 * same about its own).
 */

/**
 * One entry of a prefix → company table. `prefix` is matched against the
 * NORMALISED national number, longest match wins, so a ten-digit block can
 * override the three-digit area code that contains it.
 */
export interface CarrierRange {
	readonly prefix: string;
	/** `Saldo Carrier.name`, so a match can select a real chip. */
	readonly carrier: string;
}

/**
 * The Mexican range table — deliberately empty.
 *
 * Not a stub waiting to be filled with guesses: it is filled from an
 * authoritative feed or it stays empty. Two would qualify — the IFT's published
 * numbering plan (which dates a number's ORIGINAL operator and so needs a
 * portability check beside it), or a portability lookup exposed by TAECEL,
 * which today's API does not offer (`saldo/saldo/api/services.py` has no such
 * verb). Until one of those lands, history is the only honest source and the
 * resolver falls through to `ask`.
 */
export const MX_CARRIER_RANGES: readonly CarrierRange[] = [];

/** Mexican mobile numbers are ten digits, flat, since the 2019 renumbering. */
export const MX_MOBILE_DIGITS = 10;

export type HintReason =
	/** Nothing typed yet. */
	| "empty"
	/** Fewer (or more) digits than a dialable number. */
	| "incomplete"
	/** A complete number that no source recognises. */
	| "no-source"
	/** Two sources recognised it and named different companies. */
	| "conflict";

export type CarrierHint =
	| { kind: "ask"; reason: HintReason }
	| { kind: "suggested"; carrier: string; source: "history" | "range" };

/** One prior recharge, as `list_transactions` returns it. */
export interface RechargeHistoryEntry {
	referencia?: string | null;
	saldo_carrier?: string | null;
}

export interface CarrierHintOptions {
	ranges?: readonly CarrierRange[];
	history?: readonly RechargeHistoryEntry[];
	/** Override for a market whose numbers are not ten digits. */
	nationalDigits?: number;
}

/**
 * Digits only, with the international dressing removed.
 *
 * `+52 1 55…` (the pre-2019 mobile form) and `+52 55…` both still arrive from
 * contact lists, printed receipts and the customer reading their own number
 * aloud, and all three spellings are the same line. Anything else is returned
 * as its bare digits and left for the length check to reject — inventing a rule
 * for an unexpected length is how a service reference gets treated as a phone.
 *
 * Scoped to phone numbers on purpose: a CFE account or an internet contract is
 * also a `referencia`, and stripping a leading 52 from one would corrupt it.
 */
export function normaliseMsisdn(raw: unknown): string {
	const digits = String(raw ?? "").replace(/\D+/g, "");
	if (digits.length === 13 && digits.startsWith("521")) {
		return digits.slice(3);
	}
	if (digits.length === 12 && digits.startsWith("52")) {
		return digits.slice(2);
	}
	if (digits.length === 11 && digits.startsWith("1")) {
		// The retired national mobile prefix, still typed by habit.
		return digits.slice(1);
	}
	return digits;
}

/** Longest matching prefix, or null. Longest — not first — so a specific block
 * beats the area code that contains it whatever order the table is written in. */
function rangeCarrier(number: string, ranges: readonly CarrierRange[]): string | null {
	let best: CarrierRange | null = null;
	for (const entry of ranges) {
		const prefix = String(entry?.prefix ?? "");
		const carrier = String(entry?.carrier ?? "");
		if (!prefix || !carrier || !number.startsWith(prefix)) {
			continue;
		}
		if (!best || prefix.length > best.prefix.length) {
			best = entry;
		}
	}
	return best ? best.carrier : null;
}

/** Every distinct company this exact number has been recharged on before. */
function historyCarriers(
	number: string,
	history: readonly RechargeHistoryEntry[],
): string[] {
	const seen = new Set<string>();
	for (const row of history) {
		const carrier = String(row?.saldo_carrier ?? "").trim();
		if (!carrier) {
			continue;
		}
		if (normaliseMsisdn(row?.referencia) === number) {
			seen.add(carrier);
		}
	}
	return [...seen];
}

/**
 * Resolve the hint for a typed number.
 *
 * NEVER returns a company the caller should act on without confirmation, and
 * never falls back to a default one: every path that is not a positive match
 * from a real source returns `ask`, with the reason, because the surface says
 * different things for "keep typing" and for "I don't recognise this number".
 */
export function resolveCarrierHint(
	raw: unknown,
	options: CarrierHintOptions = {},
): CarrierHint {
	const ranges = options.ranges ?? MX_CARRIER_RANGES;
	const history = options.history ?? [];
	const expected = options.nationalDigits ?? MX_MOBILE_DIGITS;

	const number = normaliseMsisdn(raw);
	if (!number) {
		return { kind: "ask", reason: "empty" };
	}
	if (number.length !== expected) {
		return { kind: "ask", reason: "incomplete" };
	}

	const fromHistory = historyCarriers(number, history);
	if (fromHistory.length > 1) {
		// The line was ported, or somebody keyed the wrong company once. Either
		// way our own record disagrees with itself and is no longer evidence.
		return { kind: "ask", reason: "conflict" };
	}

	const fromRange = rangeCarrier(number, ranges);
	const [only] = fromHistory;
	if (only && fromRange && only !== fromRange) {
		return { kind: "ask", reason: "conflict" };
	}
	if (only) {
		return { kind: "suggested", carrier: only, source: "history" };
	}
	if (fromRange) {
		return { kind: "suggested", carrier: fromRange, source: "range" };
	}
	return { kind: "ask", reason: "no-source" };
}

/**
 * Is the surface allowed to act on this hint without the operator confirming?
 *
 * No. Always no — the function exists so the answer is written down in one
 * place and a caller cannot arrive at a different one by reading the shape of
 * `CarrierHint` and assuming `suggested` means selected. A hint pre-highlights
 * a chip; the operator's tap is what chooses the company.
 */
export const hintIsAuthoritative = (): boolean => false;
