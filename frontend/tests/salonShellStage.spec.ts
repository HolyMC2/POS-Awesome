// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * The shell half of the golden flow: which column owns the stage, and which
 * verb the band offers.
 *
 * The register's primary verb is CONTEXTUAL (§0): a walk-up pays, a cuenta on a
 * table saves and goes back to the room, and Salón itself charges the selected
 * cuenta. That is one computed with three answers, and the retail branch is the
 * one that must not move — demo-abarrotes completes a sale through this band.
 */

vi.mock("../src/posapp/components/pos/Invoice.vue", () => ({
	default: { name: "Invoice", render: () => null },
}));
vi.mock("../src/posapp/components/pos/items/ItemsSelector.vue", () => ({
	default: { name: "ItemsSelector", render: () => null },
}));
vi.mock("../src/posapp/components/pos/shift/OpeningDialog.vue", () => ({
	default: { name: "OpeningDialog", render: () => null },
}));
vi.mock("../src/posapp/components/pos/offers/PosOffers.vue", () => ({
	default: { name: "PosOffers", render: () => null },
}));
vi.mock("../src/posapp/components/pos/offers/PosCoupons.vue", () => ({
	default: { name: "PosCoupons", render: () => null },
}));
vi.mock("../src/posapp/components/pos/Payments.vue", () => ({
	default: { name: "Payments", render: () => null },
}));
// FloorView is deliberately NOT mocked: the shell loads it through
// `defineAsyncComponent`, and a factory mock makes Vue's own vnode probe
// (`__v_isVNode`) hit vitest's missing-export proxy and throw. `shallow: true`
// stubs it after the module resolves, which is all this file needs.
vi.mock("@saldo/SaldoReferenciaDialog.vue", () => ({
	default: { name: "SaldoReferenciaDialog", render: () => null },
}));
vi.mock("@saldo/SaldoStatusDialog.vue", () => ({
	default: { name: "SaldoStatusDialog", render: () => null },
}));
vi.mock("@saldo/SaldoCatalogPicker.vue", () => ({
	default: { name: "SaldoCatalogPicker", render: () => null },
}));

import { createVuetify } from "vuetify";

import Pos from "../src/posapp/components/pos/shell/Pos.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { useFloorStore } from "../src/posapp/stores/floorStore";

const makeBus = () => {
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	const emit = vi.fn((event: string, payload?: unknown) => {
		for (const fn of handlers[event] ?? []) fn(payload);
	});
	return {
		on: (event: string, fn: (payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn: (payload?: unknown) => void) => {
			handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
		},
		emit,
	};
};

const mountShell = (eventBus = makeBus()) => ({
	wrapper: mount(Pos, {
		shallow: true,
		global: { plugins: [createVuetify()], provide: { eventBus } },
	}),
	eventBus,
});

const cafeteriaPreset = () =>
	useUIStore().setCapabilityPayload({
		name: "cafeteria-mesas",
		capabilities: ["tables", "tab_identity", "service_types"],
		invoice_mode: "Record Only",
		layout: { dock_tabs: ["browse", "cart", "floor", "pay"] },
	});

const tableOrder = {
	order_uid: "ord-a",
	table: "tbl-1",
	tab_name: "Sofía",
	total: 191,
	items_count: 4,
	unsent_count: 2,
	status: "Open",
	modified: "2026-08-23 09:02:00",
};

beforeEach(() => {
	setActivePinia(createPinia());
	// The two-column desktop: below 1100 the dock is the nav and no band mounts.
	Object.defineProperty(window, "innerWidth", { value: 1718, writable: true });
	Object.defineProperty(window, "innerHeight", { value: 1023, writable: true });
	vi.stubGlobal("__", (value: string) => value);
	vi.stubGlobal("frappe", {
		session: { user: "tester@example.com" },
		call: vi.fn().mockResolvedValue({ message: null }),
		db: { get_doc: vi.fn().mockResolvedValue({}) },
		realtime: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
		datetime: { nowdate: () => "2026-08-23", now_time: () => "10:00:00", get_today: () => "2026-08-23" },
		boot: { user: { roles: [] }, sysdefaults: {} },
	});
});

describe("Salón owns the stage", () => {
	it("gives the floor column all twelve and stands the sale's column down", async () => {
		cafeteriaPreset();
		const { wrapper } = mountShell();
		const vm = wrapper.vm as any;

		expect(vm.floorOwnsStage).toBe(false);
		expect(vm.floorColSpan).toBe(5);

		useUIStore().setActiveView("floor");
		await nextTick();

		expect(vm.floorOwnsStage).toBe(true);
		expect(vm.floorColSpan).toBe(12);
	});

	it("never claims the stage on a register with no tables", async () => {
		const { wrapper } = mountShell();
		useUIStore().setActiveView("floor");
		await nextTick();

		// A retail preset cannot reach `floor` legitimately, and if something
		// put it there the sale must stay on screen rather than vanishing
		// behind a column that renders nothing.
		expect((wrapper.vm as any).floorOwnsStage).toBe(false);
	});
});

describe("the band's contextual primary", () => {
	it("stays PAY for a walk-up sale — retail must not notice this round", () => {
		const vm = mountShell().wrapper.vm as any;

		expect(vm.bandState.kind).toBe("sale");
		expect(vm.bandState.primaryAction.id).toBe("sale.pay");
	});

	it("becomes SAVE · BACK TO FLOOR once a table order owns the cart", async () => {
		cafeteriaPreset();
		const { wrapper } = mountShell();
		useFloorStore().setActiveOrder(tableOrder as any);
		await nextTick();

		const state = (wrapper.vm as any).bandState;
		expect(state.kind).toBe("tableSale");
		expect(state.primaryAction.id).toBe("table.saveAndReturn");
	});

	it("adopts the floor's own band while Salón is on stage", async () => {
		cafeteriaPreset();
		const { wrapper } = mountShell();
		const vm = wrapper.vm as any;
		useUIStore().setActiveView("floor");
		vm.onFloorBand({
			kind: "floorAccount",
			tone: "neutral",
			value: 351,
			labelKey: "Open account · {0}",
			labelParams: ["Mesa 7 · Sofía"],
			primaryAction: { id: "floor.chargeAccount", labelKey: "CHARGE ACCOUNT" },
			primaryEnabled: true,
		});
		await nextTick();

		expect(vm.bandState.kind).toBe("floorAccount");
		expect(vm.bandState.value).toBe(351);
	});

	it("shows no PAY on the salón stage even before the floor has published", async () => {
		cafeteriaPreset();
		const { wrapper } = mountShell();
		useUIStore().setActiveView("floor");
		await nextTick();

		const state = (wrapper.vm as any).bandState;
		expect(state.kind).toBe("floorAccount");
		expect(state.primaryAction.id).not.toBe("sale.pay");
		expect(state.primaryEnabled).toBe(false);
	});
});

describe("the band's presses", () => {
	it("saves and returns in the one order that cannot lose the round", async () => {
		cafeteriaPreset();
		const { wrapper, eventBus } = mountShell();
		const floor = useFloorStore();
		const flush = vi.spyOn(floor, "flushCartSync").mockResolvedValue(undefined);
		floor.setActiveOrder(tableOrder as any);
		await nextTick();

		(wrapper.vm as any).onBandPrimary("table.saveAndReturn");
		// The press is fire-and-forget by design (a band handler must not block
		// the paint), so the assertions wait on the microtask queue rather than
		// on the call.
		await flushPromises();

		// Flush first (the debounce may still hold the last line), DETACH before
		// the clear (or the emptied cart syncs itself back over the cuenta),
		// then land on the room.
		expect(flush).toHaveBeenCalled();
		expect(floor.activeOrder).toBeNull();
		expect(eventBus.emit).toHaveBeenCalledWith("clear_invoice");
		expect(useUIStore().activeView).toBe("floor");
	});

	it("sends the kitchen press to the floor rather than calling the API twice", async () => {
		cafeteriaPreset();
		const { wrapper, eventBus } = mountShell();

		(wrapper.vm as any).fireMesaCourse();

		expect(eventBus.emit).toHaveBeenCalledWith("floor_fire_active_course");
	});

	it("asks the floor to hydrate before charging the selected cuenta", async () => {
		cafeteriaPreset();
		const { wrapper, eventBus } = mountShell();

		(wrapper.vm as any).onBandPrimary("floor.chargeAccount");

		expect(eventBus.emit).toHaveBeenCalledWith("floor_charge_selected_account");
	});

	it("keeps CHARGE AND PRINT wired — the retail golden flow ends there", () => {
		const { wrapper, eventBus } = mountShell();

		(wrapper.vm as any).onBandPrimary("sale.collectAndClose");

		// print: true — the band's primary is the printing close.
		expect(eventBus.emit).toHaveBeenCalledWith("queue_submit_payment_shortcut", { print: true });
	});
});
