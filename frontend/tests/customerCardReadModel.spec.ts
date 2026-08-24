import { describe, expect, it } from "vitest";

import {
	cashbackPercentOf,
	isContactableCustomer,
	makeDayLabel,
	movementLabelKey,
	normalizeCashbackPreview,
	normalizeWallet,
	resolveMovementKind,
	signedAmount,
	storyTotals,
	todayKey,
} from "../src/posapp/components/pos/customer/customerCard";

/**
 * The customer card's read model.
 *
 * No jsdom and no mount: the module is pure on purpose, and what is worth
 * pinning here is the MAPPING — which wire spellings become which row, which
 * direction a figure points, and what the view is handed when the server says
 * something this code has never seen. Every one of those is a rendering bug
 * that only shows up with a customer at the counter.
 */

const identity = (key: string) => key;

describe("what the wallet endpoint sends becomes what the card draws", () => {
	it("reads a balance and its provenance", () => {
		const wallet = normalizeWallet({
			balance: 418,
			deposited: 390,
			cashback_value: 28,
			enrolled: true,
			program: "CASHBACK-DOCO",
			program_name: "Cashback Doco",
			cashback_percent: 3,
			movements: [],
			cap: 15,
		});
		expect(wallet).toMatchObject({
			balance: 418,
			deposited: 390,
			cashbackValue: 28,
			enrolled: true,
			programName: "Cashback Doco",
			cashbackPercent: 3,
			cap: 15,
		});
	});

	it("refuses a payload with no balance rather than drawing a zero", () => {
		// `walletSummary.ts`'s rule, restated one level up: a zero we invented
		// is indistinguishable from a zero we read, and the customer is
		// standing there. `null` means the card is not drawn at all.
		expect(normalizeWallet({ movements: [] })).toBeNull();
		expect(normalizeWallet(null)).toBeNull();
		expect(normalizeWallet("nope")).toBeNull();
	});

	it("treats a programme name as enrolment when no flag was sent", () => {
		expect(normalizeWallet({ balance: 0, loyalty_program: "CB" })?.enrolled).toBe(true);
		expect(normalizeWallet({ balance: 0 })?.enrolled).toBe(false);
	});

	it("believes an explicit flag over a programme name", () => {
		// A customer can be attached to a programme the register does not run;
		// the server is the one that knows, and its answer wins.
		expect(normalizeWallet({ balance: 0, enrolled: false, program: "CB" })?.enrolled).toBe(false);
	});
});

describe("a ledger row points the way the thing that happened points", () => {
	it("resolves the spellings the ledger's three sources use", () => {
		expect(resolveMovementKind("deposit")).toBe("deposit");
		expect(resolveMovementKind("top_up")).toBe("deposit");
		expect(resolveMovementKind("redeem")).toBe("redemption");
		expect(resolveMovementKind("points_earned")).toBe("cashback_earned");
		expect(resolveMovementKind("credit_note")).toBe("credit_note");
		expect(resolveMovementKind("")).toBeNull();
	});

	it("signs a bare figure by what happened, and keeps a signed one", () => {
		// The two conventions a server can pick, both landing on the same row.
		expect(signedAmount("redemption", 120)).toBe(-120);
		expect(signedAmount("redemption", -120)).toBe(-120);
		expect(signedAmount("deposit", 200)).toBe(200);
		expect(signedAmount("cashback_spent", 10)).toBe(-10);
	});

	it("still renders a kind it has never seen", () => {
		// Rule 3. The ledger is assembled from three ERPNext sources and a shop
		// can add a fourth; dropping the row would hide exactly the movement
		// somebody cared enough to record.
		const wallet = normalizeWallet({
			balance: 10,
			movements: [{ ts: "2026-08-18 11:00:00", kind: "layaway_forfeit", amount: 5, detail: "Apartado" }],
		});
		expect(wallet?.movements).toHaveLength(1);
		expect(wallet?.movements[0]).toMatchObject({
			kind: null,
			labelKey: "Movement",
			detail: "Apartado",
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
			"cashback_earned",
			"cashback_spent",
			"credit_note",
			"adjustment",
		] as const) {
			expect(movementLabelKey(kind)).not.toBe("Movement");
		}
	});
});

describe("the cashback rate is printed only when it is known", () => {
	it("prefers the explicit percent", () => {
		expect(cashbackPercentOf({ cashback_percent: 3, cashback_rate: 0.03 })).toBe(3);
	});

	it("reads a fraction as a percent", () => {
		expect(cashbackPercentOf({ cashback_rate: 0.03 })).toBe(3);
	});

	it("says nothing rather than 0 %", () => {
		expect(cashbackPercentOf({})).toBeNull();
		expect(cashbackPercentOf({ cashback_rate: 0 })).toBeNull();
	});
});

describe("the accrual preview is a server figure or it is absent", () => {
	it("takes the value the server computed", () => {
		expect(normalizeCashbackPreview({ points: 15, value: 15 })).toEqual({ points: 15, value: 15 });
	});

	it("renders nothing for a zero accrual", () => {
		// A line saying "acumula $0.00" is worse than no line: it reads as a
		// programme that is broken rather than as a purchase too small to earn.
		expect(normalizeCashbackPreview({ points: 0, value: 0 })).toBeNull();
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
