export const restaurantTipFromPercent = (orderTotal: number, percent: number): number =>
	Math.round(orderTotal * percent / 100);

/**
 * Whether the payment surface offers the tip row (critique C2, 08-29).
 *
 * The capability token is the whole gate: a register whose preset grants
 * `tips` offers them on EVERY sale — a mesa settle books through
 * settle_table_order, a counter sale books through submit_invoice's
 * server-side injection; the selector is the same either way. Returns are
 * the one exception: nobody tips a refund.
 *
 * (Until 08-29 this also required a live Record-Only mesa ticket, which is
 * why a counter register with the token never saw the row — the B5/C2 gap.)
 */
export const shouldShowRestaurantTips = (
	hasTipsCapability: boolean,
	isReturn = false,
): boolean => hasTipsCapability && !isReturn;
