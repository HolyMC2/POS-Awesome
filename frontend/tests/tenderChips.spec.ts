import { describe, expect, it } from "vitest";

import {
	defaultTenderMode,
	mixedIsAvailable,
	resolveArmedTender,
	resolveTenderChips,
	type TenderChip,
	type TenderContext,
	type TenderSelection,
} from "../src/posapp/components/pos/invoice/tenderChips";

/**
 * The tender chosen before the primary action (Riel y Cajón §11 item E).
 *
 * Two things are under test and only one of them carries money.
 * `resolveTenderChips` decides what a register OFFERS — get it wrong and a
 * cashier sees a dead chip or a missing one. `resolveArmedTender` decides what
 * reaches the payment screen as a pre-arm, and a wrong answer there puts the
 * full amount on a Mode of Payment nobody chose. That one is mutation-tested
 * at the bottom of this file.
 */

const CASH = "Efectivo";
const CARD = "Tarjeta";
const WIRE = "Transferencia";

const RETAIL = {
	payments: [
		{ mode_of_payment: CASH, default: 1, type: "Cash" },
		{ mode_of_payment: CARD, default: 0, type: "Bank" },
		{ mode_of_payment: WIRE, default: 0, type: "Bank" },
	],
};

const chipsOf = (profile: unknown) => resolveTenderChips(profile as never);
const modes = (chips: readonly TenderChip[]) => chips.map((chip) => chip.mode);

describe("the chips are the register's own tenders", () => {
	it("renders one chip per configured payment method, in profile order", () => {
		expect(modes(chipsOf(RETAIL))).toEqual([CASH, CARD, WIRE]);
	});

	it("gives a cash-only register ONE chip and no dead siblings", () => {
		// The failure this exists to prevent: a fixed Efectivo/Tarjeta/Transfer
		// row on a carnicería that has only ever taken cash — three controls
		// that do nothing, on the densest row of the screen.
		const chips = chipsOf({ payments: [{ mode_of_payment: CASH, default: 1 }] });
		expect(modes(chips)).toEqual([CASH]);
		expect(mixedIsAvailable(chips)).toBe(false);
	});

	it("carries whatever this shop actually took, not the artboard's four", () => {
		const chips = chipsOf({
			payments: [
				{ mode_of_payment: "MercadoPago Point", default: 1 },
				{ mode_of_payment: "Transferencia BBVA" },
			],
		});
		expect(modes(chips)).toEqual(["MercadoPago Point", "Transferencia BBVA"]);
	});

	it("renders nothing at all when the profile offers no method", () => {
		expect(chipsOf({})).toEqual([]);
		expect(chipsOf(null)).toEqual([]);
		expect(chipsOf({ payments: [] })).toEqual([]);
		expect(chipsOf({ payments: [{ mode_of_payment: "  " }, null] })).toEqual([]);
	});

	it("opens on the profile's default", () => {
		expect(defaultTenderMode(chipsOf(RETAIL))).toBe(CASH);
		expect(
			defaultTenderMode(
				chipsOf({ payments: [{ mode_of_payment: CASH }, { mode_of_payment: CARD, default: 1 }] }),
			),
		).toBe(CARD);
	});

	it("falls back to the first row when no default is flagged", () => {
		// `get_payments()` marks index 0 default before the doc reaches the
		// payment screen, so anything else here would light a chip that
		// disagrees with the method PAY actually opens on.
		expect(defaultTenderMode(chipsOf({ payments: [{ mode_of_payment: CARD }, { mode_of_payment: CASH }] }))).toBe(
			CARD,
		);
	});

	it("drops gift cards, exactly as the payment screen does", () => {
		// Payments.vue's `visiblePaymentMethods` filters them out because a gift
		// card is redeemed by scanning a code in its own section. Arming one
		// would arm a method the payment screen does not list as a card.
		const profile = {
			posa_use_gift_cards: 1,
			payments: [{ mode_of_payment: CASH, default: 1 }, { mode_of_payment: "Gift Card" }],
		};
		expect(modes(chipsOf(profile))).toEqual([CASH]);
		expect(modes(chipsOf({ ...profile, posa_use_gift_cards: 0 }))).toEqual([CASH, "Gift Card"]);
	});

	it("never renders the same tender twice", () => {
		expect(modes(chipsOf({ payments: [{ mode_of_payment: CASH }, { mode_of_payment: CASH }] }))).toEqual([CASH]);
	});

	it("offers MIXED only where there is something to mix", () => {
		expect(mixedIsAvailable(chipsOf(RETAIL))).toBe(true);
		expect(mixedIsAvailable([])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The guard.
// ---------------------------------------------------------------------------

const CHIPS = chipsOf(RETAIL);
const SELLING: TenderContext = { cartHasItems: true, isReturn: false };

interface GuardCase {
	name: string;
	selection: TenderSelection;
	chips: readonly TenderChip[];
	context: TenderContext;
	expected: string | null;
}

/**
 * The contract, as a table, because the mutation harness below re-runs every
 * mutant against this same list. A case that no mutant fails is a case with no
 * discriminating power, and the harness says so.
 */
const CASES: readonly GuardCase[] = [
	{ name: "untouched arms the register's default", selection: undefined, chips: CHIPS, context: SELLING, expected: CASH },
	{ name: "a chosen tender arms itself", selection: CARD, chips: CHIPS, context: SELLING, expected: CARD },
	{ name: "MIXED arms nothing", selection: null, chips: CHIPS, context: SELLING, expected: null },
	{
		// The staleness case with money behind it: the profile reloaded and the
		// method the cashier picked is gone. Arming the DEFAULT instead would
		// substitute a tender they never chose, silently, on a real invoice.
		name: "a tender the register no longer offers arms nothing",
		selection: "Vale de despensa",
		chips: CHIPS,
		context: SELLING,
		expected: null,
	},
	{
		// `mode_of_payment` is a document name. A folded comparison would arm a
		// Mode of Payment that does not exist and the payment screen would fall
		// back without saying why.
		name: "a near-miss spelling arms nothing",
		selection: "efectivo",
		chips: CHIPS,
		context: SELLING,
		expected: null,
	},
	{ name: "a padded name arms nothing", selection: ` ${CARD}`, chips: CHIPS, context: SELLING, expected: null },
	{
		name: "a refund is not a tender choice",
		selection: CARD,
		chips: CHIPS,
		context: { cartHasItems: true, isReturn: true },
		expected: null,
	},
	{
		// The leak between customers: the ticket is gone, so the tender chosen
		// for it must not still be armed when the next one starts.
		name: "an empty cart arms nothing",
		selection: CARD,
		chips: CHIPS,
		context: { cartHasItems: false, isReturn: false },
		expected: null,
	},
	{ name: "a register with no tenders arms nothing", selection: CARD, chips: [], context: SELLING, expected: null },
];

describe("what is allowed to reach the payment screen", () => {
	it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
		expect(resolveArmedTender(testCase.selection, testCase.chips, testCase.context)).toBe(testCase.expected);
	});

	it("survives a register that has been left with no tender configured", () => {
		// Deliberately outside the mutation table below: with no chips, every
		// path already falls through the membership check, so no mutant can
		// distinguish this case and including it would make the table's own
		// "every case earns its place" assertion pass on a case that proves
		// nothing. It is still worth asserting that it does not throw.
		expect(resolveArmedTender(undefined, [], SELLING)).toBeNull();
		expect(resolveArmedTender(null, [], SELLING)).toBeNull();
	});

	it("only ever arms a tender the register offers", () => {
		// The property behind every case above, stated once: whatever comes out
		// is either null or a mode that is on screen. Nothing else can reach
		// `initializePaymentLinesForDialog`.
		const attempts: TenderSelection[] = [undefined, null, CASH, CARD, WIRE, "efectivo", "Vale", ""];
		for (const attempt of attempts) {
			for (const context of [SELLING, { cartHasItems: false, isReturn: false }, { cartHasItems: true, isReturn: true }]) {
				const armed = resolveArmedTender(attempt, CHIPS, context);
				if (armed !== null) {
					expect(modes(CHIPS)).toContain(armed);
				}
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Mutation test.
// ---------------------------------------------------------------------------

type Guard = (_s: TenderSelection, _c: readonly TenderChip[], _x: TenderContext) => string | null;

/**
 * Each mutant is a plausible weakening someone could actually write — not a
 * random operator flip. The assertion is that the case table above KILLS every
 * one of them, which is the only evidence that the table tests the guard
 * rather than merely exercising it.
 */
const MUTANTS: ReadonlyArray<readonly [string, Guard]> = [
	[
		"trusts the selection without checking it is still offered",
		(selection, chips, context) => {
			if (context.isReturn) return null;
			if (!context.cartHasItems) return null;
			if (selection === null) return null;
			if (selection === undefined) return defaultTenderMode(chips);
			return selection;
		},
	],
	[
		"compares tender names case-insensitively",
		(selection, chips, context) => {
			if (context.isReturn) return null;
			if (!context.cartHasItems) return null;
			if (selection === null) return null;
			if (selection === undefined) return defaultTenderMode(chips);
			const hit = chips.find((chip) => chip.mode.toLowerCase() === String(selection).trim().toLowerCase());
			return hit ? hit.mode : null;
		},
	],
	[
		"substitutes the default when the chosen tender is gone",
		(selection, chips, context) => {
			if (context.isReturn) return null;
			if (!context.cartHasItems) return null;
			if (selection === null) return null;
			if (selection === undefined) return defaultTenderMode(chips);
			return chips.some((chip) => chip.mode === selection) ? selection : defaultTenderMode(chips);
		},
	],
	[
		"arms a refund",
		(selection, chips, context) => {
			if (!context.cartHasItems) return null;
			if (selection === null) return null;
			if (selection === undefined) return defaultTenderMode(chips);
			return chips.some((chip) => chip.mode === selection) ? selection : null;
		},
	],
	[
		"keeps the arm alive across an emptied cart",
		(selection, chips, context) => {
			if (context.isReturn) return null;
			if (selection === null) return null;
			if (selection === undefined) return defaultTenderMode(chips);
			return chips.some((chip) => chip.mode === selection) ? selection : null;
		},
	],
	[
		"treats MIXED as untouched and re-lights the default",
		(selection, chips, context) => {
			if (context.isReturn) return null;
			if (!context.cartHasItems) return null;
			if (selection === null || selection === undefined) return defaultTenderMode(chips);
			return chips.some((chip) => chip.mode === selection) ? selection : null;
		},
	],
	[
		"inverts the empty-cart guard",
		(selection, chips, context) => {
			if (context.isReturn) return null;
			if (context.cartHasItems) return null;
			if (selection === null) return null;
			if (selection === undefined) return defaultTenderMode(chips);
			return chips.some((chip) => chip.mode === selection) ? selection : null;
		},
	],
];

describe("mutation — the case table kills every weakening of the guard", () => {
	it.each(MUTANTS.map(([name, guard]) => [name, guard] as const))("kills a guard that %s", (_name, mutant) => {
		const survived = CASES.filter(
			(testCase) => mutant(testCase.selection, testCase.chips, testCase.context) === testCase.expected,
		);
		expect(
			survived.length,
			"this mutant passes every case above, so the table does not actually test the guard",
		).toBeLessThan(CASES.length);
	});

	it("every case earns its place by killing at least one mutant", () => {
		// The inverse check. A case no mutant fails is decoration, and
		// decoration in a money guard's suite is how a suite stays green
		// through a regression.
		const idle = CASES.filter((testCase) =>
			MUTANTS.every(([, mutant]) => mutant(testCase.selection, testCase.chips, testCase.context) === testCase.expected),
		).map((testCase) => testCase.name);
		expect(idle).toEqual([]);
	});
});
