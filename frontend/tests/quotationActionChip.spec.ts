// @vitest-environment jsdom

/**
 * «Guardar cotización» on the sale's action strip — `Cotizacion.dc.html`, which
 * puts it beside «Guardar y Limpiar».
 *
 * Two halves, and only the second one can catch the failure that matters. The
 * registry half is arithmetic on a literal. The mounted half proves the press
 * actually reaches something: the chip's handler is the ONE entry in
 * `actionStripHandlers` that does not emit up to `Invoice.vue` — the dialog
 * belongs to `NavbarMenu.vue`, which listens on the bus — so a handler wired to
 * a component event nobody forwards would render a perfectly good button that
 * does nothing at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({
		windowWidth: { value: 1400 },
		isDesktop: { value: true },
		isTablet: { value: false },
		isPhone: { value: false },
		isCompact: { value: false },
	}),
}));

import InvoiceSummary from "../src/posapp/components/pos/invoice/InvoiceSummary.vue";
import { ACTION_CHIPS, chordLabelFor, visibleChips } from "../src/posapp/components/pos/invoice/actionChips";
import { MUELLE_DEFAULT, resolveKeymap } from "../src/posapp/shortcuts";

const QUOTING = {
	currency: "MXN",
	posa_use_percentage_discount: 0,
	posa_allow_user_to_edit_additional_discount: 1,
	custom_allow_create_quotation: 1,
	payments: [{ mode_of_payment: "Efectivo", default: 1, type: "Cash" }],
};

const baseProps = {
	pos_profile: QUOTING,
	total_qty: 3,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	subtotal: 678,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => Number(value).toFixed(2),
	currencySymbol: () => "$",
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
};

const createBus = () => {
	const emitted: string[] = [];
	return {
		emitted,
		emit: (event: string) => {
			emitted.push(event);
		},
		on: () => undefined,
		off: () => undefined,
	};
};

const mountSummary = (profile: Record<string, unknown> = QUOTING) => {
	const bus = createBus();
	const wrapper = mount(InvoiceSummary, {
		props: { ...baseProps, pos_profile: profile },
		global: {
			// `stubs` would be inert here: Vuetify is not installed in this lane,
			// so `v-btn` is unresolvable and a stub only REPLACES a component the
			// runtime can resolve. Left unresolved it renders as a plain element
			// and its @click is a native listener, which is what we press.
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			provide: { eventBus: bus },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});
	return { wrapper, bus };
};

beforeEach(() => {
	setActivePinia(createPinia());
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		datetime: { nowdate: () => "2026-08-24" },
	});
	vi.stubGlobal("__", (value: string) => value);
});

describe("the quotation chip is offered only where the register quotes", () => {
	it("appears on a quoting register and stays on the sale scope", () => {
		const chip = ACTION_CHIPS.find((c) => c.id === "save-quotation");
		expect(chip?.profileFlag).toBe("custom_allow_create_quotation");
		// `sale`, not `destination`: it survives the rail taking the destination
		// chips away, because filing the cart is something you do TO this sale.
		expect(chip?.scope).toBe("sale");
		expect(visibleChips(QUOTING, true).map((c) => c.id)).toContain("save-quotation");
	});

	it("is absent from a register whose profile never turned quoting on", () => {
		expect(visibleChips({ posa_allow_return: 1 }, false).map((c) => c.id)).not.toContain(
			"save-quotation",
		);
	});

	it("prints the chord the pack actually binds", () => {
		const chip = ACTION_CHIPS.find((c) => c.id === "save-quotation");
		expect(chip?.actionId).toBe("invoice.saveQuotation");
		expect(chordLabelFor(chip!.actionId, resolveKeymap(MUELLE_DEFAULT))).toBe("Alt + Z");
	});
});

describe("pressing it asks for the dialog", () => {
	it("puts open_save_quotation on the bus", async () => {
		const { wrapper, bus } = mountSummary();

		const chip = wrapper.find('[data-testid="action-chip-save-quotation"]');
		expect(chip.exists()).toBe(true);
		await chip.trigger("click");

		expect(bus.emitted).toEqual(["open_save_quotation"]);
	});

	it("renders no chip at all on a register that does not quote", () => {
		const { wrapper } = mountSummary({ ...QUOTING, custom_allow_create_quotation: 0 });
		expect(wrapper.find('[data-testid="action-chip-save-quotation"]').exists()).toBe(false);
		// The neighbour it sits beside is still there, so this is the flag doing
		// the work and not the strip failing to render.
		expect(wrapper.find('[data-testid="action-chip-save-and-clear"]').exists()).toBe(true);
	});
});
