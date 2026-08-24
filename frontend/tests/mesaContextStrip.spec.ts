// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { mount } from "@vue/test-utils";

/**
 * The strip that tells a waiter whose ticket they are holding.
 *
 * Golden flow §3. Before it, a mesa-owned sale and a walk-up looked identical:
 * the same customer row, the same buttons, and a round whose only trace was an
 * 800 ms debounce nobody could see. Three sentences — where this ticket lives,
 * whether the last round is safe, how to get back — and these tests pin all
 * three, plus the ordering rule that makes «Volver al salón» safe.
 */

const floorStore = reactive({
	activeOrder: null as any,
	cartSyncState: "saved" as string,
	tables: [
		{ name: "tbl-1", table_label: "Mesa 1", floor: "interior", seats: 4, needs_cleaning: 0 },
	],
	floors: [{ name: "interior", floor_name: "Interior" }],
	floorStats: { tables: 12, occupied: 6, needsCleaning: 2, openAccounts: 7, openTotal: 2296 },
});

const invoiceStore = reactive({
	posaGuestCount: 2 as number | null,
	posaServiceType: "Dine In" as string | null,
	itemsCount: 4,
});

vi.mock("../src/posapp/stores/floorStore", () => ({
	useFloorStore: () => floorStore,
}));
vi.mock("../src/posapp/stores/invoiceStore", () => ({
	useInvoiceStore: () => invoiceStore,
}));
vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value).toFixed(2)}` }),
}));

import MesaContextStrip from "../src/posapp/components/pos/invoice/MesaContextStrip.vue";

const order = {
	order_uid: "ord-a",
	table: "tbl-1",
	tab_name: "Sofía",
	guest_count: 2,
	service_type: "Dine In",
	items_count: 4,
	unsent_count: 2,
	total: 191,
	modified: "2026-08-23 09:02:00",
	status: "Open",
};

const mountStrip = (bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() }, bandTarget = "") => {
	const wrapper = mount(MesaContextStrip, {
		props: { bandBreakdownTarget: bandTarget },
		global: {
			provide: { eventBus: bus },
			stubs: { VIcon: true, Teleport: true },
		},
	});
	return { wrapper, bus };
};

beforeEach(() => {
	vi.clearAllMocks();
	floorStore.activeOrder = { ...order };
	floorStore.cartSyncState = "saved";
	invoiceStore.posaGuestCount = 2;
	invoiceStore.posaServiceType = "Dine In";
});

describe("the mesa context strip", () => {
	it("says which table and which room the ticket belongs to", () => {
		const { wrapper } = mountStrip();

		expect(wrapper.find("[data-test='mesa-context-strip']").exists()).toBe(true);
		expect(wrapper.text()).toContain("Mesa 1");
		expect(wrapper.text()).toContain("Interior");
	});

	it("reads guests and service off the CART, not the stale order row", () => {
		// Both fields are edited a few pixels below this strip and sync back on
		// the same debounce; reading the row would print the old party size the
		// moment a waiter corrects it.
		invoiceStore.posaGuestCount = 5;
		invoiceStore.posaServiceType = "Takeout";

		const { wrapper } = mountStrip();

		expect(wrapper.text()).toContain("5");
		expect(wrapper.text()).toContain("Takeout");
	});

	it("renders nothing at all when no table order owns the cart", () => {
		floorStore.activeOrder = null;

		const { wrapper } = mountStrip();

		expect(wrapper.find("[data-test='mesa-context-strip']").exists()).toBe(false);
	});

	describe("the sync chip", () => {
		const chipOf = (wrapper: any) => wrapper.find("[data-test='mesa-sync-state']");

		it("says «guardando» for both halves of the round trip", () => {
			for (const state of ["pending", "saving"]) {
				floorStore.cartSyncState = state;
				const { wrapper } = mountStrip();
				const chip = chipOf(wrapper);
				// One sentence to the waiter, two states in the DOM — the
				// debounce window and the POST are different facts and the
				// tests still need to tell them apart.
				expect(chip.text()).toContain("Saving…");
				expect(chip.attributes("data-sync-state")).toBe(state);
			}
		});

		it("settles on «guardado»", () => {
			floorStore.cartSyncState = "saved";
			expect(chipOf(mountStrip().wrapper).text()).toContain("Saved");
		});

		it("never claims saved when the push failed", () => {
			floorStore.cartSyncState = "error";
			const chip = chipOf(mountStrip().wrapper);
			expect(chip.text()).toContain("Not saved");
			expect(chip.attributes("data-sync-state")).toBe("error");
		});

		it("is announced, because it changes with nothing touched", () => {
			expect(chipOf(mountStrip().wrapper).attributes("aria-live")).toBe("polite");
		});
	});

	it("asks the SHELL for the way back rather than clearing the cart itself", async () => {
		// The ordering is the safety property: flush → detach → clear → land on
		// the floor. Clearing here would bump the cart's change version with the
		// order still attached, and the line sync would push "remove every line"
		// at the cuenta 800 ms later.
		const { wrapper, bus } = mountStrip();

		await wrapper.find("[data-test='mesa-back-to-floor']").trigger("click");

		expect(bus.emit).toHaveBeenCalledWith("floor_return_to_salon");
	});
});
