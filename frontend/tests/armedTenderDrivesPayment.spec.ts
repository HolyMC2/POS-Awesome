import { afterEach, describe, expect, it } from "vitest";

import {
	applyArmedPaymentPreference,
	resolveArmedPaymentLine,
	type ArmedPreferenceContext,
} from "../src/posapp/components/pos/payments/armedTenderPreselect";
import {
	armTender,
	peekArmedTender,
	resetTenderSelection,
	revalidateArmedTender,
} from "../src/posapp/components/pos/invoice/armedTender";
import { resolveTenderChips } from "../src/posapp/components/pos/invoice/tenderChips";
import {
	initializePaymentLinesForDialog,
	resolvePreferredPaymentLine,
	type PaymentLine,
} from "../src/posapp/utils/paymentInitialization";

/**
 * The owner's second symptom, as a test: *"the sales view payment method
 * doesn't drive the payment view, is always pick cash first even if you select
 * another payment method."*
 *
 * `tests/cobroArmedTender.spec.ts` already proved the RESOLVER answers
 * `Tarjeta`. It passed the whole time the register opened on `Efectivo`,
 * because nothing called it — which is exactly why this file exists and why
 * it runs the real production chain end to end rather than the resolver alone:
 *
 *     resolveTenderChips → armTender (the strip's own guard)
 *       → peekArmedTender → applyArmedPaymentPreference
 *         → resolvePreferredPaymentLine / initializePaymentLinesForDialog
 *
 * Every link is the shipped module. If any one of them stops honouring the
 * arm, the assertions below fail — including the one that matters most, which
 * is not "the badge moved" but "the full amount landed on the line the cashier
 * chose". A pre-selection that moved the badge and left the money on Efectivo
 * would be a split nobody asked for, and it would look fixed.
 *
 * `Payments.vue` cannot be imported under jsdom (build plan §10), so the
 * one-line CALL is pinned by source scan in `payViewWiring.spec.ts`. This file
 * owns the behaviour behind it.
 */

const CASH = "Efectivo";
const CARD = "Tarjeta";
const WIRE = "Transferencia";

const PROFILE = {
	payments: [
		{ mode_of_payment: CASH, default: 1, type: "Cash" },
		{ mode_of_payment: CARD, default: 0, type: "Bank" },
		{ mode_of_payment: WIRE, default: 0, type: "Bank" },
	],
};

const SELLING = { cartHasItems: true, isReturn: false };

/** `get_payments` hands the payment screen the profile's lines, amounts at 0. */
const invoicePayments = (): PaymentLine[] => [
	{ mode_of_payment: CASH, default: 1, amount: 0, base_amount: 0, type: "Cash" },
	{ mode_of_payment: CARD, default: 0, amount: 0, base_amount: 0, type: "Bank" },
	{ mode_of_payment: WIRE, default: 0, amount: 0, base_amount: 0, type: "Bank" },
];

const isCashLike = (payment: PaymentLine) => payment.type === "Cash";

/**
 * The payment screen opening, in the order `ensurePaymentLinesInitialized`
 * runs it: the arm moves `default`, then the untouched initialiser fills the
 * amount on whichever line now carries it.
 */
const openPaymentScreen = (
	payments: PaymentLine[],
	context: ArmedPreferenceContext = {},
	total = 559,
) => {
	applyArmedPaymentPreference(payments, peekArmedTender(), context);
	const doc = { payments, rounded_total: total, grand_total: total, conversion_rate: 1, ...context };
	const preferred = initializePaymentLinesForDialog(doc, 2, isCashLike);
	return {
		/** The line the screen opens on — the `Default` badge and the pre-fill. */
		opensOn: preferred?.mode_of_payment ?? null,
		/** Where the money actually is, by mode. */
		amounts: Object.fromEntries(payments.map((p) => [p.mode_of_payment, p.amount])),
		/** Exactly one line may claim the flag every consumer reads. */
		defaults: payments.filter((p) => p.default === 1).map((p) => p.mode_of_payment),
	};
};

afterEach(() => {
	resetTenderSelection();
});

describe("an armed tender opens the payment screen on that tender", () => {
	it("opens on Tarjeta when Tarjeta was armed, with the whole amount on it", () => {
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);

		const result = openPaymentScreen(invoicePayments());

		expect(result.opensOn).toBe(CARD);
		// The half that makes it real. Before the wiring the badge and the money
		// both sat on Efectivo; a fix that moved only the first would be worse.
		expect(result.amounts[CARD]).toBe(559);
		expect(result.amounts[CASH]).toBe(0);
		expect(result.defaults).toEqual([CARD]);
	});

	it("opens on Transferencia when Transferencia was armed", () => {
		// Not a duplicate of the case above: `resolvePreferredPaymentLine`'s
		// second branch falls back to the first CASH-LIKE line, so a broken
		// preference lands on Efectivo either way and only a non-adjacent,
		// non-cash tender tells the two apart.
		armTender(WIRE, resolveTenderChips(PROFILE), SELLING);

		const result = openPaymentScreen(invoicePayments());

		expect(result.opensOn).toBe(WIRE);
		expect(result.amounts[WIRE]).toBe(559);
	});

	it("opens on Efectivo when the strip was never touched", () => {
		// Untouched still ARMS the register's default — the strip lights it —
		// so the answer is the same one the screen has always given. This is the
		// case that proves the wiring did not become a new behaviour.
		armTender(undefined, resolveTenderChips(PROFILE), SELLING);

		const result = openPaymentScreen(invoicePayments());

		expect(result.opensOn).toBe(CASH);
		expect(result.amounts[CASH]).toBe(559);
		expect(result.defaults).toEqual([CASH]);
	});

	it("opens on Efectivo when nothing was ever armed", () => {
		expect(peekArmedTender()).toBeNull();

		expect(openPaymentScreen(invoicePayments()).opensOn).toBe(CASH);
	});

	it("opens on Efectivo when the cashier chose MIXED", () => {
		// MIXED is the EMPTY selection, and the payment screen with nothing
		// pre-armed already IS the split surface. Deselecting must not strand
		// the cashier on a screen with no method selected.
		armTender(null, resolveTenderChips(PROFILE), SELLING);

		const result = openPaymentScreen(invoicePayments());

		expect(result.opensOn).toBe(CASH);
		expect(result.defaults).toEqual([CASH]);
	});
});

describe("a stale arm reads null and is never resurrected", () => {
	it("falls back to the register's default when the profile drops the method", () => {
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);
		expect(peekArmedTender()).toBe(CARD);

		// The profile reloaded without Tarjeta. `armedTender.ts` re-runs its own
		// guard; the payment screen must read whatever that says, not a value it
		// cached. Substituting silently is the one failure the cashier would not
		// notice — they believed their own pick.
		const withoutCard = { payments: [{ mode_of_payment: CASH, default: 1, type: "Cash" }] };
		revalidateArmedTender(resolveTenderChips(withoutCard), SELLING);
		expect(peekArmedTender()).toBeNull();

		const result = openPaymentScreen(invoicePayments());
		expect(result.opensOn).toBe(CASH);
		expect(result.defaults).toEqual([CASH]);
	});

	it("falls back when the sale became a return after the arm", () => {
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);
		revalidateArmedTender(resolveTenderChips(PROFILE), { cartHasItems: true, isReturn: true });

		expect(peekArmedTender()).toBeNull();
		expect(openPaymentScreen(invoicePayments()).opensOn).toBe(CASH);
	});

	it("refuses a return even if the arm somehow survived", () => {
		// Belt and braces: the strip's guard runs on a WATCHER, and a doc that
		// arrives as a return before that watcher fires would otherwise carry a
		// live arm onto a refund. A refund is not "cobrar con".
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);
		const payments = invoicePayments();

		expect(applyArmedPaymentPreference(payments, peekArmedTender(), { isReturn: true })).toBeNull();
		expect(payments.filter((p) => p.default === 1).map((p) => p.mode_of_payment)).toEqual([CASH]);
	});

	it("refuses once the cashier has entered an amount", () => {
		// Re-opening the screen must not move the money off the line they typed
		// on. `paymentsTouched` is the register's own word for that moment.
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);
		const payments = invoicePayments();
		payments[0].amount = 300;

		expect(
			applyArmedPaymentPreference(payments, peekArmedTender(), { paymentsTouched: true }),
		).toBeNull();
		expect(payments.filter((p) => p.default === 1).map((p) => p.mode_of_payment)).toEqual([CASH]);
	});

	it("refuses a tender this invoice does not carry", () => {
		// The invoice's lines and the profile's chips can disagree — a gift-card
		// method is a chip the payment screen does not list. Arming one must not
		// leave the screen with no default at all.
		const payments = invoicePayments();

		expect(applyArmedPaymentPreference(payments, "Vale de despensa")).toBeNull();
		expect(payments.filter((p) => p.default === 1).map((p) => p.mode_of_payment)).toEqual([CASH]);
	});
});

describe("the preference moves which line, never how much", () => {
	it("leaves exactly one default behind", () => {
		// Two survivors would make `resolvePreferredPaymentLine` and
		// `primaryPaymentMethod` pick by array order, and they walk it
		// differently — the badge would name one card and the money sit on
		// another.
		armTender(WIRE, resolveTenderChips(PROFILE), SELLING);
		const payments = invoicePayments();

		applyArmedPaymentPreference(payments, peekArmedTender());

		expect(payments.filter((p) => p.default === 1)).toHaveLength(1);
		expect(payments.filter((p) => p.default === 0)).toHaveLength(2);
	});

	it("touches no amount of its own", () => {
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);
		const payments = invoicePayments();
		payments.forEach((p) => {
			p.amount = 7;
			p.base_amount = 7;
		});

		applyArmedPaymentPreference(payments, peekArmedTender());

		// Every peso exactly where it was. The amounts are filled afterwards, by
		// code this change did not touch.
		expect(payments.map((p) => p.amount)).toEqual([7, 7, 7]);
		expect(payments.map((p) => p.base_amount)).toEqual([7, 7, 7]);
	});

	it("hands the same total to the armed line that Efectivo would have got", () => {
		// The arithmetic is the invariant: whichever line the screen opens on,
		// the figure is the one `initializePaymentLinesForDialog` computes. If
		// the two ever differ, the pre-selection has started pricing.
		const unarmed = openPaymentScreen(invoicePayments(), {}, 1234.56);

		resetTenderSelection();
		armTender(CARD, resolveTenderChips(PROFILE), SELLING);
		const armed = openPaymentScreen(invoicePayments(), {}, 1234.56);

		expect(armed.amounts[CARD]).toBe(unarmed.amounts[CASH]);
		expect(Object.values(armed.amounts).reduce((a, b) => a + (b ?? 0), 0)).toBe(
			Object.values(unarmed.amounts).reduce((a, b) => a + (b ?? 0), 0),
		);
	});
});

/**
 * MUTATION — the harness `tenderChips.spec.ts` established, pointed at the
 * half that was missing rather than the half that already worked.
 *
 * Each mutant is a plausible weakening someone could actually write while
 * "cleaning up" this wiring, and the first is the bug the owner reported:
 * a payment screen that ignores the arm. A mutant that survives every case
 * below means the cases do not test the pre-selection at all.
 */
type Preference = (
	_payments: PaymentLine[],
	_armed: string | null | undefined,
	_context?: ArmedPreferenceContext,
) => PaymentLine | null;

interface PreferenceCase {
	name: string;
	armed: string | null | undefined;
	context: ArmedPreferenceContext;
	/**
	 * The register these lines belong to. The "no opinion" cases use a shop
	 * whose OWN default is Transferencia — neither first in the array nor
	 * cash-like — because on a cash-default register every weakening of the
	 * fallback still lands on Efectivo and the case proves nothing.
	 */
	payments?: () => PaymentLine[];
	/** The mode the screen must open on afterwards. */
	expected: string;
}

/** A shop that takes card by default: `default` is neither first nor cash. */
const wireDefaultPayments = (): PaymentLine[] => [
	{ mode_of_payment: CASH, default: 0, amount: 0, base_amount: 0, type: "Cash" },
	{ mode_of_payment: CARD, default: 0, amount: 0, base_amount: 0, type: "Bank" },
	{ mode_of_payment: WIRE, default: 1, amount: 0, base_amount: 0, type: "Bank" },
];

const CASES: readonly PreferenceCase[] = [
	{ name: "an armed card opens on the card", armed: CARD, context: {}, expected: CARD },
	{ name: "an armed transfer opens on the transfer", armed: WIRE, context: {}, expected: WIRE },
	{
		name: "unarmed opens on the register's own default",
		armed: null,
		context: {},
		payments: wireDefaultPayments,
		expected: WIRE,
	},
	{
		name: "a tender the invoice does not carry opens on the register's own default",
		armed: "Vale de despensa",
		context: {},
		payments: wireDefaultPayments,
		expected: WIRE,
	},
	{
		name: "a near-miss spelling opens on the default",
		armed: "tarjeta",
		context: {},
		expected: CASH,
	},
	{ name: "a return opens on the default", armed: CARD, context: { isReturn: true }, expected: CASH },
	{
		name: "a screen the cashier has typed on opens on the default",
		armed: CARD,
		context: { paymentsTouched: true },
		expected: CASH,
	},
];

const MUTANTS: ReadonlyArray<readonly [string, Preference]> = [
	// THE BUG. This is the register as the owner found it: the chips arm, the
	// payment screen shrugs. It must die on the very first case.
	["ignores the armed tender entirely", () => null],
	// Moves the badge but not the flag every other consumer reads — the
	// "looks fixed, still opens on cash" mutant.
	[
		"returns the armed line without moving `default`",
		(payments, armed, context = {}) =>
			context.isReturn || context.paymentsTouched ? null : resolveArmedPaymentLine(payments, armed),
	],
	// Sets the armed line but never clears the old default: two survivors, and
	// the two consumers that walk the array disagree about which one wins.
	[
		"sets the armed default without clearing the others",
		(payments, armed, context = {}) => {
			if (context.isReturn || context.paymentsTouched) return null;
			const line = resolveArmedPaymentLine(payments, armed);
			if (line) line.default = 1;
			return line;
		},
	],
	// Drops the return guard: a refund pre-armed with the tender of the sale
	// that preceded it.
	[
		"forgets that a refund is not `cobrar con`",
		(payments, armed, context = {}) =>
			applyArmedPaymentPreference(payments, armed, { ...context, isReturn: false }),
	],
	// Drops the touched guard: re-opening the screen moves the money off the
	// line the cashier typed on.
	[
		"forgets the cashier already typed an amount",
		(payments, armed, context = {}) =>
			applyArmedPaymentPreference(payments, armed, { ...context, paymentsTouched: false }),
	],
	// Clears the flags before deciding, so an unarmed screen ends up with NO
	// default at all and the fallback picks whatever happens to be cash-like.
	[
		"clears every default before it knows there is an arm",
		(payments, armed, context = {}) => {
			for (const row of payments) row.default = 0;
			return applyArmedPaymentPreference(payments, armed, context);
		},
	],
	// The substitution `armedTenderPreselect`'s header warns about, written the
	// way it actually gets written: `?? rows[0]`. The cashier picked a tender
	// the invoice does not carry and the screen opens on a different one.
	[
		"falls back to the first line when the armed mode is missing",
		(payments, armed, context = {}) => {
			if (context.isReturn || context.paymentsTouched) return null;
			const line = resolveArmedPaymentLine(payments, armed) ?? payments[0] ?? null;
			if (!line) return null;
			for (const row of payments) row.default = row === line ? 1 : 0;
			return line;
		},
	],
	// Case-folds the comparison: arms a Mode of Payment that does not exist,
	// and `initializePaymentLinesForDialog` then has no default at all.
	[
		"matches the mode name loosely",
		(payments, armed, context = {}) => {
			if (context.isReturn || context.paymentsTouched) return null;
			const wanted = String(armed ?? "").trim().toLowerCase();
			const line = wanted
				? (payments.find((p) => String(p.mode_of_payment ?? "").trim().toLowerCase() === wanted) ??
					null)
				: null;
			if (!line) return null;
			for (const row of payments) row.default = row === line ? 1 : 0;
			return line;
		},
	],
];

/** One case, run against one implementation; returns the mode opened on. */
const opensOn = (preference: Preference, testCase: PreferenceCase): string | null => {
	const payments = (testCase.payments ?? invoicePayments)();
	preference(payments, testCase.armed, testCase.context);
	const doc = { payments, rounded_total: 559, grand_total: 559, conversion_rate: 1 };
	return resolvePreferredPaymentLine(doc, isCashLike)?.mode_of_payment ?? null;
};

describe("mutation — the case table kills every weakening of the pre-selection", () => {
	it("the real implementation passes every case", () => {
		for (const testCase of CASES) {
			expect(opensOn(applyArmedPaymentPreference, testCase), testCase.name).toBe(testCase.expected);
		}
	});

	it.each(MUTANTS.map(([name, mutant]) => [name, mutant] as const))(
		"kills a pre-selection that %s",
		(_name, mutant) => {
			const survived = CASES.every((testCase) => opensOn(mutant, testCase) === testCase.expected);
			expect(
				survived,
				"this mutant passes every case above, so the table does not actually test the pre-selection",
			).toBe(false);
		},
	);

	it("every case earns its place by killing at least one mutant", () => {
		// The inverse check. A case no mutant fails is decoration, and
		// decoration is what an unmounted component's green tests were.
		const idle = CASES.filter((testCase) =>
			MUTANTS.every(([, mutant]) => opensOn(mutant, testCase) === testCase.expected),
		);
		expect(idle.map((c) => c.name), "these cases discriminate nothing").toEqual([]);
	});
});
