/**
 * The customer's wallet, on the screen where it is about to be used
 * (Riel y Cajón §12 item B, `Cobro.dc.html` nodes 50–54).
 *
 *     Monedero del cliente                              $418.00
 *     Acumula $29.20 con esta compra
 *
 * Two claims, and only one of them exists in this product today. The balance
 * is read from a real ledger. **The accrual has no read model**, and this
 * module renders nothing rather than guessing one — see `accrual` below.
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
 * figure. Which one the card describes is decided here, once, so no caller can
 * label a stored-value balance with a loyalty accrual it will never earn.
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
	 * `null` — and it is null for every register today — means NOT AVAILABLE.
	 * The accrual is `cint(eligible_amount / collection_factor) ×
	 * conversion_factor`, and `collection_factor` is computed server-side in
	 * `get_loyalty_program_details_with_points` but never copied into the
	 * payload `api/customers.py:get_customer_info` returns. Nothing on the
	 * client can compute it, so nothing on the client may claim it. The exact
	 * server change is in this task's report; until it lands the line is
	 * absent, which is the same treatment `registerStatusLine` gives
	 * `ticketsToday`.
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
 * Order matters and is not arbitrary: loyalty wins when the customer is
 * enrolled, because loyalty is the wallet that can carry an accrual, and a
 * card that showed a stored-value balance beside "acumula" would attach the
 * accrual to the wrong ledger.
 *
 * An enrolled customer whose points are worth nothing yet still gets the card
 * — `$0.00` on a loyalty wallet is a fact, and it is the fact that makes the
 * accrual line worth reading. An UNKNOWN balance is not: `null` renders
 * nothing, because a zero we invented is indistinguishable from a zero we
 * read, and the customer is standing there.
 */
export const resolveWalletSummary = (
	input: WalletSummaryInput | null | undefined,
): WalletSummary => {
	if (!input || input.isReturn) {
		return ABSENT;
	}

	const accrual = toFiniteNumber(input.accrual);

	const enrolled = String(input.loyaltyProgram ?? "").trim() !== "";
	if (enrolled) {
		const balance = toFiniteNumber(input.loyaltyValue);
		if (balance === null) {
			return ABSENT;
		}
		return {
			visible: true,
			kind: "loyalty",
			balance,
			// A negative accrual is not a thing a purchase does; it would be a
			// sign error somewhere upstream, and printing it would tell the
			// customer their wallet is about to shrink.
			accrual: accrual !== null && accrual > 0 ? accrual : null,
		};
	}

	const stored = toFiniteNumber(input.storedValueBalance);
	// A customer with no stored value and no programme has no wallet, and an
	// empty card that says "$0.00" on every anonymous walk-in teaches the
	// cashier to stop reading that corner of the screen.
	if (stored === null || stored <= 0) {
		return ABSENT;
	}
	return {
		visible: true,
		kind: "stored-value",
		balance: stored,
		// Stored value does not accrue from a purchase. Even handed one, this
		// card refuses to make that promise — it is topped up deliberately, at
		// the counter, and "acumula" beside it would be a lie with a number on
		// it.
		accrual: null,
	};
};
