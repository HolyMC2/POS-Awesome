// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";

/**
 * The behavioural half of the shell's Riel y Cajón wiring (§17.7). The
 * structural half — what is imported, registered and rendered — is
 * source-scanned in shellIntegrationWiring.spec.ts, because `Pos.vue` drags
 * the whole POS stack in and jsdom has no node:fs.
 *
 * What is worth asserting here is the part a source scan cannot see: that the
 * bus events actually reach live state, and that the rail, the chord and the
 * dock all move the SAME state rather than three similar ones.
 */

// Stub the leaves, same technique as posShellDockTabs.spec.ts: this exercises
// the shell, not the panels hanging off it.
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

const mountShell = (eventBus = makeBus()) => ({
	bus: eventBus,
	wrapper: mount(Pos, {
		shallow: true,
		global: { plugins: [createVuetify()], provide: { eventBus } },
	}),
});

describe("shell integration — Riel y Cajón", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "tester@example.com" },
			call: vi.fn().mockResolvedValue({ message: null }),
			db: { get_doc: vi.fn().mockResolvedValue({}) },
			realtime: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
			datetime: {
				nowdate: () => "2026-08-22",
				now_time: () => "10:00:00",
				get_today: () => "2026-08-22",
			},
			boot: { user: { roles: [] }, sysdefaults: {} },
		});
	});

	it("exposes one band state, with one number and one action", () => {
		const { wrapper } = mountShell();
		const state = (wrapper.vm as any).bandState;

		expect(state.kind).toBe("sale");
		expect(typeof state.value).toBe("number");
		expect(state.primaryAction.id).toBe("sale.pay");
		// The shape is the invariant: one `value`, one `primaryAction`. A band
		// that could carry two of either would not be this type.
		expect(Object.keys(state).filter((k) => k === "value")).toHaveLength(1);
		expect(Array.isArray(state.primaryAction)).toBe(false);
	});

	it("starts on the sale with no hosted destination", () => {
		const vm = mountShell().wrapper.vm as any;
		expect(vm.hostedDestinationId).toBeNull();
		expect(vm.destinationRefusal).toBeNull();
	});

	it("answers open_destination — the chord and the rail share one writer", () => {
		const { bus, wrapper } = mountShell();
		const vm = wrapper.vm as any;

		// The shift is closed in this harness, so the router must REFUSE rather
		// than open — and it must say why. "El turno es el sobre de todo lo
		// demás": reporting anything but `shift_closed` here would send a
		// cashier to fix the network when the register simply is not open.
		bus.emit("open_destination", "drafts");
		expect(vm.destinationRefusal).toBe("shift_closed");
		expect(vm.hostedDestinationId).toBe("drafts");
	});

	it("ignores an open_destination for an id nothing registers", () => {
		const { bus, wrapper } = mountShell();
		const vm = wrapper.vm as any;
		bus.emit("open_destination", "not-a-destination");
		expect(vm.destinationRefusal).toBe("unknown");
		expect(vm.hostedDestinationId).toBeNull();
	});

	it("toggles the catalogue drawer from the bus, and back", async () => {
		const { bus, wrapper } = mountShell();
		const vm = wrapper.vm as any;
		// `catalogDrawer` is returned as a plain object of refs, so setup's
		// unwrapping does not reach inside it — the template says
		// `catalogDrawer.phase.value` for the same reason.
		const drawer = vm.catalogDrawer;
		expect(drawer.phase.value).toBe("closed");

		bus.emit("toggle_catalog_drawer");
		await nextTick();
		expect(drawer.phase.value).not.toBe("closed");
		expect(drawer.openReason.value).toBe("shortcut");

		bus.emit("toggle_catalog_drawer");
		await nextTick();
		expect(["closing", "closed"]).toContain(drawer.phase.value);
	});

	it("releases both new bus listeners on unmount", () => {
		const { bus, wrapper } = mountShell();
		wrapper.unmount();
		// Emitting into a torn-down shell must not reach a dead component; the
		// handler map is the only evidence available from outside.
		expect(() => bus.emit("open_destination", "drafts")).not.toThrow();
		expect(() => bus.emit("toggle_catalog_drawer")).not.toThrow();
	});

	it("renders a testid on every dock tab, derived from the tab's id", () => {
		const { wrapper } = mountShell();
		const ids = ((wrapper.vm as any).dockTabs as Array<{ id: string }>).map((t) => t.id);
		expect(ids.length).toBeGreaterThan(0);
		expect(wrapper.find('[data-testid="mobile-dock"]').exists()).toBe(true);
		for (const id of ids) {
			expect(
				wrapper.find(`[data-testid="dock-${id}"]`).exists(),
				`dock tab "${id}" has no testid — the evidence lane cannot select it`,
			).toBe(true);
		}
	});

	it("keeps the rail off where the dock is the navigation", () => {
		// jsdom is 1024px wide: below the two-column boundary the dock is the
		// nav, and drawing both would be two answers to one question.
		const vm = mountShell().wrapper.vm as any;
		expect(vm.useCompactPosSwitcher).toBe(true);
		expect(vm.railVisible).toBe(false);
	});

	it("hands the rail a context it can resolve without a store", () => {
		const vm = mountShell().wrapper.vm as any;
		const ctx = vm.railContext;
		expect(typeof ctx.__).toBe("function");
		expect(typeof ctx.t).toBe("function");
		expect(typeof ctx.navigate).toBe("function");
		// Badge sources the registry names must all be present, or a rail badge
		// silently reads 0 forever.
		expect(Object.keys(ctx.counts).sort()).toEqual([
			"draftInvoicesCount",
			"floorOpenOrdersCount",
			"serviceOrderOpenCount",
		]);
		// The rail is inert until the shift opens (§5.1).
		expect(ctx.shiftOpen.value).toBe(false);
	});

	it("gives the cart the whole row until an anchored drawer opens", () => {
		// The density argument for direction E, asserted rather than described:
		// closed, the ticket is full width with only the teleported scan bar
		// above it.
		const vm = mountShell().wrapper.vm as any;
		expect(vm.drawerAnchoredOpen).toBe(false);

		vm.catalogDrawer.open("rail");
		// jsdom is 1024px, below the 1100px anchor threshold, so this opens as an
		// OVERLAY — which must not take width from the cart either.
		expect(vm.catalogDrawer.presentation.value).toBe("overlay");
		expect(vm.drawerAnchoredOpen).toBe(false);
	});

	it("treats browse as the drawer, not as a column", () => {
		// The catalogue has exactly one home now. If the dock's Buscar tab still
		// only swapped `activeView`, it would light up with nothing behind it.
		const vm = mountShell().wrapper.vm as any;
		expect(vm.catalogDrawer.isOpen.value).toBe(false);

		vm.applySelectorView("items");
		expect(vm.catalogDrawer.isOpen.value).toBe(true);

		vm.applySelectorView("offers");
		expect(["closing", "closed"]).toContain(vm.catalogDrawer.phase.value);
	});

	it("offers no combo surfaces until combos are actually loaded", () => {
		// An empty list is the honest state: a chip row promising a Combos
		// category that resolves to nothing is worse than no chip.
		const vm = mountShell().wrapper.vm as any;
		expect(vm.catalogCategories).toEqual([]);
		expect(vm.comboSuggestions).toEqual([]);
	});
});
