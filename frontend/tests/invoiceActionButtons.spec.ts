// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import InvoiceActionButtons from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue";

/**
 * Rewritten by W4-D, 2026-08-22.
 *
 * This file used to assert the eight-button grid: PAY first at `cols="12"`,
 * `summary-btn` classes, and a `tonal`/`elevated` variant split. That grid is
 * gone — `Main.dc.html` draws the area between the cart and the band as ONE
 * ~38px strip of keyboard-hint chips, and the grid was spending roughly 200px
 * and eight saturated fills on it.
 *
 * The assertions are kept in spirit rather than deleted: PAY still has to be
 * unmissable where it exists, and it still has to be absent where the band
 * carries it instead. What changed is the shape it lives in.
 */
describe("InvoiceActionButtons — the action strip contract", () => {
	beforeEach(() => {
		(window as any).__ = (value: string) => value;
		vi.stubGlobal("__", (value: string) => value);
	});

	const mountStrip = (
		width = 400,
		profile: Record<string, unknown> = {},
		bandOwnsPrimary = false,
	) => {
		(window as any).innerWidth = width;
		(window as any).innerHeight = 740;
		return mount(InvoiceActionButtons, {
			props: { pos_profile: profile, bandOwnsPrimary },
			global: { mocks: { __: (value: string) => value } },
		});
	};

	it("renders one strip, not a grid", () => {
		const wrapper = mountStrip();
		expect(wrapper.find('[data-testid="action-strip"]').exists()).toBe(true);
		// The grid's own scaffolding must not come back.
		expect(wrapper.findAll("v-col")).toHaveLength(0);
		expect(wrapper.findAll("v-row")).toHaveLength(0);
	});

	it("keeps PAY on the keyboard target where no band exists", () => {
		const pay = mountStrip(400).find('[data-testid="action-strip-pay"]');
		expect(pay.exists()).toBe(true);
		expect(pay.attributes("data-pos-keyboard-target")).toBe("pay");
		// The one accent, and it is filled — see §17.7 invariant 2.
		expect(pay.attributes("color")).toBe("primary");
		expect(pay.attributes("variant")).toBe("flat");
	});

	it("drops PAY entirely once the band owns the lane", () => {
		// Two primaries on one screen is the invariant's exact failure mode.
		const wrapper = mountStrip(1440, {}, true);
		expect(wrapper.find('[data-testid="action-strip-pay"]').exists()).toBe(false);
	});

	it("renders every chip as a text variant, so none can become a fill", () => {
		const chips = mountStrip(1440, {}, true).findAll('[data-testid^="action-chip-"]');
		expect(chips.length).toBeGreaterThan(0);
		for (const chip of chips) {
			expect(chip.attributes("variant")).toBe("text");
		}
	});

	it("prints a chord only where one is bound", () => {
		const wrapper = mountStrip(1440, {}, true);
		// `invoice.saveAndClear` is bound (Alt+S); print-draft is bound to nothing.
		expect(wrapper.find('[data-testid="action-chord-save-and-clear"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="action-chord-print-draft"]').exists()).toBe(false);
	});
});
