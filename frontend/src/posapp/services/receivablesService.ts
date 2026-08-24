import api from "./api";

import type {
	CollectedPayload,
	ReceivableDetail,
	ReceivablesPayload,
	ReminderSummary,
} from "../components/pos/payments/cobranza/receivablesModel";

/**
 * The Cobranza panel, from the SPA's side (COBRANZA_GOLDEN_FLOW §2).
 *
 * Reads, plus ONE write that is never money: `logReminder` files a row of the
 * reminder log (`receivables_reminders.file_reminder`), which is the panel
 * recording that a customer was chased. There is no `collect()` here and
 * there must never be one: capture stays `payment_entry.process_pos_payment`,
 * reached through `PayView`, which is the path that has the idempotency key,
 * the offline queue and the reconciliation behind it. A second money-write
 * seam would be a second place for a double charge to be invented.
 *
 * The badge read is deliberately separate from the worklist read even though
 * the server computes both the same way. The rail asks for it on a register
 * where nobody has opened the panel — that is what makes it an ops panel — and
 * pulling the whole worklist down to render one number would put a page of
 * invoice rows on the wire every minute.
 */

const MODULE = "posawesome.posawesome.api.receivables";

export interface ReceivablesBadge {
	overdue: number;
	due_soon: number;
	all: number;
	today: string;
	/** The register has more open invoices than the read's cap — see §2. */
	capped: boolean;
}

export function fetchReceivables(
	posProfile: string,
	options: { bucket?: string | null; search?: string | null; limit?: number | null } = {},
): Promise<ReceivablesPayload> {
	return api.call<ReceivablesPayload>(`${MODULE}.get_receivables`, {
		pos_profile: posProfile,
		bucket: options.bucket ?? null,
		search: options.search ?? null,
		limit: options.limit ?? null,
	});
}

export function fetchCollectedToday(
	posProfile: string,
	options: { limit?: number | null } = {},
): Promise<CollectedPayload> {
	return api.call<CollectedPayload>(`${MODULE}.get_collected_today`, {
		pos_profile: posProfile,
		limit: options.limit ?? null,
	});
}

/**
 * The right column for one row, in one round trip.
 *
 * `doctype` travels because a register that books POS Invoices has folios in
 * two tables and the server refuses to guess: the row already knows which one
 * it came from, and re-deriving it here would be a lookup to re-learn
 * something the list already told us.
 */
export function fetchReceivableDetail(
	posProfile: string,
	invoice: string,
	doctype = "Sales Invoice",
): Promise<ReceivableDetail> {
	return api.call<ReceivableDetail>(`${MODULE}.get_receivable_detail`, {
		pos_profile: posProfile,
		invoice,
		doctype,
	});
}

export function fetchReceivablesBadge(posProfile: string): Promise<ReceivablesBadge> {
	return api.call<ReceivablesBadge>(`${MODULE}.get_receivables_badge`, {
		pos_profile: posProfile,
	});
}

/** What `file_reminder` answers: the invoice's refreshed ladder position. */
export interface ReminderFiled extends Pick<ReminderSummary, "count" | "next_level"> {
	/** True when today already stepped the ladder — no new row was written. */
	already_today: boolean;
	/** The log row this press wrote (or, when `already_today`, today's). */
	reminder: string;
	level: number;
}

/**
 * Step the escalation ladder for one invoice — the server owns the arithmetic
 * (next = min(count+1, 3), at most one step per day) and answers with the
 * state the chips should now show, so the surface needs no second read.
 */
export function logReminder(
	posProfile: string,
	invoice: string,
	doctype: string,
	options: { channel?: string | null; note?: string | null } = {},
): Promise<ReminderFiled> {
	return api.call<ReminderFiled>(
		"posawesome.posawesome.api.receivables_reminders.file_reminder",
		{
			pos_profile: posProfile,
			invoice,
			doctype,
			channel: options.channel ?? null,
			note: options.note ?? null,
		},
	);
}

/**
 * The rail's badge, cached for the session and shared by every asker.
 *
 * Same shape as `getServiceOrderCountsCached`, and for the same reason: the
 * shell asks on mount, on the hottest path in the product. A transport failure
 * clears the cache so the next caller retries rather than pinning a stale
 * number; a profile change starts a new cache rather than badging this
 * register with the previous one's debt.
 *
 * `force` is what the panel uses after a capture: the answer it wants is the
 * one from AFTER the payment landed, and the cached promise is from before.
 */
let badgePromise: Promise<ReceivablesBadge> | null = null;
let badgeProfile: string | null = null;

export function getReceivablesBadgeCached(
	posProfile: string,
	force = false,
): Promise<ReceivablesBadge> {
	if (force || !badgePromise || badgeProfile !== posProfile) {
		badgeProfile = posProfile;
		badgePromise = fetchReceivablesBadge(posProfile).catch((error) => {
			badgePromise = null;
			throw error;
		});
	}
	return badgePromise;
}

/** Drop the cached badge — after a capture, the queue is one shorter. */
export function invalidateReceivablesBadge(): void {
	badgePromise = null;
	badgeProfile = null;
}
