// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import ParkedOrdersList from "../src/posapp/components/pos/invoice/ParkedOrdersList.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

const drafts = [
	{
		name: "ACC-SINV-0001",
		customer_name: "Walk-in Customer",
		posting_date: "2026-07-08",
		posting_time: "10:00:00.000000",
		grand_total: 125,
		currency: "PKR",
	},
	{
		name: "ACC-SINV-0002",
		customer_name: "MedPlus Customer",
		posting_date: "2026-07-08",
		posting_time: "10:05:00.000000",
		grand_total: 250,
		currency: "PKR",
	},
];

describe("ParkedOrdersList keyboard control", () => {
	beforeEach(() => {
		setActivePinia(createPinia()); // ParkedOrdersList uses verticalStore
		vi.stubGlobal("__", (value: string) => value);
	});

	afterEach(() => {
		document.body.innerHTML = "";
		vi.unstubAllGlobals();
	});

	function mountList(parkedOrders: Record<string, unknown>[] = drafts) {
		const onResume = vi.fn();
		const onClose = vi.fn();
		const wrapper = mount(ParkedOrdersList, {
			attachTo: document.body,
			props: {
				parkedOrders,
				formatCurrency: (value: number) => String(value),
				currencySymbol: () => "Rs ",
				showManageAll: true,
				onResume,
				onClose,
			},
			global: {
				stubs: {
					VBtn: {
						template: "<button type=\"button\"><slot /></button>",
					},
					VProgressCircular: {
						template: "<span />",
					},
				},
			},
		});
		return { wrapper, onResume, onClose };
	}

	it("focuses drafts and opens the selected row with arrow keys and Enter", async () => {
		const { wrapper, onResume } = mountList();

		await (wrapper.vm as any).focusFirstDraft();

		const cards = wrapper.findAll(".drafts-list__card");
		expect(document.activeElement).toBe(cards[0].element);

		await cards[0].trigger("keydown", { key: "ArrowDown" });
		expect(document.activeElement).toBe(cards[1].element);

		await cards[1].trigger("keydown", { key: "Enter" });

		expect(onResume).toHaveBeenCalledWith(drafts[1]);
	});

	it("closes from Escape without opening a draft", async () => {
		const { wrapper, onResume, onClose } = mountList();

		await (wrapper.vm as any).focusFirstDraft();
		const cards = wrapper.findAll(".drafts-list__card");
		await cards[0].trigger("keydown", { key: "Escape" });

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(onResume).not.toHaveBeenCalled();
	});

	it("renders the service type through the preset's vocabulary, not __()", () => {
		// Same contract as the rail: the row noun resolves through
		// verticalStore.t(), so a preset can rename it per vertical.
		useUIStore().setCapabilityPayload({
			name: "coffee-quickserve",
			labels: { Takeout: "Para llevar" },
		});

		const { wrapper } = mountList([{ ...drafts[0], posa_rt_service_type: "Takeout" }]);

		expect(wrapper.text()).toContain("Para llevar");
		expect(wrapper.text()).not.toContain("Takeout");
	});

	describe("loading draws the shape of what is coming, not a spinner", () => {
		// Native-feel round 2. A spinner says "something is happening"; four
		// ghost cards say "four records are on their way and this is the shape
		// they will take", which is the only useful thing a loading state can
		// say — and it is the difference between a list that appears and a
		// list that jumps into place.
		const mountLoading = () =>
			mount(ParkedOrdersList, {
				props: {
					parkedOrders: [],
					loading: true,
					formatCurrency: (value: number) => String(value),
					currencySymbol: () => "Rs ",
				},
				global: { stubs: { VBtn: { template: '<button type="button"><slot /></button>' } } },
			});

		it("draws ghost cards instead of a progress circle", () => {
			const wrapper = mountLoading();

			expect(wrapper.findComponent({ name: "VProgressCircular" }).exists()).toBe(false);
			expect(wrapper.findAll(".drafts-list__card--ghost")).toHaveLength(4);
		});

		it("wears the REAL card class, so the box cannot drift from the card", () => {
			// Not a copy of the card's numbers — the card's own rule. A border,
			// a radius or a padding edited in one place and not the other is a
			// jump on every draft load.
			const ghost = mountLoading().get(".drafts-list__card--ghost");
			expect(ghost.classes()).toContain("drafts-list__card");
		});

		it("keeps the wording for a screen reader and shows none of it", () => {
			const list = mountLoading().get('[data-test="drafts-list-loading"]');

			expect(list.attributes("role")).toBe("status");
			expect(list.attributes("aria-busy")).toBe("true");
			expect(list.attributes("aria-label")).toBe("Loading records...");
			expect(list.text()).toBe("");
		});

		it("shows the empty message once the load finishes with nothing", () => {
			const { wrapper } = mountList([]);

			expect(wrapper.find('[data-test="drafts-list-loading"]').exists()).toBe(false);
			expect(wrapper.text()).toContain("No records found");
		});
	});
});
