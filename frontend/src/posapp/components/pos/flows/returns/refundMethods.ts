/**
 * How the money goes back (DOCUMENTOS_GOLDEN_FLOW §2).
 *
 * Pure, like its neighbours `findMethods.ts` and `returnLines.ts`: the rule
 * that decides whether a nota de crédito is even offered is a rule about a
 * customer, and it has to be readable in a test rather than only by mounting a
 * 900-line dialog.
 *
 * The two branches are different SHAPES, not two tenders:
 *
 * * **Efectivo** is today's path, unchanged. The dialog emits
 *   `load_return_invoice`, the negative document lands in the cart, and the
 *   cashier tenders it in Cobro. Nothing on this round touches it.
 * * **Nota de crédito** never reaches the tender screen. It is a submitted
 *   return with NO payments — which is exactly what leaves the customer's
 *   `outstanding_amount` negative and therefore spendable as monedero — so the
 *   surface posts it server-side and prints the folio.
 */

export const REFUND_METHOD_IDS = ["cash", "credit_note"] as const;

export type RefundMethodId = (typeof REFUND_METHOD_IDS)[number];

export interface RefundMethod {
	id: RefundMethodId;
	/** English source string; the view wraps it in `__()`. */
	label: string;
	/** One line under the label — what actually happens. */
	hint: string;
	icon: string;
	/** False when this register/sale cannot use it; the chip stays and says why. */
	available: boolean;
	/** English source string explaining the refusal, or null when available. */
	blockedReason: string | null;
}

export interface RefundContext {
	/** The customer on the ORIGINAL sale. */
	customer: string | null | undefined;
	/** The register's default counter customer (`POS Profile.customer`). */
	walkInCustomer: string | null | undefined;
}

/**
 * Is this sale's customer someone credit could belong to?
 *
 * A balance held by «Público en General» is a balance the next person to say
 * that name could spend, so the counter customer is refused — and so is a sale
 * with no customer at all, which the no-ticket path can produce.
 */
export const canLeaveCredit = (ctx: RefundContext): boolean => {
	const customer = String(ctx.customer ?? "").trim();
	if (!customer) return false;
	const walkIn = String(ctx.walkInCustomer ?? "").trim();
	return !walkIn || customer !== walkIn;
};

/**
 * The two chips, in artboard order, resolved for THIS sale.
 *
 * Both are always returned. A credit note that is simply absent on a counter
 * sale teaches nothing; one that is present and says «el saldo necesita dueño»
 * teaches the cashier to ask for the customer's name next time — the same
 * reasoning the rail uses for a dimmed destination versus an absent one.
 */
export const describeRefundMethods = (ctx: RefundContext): RefundMethod[] => {
	const creditAllowed = canLeaveCredit(ctx);
	return [
		{
			id: "cash",
			label: "Cash",
			hint: "The money goes back the way it came in",
			icon: "mdi-cash",
			available: true,
			blockedReason: null,
		},
		{
			id: "credit_note",
			label: "Credit note",
			hint: "Credited to the customer's balance, spendable on any purchase",
			icon: "mdi-ticket-percent-outline",
			available: creditAllowed,
			blockedReason: creditAllowed
				? null
				: "Credit needs an owner — set a real customer on the sale, or refund in cash.",
		},
	];
};

/**
 * The method the surface starts on, and falls back to when the chosen one
 * stops being legal.
 *
 * Cash always. A refund defaulting to credit would hand the customer a balance
 * they did not ask for, and the cashier would have to notice before pressing
 * the one big button.
 */
export const defaultRefundMethod = (): RefundMethodId => "cash";

/**
 * Re-resolve a chosen method against a new sale.
 *
 * Called when the cashier picks a different original: a credit note chosen for
 * a named customer must not survive onto a counter sale, where it would be
 * refused by the server after the button was pressed.
 */
export const resolveRefundMethod = (
	chosen: RefundMethodId,
	ctx: RefundContext,
): RefundMethodId => (chosen === "credit_note" && !canLeaveCredit(ctx) ? "cash" : chosen);

/**
 * The sentence printed after a credit note is minted.
 *
 * `{0}` is the customer and `{1}` the folio, kept outside the key so `__()` can
 * substitute them after translation.
 */
export const CREDIT_NOTE_MINTED_KEY =
	"Credited to {0}'s balance — usable on any purchase. Note {1}.";

/** The primary button's label per method — the artboard's «DEVOLVER $149.00». */
export const refundActionKey = (method: RefundMethodId): string =>
	method === "credit_note" ? "Refund as credit note" : "Continue the return";
