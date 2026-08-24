/**
 * The customer's wallet, on the screen where it is about to be used
 * (Riel y Cajón §12 item B, `Cobro.dc.html` nodes 50–54).
 *
 *     Monedero del cliente                              $418.00
 *     Acumula $29.20 con esta compra
 *
 * Two claims, and both are now READ rather than guessed. The balance comes
 * from a real ledger; the accrual comes from `stored_value.get_cashback_preview`
 * (2026-08-23), which computes it with ERPNext's own truncation instead of
 * re-deriving it here — see `accrual` below. What has not changed is the rule:
 * an accrual this module was not handed renders nothing at all.
 *
 * TWO WALLETS, NOT ONE. A register can carry either, both or neither:
 *
 *  - **Stored value** (`stored_value.py`, the POS's own "monedero"): pesos the
 *    customer has already paid in, redeemable as a tender. It does not accrue
 *    from a purchase; it is topped up deliberately.
 *  - **Loyalty points** (ERPNext Loyalty Program): points that DO accrue from a
 *    purchase, worth `points × conversion_factor` in pesos when redeemed.
 *
 * They are different promises and this module never merges them into one
 * figure — the card carries a balance and, on its own line, what the purchase
 * earns. Which balance is named is decided here, once, so no caller has to
 * choose: the monedero when the customer has one, because that is the money
 * this till can take today; the points when it is the only wallet there is.
 * See the guard for why that ordering changed.
 *
 * Pure: no Vue, no store, no `__()`.
 */

export type WalletKind = "loyalty" | "stored-value";

export interface WalletSummaryInput {
	/**
	 * `customer_info.loyalty_program` — the customer is enrolled. Absent means
	 * not enrolled, which is most customers at these counters.
	 */
	loyaltyProgram?: string | null;
	/**
	 * Pesos the customer's points are worth — `useRedemptionLogic`'s
	 * `available_points_amount` (points × conversion_factor, converted to the
	 * invoice currency). `null` means the register has not answered yet.
	 */
	loyaltyValue?: number | null;
	/**
	 * `customer_info.stored_value_balance` — pesos already paid in. `null`
	 * means unknown: `get_customer_info` returns it only when a company was
	 * passed, and offline it comes from a snapshot that may be absent.
	 */
	storedValueBalance?: number | null;
	/**
	 * What THIS purchase will add to the wallet, in pesos.
	 *
	 * `null` still means NOT AVAILABLE, and it is null for every register with
	 * `posa_use_customer_cards` off, every unenrolled customer and every
	 * offline sale — absent, the same treatment `registerStatusLine` gives
	 * `ticketsToday`.
	 *
	 * When it IS a number it was read from the server, never derived here. The
	 * accrual is `cint(eligible_amount / collection_factor) ×
	 * conversion_factor`, and `collection_factor` is a TIER value picked from
	 * the customer's total spend with this sale folded in — the client has
	 * neither the tiers nor the spend, so a local figure would agree with the
	 * posted accrual only until a customer crossed a tier.
	 * `useRedemptionLogic.cashback_accrual` fills this from
	 * `stored_value.get_cashback_preview`.
	 */
	accrual?: number | null;
	/** A refund does not accrue, and its wallet card is not this screen's job. */
	isReturn?: boolean;
}

export interface WalletSummary {
	/** Whether the card is drawn at all. */
	visible: boolean;
	/** Which promise the card is making. */
	kind: WalletKind | null;
	/** Pesos on the wallet today. */
	balance: number;
	/** Pesos this sale adds, or `null` for "we cannot say". */
	accrual: number | null;
}

const ABSENT: WalletSummary = { visible: false, kind: null, balance: 0, accrual: null };

const toFiniteNumber = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * THE GUARD. What the wallet card is allowed to say.
 *
 * THE HEADLINE IS THE MONEDERO. Whatever the customer has already paid in is
 * the money they can hand over at THIS till, on THIS sale, and it is the one
 * figure the cashier standing at Cobro can act on. `get_customer_wallet` says
 * the same thing in its own docstring, `ClienteWallet.vue` draws the contact
 * view that way, and `Cobro.dc.html` nodes 50–54 write it out: «Monedero del
 * cliente $418.00».
 *
 * This module used to put loyalty first whenever the customer was enrolled,
 * reasoning that loyalty is the wallet that carries the accrual. That ordering
 * hid real money: a customer enrolled in a cashback programme with $200 of
 * monedero and no points yet got «Puntos del cliente $0.00» — the $0.00 they
 * cannot spend, in place of the $200 they can — while the contact view one
 * screen away showed the $200. Two screens disagreeing about one person's
 * wallet is worse than either ordering.
 *
 * Loyalty still gets the card when it is the ONLY wallet: a register with a
 * points programme and no stored-value ledger is a real configuration, and
 * `$0.00` of points is a fact worth printing there — it is what makes the
 * accrual line beneath it worth reading.
 *
 * THE ACCRUAL BELONGS TO ENROLMENT, NOT TO THE HEADLINE. It is a claim about
 * what this purchase does — the server answers it from
 * `stored_value.get_cashback_preview`, which gates on `enrolled` and nothing
 * else. So an enrolled customer may carry the accrual line under either
 * balance, and an UNENROLLED one never carries it, whatever number is handed
 * in. What this module still refuses, and always will, is ADDING the two: they
 * are separate promises and the card prints them on separate lines.
 *
 * An UNKNOWN balance renders nothing: `null` is not zero, because a zero we
 * invented is indistinguishable from a zero we read, and the customer is
 * standing there.
 */
export const resolveWalletSummary = (
	input: WalletSummaryInput | null | undefined,
): WalletSummary => {
	if (!input || input.isReturn) {
		return ABSENT;
	}

	const enrolled = String(input.loyaltyProgram ?? "").trim() !== "";
	const supplied = toFiniteNumber(input.accrual);
	// A negative accrual is not a thing a purchase does; it would be a sign
	// error somewhere upstream, and printing it would tell the customer their
	// wallet is about to shrink.
	const accrual = enrolled && supplied !== null && supplied > 0 ? supplied : null;

	const stored = toFiniteNumber(input.storedValueBalance);
	if (stored !== null && stored > 0) {
		return { visible: true, kind: "stored-value", balance: stored, accrual };
	}

	if (enrolled) {
		const balance = toFiniteNumber(input.loyaltyValue);
		if (balance === null) {
			return ABSENT;
		}
		return { visible: true, kind: "loyalty", balance, accrual };
	}

	// A customer with no stored value and no programme has no wallet, and an
	// empty card that says "$0.00" on every anonymous walk-in teaches the
	// cashier to stop reading that corner of the screen.
	return ABSENT;
};
