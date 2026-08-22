// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";

import ComboCartLine from "../src/posapp/components/pos/combos/ComboCartLine.vue";
import ComboSuggestionStrip from "../src/posapp/components/pos/combos/ComboSuggestionStrip.vue";
import {
	readAvailabilityProbe,
	resetAvailabilityProbe,
} from "../src/posapp/composables/pos/combos/comboAvailability";
import type { ComboSuggestion } from "../src/posapp/composables/pos/combos/comboCatalog";

const money = (value: number) =>
	`$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LINE = {
	item_code: "COMBO-IP15P",
	item_name: "Combo Protección iPhone 15 Pro",
	qty: 1,
	rate: 299,
	components: [
		{ item_code: "IPN001758", item_name: "Case negro", qty: 1, rate: 200 },
		{ item_code: "MICA15P", item_name: "Mica Cristal", qty: 1, rate: 80 },
		{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60 },
	],
};

beforeEach(() => resetAvailabilityProbe());

describe("combo cart line", () => {
	const mountLine = (overrides = {}) =>
		mount(ComboCartLine, { props: { line: { ...LINE, ...overrides }, formatCurrency: money } });

	it("exposes the evidence-lane hooks the screenshot lane selects on", () => {
		const wrapper = mountLine();
		const row = wrapper.get('[data-testid="cart-line-combo"]');
		expect(row.attributes("data-combo-components")).toBe("3");
		expect(wrapper.find('[data-testid="combo-saving"]').exists()).toBe(true);
	});

	it("renders the artboard's badge, saving and component summary", () => {
		const wrapper = mountLine();
		expect(wrapper.get('[data-testid="combo-badge"]').text()).toBe("COMBO · 3");
		expect(wrapper.get('[data-testid="combo-saving"]').text()).toBe("saves $41.00");
		expect(wrapper.get('[data-testid="combo-components"]').text()).toBe(
			"Case negro + Mica Cristal + Instalación · list $340.00",
		);
	});

	it("multiplies the line amount by quantity but keeps the per-combo rate", () => {
		const wrapper = mountLine({ qty: 3 });
		expect(wrapper.text()).toContain("$897.00");
		// The saving chip stays per-combo, matching the rate beside it.
		expect(wrapper.get('[data-testid="combo-saving"]').text()).toBe("saves $41.00");
	});

	it("omits the saving chip when the bundle is not a discount", () => {
		const wrapper = mountLine({ rate: 400 });
		expect(wrapper.find('[data-testid="combo-saving"]').exists()).toBe(false);
	});

	it("renders the figure the line already carries, without re-asking", () => {
		// `_combo_available` was computed when the line was added. Recomputing
		// here would ask the choke point a second time for the same line and
		// could disagree with the ceiling that was applied.
		const wrapper = mountLine({ _combo_available: 10, _combo_limited_by: "Case negro" });
		expect(wrapper.get('[data-testid="combo-stock"]').text()).toBe("left 10");
		expect(readAvailabilityProbe().calls).toBe(0);
	});

	it("names the limiting component, because a bare number says nothing", () => {
		const wrapper = mountLine({ _combo_available: 3, _combo_limited_by: "Mica Cristal" });
		expect(wrapper.get('[data-testid="combo-stock"]').attributes("title")).toBe(
			"Limited: Mica Cristal",
		);
	});

	it("draws NO number for an all-labour combo instead of Infinity", () => {
		const wrapper = mountLine({ _combo_available: Number.POSITIVE_INFINITY });
		const stock = wrapper.get('[data-testid="combo-stock"]');
		expect(stock.text()).toBe("");
		expect(stock.text()).not.toContain("Infinity");
		expect(stock.attributes("data-availability")).toBe("unbounded");
	});

	it("draws NO number when stock is unknown, rather than a 0 reading as empty", () => {
		const wrapper = mountLine({ _combo_available: null });
		const stock = wrapper.get('[data-testid="combo-stock"]');
		expect(stock.text()).toBe("");
		expect(stock.text()).not.toContain("0");
		expect(stock.attributes("data-availability")).toBe("unknown");
	});

	it("shows a real zero, tinted, because that one the cashier must see", () => {
		const wrapper = mount(ComboCartLine, {
			props: {
				line: { ...LINE, _combo_available: 0, _combo_limited_by: "Mica Cristal" },
				formatCurrency: money,
				lowStockThreshold: 10,
			},
		});
		const stock = wrapper.get('[data-testid="combo-stock"]');
		expect(stock.text()).toBe("left 0");
		expect(stock.classes()).toContain("combo-line__stock--low");
	});

	it("tints at the register's threshold and not above it", () => {
		const low = mount(ComboCartLine, {
			props: { line: { ...LINE, _combo_available: 10 }, lowStockThreshold: 10 },
		});
		const fine = mount(ComboCartLine, {
			props: { line: { ...LINE, _combo_available: 11 }, lowStockThreshold: 10 },
		});
		expect(low.get('[data-testid="combo-stock"]').classes()).toContain("combo-line__stock--low");
		expect(fine.get('[data-testid="combo-stock"]').classes()).not.toContain(
			"combo-line__stock--low",
		);
	});

	it("falls back to the resolver only for a line predating the field", () => {
		const wrapper = mountLine();
		expect(readAvailabilityProbe().calls).toBe(1);
		// Components carry no actual_qty, so the honest answer is "unknown".
		expect(wrapper.get('[data-testid="combo-stock"]').attributes("data-availability")).toBe(
			"unknown",
		);
	});

	it("emits remove with an accessible label naming the combo", async () => {
		// Listener props rather than wrapper.emitted(): VTU records only the
		// native click that bubbles to the root — the same reason
		// changeDueDialog.spec.ts asserts this way.
		const onRemove = vi.fn();
		const wrapper = mount(ComboCartLine, {
			props: { line: LINE, formatCurrency: money, onRemove },
		});
		const button = wrapper.get(".combo-line__remove");
		expect(button.attributes("aria-label")).toBe("Remove Combo Protección iPhone 15 Pro");
		await button.trigger("click");
		expect(onRemove).toHaveBeenCalledTimes(1);
	});
});

describe("se suele llevar junto strip", () => {
	const SUGGESTIONS: ComboSuggestion[] = [
		{
			item_code: "COMBO-X8A",
			item_name: "Combo Protección Honor X8A",
			rate: 289,
			saving: 36,
			kind: "combo",
			reason: "targets-cart-item",
		},
		{
			item_code: "MICA15P",
			item_name: "Mica Cristal iPhone 15 Pro",
			rate: 80,
			availableQty: 24,
			kind: "item",
			reason: "universal",
		},
	];

	it("carries the strip hook and one tile hook per suggestion", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: { suggestions: SUGGESTIONS, formatCurrency: money },
		});
		expect(wrapper.find('[data-testid="upsell-strip"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="upsell-tile-COMBO-X8A"]').exists()).toBe(true);
		expect(
			wrapper.get('[data-testid="upsell-tile-COMBO-X8A"]').attributes("data-upsell-kind"),
		).toBe("combo");
	});

	it("shows a saving for combos and a piece count for plain items", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: { suggestions: SUGGESTIONS, formatCurrency: money },
		});
		expect(wrapper.text()).toContain("saves $36.00");
		expect(wrapper.text()).toContain("24 pcs");
	});

	it("gives each tile one spoken sentence rather than three fragments", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: { suggestions: SUGGESTIONS, formatCurrency: money },
		});
		expect(
			wrapper.get('[data-testid="upsell-tile-COMBO-X8A"]').attributes("aria-label"),
		).toBe("Add Combo Protección Honor X8A, $289.00, saves $36.00");
	});

	it("emits the whole suggestion so the shell adds it without a second lookup", async () => {
		const onAdd = vi.fn();
		const wrapper = mount(ComboSuggestionStrip, {
			props: { suggestions: SUGGESTIONS, formatCurrency: money, onAdd },
		});
		await wrapper.get('[data-testid="upsell-tile-MICA15P"]').trigger("click");
		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ item_code: "MICA15P" });
	});

	it("draws NO stock on a combo tile that is unbounded", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: {
				suggestions: [
					{
						...SUGGESTIONS[0]!,
						availability: {
							show: false,
							value: null,
							limitedBy: null,
							isLow: false,
							reason: "unbounded" as const,
						},
					},
				],
				formatCurrency: money,
			},
		});
		expect(wrapper.find('[data-testid="upsell-stock"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("Infinity");
		expect(
			wrapper.get('[data-testid="upsell-tile-COMBO-X8A"]').attributes("data-availability"),
		).toBe("unbounded");
	});

	it("draws NO stock on a combo tile whose stock is unknown", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: { suggestions: SUGGESTIONS, formatCurrency: money },
		});
		expect(wrapper.find('[data-testid="upsell-stock"]').exists()).toBe(false);
		expect(
			wrapper.get('[data-testid="upsell-tile-COMBO-X8A"]').attributes("data-availability"),
		).toBe("unknown");
	});

	it("shows stock on a combo tile only when the register calls it low", () => {
		const lowTile = {
			...SUGGESTIONS[0]!,
			availability: {
				show: true,
				value: 2,
				limitedBy: "Mica",
				isLow: true,
				reason: "bounded" as const,
			},
		};
		const healthyTile = {
			...SUGGESTIONS[0]!,
			availability: { ...lowTile.availability, value: 40, isLow: false },
		};
		const low = mount(ComboSuggestionStrip, {
			props: { suggestions: [lowTile], formatCurrency: money },
		});
		const healthy = mount(ComboSuggestionStrip, {
			props: { suggestions: [healthyTile], formatCurrency: money },
		});
		expect(low.get('[data-testid="upsell-stock"]').text()).toBe("· left 2");
		// The artboard draws no figure at healthy stock; price and saving only.
		expect(healthy.find('[data-testid="upsell-stock"]').exists()).toBe(false);
	});

	it("speaks the low figure as well as tinting it", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: {
				suggestions: [
					{
						...SUGGESTIONS[0]!,
						availability: {
							show: true,
							value: 2,
							limitedBy: "Mica",
							isLow: true,
							reason: "bounded" as const,
						},
					},
				],
				formatCurrency: money,
			},
		});
		// Colour alone is not an accessible way to say "nearly out".
		expect(
			wrapper.get('[data-testid="upsell-tile-COMBO-X8A"]').attributes("aria-label"),
		).toBe("Add Combo Protección Honor X8A, $289.00, saves $36.00, left 2");
	});

	it("renders nothing at all when there is nothing to suggest", () => {
		const wrapper = mount(ComboSuggestionStrip, { props: { suggestions: [] } });
		expect(wrapper.find('[data-testid="upsell-strip"]').exists()).toBe(false);
	});
});
