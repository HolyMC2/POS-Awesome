/**
 * The unsent cash form on this device.
 *
 * A draft is what the worker typed and has NOT sent: the task, the counted
 * denominations, the seal, the note, the bank reference, the purpose and the
 * record it was opened from. It never means cash moved. Submitted commands
 * waiting for a confirmed result are a different thing entirely and live under
 * the `cash-custody-request:` keys owned by `api.ts` — nothing here reads,
 * writes or clears those, so recovery evidence is never overwritten by a draft.
 *
 * The key carries the session user, the register profile and the opening shift,
 * so a second cashier on the same terminal never inherits someone else's count.
 */

const PREFIX = "cash-custody-draft:";

export type CustodyDraft = {
	action: string;
	bag: string | null;
	cash_count: string | null;
	seal: string;
	purpose: string;
	note: string;
	reference: string;
	count: any;
	saved_at: string;
};

/** `unreadable` is deliberate: damaged saved work is reported, never discarded. */
export type DraftRead =
	| { state: "empty" }
	| { state: "draft"; draft: CustodyDraft }
	| { state: "unreadable" };

export function draftKey(
	user?: string | null,
	profile?: string | null,
	openingShift?: string | null,
): string | null {
	if (!user || !profile) return null;
	return `${PREFIX}${user}:${profile}:${openingShift || "no-shift"}`;
}

const text = (value: any) => typeof value === "string";
const optionalName = (value: any) =>
	value === null || value === undefined || text(value);
const missing = (value: any) => value === null || value === undefined;

/**
 * The count is the part `CashCountEditor` and `amount()` consume directly, so a
 * reshaped row here would reach them as NaN arithmetic or a crash. Structure is
 * checked; the *content* of a hand-typed total is not — "12," is a half-typed
 * amount the cashier still has to correct on screen, not damaged storage.
 */
function countShaped(count: any) {
	if (!count || typeof count !== "object" || Array.isArray(count))
		return false;
	if (
		!missing(count.source) &&
		!["denominations", "manual"].includes(count.source)
	)
		return false;
	if (
		!missing(count.amount) &&
		!text(count.amount) &&
		typeof count.amount !== "number"
	)
		return false;
	if (!missing(count.reason) && !text(count.reason)) return false;
	if (missing(count.denominations)) return true;
	if (!Array.isArray(count.denominations)) return false;
	return count.denominations.every(
		(row: any) =>
			row &&
			typeof row === "object" &&
			!Array.isArray(row) &&
			Number.isFinite(Number(row.value)) &&
			!missing(row.value) &&
			Number.isFinite(Number(row.quantity)) &&
			!missing(row.quantity),
	);
}

function shaped(saved: any): saved is CustodyDraft {
	return Boolean(
		saved &&
			typeof saved === "object" &&
			!Array.isArray(saved) &&
			text(saved.action) &&
			saved.action.length > 0 &&
			saved.action.length <= 40 &&
			text(saved.seal) &&
			text(saved.purpose) &&
			text(saved.note) &&
			text(saved.reference) &&
			optionalName(saved.bag) &&
			optionalName(saved.cash_count) &&
			countShaped(saved.count),
	);
}

export function readDraft(key: string): DraftRead {
	let raw: string | null;
	try {
		raw = localStorage.getItem(key);
	} catch {
		return { state: "unreadable" };
	}
	if (raw === null) return { state: "empty" };
	let saved: any;
	try {
		saved = JSON.parse(raw);
	} catch {
		return { state: "unreadable" };
	}
	if (!shaped(saved)) return { state: "unreadable" };
	return {
		state: "draft",
		draft: {
			action: saved.action,
			bag: saved.bag || null,
			cash_count: saved.cash_count || null,
			seal: saved.seal,
			purpose: saved.purpose,
			note: saved.note,
			reference: saved.reference,
			count: saved.count,
			saved_at: text(saved.saved_at) ? saved.saved_at : "",
		},
	};
}

/** Throws when the browser refuses to keep the work, so the screen can say so. */
export function writeDraft(key: string, draft: CustodyDraft) {
	localStorage.setItem(key, JSON.stringify(draft));
}

/** False means the finished work is still on disk and the worker must be told. */
export function clearDraft(key: string): boolean {
	try {
		localStorage.removeItem(key);
		return true;
	} catch {
		return false;
	}
}
