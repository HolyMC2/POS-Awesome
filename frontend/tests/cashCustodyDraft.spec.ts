// @vitest-environment jsdom

/**
 * The storage rules for an unsent cash form, away from the screen that uses it.
 *
 * Two things must hold no matter what the UI does: a draft belongs to exactly
 * one user + register + shift, and damaged saved work is reported rather than
 * quietly replaced. The submitted-command recovery records in `api.ts` live
 * under a different prefix and are never touched from here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearDraft,
	draftKey,
	readDraft,
	writeDraft,
} from "../src/posapp/components/pos/custody/draft";

const draft = (over: Record<string, any> = {}) => ({
	action: "drop",
	bag: null,
	cash_count: null,
	seal: "DOCO-TAK-9",
	purpose: "Takings",
	note: "Sealed before the bank run",
	reference: "",
	count: { source: "manual", amount: "250", reason: "", denominations: [] },
	saved_at: "2026-09-15 20:10:00",
	...over,
});

beforeEach(() => {
	localStorage.clear();
});

describe("cash custody unsent-form storage", () => {
	it("scopes the form to the user, the register and the open shift", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		writeDraft(key, draft());
		expect(readDraft(key)).toEqual({ state: "draft", draft: draft() });
		expect(
			readDraft(
				draftKey("other@doco.mx", "Doco Ventas", "POS-OPEN-0009")!,
			),
		).toEqual({ state: "empty" });
		expect(
			readDraft(draftKey("cashier@doco.mx", "Mumu", "POS-OPEN-0009")!),
		).toEqual({ state: "empty" });
		expect(
			readDraft(
				draftKey("cashier@doco.mx", "Doco Ventas", "POS-OPEN-0010")!,
			),
		).toEqual({ state: "empty" });
	});

	it("refuses to key work that has no signed-in user or no register", () => {
		expect(draftKey("", "Doco Ventas", "POS-OPEN-0009")).toBeNull();
		expect(draftKey("cashier@doco.mx", null, "POS-OPEN-0009")).toBeNull();
		// A supervisor task without a drawer still gets its own bucket.
		expect(draftKey("boss@doco.mx", "Doco Ventas", null)).toBe(
			"cash-custody-draft:boss@doco.mx:Doco Ventas:no-shift",
		);
	});

	it("stays clear of the submitted-request recovery records", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		const request = "cash-custody-request:cashier@doco.mx:Doco Ventas:drop";
		localStorage.setItem(request, '{"body":"{}","request_id":"x"}');
		writeDraft(key, draft());
		clearDraft(key);
		expect(key.startsWith("cash-custody-request:")).toBe(false);
		expect(localStorage.getItem(request)).toBe(
			'{"body":"{}","request_id":"x"}',
		);
	});

	it("reports damaged or reshaped work instead of discarding it", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		for (const raw of [
			"{damaged",
			"[]",
			JSON.stringify(draft({ action: "" })),
			JSON.stringify(draft({ count: "250" })),
			JSON.stringify(draft({ note: 7 })),
			// A reshaped count reaches the counter and the money arithmetic
			// directly, so it is damage, not a correctable typo.
			JSON.stringify(draft({ count: { denominations: {} } })),
			JSON.stringify(
				draft({
					count: { denominations: [{ value: "x", quantity: 2 }] },
				}),
			),
			JSON.stringify(
				draft({
					count: { denominations: [{ value: 200, quantity: {} }] },
				}),
			),
			JSON.stringify(draft({ count: { source: "guess" } })),
			JSON.stringify(draft({ count: { amount: { evil: true } } })),
		]) {
			localStorage.setItem(key, raw);
			expect(readDraft(key)).toEqual({ state: "unreadable" });
			expect(localStorage.getItem(key)).toBe(raw);
		}
	});

	it("keeps a half-typed total exactly as the cashier left it", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		// "12," is a correction the cashier still has to make on screen. The
		// storage layer must not decide it is damage and hide the whole form.
		for (const count of [
			{ source: "manual", amount: "12,", reason: "", denominations: [] },
			{ source: "manual", amount: 1250.5, reason: "Jammed counter" },
			{
				source: "denominations",
				denominations: [{ value: 200, quantity: 3 }],
			},
			{},
		]) {
			writeDraft(key, draft({ count }));
			expect(readDraft(key)).toEqual({
				state: "draft",
				draft: draft({ count }),
			});
		}
	});

	it("reports unreadable storage rather than claiming there is no saved work", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		const getItem = vi
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new DOMException("Denied", "SecurityError");
			});
		expect(readDraft(key)).toEqual({ state: "unreadable" });
		getItem.mockRestore();
	});

	it("lets the caller see that finished work could not be removed", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		writeDraft(key, draft());
		expect(clearDraft(key)).toBe(true);
		expect(readDraft(key)).toEqual({ state: "empty" });
		const removeItem = vi
			.spyOn(Storage.prototype, "removeItem")
			.mockImplementation(() => {
				throw new DOMException("Denied", "SecurityError");
			});
		expect(clearDraft(key)).toBe(false);
		removeItem.mockRestore();
	});

	it("surfaces a browser that refuses to keep the work", () => {
		const key = draftKey(
			"cashier@doco.mx",
			"Doco Ventas",
			"POS-OPEN-0009",
		)!;
		const setItem = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			});
		expect(() => writeDraft(key, draft())).toThrow();
		setItem.mockRestore();
	});
});
