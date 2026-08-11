/**
 * Deadline wrapper for the raw `frappe.call` sites on the resume-critical paths.
 *
 * `frappe.call` has no timeout. When the radio dies mid-request — the phone
 * locks, the tab is frozen, the AP drops — the browser is free to leave the
 * request hanging with neither a response nor an error, and the promise never
 * settles. Every guard the caller holds while awaiting (a `running` flag, an
 * in-flight dedupe promise, a coordinator's per-trigger promise) is then stuck
 * for the life of the document: the POS looks alive, scrolls, and refuses to
 * load anything ever again.
 *
 * This does NOT cancel the underlying request — it releases the *waiter* so the
 * guard clears and the next attempt can run. A late response is harmless: every
 * one of these calls is a read or an idempotent, claim-guarded drain.
 *
 * @module posapp/utils/requestTimeout
 */

/** Default deadline for a POS background fetch. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

export class RequestTimeoutError extends Error {
	readonly timeoutMs: number;

	readonly label: string;

	constructor(label: string, timeoutMs: number) {
		super(`${label} did not respond within ${timeoutMs}ms`);
		this.name = "RequestTimeoutError";
		this.label = label;
		this.timeoutMs = timeoutMs;
	}
}

export function isRequestTimeoutError(error: unknown): error is RequestTimeoutError {
	return (
		!!error &&
		typeof error === "object" &&
		(error as { name?: string }).name === "RequestTimeoutError"
	);
}

/**
 * Rejects with {@link RequestTimeoutError} when `promise` has not settled in
 * `timeoutMs`. Never leaves a timer behind.
 */
export async function withRequestTimeout<T>(
	promise: Promise<T> | (() => Promise<T>),
	label: string,
	timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			typeof promise === "function" ? promise() : promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new RequestTimeoutError(label, timeoutMs));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer !== null) {
			clearTimeout(timer);
		}
	}
}
