// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * The mesa sheet — the tap's question, asked beside the room instead of over it
 * (`Salon.dc.html`).
 *
 * The contracts it inherits from RESTAURANT_UX_MAP §5–6 are the ones worth
 * pinning: a split bill shows one row per account and never an aggregate beside
 * a Charge, Release only appears with nothing to lose, and a free table gets
 * one honest verb rather than a grid of greyed ones.
 */

vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value).toFixed(2)}` }),
}));

import MesaSheet from "../src/posapp/components/floor/MesaSheet.vue";

const table = (over: Record<string, unknown> = {}) => ({
	name: "tbl-7",
	table_uid: "u7",
	table_label: "Mesa 7",
	floor: "salon",
	seats: 5,
	is_active: 1,
	layout: null,
	needs_cleaning: 0,
	bill_printed_at: null,
	occupied: 1,
	modified: null,
	...over,
});

const account = (uid: string, over: Record<string, unknown> = {}) => ({
	name: uid,
	order_uid: uid,
	table: "tbl-7",
	pos_profile: "Barra 1",
	company: "Café",
	status: "Open",
	tab_name: uid === "ord-a" ? "Sofía" : "Diego",
	guest_count: 3,
	service_type: "Dine In",
	customer: null,
	opened_by: "citlali@example.com",
	waiter: null,
	items_count: 6,
	unsent_count: 0,
	total: 351,
	modified: "2026-08-23 08:40:00",
	...over,
});

const mountSheet = (props: Record<string, unknown> = {}) =>
	mount(MesaSheet, {
		props: {
			table: table(),
			orders: [account("ord-a")],
			selectedUid: "ord-a",
			...props,
		},
		global: { stubs: { VIcon: true } },
	});

describe("the mesa sheet", () => {
	it("names the table and the party it is asking about", () => {
		const wrapper = mountSheet();

		expect(wrapper.find("[data-test='mesa-sheet']").exists()).toBe(true);
		expect(wrapper.text()).toContain("Mesa 7");
		expect(wrapper.text()).toContain("Sofía");
		expect(wrapper.text()).toContain("$351.00");
	});

	it("shows one row per cuenta on a split bill, with its OWN total", () => {
		const wrapper = mountSheet({
			orders: [account("ord-a"), account("ord-b", { total: 214, items_count: 4 })],
		});

		expect(wrapper.findAll("[data-test^='mesa-sheet-account-']")).toHaveLength(2);
		expect(wrapper.text()).toContain("$351.00");
		expect(wrapper.text()).toContain("$214.00");
		// Never the $565 aggregate beside a verb that settles one of them.
		expect(wrapper.text()).not.toContain("$565.00");
	});

	it("warns before the operator reaches for a verb on a split table", () => {
		const wrapper = mountSheet({ orders: [account("ord-a"), account("ord-b")] });

		expect(wrapper.find("[data-test='mesa-sheet-split']").exists()).toBe(true);
	});

	it("has no warning when there is one cuenta to charge", () => {
		expect(mountSheet().find("[data-test='mesa-sheet-split']").exists()).toBe(false);
	});

	it("routes the account choice up rather than picking one itself", async () => {
		const onSelect = vi.fn();
		const wrapper = mountSheet({
			orders: [account("ord-a"), account("ord-b")],
			onSelect,
		});

		await wrapper.find("[data-test='mesa-sheet-account-ord-b']").trigger("click");

		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ order_uid: "ord-b" }));
	});

	it("offers the live verbs, and Release only with nothing to lose", () => {
		const withFood = mountSheet();
		expect(withFood.find("[data-test='mesa-sheet-add-items']").exists()).toBe(true);
		expect(withFood.find("[data-test='mesa-sheet-fire']").exists()).toBe(true);
		expect(withFood.find("[data-test='mesa-sheet-view']").exists()).toBe(true);
		expect(withFood.find("[data-test='mesa-sheet-transfer']").exists()).toBe(true);
		// Spec §3: releasing a table cancels its EMPTY order.
		expect(withFood.find("[data-test='mesa-sheet-release']").exists()).toBe(false);

		const empty = mountSheet({ orders: [account("ord-a", { items_count: 0, total: 0 })] });
		expect(empty.find("[data-test='mesa-sheet-release']").exists()).toBe(true);
	});

	it("keeps Send to kitchen pressable at zero unsent", () => {
		// The last line typed may still be inside the cart-sync debounce, and
		// `fireActiveCourse` flushes before it fires — gating on the count would
		// refuse the one press that matters.
		const wrapper = mountSheet({ orders: [account("ord-a", { unsent_count: 0 })] });

		expect(
			wrapper.find("[data-test='mesa-sheet-fire']").attributes("disabled"),
		).toBeUndefined();
	});

	it("badges the kitchen count when there is one", () => {
		const wrapper = mountSheet({ orders: [account("ord-a", { unsent_count: 2 })] });

		expect(wrapper.find("[data-test='mesa-sheet-fire']").text()).toContain("2");
	});

	it("ships no verb it cannot perform", () => {
		// «Imprimir cuenta» is on the artboard and has no server behind it —
		// nothing sets `bill_printed_at`. A dead button is worse than an absent
		// one on a screen whose whole promise is that every verb works.
		expect(mountSheet().html()).not.toContain("mesa-sheet-print");
	});

	it("gives a free table one honest action", () => {
		const wrapper = mountSheet({ table: table({ occupied: 0 }), orders: [], selectedUid: null });

		expect(wrapper.find("[data-test='mesa-sheet-open']").exists()).toBe(true);
		expect(wrapper.find("[data-test='mesa-sheet-add-items']").exists()).toBe(false);
	});

	it("offers cleaning, not seating, on a dirty free table", () => {
		const wrapper = mountSheet({
			table: table({ occupied: 0, needs_cleaning: 1 }),
			orders: [],
			selectedUid: null,
		});

		expect(wrapper.find("[data-test='mesa-sheet-clean']").exists()).toBe(true);
		expect(wrapper.find("[data-test='mesa-sheet-open']").exists()).toBe(false);
	});

	it("marks an unsent count on the cuenta card, in words", () => {
		const wrapper = mountSheet({ orders: [account("ord-a", { unsent_count: 2 })] });

		expect(wrapper.find("[data-test='mesa-sheet-account-ord-a']").text()).toContain(
			"not sent to the kitchen",
		);
	});
});
