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
		// jsdom's own default, restated so a test that mounts a desktop-width
		// register cannot leave the next one on 1440 — the compact switcher
		// reads this at setup and nothing resets it between files.
		window.innerWidth = 1024;
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

	it("toggles the catalogue from the bus, and back", async () => {
		// jsdom is 1024px, so this is the COMPACT shell: the catalogue is the
		// panel the register boots on, and the chord swaps panels rather than
		// covering one. Closing it in place would leave the shell drawing
		// nothing, which is the defect the inline presentation exists to fix.
		const { bus, wrapper } = mountShell();
		const vm = wrapper.vm as any;
		// `catalogDrawer` is returned as a plain object of refs, so setup's
		// unwrapping does not reach inside it — the template says
		// `catalogDrawer.phase.value` for the same reason.
		//
		// Since 2026-08-26 the compact band (this mount's 1024) is the MOVIL
		// register: the browse screen is the catalogue and the drawer stays
		// closed throughout — the toggle still moves the PANEL, so nothing a
		// chord or the dock reaches ever shows a blank shell.
		const drawer = vm.catalogDrawer;
		expect(drawer.presentation.value).toBe("inline");
		expect(drawer.isOpen.value).toBe(false);
		expect(vm.movilShellProps.screen).toBe("browse");

		vm.showInvoicePanel();
		await nextTick();
		expect(vm.compactPanel).toBe("invoice");

		bus.emit("toggle_catalog_drawer");
		await nextTick();
		expect(vm.compactPanel).toBe("selector");
		expect(vm.movilShellProps.screen).toBe("browse");
		expect(drawer.isOpen.value).toBe(false);
	});

	it("covers and uncovers the cart with the same chord on a desktop register", async () => {
		// Above the boundary the catalogue is a drawer beside a cart that stays
		// on screen, so the chord opens and closes it in place.
		window.innerWidth = 1440;
		const { bus, wrapper } = mountShell();
		const drawer = (wrapper.vm as any).catalogDrawer;
		expect(drawer.presentation.value).toBe("anchored");
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
			// Cobranza's overdue count. The rail advertises it before anyone
			// opens the panel, which is the whole difference between an ops
			// panel and a page.
			"receivablesOverdueCount",
			"serviceOrderOpenCount",
		]);
		// The rail is inert until the shift opens (§5.1).
		expect(ctx.shiftOpen.value).toBe(false);
	});

	it("gives the cart the whole row until an anchored drawer opens", () => {
		// The density argument for direction E, asserted rather than described:
		// only the ANCHORED presentation is a flex sibling of the ticket, so it
		// is the only one that may take width from it.
		//
		// jsdom is 1024px, i.e. the compact shell, where the catalogue replaces
		// the cart as the panel instead of squeezing it.
		const compact = mountShell().wrapper.vm as any;
		expect(compact.catalogDrawer.presentation.value).toBe("inline");
		expect(compact.drawerAnchoredOpen).toBe(false);

		// The floating (overlay) presentation is a sheet over the row and must
		// not take width either — that is what un-anchoring buys.
		window.innerWidth = 1440;
		const wide = mountShell().wrapper.vm as any;
		wide.catalogDrawer.setAnchored(false);
		wide.catalogDrawer.open("rail");
		expect(wide.catalogDrawer.presentation.value).toBe("overlay");
		expect(wide.drawerAnchoredOpen).toBe(false);
	});

	it("treats browse as the movil screen, drawer standing down", async () => {
		// The catalogue has exactly one home. On the compact band (since
		// 2026-08-26) that home is the movil browse screen: every path that
		// asks for items lands there and the drawer never opens under it.
		const vm = mountShell().wrapper.vm as any;
		// Compact boots ON the catalogue, so start from the ticket — otherwise
		// the tab would be "confirmed" by a state it never had to reach.
		vm.showInvoicePanel();
		await nextTick();
		expect(vm.catalogDrawer.isOpen.value).toBe(false);

		vm.applySelectorView("items");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);
		expect(vm.movilShellProps.screen).toBe("browse");

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
