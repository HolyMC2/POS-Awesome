/**
 * The customer-card seam, from the SPA's side — and the graceful-absence rule
 * in front of it.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the contact view works on a register
 * that has never heard of customer cards. `docs/CUSTOMER_CARDS_GOLDEN_FLOW.md`
 * §5 spells it out — "registers without the flags: no wallet card … and no
 * dead links to any of it" — and the endpoints below ship in a sibling task,
 * so for a window of time the answer to every one of them is a 404 on a
 * register whose app has not been migrated yet.
 *
 * So the READS return `null` on any failure and the caller HIDES the wallet.
 * The story column and the CRM strip do not depend on them and keep working;
 * that separation is the whole reason the contact view is worth opening even
 * on a shop with no programme.
 *
 * The WRITES do the opposite: `deposit` and `enrol` THROW, and the dialog
 * prints the server's own words. A refusal there is something the cashier can
 * act on — a closed shift, a tender that is not on this profile, an amount of
 * zero — and swallowing it would leave somebody pressing a button that does
 * nothing while a customer waits with cash in their hand.
 *
 * READS ARE BUDGETED, NOT PROBED. `crmService` disables itself on the first
 * "not installed" because its server answers that question directly; this one
 * has no such answer, so it counts consecutive failures instead. Three and the
 * session stops asking, which bounds a register with no endpoint to three
 * round trips in its life without ever confusing "unreachable" with "absent".
 */

import api from "../../../services/api";

import {
	normalizeCashbackPreview,
	normalizeWallet,
	type CashbackPreview,
	type CustomerWallet,
} from "./customerCard";

const BASE = "posawesome.posawesome.api.stored_value";

/** Consecutive read failures after which the session stops asking. */
const FAILURE_BUDGET = 3;

let failures = 0;

/** True once the register has given up on the wallet endpoints. */
export const customerCardIsUnavailable = (): boolean => failures >= FAILURE_BUDGET;

/** Forget what the session learned. Exported for tests and profile switches. */
export function resetCustomerCardAvailability(): void {
	failures = 0;
}

/**
 * The customer's wallet, or `null` when there is nothing to show.
 *
 * `null` means HIDE THE CARD. It is never an error the cashier has to read:
 * a wallet that could not load is not something they can fix at the counter,
 * and a toast about it over a live ticket would be noise.
 */
export async function fetchCustomerWallet(
	customer: string,
	company: string,
): Promise<CustomerWallet | null> {
	if (customerCardIsUnavailable() || !customer || !company) return null;
	try {
		const answer = await api.call<unknown>(`${BASE}.get_customer_wallet`, {
			customer,
			company,
		});
		failures = 0;
		return normalizeWallet(answer);
	} catch {
		failures += 1;
		return null;
	}
}

/**
 * What a purchase of `eligibleAmount` would add to the wallet.
 *
 * Computed by the server with ERPNext's own rounding — `walletSummary.ts`
 * describes the socket this fills and why the client may never re-derive it:
 * the accrual is `cint(eligible / collection_factor) × conversion_factor`, and
 * `collection_factor` has never been on any payload the SPA holds.
 */
export async function fetchCashbackPreview(
	customer: string,
	company: string,
	eligibleAmount: number,
): Promise<CashbackPreview | null> {
	if (customerCardIsUnavailable() || !customer || !company || !(eligibleAmount > 0)) {
		return null;
	}
	try {
		const answer = await api.call<unknown>(`${BASE}.get_cashback_preview`, {
			customer,
			company,
			eligible_amount: eligibleAmount,
		});
		failures = 0;
		return normalizeCashbackPreview(answer);
	} catch {
		failures += 1;
		return null;
	}
}

/**
 * Money in. A submitted Payment Entry against the customer, paid to the
 * tender's account — which is also why it counts in this register's drawer and
 * why the server, not this call, decides whether the shift is open.
 *
 * Throws on refusal, on purpose. See the module header.
 */
export function depositStoredValue(
	posProfile: string,
	customer: string,
	amount: number,
	modeOfPayment: string,
	clientRequestId?: string,
): Promise<unknown> {
	// A money-IN write gets the invoice submit's leash, not the 30s default:
	// the server is allowed 120s (gunicorn `--timeout=120`), and the fetch has
	// no AbortController, so a 30s client timeout reported "failed" while the
	// deposit was still legitimately posting — a re-press then booked a SECOND
	// Payment Entry. `client_request_id` (minted once per press by the dialog)
	// makes the server dedupe a replay; the longer timeout stops the false
	// failure that triggers the re-press in the first place.
	return api.call<unknown>(
		`${BASE}.deposit_stored_value`,
		{
			pos_profile: posProfile,
			customer,
			amount,
			mode_of_payment: modeOfPayment,
			client_request_id: clientRequestId,
		},
		{ timeoutMs: 120_000 },
	);
}

/**
 * «Activar tarjeta» — enrol the customer in the programme this register
 * designates (`POS Profile.posa_customer_card_program`). One tap, and the
 * register never names the programme in the request: which programme a shop
 * runs is a profile decision, and a client that could pass one could enrol a
 * customer into somebody else's.
 *
 * Throws on refusal, on purpose. See the module header.
 */
export function enrollCustomerCard(posProfile: string, customer: string): Promise<unknown> {
	return api.call<unknown>(`${BASE}.enroll_customer_card`, {
		pos_profile: posProfile,
		customer,
	});
}

/**
 * The message a Frappe failure is actually carrying.
 *
 * A thrown Frappe error puts the operator's sentence in `_server_messages`,
 * never in a `message` key — `api.call` unpacks it (`extractServerMessage`) and
 * rethrows an `ApiEnvelopeError` whose `.message` IS that sentence. So
 * `.message` is the one that fires here; `serverMessage` is read first for the
 * callers further down the tree that still surface a raw frappe rejection.
 * Both are checked in one place so the three callers cannot disagree about
 * which refusal a cashier gets to read.
 */
export function refusalText(error: unknown, fallback: string): string {
	const failure = error as { serverMessage?: string; message?: string } | null;
	return failure?.serverMessage || failure?.message || fallback;
}
