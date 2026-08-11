// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

// The shell statically imports the whole panel graph; stub the leaves so this
// smoke test exercises the shell itself (same technique as viewRegistry.spec).
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

/** Minimal mitt stand-in — the shell registers real bus listeners on mount. */
const makeBus = () => {
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	return {
		on: (event: string, fn: (payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn: (payload?: unknown) => void) => {
			handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
		},
		emit: (event: string, payload?: unknown) => {
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

const mountShell = (eventBus: ReturnType<typeof makeBus> = makeBus()) =>
	mount(Pos, {
		shallow: true,
		global: {
			plugins: [createVuetify()],
			provide: { eventBus },
		},
	});

describe("POS shell dock tabs", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		// The shell's mounted() hook talks to the desk API on the way in;
		// nothing here is under test, it just has to not explode.
		vi.stubGlobal("frappe", {
			session: { user: "tester@example.com" },
			call: vi.fn().mockResolvedValue({ message: null }),
			db: { get_doc: vi.fn().mockResolvedValue({}) },
			realtime: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
			datetime: {
				nowdate: () => "2026-08-10",
				now_time: () => "10:00:00",
				get_today: () => "2026-08-10",
			},
			boot: { user: { roles: [] }, sysdefaults: {} },
		});
	});

	it("mounts with retail defaults and renders the five retail dock tabs", () => {
		const wrapper = mountShell();

		expect(wrapper.vm).toBeTruthy();
		const tabs = (wrapper.vm as any).dockTabs;
		expect(tabs.map((t: any) => t.id)).toEqual([
			"browse",
			"offers",
			"cart",
			"coupons",
			"pay",
		]);
		// Every tab arrived with the chrome the dock template reads — an id
		// with no DOCK_TAB_DEFS entry would be filtered out above instead.
		for (const tab of tabs) {
			expect(typeof tab.icon).toBe("string");
			expect(typeof tab.label()).toBe("string");
			expect(typeof tab.onTap).toBe("function");
		}
	});

	it("narrows the dock to the ids a capability preset names", () => {
		useUIStore().setCapabilityPayload({
			name: "coffee-quickserve",
			layout: { dock_tabs: ["browse", "cart", "pay"] },
		});

		const vm = mountShell().vm as any;
		expect(vm.dockTabs.map((t: any) => t.id)).toEqual(["browse", "cart", "pay"]);
		expect(vm.dockTabCount).toBe(3);
	});

	it("never publishes a tab count of 0 — repeat(0, …) collapses the grid", () => {
		// Every id unknown to the build gets filtered out, so the dock can
		// legitimately end up empty; the CSS track count must still be valid.
		useUIStore().setCapabilityPayload({
			name: "broken-preset",
			layout: { dock_tabs: ["not-a-tab"] },
		});

		const vm = mountShell().vm as any;
		expect(vm.dockTabs).toEqual([]);
		expect(vm.dockTabCount).toBe(1);
	});
});

describe("POS shell dock discount row", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "tester@example.com" },
			call: vi.fn().mockResolvedValue({ message: null }),
			db: { get_doc: vi.fn().mockResolvedValue({}) },
			realtime: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
			datetime: {
				nowdate: () => "2026-08-10",
				now_time: () => "10:00:00",
				get_today: () => "2026-08-10",
			},
			boot: { user: { roles: [] }, sysdefaults: {} },
		});
	});

	const profile = (fields: Record<string, unknown>) =>
		({ name: "P1", company: "Doco", currency: "MXN", ...fields }) as any;

	it("opens on the shortcut when the operator may edit the discount", () => {
		useUIStore().setPosProfile(profile({ posa_allow_user_to_edit_additional_discount: 1 }));
		const bus = makeBus();
		const wrapper = mountShell(bus);

		bus.emit("focus_additional_discount");

		expect((wrapper.vm as any).showDockDiscountToggle).toBeTruthy();
		expect((wrapper.vm as any).dockDiscountOpen).toBe(true);
	});

	it("stays shut on the shortcut when editing is disallowed", () => {
		// The collapse control is v-if'd on showDockDiscountToggle, so opening
		// the row here would strand a disabled field with no way to close it.
		useUIStore().setPosProfile(profile({ posa_allow_user_to_edit_additional_discount: 0 }));
		const bus = makeBus();
		const wrapper = mountShell(bus);

		bus.emit("focus_additional_discount");

		expect((wrapper.vm as any).showDockDiscountToggle).toBeFalsy();
		expect((wrapper.vm as any).dockDiscountOpen).toBe(false);
	});
});
