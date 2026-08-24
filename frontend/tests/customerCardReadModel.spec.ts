import { describe, expect, it } from "vitest";

import {
	isContactableCustomer,
	makeDayLabel,
	makeMonthYearLabel,
	movementLabelKey,
	normalizeCashbackPreview,
	normalizeWallet,
	resolveMovementKind,
	storyTotals,
	todayKey,
} from "../src/posapp/components/pos/customer/customerCard";

/**
 * The customer card's read model.
 *
 * No jsdom and no mount: the module is pure on purpose, and what is worth
 * pinning here is the MAPPING — which wire key becomes which row, which
 * direction a figure points, and what the view is handed when the server says
 * something this code has never seen. Every one of those is a rendering bug
 * that only shows up with a customer at the counter.
 *
 * The fixture below is `stored_value.get_customer_wallet`'s payload as it
 * actually goes over the wire, GROUPED OBJECTS INCLUDED. Those objects are the
 * point: they carry the same three facts under keys like `stored_value` and
 * `cashback`, and a reader that reached for one as a number would render a
 * blank card rather than fail. Copying the real shape is the only way that
 * assertion means anything.
 */

const identity = (key: string) => key;

const WIRE = {
	customer: "FINRECON Cliente",
	company: "Doco",
	balance: 200.0,
	deposited: 200.0,
	cashback_value: 14.0,
	enrolled: true,
	program: "Cashback Doco",
	program_name: "Cashback Doco",
	cashback_percent: 10.0,
	points: 7,
	cap: 40,
	truncated: false,
	movements: [
		{
			kind: "deposit",
			type: "deposit",
			label: "Deposit",
			detail: "Deposit",
			amount: 200.0,
			ts: "2026-08-18 11:04:22.113000",
			posting_date: "2026-08-18",
			creation: "2026-08-18 11:04:22.113000",
			reference: "ACC-PAY-2026-00031",
			reference_doctype: "Payment Entry",
			reference_name: "ACC-PAY-2026-00031",
			cashier: "vanessa@doco.mx",
			mode_of_payment: "Efectivo",
		},
		{
			kind: "redemption",
			type: "redemption",
			label: "Paid with wallet",
			detail: "Paid with wallet",
			amount: -60.0,
			ts: "2026-08-18 12:40:02.900000",
			posting_date: "2026-08-18",
			creation: "2026-08-18 12:40:02.900000",
			reference: "ACC-SINV-2026-00214",
			reference_doctype: "Sales Invoice",
			reference_name: "ACC-SINV-2026-00214",
			cashier: "vanessa@doco.mx",
		},
		{
			kind: "cashback",
			type: "cashback",
			label: "Cashback earned",
			detail: "Cashback earned",
			amount: 24.0,
			ts: "2026-08-18 12:40:03.100000",
			posting_date: "2026-08-18",
			creation: "2026-08-18 12:40:03.100000",
			reference: "ACC-SINV-2026-00214",
			reference_doctype: "Sales Invoice",
			reference_name: "ACC-SINV-2026-00214",
			cashier: "vanessa@doco.mx",
			points: 12,
		},
	],
	stored_value: { balance: 200.0, source_count: 1, sources: [{ total_credit: 200.0 }] },
	cashback: {
		enrolled: true,
		program: "Cashback Doco",
		points: 7,
		value: 14.0,
		conversion_factor: 2.0,
		percent: 10.0,
	},
	movements_limit: 40,
	movements_truncated: false,
};

describe("the monedero and the cashback stay two figures", () => {
	it("keeps them apart, and offers no third one to add them into", () => {
		// The guardrail, at the level where it can actually be enforced. A
		// customer holding $200 of monedero and $14 of cashback cannot hand
		// over $214, so there is deliberately no `total` on this object for a
		// caller to reach for.
		const wallet = normalizeWallet(WIRE)!;
		expect(wallet.balance).toBe(200);
		expect(wallet.cashbackValue).toBe(14);
		expect(wallet.points).toBe(7);
		expect(Object.keys(wallet)).not.toContain("total");
		expect(Object.values(wallet)).not.toContain(214);
	});

	it("never reads a grouped object as a figure", () => {
		// `stored_value` and `cashback` are OBJECTS on this payload. `Number({})`
		// is NaN rather than a throw, so a misread surfaces as a blank card
		// nobody can trace — which is why the coercion refuses objects outright.
		const wallet = normalizeWallet({ ...WIRE, cashback_value: undefined })!;
		expect(wallet.cashbackValue).toBe(0);
		expect(Number.isNaN(wallet.cashbackValue)).toBe(false);

		// And the same for the headline: an object where the balance should be
		// is an unreadable wallet, not a wallet worth NaN.
		expect(normalizeWallet({ ...WIRE, balance: { balance: 200 } })).toBeNull();
	});

	it("refuses a payload with no balance rather than drawing a zero", () => {
		// `walletSummary.ts`'s rule, restated one level up: a zero we invented
		// is indistinguishable from a zero we read, and the customer is
		// standing there. `null` means the card is not drawn at all.
		expect(normalizeWallet({ movements: [] })).toBeNull();
		expect(normalizeWallet(null)).toBeNull();
		expect(normalizeWallet("nope")).toBeNull();
	});

	it("reads enrolment from the flag the server sends", () => {
		expect(normalizeWallet(WIRE)?.enrolled).toBe(true);
		expect(normalizeWallet({ ...WIRE, enrolled: false })?.enrolled).toBe(false);
	});
});

describe("a ledger row points the way the server says it points", () => {
	const rows = normalizeWallet(WIRE)!.movements;

	it("prints the server's sign verbatim", () => {
		// The client does NOT re-derive the sign from the kind any more. It
		// used to, as a safety net; the net became a hazard the moment the
		// convention was settled, because a legitimately positive redemption —
		// a reversal — would have been flipped into a debit by a client
		// second-guessing the ledger.
		expect(rows.map((row) => row.amount)).toEqual([200, -60, 24]);
		expect(normalizeWallet({ balance: 0, movements: [{ kind: "redemption", amount: 60 }] })
			?.movements[0]?.amount).toBe(60);
	});

	it("uses the canonical vocabulary and nothing else", () => {
		expect(rows.map((row) => row.kind)).toEqual(["deposit", "redemption", "cashback"]);
		expect(resolveMovementKind("cashback_spent")).toBe("cashback_spent");
		expect(resolveMovementKind("credit_note")).toBe("credit_note");
		// The spellings that were accepted while the endpoint was being written
		// are gone: one key, one meaning.
		expect(resolveMovementKind("monedero_payment")).toBeNull();
		expect(resolveMovementKind("cashback_earned")).toBeNull();
		expect(resolveMovementKind("")).toBeNull();
	});

	it("says what happened in the register's own words, not the server's", () => {
		// The server sends `label`/`detail` already translated. Rendering those
		// beside this key would print «Depósito · Depósito», and a string built
		// inside a Python `frappe._()` is invisible to the translation scan.
		expect(rows[0]?.labelKey).toBe("Deposit");
		expect(rows[1]?.labelKey).toBe("Paid with the wallet");
		expect(rows[2]?.labelKey).toBe("Cashback");
	});

	it("keeps the tender as the row's detail, and nothing else", () => {
		expect(rows[0]?.detail).toBe("Efectivo");
		expect(rows[1]?.detail).toBeNull();
		expect(rows[2]?.detail).toBeNull();
	});

	it("dates the row from `ts`, the instant it was recorded", () => {
		expect(rows.map((row) => row.day)).toEqual(["2026-08-18", "2026-08-18", "2026-08-18"]);
	});

	it("still renders a kind it has never seen", () => {
		// Rule 3. The ledger is assembled from four ERPNext sources and a shop
		// can add a fifth; dropping the row would hide exactly the movement
		// somebody cared enough to record.
		const wallet = normalizeWallet({
			balance: 10,
			movements: [{ ts: "2026-08-18 11:00:00", kind: "layaway_forfeit", amount: 5 }],
		});
		expect(wallet?.movements).toHaveLength(1);
		expect(wallet?.movements[0]).toMatchObject({
			kind: null,
			labelKey: "Movement",
			amount: 5,
			day: "2026-08-18",
		});
	});

	it("drops a row with no figure, because the column is figures", () => {
		const wallet = normalizeWallet({
			balance: 10,
			movements: [{ ts: "2026-08-18", kind: "deposit" }, { ts: "2026-08-18", kind: "deposit", amount: 5 }],
		});
		expect(wallet?.movements).toHaveLength(1);
	});

	it("names every kind it claims to know", () => {
		for (const kind of [
			"deposit",
			"redemption",
			"cashback",
			"cashback_spent",
			"credit_note",
			"adjustment",
		] as const) {
			expect(movementLabelKey(kind)).not.toBe("Movement");
		}
	});
});

describe("the cashback rate is a percent, printed only when it is known", () => {
	it("takes the percent as sent — 1 means one per cent", () => {
		// The ambiguity is gone: the server computes
		// conversion_factor / collection_factor × 100 and never sends a
		// fraction, so nothing here reinterprets a small number.
		expect(normalizeWallet(WIRE)?.cashbackPercent).toBe(10);
		expect(normalizeWallet({ ...WIRE, cashback_percent: 1 })?.cashbackPercent).toBe(1);
	});

	it("says nothing rather than 0 %", () => {
		// `null` when either factor is missing — a chip reading «Cashback 0 %»
		// describes a programme that does not pay.
		expect(normalizeWallet({ ...WIRE, cashback_percent: null })?.cashbackPercent).toBeNull();
		expect(normalizeWallet({ ...WIRE, cashback_percent: 0 })?.cashbackPercent).toBeNull();
	});
});

describe("the accrual preview is a server figure or it is absent", () => {
	it("takes the value the server computed", () => {
		expect(normalizeCashbackPreview({ points: 15, value: 15 })).toEqual({ points: 15, value: 15 });
	});

	it("renders nothing for an unenrolled customer's zero", () => {
		// The endpoint answers `{enrolled: false, points: 0, value: 0}` rather
		// than refusing, so "no accrual" and "no answer" arrive as the same
		// `null` here — which is what the caller wants, because both mean the
		// line is absent.
		expect(normalizeCashbackPreview({ enrolled: false, points: 0, value: 0 })).toBeNull();
		expect(normalizeCashbackPreview(null)).toBeNull();
	});
});

describe("the walk-in identity is not a contact", () => {
	it("refuses the register's own default customer", () => {
		expect(isContactableCustomer("Público en General", "Público en General")).toBe(false);
	});

	it("matches on identity rather than on the words", () => {
		// A shop that renamed its default is still refused; a real customer who
		// happens to be called that on ANOTHER register is not.
		expect(isContactableCustomer("Mostrador", "Mostrador")).toBe(false);
		expect(isContactableCustomer("Público en General", "Mostrador")).toBe(true);
	});

	it("refuses an empty ticket", () => {
		expect(isContactableCustomer("", "Mostrador")).toBe(false);
		expect(isContactableCustomer(null, null)).toBe(false);
	});

	it("allows any customer on a register with no default at all", () => {
		expect(isContactableCustomer("CUST-0001", "")).toBe(true);
	});
});

describe("the totals row is read off the rows beneath it", () => {
	const events = [
		{ ts: "2026-08-23 12:40:00", kind: "billing", topic: "invoiced", amount: 348 },
		{ ts: "2026-07-29 10:00:00", kind: "billing", topic: "invoiced", amount: 92 },
		{ ts: "2026-08-11 09:00:00", kind: "billing", topic: "returned", amount: 40 },
		{ ts: "2026-08-11 09:00:00", kind: "payment", topic: "advance", amount: 600 },
	];

	it("counts purchases and sums them", () => {
		expect(storyTotals(events)).toEqual({ purchases: 2, total: 440, lastDay: "2026-08-23" });
	});

	it("leaves a credit note out of both figures", () => {
		// A return is the customer un-buying something. Folding it in either
		// direction makes "23 compras" a figure nobody can reproduce by
		// counting the rows on screen.
		const onlyReturns = storyTotals([{ ts: "2026-08-11", kind: "billing", topic: "returned", amount: 40 }]);
		expect(onlyReturns).toEqual({ purchases: 0, total: 0, lastDay: "" });
	});

	it("survives an empty window", () => {
		expect(storyTotals([])).toEqual({ purchases: 0, total: 0, lastDay: "" });
	});
});

describe("a day is read off the string, never through new Date(day)", () => {
	const label = makeDayLabel(identity, () => new Date(2026, 7, 23, 9, 30));

	it("says «today» for today", () => {
		expect(label(todayKey(new Date(2026, 7, 23)))).toBe("Today");
	});

	it("renders an older day as a number and a month KEY", () => {
		// The key, not a formatted month: the register's language is the
		// tenant's, and `Intl` would print the operator's laptop locale.
		expect(label("2026-08-18")).toBe("18 aug");
	});

	it("does not slip a day west of Greenwich", () => {
		// `new Date("2026-08-01")` is UTC midnight and renders as 31 jul in
		// every Mexican timezone. Reading the text cannot do that.
		expect(label("2026-08-01")).toBe("1 aug");
	});

	it("prints a dash rather than an invented date", () => {
		expect(label("")).toBe("—");
	});
});

describe("«cliente desde» is a month and a year", () => {
	const since = makeMonthYearLabel(identity);

	it("drops the day, which nobody is asking about", () => {
		expect(since("2025-03-14 09:12:44.201000")).toBe("mar 2025");
	});

	it("is empty on a server that does not send `creation`", () => {
		// Older tenants: the phrase is absent rather than invented.
		expect(since("")).toBe("");
		expect(since("not a date")).toBe("");
	});
});
