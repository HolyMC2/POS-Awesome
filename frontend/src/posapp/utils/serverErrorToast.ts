/**
 * Shared parser for Frappe error envelopes + toast emitter.
 *
 * Replaces the swallow pattern that lived in many `.catch((err) => {
 * console.error(...) })` sites across the SPA. Closing a shift was
 * the most visible victim (operator never learned why the button did
 * nothing) but the same shape applies to submit-sales-order,
 * create-customer, submit-payment, etc. — every user-action mutation
 * deserves the operator's eyes.
 *
 * Public surface:
 *   - extractServerErrorMessage(err)   → string
 *   - showServerErrorToast(err, title) → void (uses toastStore)
 *
 * Why a separate util:
 *   - `services/api.ts` already has `extractServerMessage` for its
 *     own internal envelope normaliser. Duplicating the parser
 *     across catches led to drift. This util is the canonical one.
 */

import { useToastStore } from "../stores/toastStore.js";

export interface ServerErrorLike {
	message?: string;
	exc?: string;
	exc_type?: string;
	_server_messages?: string;
	responseJSON?: {
		_server_messages?: string;
		message?: string;
		exc?: string;
	};
}

export function extractServerErrorMessage(err: unknown): string {
	const anyErr = err as ServerErrorLike | undefined;
	if (!anyErr) return "Request failed.";

	// 1. Frappe's _server_messages envelope is the gold standard for
	//    user-facing exception text. Format is a JSON-encoded array
	//    of stringified `{message, title, indicator, ...}` objects.
	const sm = anyErr._server_messages || anyErr.responseJSON?._server_messages;
	if (sm) {
		try {
			const parsed = JSON.parse(sm);
			if (Array.isArray(parsed) && parsed.length) {
				const first = parsed[0];
				const obj = typeof first === "string" ? JSON.parse(first) : first;
				const msg = (obj?.message || obj?.title || String(first || "")) as string;
				if (msg) return stripHtml(msg);
			}
		} catch {
			// Malformed envelope — fall through to plain .message.
		}
	}

	// 2. Plain .message (Frappe sometimes throws Error directly when
	//    the request never reached the backend, e.g. network drop).
	if (anyErr.message) return stripHtml(anyErr.message);
	if (anyErr.responseJSON?.message) {
		return stripHtml(anyErr.responseJSON.message);
	}

	// 3. Stack trace (.exc) is internal-only. Don't show full trace
	//    to operator; surface the first line which is usually the
	//    Python exception class + message.
	const exc = anyErr.exc || anyErr.responseJSON?.exc;
	if (exc) {
		const lines = exc.split("\n").filter((line: string) => line.trim());
		const last = lines[lines.length - 1] || lines[0];
		if (last) return stripHtml(last.replace(/^.*Exception:\s*/i, "").trim());
	}

	// 4. Last resort.
	return String(err).slice(0, 280);
}

function stripHtml(s: string): string {
	// Frappe error messages frequently embed <strong>, <br>, <a> for
	// Desk-side rendering. The Vuetify snackbar treats children as
	// plain text, so the tags render as escaped angle brackets. Strip
	// them; keep the readable text.
	return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Convenience emitter — extracts the message, then pushes an
 * error-coloured toast with a longer-than-default 12s timeout so the
 * operator has time to read.
 *
 * Always pair with `console.error(action, err)` BEFORE the call so
 * the stack trace lands in the browser console for engineer triage.
 */
export function showServerErrorToast(
	err: unknown,
	title: string,
	options: { timeout?: number; color?: string; key?: string } = {},
): void {
	const toastStore = useToastStore();
	const message = extractServerErrorMessage(err);
	toastStore.show({
		title,
		message,
		color: options.color ?? "error",
		timeout: options.timeout ?? 12000,
		key: options.key,
	});
}
