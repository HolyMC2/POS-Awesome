// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
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
// Lazily loaded by the shell the moment activeView becomes "payment", which the
// Pay -> Cart tests below do. Stubbed for the same reason as the leaves above:
// these assert shell state, not the payment screen.
vi.mock("../src/posapp/components/pos/Payments.vue", () => ({
	default: { name: "Payments", render: () => null },
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

describe("POS shell dock Pay busy state", () => {
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

	const payTab = (vm: any) => vm.dockTabs.find((t: any) => t.id === "pay");

	it("marks Pay busy while the payment round-trip is open, and only Pay", () => {
		const ui = useUIStore();
		const vm = mountShell().vm as any;

		expect(payTab(vm).busy()).toBe(false);

		ui.beginPaymentRequest();

		expect(payTab(vm).busy()).toBe(true);
		// The other tabs are local view switches with no round-trip to wait on.
		for (const tab of vm.dockTabs.filter((t: any) => t.id !== "pay")) {
			expect(tab.busy).toBeUndefined();
		}

		ui.endPaymentRequest();
		expect(payTab(vm).busy()).toBe(false);
	});

	it("gives Pay back if the request never settles, rather than wedging the till", () => {
		vi.useFakeTimers();
		try {
			const ui = useUIStore();
			const vm = mountShell().vm as any;

			ui.beginPaymentRequest();
			expect(payTab(vm).busy()).toBe(true);

			// A normal round-trip is ~1s, so the watchdog must not fire under it.
			vi.advanceTimersByTime(5000);
			expect(payTab(vm).busy()).toBe(true);

			vi.advanceTimersByTime(20000);
			expect(payTab(vm).busy()).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("says it is working in the accessible name, not just the dimming", () => {
		const ui = useUIStore();
		const vm = mountShell().vm as any;

		expect(payTab(vm).ariaLabel()).toBe("Pay");

		ui.beginPaymentRequest();

		expect(payTab(vm).ariaLabel()).toContain("Processing");
	});
});

/**
 * Pay → Cart used to land the cashier on Browse with the item search focused,
 * which pops the Android keyboard — it read as being thrown out of the sale.
 * showInvoicePanel set the panel and then changed activeView, and the activeView
 * watcher answered that change by forcing the selector panel straight back.
 * Needs a phone width: at >= 992 payment is a dialog and the path never runs.
 */
describe("POS shell Pay → Cart navigation", () => {
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
		// useResponsive samples window.innerWidth once at setup, so this has to
		// be set before the shell mounts.
		Object.defineProperty(window, "innerWidth", {
			value: 480,
			writable: true,
			configurable: true,
		});
	});

	/** Puts the shell in the state a cashier is in with the payment screen open. */
	const mountOnInlinePayment = async (bus = makeBus()) => {
		const ui = useUIStore();
		const vm = mountShell(bus).vm as any;
		ui.setActiveView("payment");
		await nextTick();
		expect(vm.compactPanel).toBe("selector");
		return { ui, vm, bus };
	};

	it("lands on the cart, not Browse, when Cart is tapped from the payment view", async () => {
		const { ui, vm } = await mountOnInlinePayment();

		vm.dockTabs.find((t: any) => t.id === "cart").onTap();
		await nextTick();

		expect(vm.compactPanel).toBe("invoice");
		expect(ui.activeView).toBe("items");
	});

	it("takes the customer chip to the cart from the payment view too", async () => {
		// jumpToCustomer routes through showInvoicePanel, so it inherits the fix
		// rather than needing its own.
		const { ui, vm } = await mountOnInlinePayment();

		vm.jumpToCustomer();
		await nextTick();

		expect(vm.compactPanel).toBe("invoice");
		expect(ui.activeView).toBe("items");
	});

	it("keeps honouring later selector reveals — the suppression is one-shot", async () => {
		// The tempting fix (bail out of the watcher whenever the invoice panel is
		// showing) would swallow these: type-to-search, the Alt shortcuts, and the
		// offers/coupons panels all reveal the selector by changing activeView.
		const { ui, vm } = await mountOnInlinePayment();

		vm.dockTabs.find((t: any) => t.id === "cart").onTap();
		await nextTick();
		expect(vm.compactPanel).toBe("invoice");

		ui.setActiveView("offers");
		await nextTick();

		expect(vm.compactPanel).toBe("selector");
	});

	it("answers show_invoice_panel from the payment view by landing on the cart", async () => {
		// Payments.vue's Cancel emits this instead of moving the view itself.
		const { ui, vm, bus } = await mountOnInlinePayment();

		bus.emit("show_invoice_panel");
		await nextTick();

		expect(vm.compactPanel).toBe("invoice");
		expect(ui.activeView).toBe("items");
	});

	it("answers show_invoice_panel synchronously, so the caller's fallback stands down", async () => {
		// Payments.vue checks activeView immediately after emitting and falls
		// back to the Browse exit if it is still "payment". That fallback is
		// correct only while mitt dispatches inline — if the shell ever answered
		// on a later tick, Cancel would silently go back to shipping the bug.
		const { ui, bus } = await mountOnInlinePayment();

		bus.emit("show_invoice_panel");

		expect(ui.activeView).toBe("items");
	});

	it("leaves the plain Cart tap alone when payment was never open", async () => {
		const ui = useUIStore();
		const vm = mountShell().vm as any;
		expect(ui.activeView).toBe("items");

		vm.dockTabs.find((t: any) => t.id === "cart").onTap();
		await nextTick();

		// No activeView change, so nothing to suppress and nothing to clobber.
		expect(vm.compactPanel).toBe("invoice");
		expect(ui.activeView).toBe("items");
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
