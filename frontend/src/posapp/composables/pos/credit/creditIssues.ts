import type { CreditIssue } from "./creditMath";

/**
 * English source text for each credit-sale issue; callers translate it with
 * `__()` so the strings stay in one place for the sheet and the pay card.
 */
export const CREDIT_ISSUE_TEXT: Record<CreditIssue, string> = {
	no_lines: "Select the items the credit covers.",
	lines_changed: "The sale changed. Select the items the credit covers again.",
	missing_price: "Enter the total credit price from the provider's approval.",
	missing_enganche: "Enter the down payment (0 if there is none).",
	enganche_too_high: "The down payment must be less than the credit price.",
	ticket_pending: "The ticket does not show the credit yet. Apply it again.",
};
