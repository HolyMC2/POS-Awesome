/**
 * What the Recargas destination can honestly show (build plan §12 item F).
 *
 * The artboard is dense with money — a pouch balance, a day count, a day
 * total, a commission for the day, a commission rate, what is left after this
 * recharge — and the register can source some of those and not others. This
 * module is where each figure is either DERIVED from a real payload or
 * declared absent, so the decision is one readable list rather than a set of
 * `v-if`s scattered through a template.
 *
 * The rule it enforces is the programme's: **render nothing rather than a
 * placeholder.** The cart line's category, the status line's tickets-today and
 * Cobro's warranty all took the same call, and a money surface is the worst
 * place to break it — a cashier who sees "comisión $321" believes they earned
 * $321 today.
 *
 * ### The figures, and where each one comes from
 *
 * | Artboard | Source | Verdict |
 * |---|---|---|
 * | `Saldo $1,240` / pouch card | `saldo.api.status.get_pos_available_balance` | real, and hidden when the manager hid it |
 * | `31 recargas hoy` | today's rows from `saldo.api.status.list_transactions` | real, but only when the page is not truncated |
 * | `$6,420 vendidos` | sum of `monto` over today's DELIVERED rows | same |
 * | `Comisión de hoy $321` | — | absent: `list_transactions` does not select `Saldo Transaction.comision` |
 * | `comisión 5 %` | — | absent: it is a mock's number, see below |
 * | `te quedan` | — | absent for the same reason as the commission |
 * | `Bolsa antes / después` | balance, and balance less this amount | real when the balance is visible |
 * | `Abonaste $5,000 el 14 de agosto`, `te alcanza para 6 h`, the week's bars, `Tu bolsa también paga` | — | absent: no POS read model exists for any of them |
 *
 * ### On the commission rate
 *
 * `comisión 5 %` in the artboard is a mock's number and this module will not
 * repeat it. Two real figures exist in the saldo app and they are NOT the same
 * thing: `Saldo Carrier.comision_json → ComisionCliente` is the uplift added to
 * the customer's price (`saldo/api/items.py` seeds `standard_rate = monto +
 * ComisionCliente`), while `Saldo Transaction.comision` is what TAECEL paid the
 * shop, written from the carrier's own response. Neither reaches this app: the
 * first is not returned by any POS endpoint, and the second is a column
 * `list_transactions` does not select. Both are one-line additions on the saldo
 * side and both are reported rather than guessed at here.
 */

import type { BandInput } from "../../../composables/pos/shell/bandState";

type AnyRecord = Record<string, any>;

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const money = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/* -------------------------------------------------------------------------- */
/* The pouch                                                                   */
/* -------------------------------------------------------------------------- */

/** `get_pos_available_balance()`'s envelope, as it arrives. */
export interface BolsaPayload {
	visible?: boolean;
	balance?: number | null;
	as_of?: string | null;
	error?: string | null;
}

export interface BolsaFigures {
	/**
	 * The manager's switch (`Saldo Settings.show_available_balance_in_pos`,
	 * default OFF). When it is off the server sends `{visible: false}` and NO
	 * balance ever leaves it — so there is nothing to render and nothing to
	 * apologise for either. The pouch card is simply not on this screen.
	 */
	visible: boolean;
	/** Pesos in the Tiempo Aire pouch, or null when unknown for any reason. */
	available: number | null;
	asOf: string | null;
	/** What the pouch drops to if this recharge goes through; null if unknown. */
	after: number | null;
	/**
	 * The balance was asked for and could not be had — credentials missing, or
	 * TAECEL unreachable and no cached snapshot. Distinct from `visible:false`,
	 * because this one is a fault and that one is a setting.
	 */
	unavailable: boolean;
}

/**
 * Resolve the pouch figures for a pending amount.
 *
 * `after` exists only when both halves do. A "bolsa después" computed from a
 * balance we do not have would be the amount subtracted from zero, which reads
 * as an overdrawn pouch and is a lie about the owner's money.
 */
export function resolveBolsa(payload: BolsaPayload | null | undefined, amount: unknown = 0): BolsaFigures {
	const visible = Boolean(payload?.visible);
	if (!visible) {
		return { visible: false, available: null, asOf: null, after: null, unavailable: false };
	}
	const raw = payload?.balance;
	const available = raw === null || raw === undefined || !Number.isFinite(Number(raw))
		? null
		: round2(Number(raw));
	const pending = round2(money(amount));
	return {
		visible: true,
		available,
		asOf: payload?.as_of ?? null,
		after: available === null || pending <= 0 ? null : round2(available - pending),
		unavailable: available === null,
	};
}

/* -------------------------------------------------------------------------- */
/* Today's recharges                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The six values `Saldo Transaction.status` can hold, mapped to the four the
 * artboard actually draws plus the two it does not.
 *
 * `Manual Review` is kept apart from `failed` on purpose: TAECEL may or may not
 * have charged it, so it is neither money back nor money gone, and the saldo
 * app's own `_row_flags` keeps it out of the refundable total for exactly that
 * reason. Collapsing it into "Reintegrada" would tell a cashier the pouch got
 * its money back when it may not have.
 */
export type RechargeOutcome = "applied" | "confirming" | "refunded" | "failed" | "review";

const OUTCOME_BY_STATUS: Readonly<Record<string, RechargeOutcome>> = {
	Success: "applied",
	Pending: "confirming",
	InProgress: "confirming",
	Refunded: "refunded",
	Failed: "failed",
	"Manual Review": "review",
};

/**
 * English source strings; `es.csv` carries the Spanish the counter reads.
 *
 * Wrapped in `{ labelKey }` rather than mapped straight to a string, because
 * that is the shape `registerShellTranslations.spec.ts` can SEE. Its scan
 * matches any property whose name ends in `Key`, and a bare
 * `applied: "Applied"` is invisible to it — the string would ship untranslated
 * and the suite meant to catch that would stay green, which is the exact
 * failure that spec was written after.
 */
export const OUTCOME_LABEL: Readonly<Record<RechargeOutcome, { labelKey: string }>> = {
	applied: { labelKey: "Applied" },
	confirming: { labelKey: "Confirming" },
	refunded: { labelKey: "Refunded to the pouch" },
	failed: { labelKey: "Not delivered" },
	review: { labelKey: "Under review" },
};

export interface LedgerEntry {
	id: string;
	/** `HH:MM`, sliced from the server's own timestamp — no timezone maths. */
	time: string;
	carrier: string;
	product: string;
	/** Masked: the middle four digits are the shop's copy of a customer's line. */
	reference: string;
	amount: number;
	outcome: RechargeOutcome;
}

export interface TodayLedger {
	entries: LedgerEntry[];
	/**
	 * Whether these rows are ALL of today's. `list_transactions` caps at its
	 * `limit`, and a count taken from a capped page undercounts a busy shop —
	 * "31 recargas hoy" would quietly become "100" and stay there. When this is
	 * false the counters render nothing; the table still shows what it has.
	 */
	complete: boolean;
	/** Operations today, or null when the page was capped. */
	operations: number | null;
	/** Pesos delivered today, or null when the page was capped. */
	sold: number | null;
	/** Recharges the pouch got back — the artboard's "Reintegradas 1". */
	refunded: number | null;
	/** Failed or under review: the rows a supervisor has to look at. */
	needsAttention: number | null;
	/**
	 * ALWAYS null. `list_transactions`'s SELECT does not include
	 * `st.comision`, so the day's commission has no read model to come from and
	 * this screen shows no commission at all. Typed as a number so the field
	 * stops being null the moment the column is added, with no shape change.
	 */
	commission: number | null;
}

/**
 * Mask the middle of a reference — `55 •••• 6390`, exactly as the artboard.
 *
 * The rows carry customer phone numbers, which is why `list_transactions`
 * scopes them to one POS profile in the first place. A shop screen faces the
 * counter and the next customer in the queue can read it.
 */
export function maskReference(raw: unknown): string {
	const value = String(raw ?? "").trim();
	if (value.length <= 6) {
		return value;
	}
	return `${value.slice(0, 2)} •••• ${value.slice(-4)}`;
}

const dayOf = (timestamp: unknown): string => String(timestamp ?? "").slice(0, 10);
const timeOf = (timestamp: unknown): string => String(timestamp ?? "").slice(11, 16);

export interface TodayOptions {
	/** `YYYY-MM-DD`, the server's day. */
	today: string;
	/** The `limit` the rows were fetched with, so truncation can be detected. */
	limit: number;
}

export function buildTodayLedger(
	rows: readonly AnyRecord[] | null | undefined,
	options: TodayOptions,
): TodayLedger {
	const all = Array.isArray(rows) ? rows : [];
	const complete = all.length < Math.max(1, options.limit);
	const entries: LedgerEntry[] = [];
	for (const row of all) {
		if (dayOf(row?.requested_at) !== options.today) {
			continue;
		}
		const status = String(row?.status ?? "");
		entries.push({
			id: String(row?.name ?? ""),
			time: timeOf(row?.requested_at),
			carrier: String(row?.saldo_carrier ?? ""),
			product: String(row?.saldo_product ?? row?.item_code ?? ""),
			reference: maskReference(row?.referencia),
			amount: round2(money(row?.monto)),
			// An unknown status is treated as still confirming rather than as
			// delivered: it keeps the money OUT of "vendidos" until we know.
			outcome: OUTCOME_BY_STATUS[status] ?? "confirming",
		});
	}
	const count = (outcome: RechargeOutcome) => entries.filter((e) => e.outcome === outcome).length;
	return {
		entries,
		complete,
		operations: complete ? entries.length : null,
		sold: complete
			? round2(entries.filter((e) => e.outcome === "applied").reduce((sum, e) => sum + e.amount, 0))
			: null,
		refunded: complete ? count("refunded") : null,
		needsAttention: complete ? count("failed") + count("review") : null,
		commission: null,
	};
}

/* -------------------------------------------------------------------------- */
/* The band                                                                    */
/* -------------------------------------------------------------------------- */

export interface RechargeIntent {
	carrier: string | null;
	carrierLabel: string | null;
	reference: string;
	amount: number | null;
	itemCode: string | null;
}

/**
 * The band's input for this screen — NOT a second big number.
 *
 * The artboard draws `$200.00`, `RECARGAR` and the pouch before/after inside
 * the bottom card, and that card is `shell/band`'s, not this view's. So the
 * destination composes the input and hands it over; rendering the figure here
 * as well is precisely the duplication `registerSaysItOnce.spec.ts` exists to
 * stop.
 *
 * `ready` is deliberately strict: a company explicitly chosen, a reference, a
 * positive amount and an Item behind it. A hint is not a choice
 * (`hintIsAuthoritative()` returns false and says why), so a recharge cannot
 * be armed by typing a number the register merely recognised.
 */
export function rechargeBandInput(intent: RechargeIntent): BandInput {
	const amount = intent.amount ?? 0;
	return {
		kind: "recharge",
		amount,
		carrier: intent.carrierLabel ?? intent.carrier ?? "",
		msisdn: intent.reference,
		ready: Boolean(intent.carrier && intent.reference && amount > 0 && intent.itemCode),
	};
}

/**
 * Money roles this screen declares, in one place.
 *
 * `registerSaysItOnce.spec.ts` counts figures by `data-money-role` and this
 * screen is dense with them, so each one is named here rather than typed into a
 * template where a second `role="total"` could appear unremarked. Note what is
 * NOT here: `total`. The band owns the total, on every screen.
 */
export const MONEY_ROLE = Object.freeze({
	pouch: "pouch-available",
	pouchAfter: "pouch-after",
	preset: "amount-preset",
	sold: "day-sold",
	entry: "ledger-line",
});
