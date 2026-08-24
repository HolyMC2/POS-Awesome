/**
 * The customer card, as data (`docs/CUSTOMER_CARDS_GOLDEN_FLOW.md` §2/§3).
 *
 * Pure: no Vue, no store, no `__()`. The same bargain `orderStory.ts` struck —
 * the server sends keys and figures, this module turns them into the rows a
 * counter reads, and the mapping can be checked without a server, a clock or a
 * mount.
 *
 * THREE RULES THAT LOOK LIKE STYLE AND ARE NOT:
 *
 * 1. **TWO WALLETS, NOT ONE** — `walletSummary.ts`'s standing rule, restated
 *    here because this surface is where both promises finally appear together.
 *    Monedero (pesos already paid in) and cashback (pesos earned) are shown as
 *    a balance and its PROVENANCE, never merged into a figure whose parts
 *    nobody can name. `deposited` and `cashbackValue` exist precisely so the
 *    subline can say which half is which.
 *
 * 2. **THE SIGN IS DERIVED FROM THE KIND, AND THE SERVER'S SIGN WINS.** A
 *    ledger row is either money in or money out, and that is a property of
 *    what happened, not of how the endpoint chose to spell it. A server that
 *    sends `-120` for a redemption and one that sends `120` produce the same
 *    row here. Guessing the other way round — deriving the kind from the sign
 *    — is what turns a credit note into a deposit.
 *
 * 3. **AN UNKNOWN KIND STILL RENDERS.** Same reasoning as `orderStory.ts` rule
 *    1: the ledger is assembled from three ERPNext sources and a shop can add
 *    a fourth. A row this module has never seen falls back to the server's own
 *    `detail`, because dropping it would hide exactly the movement somebody
 *    cared enough to record.
 */

import { describeDay } from "../flows/orden/orderStory";

/**
 * Kinds the ledger knows how to name. Spelled as the union the server's own
 * vocabulary uses plus the aliases seen in the wild — `redeem`/`redemption`,
 * `cashback`/`cashback_earned` — resolved in one place so no caller has to
 * know there were ever two spellings.
 */
export type WalletMovementKind =
	| "deposit"
	| "redemption"
	| "cashback_earned"
	| "cashback_spent"
	| "credit_note"
	| "adjustment";

/** Movements that take money OUT of the wallet. See rule 2. */
const DEBIT_KINDS = new Set<WalletMovementKind>(["redemption", "cashback_spent"]);

/** Wire spelling → the kind this module reasons about. */
const KIND_ALIASES: ReadonlyArray<{ match: RegExp; kind: WalletMovementKind }> = [
	{ match: /^(deposit|top_?up|advance)$/i, kind: "deposit" },
	{ match: /^(redemption|redeem|redeemed|wallet_payment|credit_used)$/i, kind: "redemption" },
	{ match: /^(cashback|cashback_earned|points_earned|loyalty_earned)$/i, kind: "cashback_earned" },
	{
		match: /^(cashback_spent|points_redeemed|loyalty_redeemed|points_used)$/i,
		kind: "cashback_spent",
	},
	{ match: /^(credit_note|return|returned)$/i, kind: "credit_note" },
	{ match: /^(adjustment|correction)$/i, kind: "adjustment" },
];

/**
 * `kind` → what happened, in register language. A LIST rather than a keyed
 * record for the reason `orderStory.ts` states: `registerShellTranslations`
 * sees a `labelKey` property and demands Spanish for every one, and a record
 * keyed by `deposit:` would hide the whole vocabulary from the only thing that
 * would notice it has none.
 */
const MOVEMENT_LABELS: ReadonlyArray<{ kind: WalletMovementKind; labelKey: string }> = [
	{ kind: "deposit", labelKey: "Deposit" },
	{ kind: "redemption", labelKey: "Paid with the wallet" },
	{ kind: "cashback_earned", labelKey: "Cashback" },
	{ kind: "cashback_spent", labelKey: "Cashback spent" },
	{ kind: "credit_note", labelKey: "Credit note" },
	{ kind: "adjustment", labelKey: "Adjustment" },
];

/** A ledger row, normalized. */
export interface WalletMovement {
	/** Stable `v-for` key — timestamps repeat, the index does not. */
	key: string;
	/** `YYYY-MM-DD`; the time, when the source knew one, is not shown here. */
	day: string;
	kind: WalletMovementKind | null;
	/** English source string; the view wraps it in `__()`. */
	labelKey: string;
	/** The document's own words — a mode of payment, a programme name. */
	detail: string | null;
	/** The invoice or payment this row belongs to, printed as a folio. */
	reference: string | null;
	/** Signed: negative takes money out of the wallet. See rule 2. */
	amount: number;
}

/** What the contact view knows about the customer's card. */
export interface CustomerWallet {
	/** Pesos on the wallet today — monedero plus cashback, as ONE spendable. */
	balance: number;
	/** Of that balance, what was paid in. `null` when the server did not say. */
	deposited: number | null;
	/** Of that balance, what was earned. `null` when the server did not say. */
	cashbackValue: number | null;
	/** Loyalty points behind `cashbackValue`, when the server reports them. */
	points: number | null;
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

const toFiniteNumber = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : null;
};

const toText = (value: unknown): string | null => {
	const text = typeof value === "string" ? value.trim() : "";
	return text ? text : null;
};

/**
 * First present key wins. The wallet payload is being written in a sibling
 * task against the same spec, and a reader that accepts the two obvious
 * spellings of a field costs four lines and removes a whole class of "the card
 * renders but every figure is zero" failure — the one shape a mock can never
 * catch, because a mock is written from the same guess as the reader.
 */
const pick = (source: Record<string, unknown>, ...keys: string[]): unknown => {
	for (const name of keys) {
		const value = source[name];
		if (value !== undefined && value !== null && value !== "") return value;
	}
	return undefined;
};

export const resolveMovementKind = (raw: unknown): WalletMovementKind | null => {
	const text = String(raw ?? "").trim();
	if (!text) return null;
	return KIND_ALIASES.find((entry) => entry.match.test(text))?.kind ?? null;
};

export const movementLabelKey = (kind: WalletMovementKind | null): string =>
	MOVEMENT_LABELS.find((entry) => entry.kind === kind)?.labelKey ?? "Movement";

/**
 * Read the day off a timestamp STRING.
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
 * mapping stays pure and both callers — the movements ledger and the story's
 * «última» — render a date the same way. Two copies of a date formatter is
 * exactly the drift that puts «hoy» in one column and `2026-08-23` in the one
 * beside it.
 *
 * Read off the STRING, never through `new Date(day)`: `orderStory.ts` states
 * the trap in full — a bare `YYYY-MM-DD` parses as UTC midnight and renders as
 * the previous day everywhere west of Greenwich, which is all of Mexico.
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

/** See rule 2: the server's sign wins, and a bare figure is signed by kind. */
export const signedAmount = (kind: WalletMovementKind | null, amount: number): number => {
	if (amount < 0) return amount;
	return kind && DEBIT_KINDS.has(kind) ? -amount : amount;
};

const normalizeMovement = (raw: unknown, index: number): WalletMovement | null => {
	if (!raw || typeof raw !== "object") return null;
	const row = raw as Record<string, unknown>;
	const amount = toFiniteNumber(pick(row, "amount", "value", "credit", "total"));
	// A movement with no figure is not a movement anybody can read; the ledger
	// is a column of amounts and a blank one reads as a rendering fault.
	if (amount === null) return null;
	const kind = resolveMovementKind(pick(row, "kind", "type", "movement_type"));
	return {
		key: `${index}`,
		day: dayOf(pick(row, "ts", "date", "posting_date", "creation")),
		kind,
		labelKey: movementLabelKey(kind),
		detail: toText(pick(row, "detail", "description", "mode_of_payment", "remark")),
		reference: toText(pick(row, "reference", "reference_name", "invoice", "name")),
		amount: signedAmount(kind, amount),
	};
};

/**
 * Cashback rate, as a percent ready to print.
 *
 * A programme's collection rule reaches the wire as either `3` (percent) or
 * `0.03` (a fraction), and the two are indistinguishable from the number alone
 * ONCE — at exactly 1. The explicit percent key is read first for that reason;
 * the fraction reading is the fallback, and a 1 % programme that only sends
 * `cashback_rate: 1` prints 1 %, which is the reading that is right far more
 * often than "100 %" would be.
 */
export const cashbackPercentOf = (source: Record<string, unknown>): number | null => {
	const explicit = toFiniteNumber(pick(source, "cashback_percent", "percent"));
	if (explicit !== null) return explicit > 0 ? explicit : null;
	const rate = toFiniteNumber(pick(source, "cashback_rate", "rate"));
	if (rate === null || rate <= 0) return null;
	return rate < 1 ? rate * 100 : rate;
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
	const balance = toFiniteNumber(pick(source, "balance", "available_amount", "total"));
	if (balance === null) return null;

	const rawMovements = pick(source, "movements", "ledger", "rows");
	const movements = Array.isArray(rawMovements)
		? rawMovements
				.map((row, index) => normalizeMovement(row, index))
				.filter((row): row is WalletMovement => row !== null)
		: [];

	const enrolledFlag = pick(source, "enrolled", "is_enrolled");
	const program = toText(pick(source, "program", "loyalty_program"));

	return {
		balance,
		deposited: toFiniteNumber(pick(source, "deposited", "deposits", "stored_value")),
		cashbackValue: toFiniteNumber(pick(source, "cashback_value", "loyalty_value", "cashback")),
		points: toFiniteNumber(pick(source, "points", "loyalty_points")),
		// The flag is authoritative when the server sends one; a programme name
		// on its own is the same claim said differently.
		enrolled: enrolledFlag === undefined ? Boolean(program) : Boolean(enrolledFlag),
		program,
		programName: toText(pick(source, "program_name", "loyalty_program_name")) ?? program,
		cashbackPercent: cashbackPercentOf(source),
		movements,
		cap: toFiniteNumber(pick(source, "cap", "limit")),
		truncated: Boolean(pick(source, "truncated")),
	};
};

/** `{points, value}` — the accrual, computed with ERPNext's own rounding. */
export interface CashbackPreview {
	points: number | null;
	value: number;
}

export const normalizeCashbackPreview = (raw: unknown): CashbackPreview | null => {
	if (!raw || typeof raw !== "object") return null;
	const source = raw as Record<string, unknown>;
	const value = toFiniteNumber(pick(source, "value", "amount"));
	if (value === null || value <= 0) return null;
	return { points: toFiniteNumber(pick(source, "points")), value };
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
		const amount = toFiniteNumber(raw?.amount) ?? 0;
		purchases += 1;
		total += amount;
		const day = dayOf(raw?.ts);
		if (day > lastDay) lastDay = day;
	}
	return { purchases, total, lastDay };
};
