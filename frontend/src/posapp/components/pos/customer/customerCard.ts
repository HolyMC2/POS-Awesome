/**
 * The customer card, as data (`docs/CUSTOMER_CARDS_GOLDEN_FLOW.md` §2/§3).
 *
 * Pure: no Vue, no store, no `__()`. The same bargain `orderStory.ts` struck —
 * the server sends keys and figures, this module turns them into the rows a
 * counter reads, and the mapping can be checked without a server, a clock or a
 * mount.
 *
 * THE WIRE IS SETTLED. This file used to accept several spellings of every
 * field while `api/stored_value.py` was being written beside it. It no longer
 * does: the endpoint emits one canonical shape, verified over real HTTP, and a
 * fallback chain kept past that point is worse than none — it hides a rename
 * behind a silent second-choice read, which is the failure mode the chain was
 * built to survive in the first place. One key, one meaning.
 *
 * THREE RULES THAT LOOK LIKE STYLE AND ARE NOT:
 *
 * 1. **`balance` IS NOT A SUM, AND NOTHING HERE MAY MAKE IT ONE.** The wallet
 *    carries two different promises: `balance` is the monedero — pesos already
 *    paid in, redeemable at the till today — and `cashback_value` is what the
 *    customer's loyalty points are worth, which has to be redeemed through the
 *    programme. Somebody holding $200 of monedero and $14 of cashback CANNOT
 *    hand over $214, and §4's guardrail ("bearer and customer value never
 *    merge into one figure") is about exactly this. The server keeps them
 *    apart, this module keeps them apart, and the card prints them on separate
 *    lines. There is deliberately no `total` here for a caller to reach for.
 *
 * 2. **THE SERVER'S SIGN IS THE TRUTH.** `amount` is signed: negative is value
 *    leaving the wallet (redemption, cashback spent), positive is value
 *    arriving (deposit, credit note, cashback earned). This module used to
 *    re-derive the sign from the kind as a safety net; that net became a
 *    hazard the moment the convention was settled, because a legitimately
 *    positive `redemption` — a reversal — would have been flipped into a debit
 *    by a client second-guessing the ledger.
 *
 * 3. **AN UNKNOWN KIND STILL RENDERS.** Same reasoning as `orderStory.ts` rule
 *    1: the ledger is assembled from four ERPNext sources and a shop can add a
 *    fifth. A row this module has never seen keeps its amount, its date and
 *    its reference, and falls back to a generic label — dropping it would hide
 *    exactly the movement somebody cared enough to record.
 */

import { describeDay } from "../flows/orden/orderStory";

/**
 * The ledger's vocabulary, spelled exactly as `stored_value._movement` emits
 * it. Not translated into a second internal set of names: two vocabularies for
 * one concept is a drift waiting to happen, and the server already sends the
 * same string twice (`kind` and `type`) for that very reason.
 */
export type WalletMovementKind =
	| "deposit"
	| "redemption"
	| "cashback"
	| "cashback_spent"
	| "credit_note"
	| "adjustment";

const KNOWN_KINDS: ReadonlySet<string> = new Set<WalletMovementKind>([
	"deposit",
	"redemption",
	"cashback",
	"cashback_spent",
	"credit_note",
	"adjustment",
]);

/**
 * `kind` → what happened, in register language.
 *
 * The server sends its own `label` beside every row and this module ignores
 * it, by agreement rather than by oversight: `registerShellTranslations` can
 * see a `labelKey` here and demand Spanish for it, while a string built inside
 * a Python `frappe._()` is invisible to that scan. `label` is there for
 * readers with no key table of their own — reports, print formats — and the
 * endpoint's own docstring now says so.
 *
 * A LIST rather than a keyed record for the reason `orderStory.ts` states: a
 * record keyed by `deposit:` would hide the whole vocabulary from the only
 * thing that would notice it has none.
 */
const MOVEMENT_LABELS: ReadonlyArray<{ kind: WalletMovementKind; labelKey: string }> = [
	{ kind: "deposit", labelKey: "Deposit" },
	{ kind: "redemption", labelKey: "Paid with the wallet" },
	{ kind: "cashback", labelKey: "Cashback" },
	{ kind: "cashback_spent", labelKey: "Cashback spent" },
	{ kind: "credit_note", labelKey: "Credit note" },
	{ kind: "adjustment", labelKey: "Adjustment" },
];

/** A ledger row, normalized. */
export interface WalletMovement {
	/** Stable `v-for` key — timestamps repeat, the index does not. */
	key: string;
	/** `YYYY-MM-DD`, read off `ts` — see `dayOf`. */
	day: string;
	kind: WalletMovementKind | null;
	/** English source string; the view wraps it in `__()`. */
	labelKey: string;
	/** The tender a deposit came in on. Absent on every other kind. */
	detail: string | null;
	/** The invoice or payment this row belongs to, printed as a folio. */
	reference: string | null;
	/** Signed by the server: negative takes value out of the wallet. Rule 2. */
	amount: number;
}

/**
 * What the contact view knows about the customer's card.
 *
 * Note what is NOT here: a combined figure. See rule 1.
 */
export interface CustomerWallet {
	/** The monedero — pesos paid in, redeemable at the till today. */
	balance: number;
	/** What the customer's points are worth. NOT part of `balance`. */
	cashbackValue: number;
	/** The points behind `cashbackValue`. */
	points: number;
	enrolled: boolean;
	/** Loyalty Program id, and the name a cashier would recognise. */
	program: string | null;
	programName: string | null;
	/** Percent, ready to print. `null` renders no chip — never "0 %". */
	cashbackPercent: number | null;
	movements: WalletMovement[];
	/** How many rows the server was willing to send, so the UI can say so. */
	cap: number | null;
	truncated: boolean;
}

const num = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	// An OBJECT is never a figure. The payload carries `stored_value` and
	// `cashback` as grouped objects beside the flat keys, and `Number({})` is
	// `NaN` rather than a throw — so a misread would surface as a blank card
	// rather than as an error anybody could trace.
	if (typeof value === "object") return null;
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown): string | null => {
	const value_ = typeof value === "string" ? value.trim() : "";
	return value_ ? value_ : null;
};

export const resolveMovementKind = (raw: unknown): WalletMovementKind | null => {
	const value = String(raw ?? "").trim();
	return KNOWN_KINDS.has(value) ? (value as WalletMovementKind) : null;
};

export const movementLabelKey = (kind: WalletMovementKind | null): string =>
	MOVEMENT_LABELS.find((entry) => entry.kind === kind)?.labelKey ?? "Movement";

/**
 * Read the day off a timestamp STRING.
 *
 * `ts` is the instant the movement was recorded and is what a screen prints;
 * `posting_date` is the accounting date it belongs to, which differs only on a
 * back-dated entry and is not the question a counter is asking.
 *
 * Never `new Date(...)`: `new Date("2026-08-19")` is parsed as UTC midnight and
 * renders as the 18th in every timezone west of Greenwich, which is all of
 * Mexico. `orderStory.ts` states the same rule for the same reason.
 */
export const dayOf = (value: unknown): string => {
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
	return match?.[1] ?? "";
};

/** Today, as `YYYY-MM-DD`, in the register's own timezone. */
export const todayKey = (now: Date = new Date()): string => {
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const date = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${date}`;
};

/**
 * «hoy» or «18 ago», for a ledger column and a totals row that must agree.
 *
 * A FACTORY taking the translator rather than reaching for `window.__`, so the
 * mapping stays pure and every caller renders a date the same way. Two copies
 * of a date formatter is exactly the drift that puts «hoy» in one column and
 * `2026-08-23` in the one beside it.
 */
export const makeDayLabel =
	(t: (key: string) => string, now: () => Date = () => new Date()) =>
	(day: string): string => {
		if (!day) return "—";
		if (day === todayKey(now())) return t("Today");
		const parts = describeDay(day);
		if (!parts) return day;
		return `${parts.dayNumber} ${t(parts.monthKey)}`;
	};

/**
 * «mar 2025» — a month and a year, for «cliente desde …».
 *
 * The day is deliberately dropped: nobody asks which Tuesday somebody became a
 * customer, and a full date in a header line reads as a transaction rather
 * than as a relationship. Same string-reading rule as `makeDayLabel`.
 */
export const makeMonthYearLabel =
	(t: (key: string) => string) =>
	(stamp: string): string => {
		const parts = describeDay(dayOf(stamp));
		if (!parts) return "";
		return `${t(parts.monthKey)} ${parts.year}`;
	};

const normalizeMovement = (raw: unknown, index: number): WalletMovement | null => {
	if (!raw || typeof raw !== "object") return null;
	const row = raw as Record<string, unknown>;
	const amount = num(row.amount);
	// A movement with no figure is not a movement anybody can read; the ledger
	// is a column of amounts and a blank one reads as a rendering fault.
	if (amount === null) return null;
	const kind = resolveMovementKind(row.kind);
	return {
		key: `${index}`,
		day: dayOf(row.ts),
		kind,
		labelKey: movementLabelKey(kind),
		// The tender, and only the tender — a DECISION, not a shortcut.
		//
		// The server also sends `detail`, and since `f4ac30a9f` it is a real
		// secondary fact rather than a copy of its own label: the tender on a
		// deposit (the same thing this line reads) and the PROGRAMME NAME on a
		// cashback row. The programme is deliberately dropped here — it is
		// identical on every cashback row this customer will ever have, and
		// the rate chip at the top of the card already names it, so per-row it
		// is a column of the same word.
		detail: text(row.mode_of_payment),
		reference: text(row.reference),
		amount,
	};
};

/**
 * The server's answer → what the card draws. `null` in, `null` out: the caller
 * treats an unreadable wallet exactly as it treats an absent endpoint, because
 * a cashier can do nothing about either and a card full of zeros is worse than
 * no card (`walletSummary.ts`'s "absence, not zeros").
 */
export const normalizeWallet = (raw: unknown): CustomerWallet | null => {
	if (!raw || typeof raw !== "object") return null;
	const source = raw as Record<string, unknown>;
	const balance = num(source.balance);
	if (balance === null) return null;

	const movements = Array.isArray(source.movements)
		? source.movements
				.map((row, index) => normalizeMovement(row, index))
				.filter((row): row is WalletMovement => row !== null)
		: [];

	const percent = num(source.cashback_percent);

	return {
		balance,
		cashbackValue: num(source.cashback_value) ?? 0,
		points: num(source.points) ?? 0,
		enrolled: Boolean(source.enrolled),
		program: text(source.program),
		programName: text(source.program_name) ?? text(source.program),
		// A programme with no collection factor sends `null`, and `null` draws
		// no chip. Never "0 %", which reads as a programme that pays nothing.
		cashbackPercent: percent !== null && percent > 0 ? percent : null,
		movements,
		cap: num(source.cap),
		truncated: Boolean(source.truncated),
	};
};

/** `{points, value}` — the accrual, computed with ERPNext's own rounding. */
export interface CashbackPreview {
	points: number;
	value: number;
}

/**
 * An unenrolled customer gets `{enrolled: false, points: 0, value: 0}` rather
 * than a refusal, so "no accrual" and "no answer" arrive as the same `null`
 * here — which is what the caller wants, because both mean the line is absent.
 * A line saying «acumula $0.00» reads as a broken programme rather than as a
 * purchase too small to earn.
 */
export const normalizeCashbackPreview = (raw: unknown): CashbackPreview | null => {
	if (!raw || typeof raw !== "object") return null;
	const source = raw as Record<string, unknown>;
	const value = num(source.value);
	if (value === null || value <= 0) return null;
	return { points: num(source.points) ?? 0, value };
};

/**
 * Is this an identity a contact view can be about?
 *
 * «Público en General» is not a person: it is the register's DEFAULT customer,
 * the bucket every walk-in sale lands in, and opening a file on it would show
 * one shop's entire counter traffic under one name — a purchase history that
 * belongs to nobody and a wallet nobody could ever be handed.
 *
 * Detected by IDENTITY, not by name. The default is `POS Profile.customer`,
 * which is what `DefaultLayout` and `useItemAddition` already fall back to
 * when no customer is chosen; matching on the words "Público en General" would
 * miss the tenant who renamed theirs and would refuse a real customer who
 * happens to be called that.
 */
export const isContactableCustomer = (
	customer: string | null | undefined,
	profileDefaultCustomer: string | null | undefined,
): boolean => {
	const chosen = String(customer ?? "").trim();
	if (!chosen) return false;
	const fallback = String(profileDefaultCustomer ?? "").trim();
	return !fallback || chosen.toLowerCase() !== fallback.toLowerCase();
};

/** The story column's totals row — «23 compras · $8,340 total · última hoy». */
export interface StoryTotals {
	purchases: number;
	total: number;
	/** `YYYY-MM-DD` of the most recent purchase, or "" when there is none. */
	lastDay: string;
}

/**
 * Totals over the story's WINDOW, not over all time.
 *
 * The story is ninety days and fifty events, and the footer says so; these
 * figures are read off the same rows, so the number on screen and the window
 * beneath it can never disagree. Deriving them from a second endpoint would
 * put a lifetime total above a ninety-day timeline, which is the shape of
 * every "my numbers do not add up" support call.
 *
 * A credit note is NOT counted as a purchase and its amount is not summed. A
 * return is the customer un-buying something, and folding it in either
 * direction — as a sale or as a negative — makes "23 compras" a figure nobody
 * can reproduce by counting rows.
 */
export const storyTotals = (events: ReadonlyArray<Record<string, unknown>>): StoryTotals => {
	let purchases = 0;
	let total = 0;
	let lastDay = "";
	for (const raw of events ?? []) {
		if (String(raw?.kind ?? "") !== "billing") continue;
		if (String(raw?.topic ?? "") !== "invoiced") continue;
		purchases += 1;
		total += num(raw?.amount) ?? 0;
		const day = dayOf(raw?.ts);
		if (day > lastDay) lastDay = day;
	}
	return { purchases, total, lastDay };
};
