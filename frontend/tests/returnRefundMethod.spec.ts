// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import ReturnFinder from "../src/posapp/components/pos/flows/returns/ReturnFinder.vue";
import {
	CREDIT_NOTE_MINTED_KEY,
	canLeaveCredit,
	defaultRefundMethod,
	describeRefundMethods,
	refundActionKey,
	resolveRefundMethod,
} from "../src/posapp/components/pos/flows/returns/refundMethods";

/**
 * «Efectivo» or «Nota de crédito» (DOCUMENTOS_GOLDEN_FLOW §2).
 *
 * The rule worth pinning is the one that costs money when it is wrong: credit
 * needs an OWNER. A balance minted against the counter customer is a balance
 * the next person to say that name could spend, so the chip is refused with a
 * sentence rather than quietly absent.
 */

describe("who may hold credit", () => {
	it("a named customer may", () => {
		expect(canLeaveCredit({ customer: "CUST-9", walkInCustomer: "General" })).toBe(true);
	});

	it("the register's counter customer may not", () => {
		expect(canLeaveCredit({ customer: "General", walkInCustomer: "General" })).toBe(false);
	});

	it("a sale with no customer at all may not", () => {
		// The no-ticket path can produce exactly this.
		expect(canLeaveCredit({ customer: null, walkInCustomer: "General" })).toBe(false);
		expect(canLeaveCredit({ customer: "  ", walkInCustomer: "General" })).toBe(false);
	});

	it("does not invent a counter customer when the profile has none", () => {
		expect(canLeaveCredit({ customer: "CUST-9", walkInCustomer: null })).toBe(true);
	});
});

describe("the two chips", () => {
	it("always renders both, so the refusal can teach", () => {
		const methods = describeRefundMethods({ customer: "General", walkInCustomer: "General" });
		expect(methods.map((method) => method.id)).toEqual(["cash", "credit_note"]);
	});

	it("marks the credit note unavailable with a reason, never just absent", () => {
		const [, credit] = describeRefundMethods({
			customer: "General",
			walkInCustomer: "General",
		});
		expect(credit?.available).toBe(false);
		expect(credit?.blockedReason).toContain("Credit needs an owner");
	});

	it("leaves cash always available — the money can always go back", () => {
		const [cash] = describeRefundMethods({ customer: null, walkInCustomer: "General" });
		expect(cash?.available).toBe(true);
		expect(cash?.blockedReason).toBeNull();
	});
});

describe("the default and the fallback", () => {
	it("starts on cash, never on credit", () => {
		expect(defaultRefundMethod()).toBe("cash");
	});

	it("drops a credit choice when the cashier switches to a counter sale", () => {
		expect(
			resolveRefundMethod("credit_note", { customer: "General", walkInCustomer: "General" }),
		).toBe("cash");
	});

	it("keeps a credit choice on a named customer", () => {
		expect(
			resolveRefundMethod("credit_note", { customer: "CUST-9", walkInCustomer: "General" }),
		).toBe("credit_note");
	});
});

describe("what the button says", () => {
	it("names the act, so the cashier reads the outcome and not just «continue»", () => {
		expect(refundActionKey("credit_note")).toBe("Refund as credit note");
		expect(refundActionKey("cash")).toBe("Continue the return");
	});

	it("keeps the customer and the folio outside the minted sentence's key", () => {
		expect(CREDIT_NOTE_MINTED_KEY).toContain("{0}");
		expect(CREDIT_NOTE_MINTED_KEY).toContain("{1}");
	});
});

/* -------------------------------------------------------------------------- */
/* The finder, mounted                                                         */
/* -------------------------------------------------------------------------- */

const VUETIFY_STUBS = {
	// `components`, NOT `stubs` — Vuetify is absent from this lane, so `v-btn`
	// never resolves and `stubs` only replaces what the runtime could resolve.
	"v-btn": {
		props: ["disabled", "block", "size", "variant", "color"],
		emits: ["click"],
		template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
	},
	"v-icon": { props: ["icon", "start", "size"], template: "<i />" },
	"v-select": { props: ["modelValue", "items", "label"], template: "<select />" },
	"v-checkbox": { props: ["modelValue", "label"], template: "<input type='checkbox' />" },
	"v-text-field": { props: ["modelValue", "label"], template: "<input />" },
	"v-progress-circular": { template: "<span />" },
};

const finderProps = (overrides: Record<string, any> = {}) => ({
	methods: [
		{
			id: "ticket",
			label: "By ticket",
			placeholder: "Ticket",
			kind: "search",
			chords: [],
			shortcutActionId: null,
			dataSource: "test",
		},
	],
	activeMethod: "ticket",
	term: "",
	searching: false,
	searchedOnce: false,
	searchError: null,
	results: [],
	selectedSale: null,
	cashier: null,
	cashierOnDuty: "Rosa",
	warranty: null,
	lines: [],
	selection: {},
	authorisers: [],
	noTicket: { allowedByProfile: false, authoriserUser: null, signatureTaken: false, reason: "" },
	refundMethods: describeRefundMethods({ customer: "CUST-9", walkInCustomer: "General" }),
	refundMethod: "cash",
	formatCurrency: (value: number) => `$${Number(value).toFixed(2)}`,
	formatDate: (value: string) => value,
	...overrides,
});

const mountFinder = (overrides: Record<string, any> = {}) =>
	mount(ReturnFinder, {
		props: finderProps(overrides) as any,
		global: { components: VUETIFY_STUBS },
	});

beforeEach(() => {
	(window as any).__ = (value: string) => value;
});

describe("the refund choice on screen", () => {
	it("draws both chips", () => {
		const wrapper = mountFinder();
		expect(wrapper.find('[data-testid="return-refund-cash"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="return-refund-credit_note"]').exists()).toBe(true);
	});

	it("disables the credit chip on a counter sale and says why on screen", () => {
		const wrapper = mountFinder({
			refundMethods: describeRefundMethods({ customer: "General", walkInCustomer: "General" }),
		});
		const chip = wrapper.find('[data-testid="return-refund-credit_note"]');
		expect(chip.attributes("disabled")).toBeDefined();
		expect(chip.attributes("data-available")).toBe("0");
		// The reason is rendered, not left in a `title` a touchscreen never shows.
		expect(wrapper.find('[data-testid="return-refund-blocked"]').text()).toContain(
			"Credit needs an owner",
		);
	});

	it("asks the dialog to change method rather than changing it itself", async () => {
		const onUpdateRefundMethod = vi.fn();
		const wrapper = mountFinder({ "onUpdate:refundMethod": onUpdateRefundMethod });
		await wrapper.find('[data-testid="return-refund-credit_note"]').trigger("click");
		expect(onUpdateRefundMethod).toHaveBeenCalledWith("credit_note");
	});

	it("renames the primary action to the outcome it produces", () => {
		const cash = mountFinder();
		expect(cash.find('[data-testid="return-proceed"]').text()).toContain("Continue the return");
		const credit = mountFinder({ refundMethod: "credit_note" });
		expect(credit.find('[data-testid="return-proceed"]').text()).toContain(
			"Refund as credit note",
		);
		expect(credit.find('[data-testid="return-proceed"]').attributes("data-refund-method")).toBe(
			"credit_note",
		);
	});
});
