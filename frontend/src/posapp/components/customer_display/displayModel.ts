/**
 * What the customer's screen is showing, derived from whatever crossed the
 * window (`docs/PANTALLA_CLIENTE_GOLDEN_FLOW.md` §1, artboard
 * `PantallaCliente.dc.html`).
 *
 * Pure: no Vue, no DOM, no `__()`. The component renders this; it decides
 * nothing itself, which is what makes the four states assertable without
 * mounting anything.
 *
 * ## The feed is READ, never guessed
 *
 * `CustomerDisplaySnapshot` — the shape `utils/customerDisplay.ts` declares
 * and the register's publisher fills today — carries the basket and the
 * total, and nothing else. It does NOT carry a stage, a tender, a change due
 * or a cashback accrual. So three of the four states are dark on this branch,
 * and that is the honest outcome rather than a bug to paper over:
 *
 *   - **tender** needs `received_amount` / `change_amount`. The register
 *     computes both (`usePaymentCalculations.change_due`), they simply do not
 *     cross the window.
 *   - **done** needs a stage marker. It cannot be inferred from "the cart went
 *     empty": a cart empties on a completed sale AND on a voided one, and
 *     printing «Gracias» at a customer whose sale the cashier just cancelled
 *     is a lie with their money in it.
 *   - **the accrual card** needs `cashback_earned`. `walletSummary.ts`'s
 *     standing rule is absence, not zeros, and a figure this module derived
 *     locally would disagree with the posted accrual the moment a customer
 *     crossed a loyalty tier (the whole reason `get_cashback_preview` is a
 *     server read model).
 *
 * Every one of those fields is therefore read OPTIONALLY, off the envelope as
 * it arrives. Widening the publisher lights the states up with no change
 * here — and until someone does, the screen shows idle and sale exactly as it
 * did before, which is the degraded behaviour the contract asks for
 * (§2: "shows the sale it knows, no error states aimed at customers").
 */

import type {
	CustomerDisplayLineItem,
	CustomerDisplaySnapshot,
} from "../../utils/customerDisplay";

/** The four states of `PANTALLA_CLIENTE_GOLDEN_FLOW.md` §1. */
export type DisplayState = "idle" | "sale" | "tender" | "done";

/**
 * The snapshot as it actually arrives, plus the presentation fields the
 * artboard draws and the wire does not carry yet.
 *
 * Declared here rather than in `utils/customerDisplay.ts` on purpose: that
 * module is the TRANSPORT and this round is presentation. Extending its
 * interface would also be the moment to re-argue what may cross a window into
 * a screen a stranger reads, which is a decision with a guard on it
 * (`tests/customerDisplayPrivacySource.spec.ts`) and not a side effect of a
 * restyle.
 */
export interface CustomerDisplayFeed
	extends Partial<Omit<CustomerDisplaySnapshot, "items">> {
	items?: CustomerDisplayFeedLine[] | null;
	/** `"sale" | "tender" | "done" | "idle"`. Absent on today's publisher. */
	stage?: string | null;
	/** Cash the customer handed over. */
	received_amount?: number | null;
	/** Change owed back. */
	change_amount?: number | null;
	/** Pesos this purchase adds to the customer's card, read from the server. */
	cashback_earned?: number | null;
	/** What the card will hold once this sale posts. */
	cashback_balance_after?: number | null;
}

export interface CustomerDisplayFeedLine extends Partial<CustomerDisplayLineItem> {
	/** A short qualifier the artboard prints after the name — «combo protección», «incluida». */
	note?: string | null;
	/** Pesos saved on THIS line, when the line is part of a priced bundle. */
	saving?: number | null;
}

export interface DisplayLine {
	id: string;
	name: string;
	/** `""` when the feed carries none — never a placeholder. */
	note: string;
	qty: number;
	rate: number;
	amount: number;
	/** Positive pesos, or `null` when the feed said nothing. */
	saving: number | null;
}

export interface DisplayTender {
	received: number | null;
	change: number | null;
}

export interface DisplayAccrual {
	/** Positive pesos this purchase earns. */
	earned: number;
	/** Where the card lands afterwards, or `null` when unstated. */
	balanceAfter: number | null;
}

export interface DisplayView {
	state: DisplayState;
	currency: string;
	lines: DisplayLine[];
	itemCount: number;
	total: number;
	/** Positive magnitude of a saving the lines do not show, else `null`. */
	saving: number | null;
	/** Positive magnitude of a charge the lines do not show, else `null`. */
	surcharge: number | null;
	tender: DisplayTender | null;
	accrual: DisplayAccrual | null;
}

/** Half a cent: the two sides of the arithmetic are floats that took different routes. */
const TOLERANCE = 0.005;

const toFinite = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const toText = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value).trim();

const toLine = (raw: CustomerDisplayFeedLine, index: number): DisplayLine => {
	const qty = toFinite(raw?.qty) ?? 0;
	const rate = toFinite(raw?.rate) ?? 0;
	const amount = toFinite(raw?.amount);
	const saving = toFinite(raw?.saving);

	return {
		id: toText(raw?.id) || `line_${index + 1}`,
		// The item's name or nothing. The SKU is deliberately not a fallback:
		// it is noise at two metres, and `customerDisplayPrivacy.spec.ts`
		// asserts it never reaches the DOM.
		name: toText(raw?.item_name),
		note: toText(raw?.note),
		qty,
		rate,
		amount: amount === null ? qty * rate : amount,
		saving: saving !== null && saving > TOLERANCE ? saving : null,
	};
};

/**
 * The tender, or `null` when the feed said nothing about one.
 *
 * A received of zero is NOT a tender — it is the absence of one written as a
 * number, and it would put an empty «Recibido $0.00» card in front of a
 * customer who has not paid yet. A change of zero IS a fact worth printing
 * once money has been received, so it survives when `received` does.
 */
const resolveTender = (feed: CustomerDisplayFeed): DisplayTender | null => {
	const received = toFinite(feed.received_amount);
	const change = toFinite(feed.change_amount);
	const hasReceived = received !== null && received > TOLERANCE;
	const hasChange = change !== null && change > TOLERANCE;
	if (!hasReceived && !hasChange) return null;
	return {
		received: hasReceived ? received : null,
		change: received !== null && change !== null && change >= 0 ? change : hasChange ? change : null,
	};
};

/**
 * The cashback card, or `null`.
 *
 * Absence, not zeros — `walletSummary.ts`'s standing rule, and the reason the
 * artboard's comment says the card "is simply absent" for anyone who is not
 * enrolled. A non-positive accrual is treated as absent too: a purchase does
 * not shrink a wallet, so a zero or a negative is a fault upstream and
 * printing it would tell the customer something untrue about their money.
 */
const resolveAccrual = (feed: CustomerDisplayFeed): DisplayAccrual | null => {
	const earned = toFinite(feed.cashback_earned);
	if (earned === null || earned <= TOLERANCE) return null;
	const balanceAfter = toFinite(feed.cashback_balance_after);
	return {
		earned,
		balanceAfter: balanceAfter !== null && balanceAfter >= 0 ? balanceAfter : null,
	};
};

/**
 * The state, from the feed's own word where it has one and from what is on
 * the screen where it does not.
 *
 * The declared stage wins because only the register knows whether a sale
 * closed or was abandoned. Everything below it is derivable without guessing:
 * money received means tender, lines mean sale, neither means idle.
 */
const resolveState = (
	declared: string,
	hasLines: boolean,
	tender: DisplayTender | null,
): DisplayState => {
	switch (declared) {
		case "done":
		case "paid":
		case "closed":
			return "done";
		case "tender":
		case "payment":
			return "tender";
		case "idle":
			return "idle";
		default:
			break;
	}
	if (tender) return "tender";
	return hasLines ? "sale" : "idle";
};

const EMPTY: DisplayView = {
	state: "idle",
	currency: "",
	lines: [],
	itemCount: 0,
	total: 0,
	saving: null,
	surcharge: null,
	tender: null,
	accrual: null,
};

export const resolveDisplayView = (
	feed: CustomerDisplayFeed | null | undefined,
): DisplayView => {
	if (!feed) return EMPTY;

	const lines = (Array.isArray(feed.items) ? feed.items : []).map(toLine);
	const lineSum = lines.reduce((sum, row) => sum + row.amount, 0);

	const declaredTotal = toFinite(feed.total_amount);
	const total = declaredTotal === null ? lineSum : declaredTotal;

	// The gap between the rows and the figure. The publisher folds discount and
	// delivery into `total_amount`, so this is real money a customer who adds
	// the rows up themselves would otherwise have to take on faith.
	// Minus what the LINES already explained. A combo that prints «ahorras $79»
	// on its own row and then a summary «Ahorro −$79» underneath has said the
	// same money twice, and a customer counting the discounts finds two — the
	// duplication `registerSaysItOnce.spec.ts` exists over. So the summary row
	// states only the remainder nobody has accounted for, and disappears
	// entirely when the lines cover it.
	const explained = lines.reduce((sum, row) => sum + (row.saving ?? 0), 0);
	const delta = total - lineSum;
	const unexplained = delta < 0 ? -delta - explained : 0;
	const saving = unexplained > TOLERANCE ? unexplained : null;
	const surcharge = delta > TOLERANCE ? delta : null;

	const declaredQty = toFinite(feed.total_qty);
	const itemCount =
		declaredQty !== null && declaredQty > 0
			? declaredQty
			: lines.reduce((sum, row) => sum + row.qty, 0);

	const tender = resolveTender(feed);

	return {
		state: resolveState(toText(feed.stage).toLowerCase(), lines.length > 0, tender),
		currency: toText(feed.currency),
		lines,
		itemCount,
		total,
		saving,
		surcharge,
		tender,
		accrual: resolveAccrual(feed),
	};
};
