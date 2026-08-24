// @vitest-environment node

/**
 * The source half of the customer display's privacy decision — see
 * `customerDisplayPrivacy.spec.ts` for the mounted half and the reasoning.
 *
 * Split for the reason `registerSaysItOnceSource.spec.ts` is split: `node:fs`
 * does not interop under jsdom (build plan §10), and the mounted half must
 * mount. The two catch different mistakes. A DOM check only sees a field a
 * fixture happened to reach; a template scan sees one bound behind a `v-if`
 * nobody's fixture satisfies, and it sees the binding on the day it is written
 * rather than on the day someone finds the right snapshot to expose it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src/posapp");

/** Read off the component itself — a template this spec cannot see is a
 *  template it cannot guard. Comments are stripped because they ARGUE the
 *  exclusions and so necessarily name the fields; the guard is about what is
 *  BOUND, not about what is discussed. */
const TEMPLATE = (() => {
	const source = readFileSync(
		resolve(SRC, "components/customer_display/CustomerDisplay.vue"),
		"utf8",
	);
	const match = /<template>([\s\S]*)<\/template>/.exec(source);
	if (!match) throw new Error("CustomerDisplay.vue has no template block");
	return match[1]!.replace(/<!--[\s\S]*?-->/g, "");
})();

describe("the customer display's template binds none of the refused fields", () => {
	it("still has a template with a total in it, so the absences mean something", () => {
		expect(TEMPLATE).toContain('data-money-role="total"');
	});

	it.each([
		["customer_name", "a person's name, readable by whoever is next in the queue"],
		["item_code", "an internal SKU the customer cannot use"],
		["channel_id", "an internal identifier with no reader on this screen"],
	])("does not bind %s", (field, why) => {
		expect(
			TEMPLATE.includes(field),
			`CustomerDisplay.vue's template binds \`${field}\`: ${why}. ` +
				`This screen faces outward and the customer cannot opt out of what it ` +
				`says about them. If it genuinely needs this field, the argument belongs ` +
				`in the component's header comment and this spec changes with it.`,
		).toBe(false);
	});
});

describe("the snapshot contract has not widened underneath the screen", () => {
	/**
	 * `utils/customerDisplay.ts` is the TRANSPORT, and what it carries is a
	 * privacy decision, not a data-modelling one: every field crosses a window
	 * into a screen a stranger standing behind the customer can read.
	 *
	 * ## The accrual was argued and admitted — 2026-08-23
	 *
	 * This block used to read as a blanket refusal, written when the display
	 * had no artboard and the transport carried only a basket. It is not one
	 * any more. `docs/PANTALLA_CLIENTE_GOLDEN_FLOW.md` §1 is the acceptance
	 * contract for this screen and it names the accrual outright — "Done →
	 * «Gracias» + change reminder + cashback earned («Acumulaste $15.00 · saldo
	 * $433.00») when the customer is enrolled" — with the standing condition
	 * attached: "only for enrolled customers on card-enabled registers —
	 * absence, not zeros". So `cashback_earned` and `cashback_balance_after`
	 * cross the window with an owner's sanction behind them, and the tender
	 * figures (§1's «Recibido $500 · Cambio $152») with them.
	 *
	 * What did NOT change is why the refused fields are refused, and the guard
	 * below is deliberately not satisfied by renaming:
	 *
	 *  - A *figure about* the customer's card is a number the customer is
	 *    standing there to read. A *wallet or loyalty record* is an account
	 *    identifier and a history, and the queue behind them has no business
	 *    with either. `Cobro.dc.html` puts the wallet on the CASHIER's screen —
	 *    a different privacy context, one the customer is not facing.
	 *  - The customer's NAME still never renders. §1's own wording («Monedero
	 *    de Sofía») was departed from on purpose: the customer knows whose card
	 *    it is, and the person next in the queue does not need telling. The
	 *    snapshot still carries `customer_name` for the register's own use and
	 *    the template still refuses to bind it — the two halves above.
	 *
	 * Anything beyond §1's list needs the same treatment this got: an argument
	 * in the golden flow first, then this spec, then a field.
	 */
	const interfaceBlock = (() => {
		const transport = readFileSync(resolve(SRC, "utils/customerDisplay.ts"), "utf8");
		const match = /export interface CustomerDisplaySnapshot \{([\s\S]*?)\}/.exec(transport);
		if (!match) throw new Error("CustomerDisplaySnapshot is gone or renamed");
		return match[1]!;
	})();

	it("still carries the fields the screen does use", () => {
		expect(interfaceBlock).toContain("total_amount");
		expect(interfaceBlock).toContain("items");
	});

	it.each([
		["stage", "which of §1's four states the register is in"],
		["received_amount", "«Recibido», §1's tender line"],
		["change_amount", "«Cambio», the figure the customer is owed back"],
		["cashback_earned", "«Acumulaste», §1's Done state, enrolled customers only"],
		["cashback_balance_after", "«saldo $433.00», the same line's second half"],
	])("carries %s, which §1 sanctions", (field) => {
		expect(
			interfaceBlock.includes(field),
			`the snapshot no longer carries \`${field}\`. ` +
				`PANTALLA_CLIENTE_GOLDEN_FLOW.md §1 asks the screen to render it, ` +
				`and the display's model reads it optionally — removing it here ` +
				`goes dark on that state without failing anything else.`,
		).toBe(true);
	});

	it.each([
		"wallet",
		"loyalty",
		"customer_phone",
		"mobile_no",
		"email",
		"customer_id",
		"purchase_history",
	])("does not carry %s", (field) => {
		expect(
			interfaceBlock.includes(field),
			`the snapshot now carries \`${field}\`. \`Cobro.dc.html\` shows the ` +
				`wallet on the CASHIER's screen, which is a different privacy ` +
				`context — decide whether it belongs on the customer's before it ` +
				`crosses the window. §1 sanctioned an ACCRUAL FIGURE ` +
				`(\`cashback_earned\` / \`cashback_balance_after\`); it did not ` +
				`sanction the account behind it.`,
		).toBe(false);
	});
});

describe("the screen renders the accrual without naming anyone", () => {
	// The sanction and the departure from it, pinned together: §1 draws the
	// card as «Monedero de Sofía · saldo quedará en $435.94» and this screen
	// renders «Your card · balance will be …». Both halves have to hold — a
	// card that stopped rendering would make the widened transport pointless,
	// and a card that started naming people would undo the reason it was
	// allowed to render at all.
	it("draws the accrual card", () => {
		expect(TEMPLATE).toContain('data-testid="customer-display-accrual"');
		expect(TEMPLATE).toContain('data-money-role="accrual"');
	});

	it("labels the balance line with the card, not with a person", () => {
		expect(TEMPLATE).toContain("Your card · balance will be {0}");
		expect(TEMPLATE).not.toContain("customer_name");
	});
});
