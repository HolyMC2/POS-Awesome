// @vitest-environment jsdom

/**
 * The compact register lands on the catalogue, and Browse is not the slow tab.
 *
 * Two defects, one cause. The register's ONE `ItemsSelector` lives in the
 * catalogue drawer's persistent slot, and the drawer boots closed — so below
 * the two-column boundary the shell had every column hidden at boot and drew
 * nothing at all. And the only presentation a 390px phone could get was the
 * modal `overlay`, so the dock's Browse tab animated a sheet in while Cart,
 * Ofertas and Cupones flipped instantly beside it.
 *
 * The `inline` presentation answers both: the catalogue becomes one of the
 * dock's panels rather than a drawer over one. This file covers the policy
 * (the composable) and the shell rule that keeps the panel and the drawer from
 * disagreeing — the half that only exists once the shell is mounted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";

// Same leaf-stubbing as tests/posShellDockTabs.spec.ts: the shell statically
// imports the whole panel graph, and none of it is under test here.
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
import {
	useCatalogDrawer,
	type CatalogCategory,
} from "../src/posapp/composables/pos/shell/useCatalogDrawer";

const CATEGORIES: CatalogCategory[] = [
	{ id: "combos", label: "Combos", count: 6, featured: true },
	{ id: "fundas", label: "Fundas", count: 18 },
];

function makeDrawer(width: number, compact: boolean) {
	const viewportWidth = ref(width);
	const isCompact = ref(compact);
	const drawer = useCatalogDrawer({
		registerId: ref("Caja 2"),
		viewportWidth,
		categories: computed(() => CATEGORIES),
		compact: isCompact,
	});
	return { drawer, viewportWidth, isCompact };
}

describe("inline is a panel, not a drawer", () => {
	it("presents inline wherever the shell says it is compact, at any width", () => {
		// Width is not the question a lean vertical preset answers: it shows one
		// panel at a time on a 1440px screen too, and anchoring 400px beside a
		// cart that is off screen would draw half a layout.
		expect(makeDrawer(390, true).drawer.presentation.value).toBe("inline");
		expect(makeDrawer(1440, true).drawer.presentation.value).toBe("inline");
		expect(makeDrawer(1440, false).drawer.presentation.value).toBe("anchored");
		expect(makeDrawer(900, false).drawer.presentation.value).toBe("overlay");
	});

	it("is not modal: no scrim, no focus trap, no scroll lock", () => {
		// The three properties that would make the compact catalogue a sheet
		// over the register instead of the register's current panel.
		document.body.style.overflow = "scroll";
		const { drawer } = makeDrawer(390, true);
		drawer.open("empty-cart");

		expect(drawer.isModal.value).toBe(false);
		expect(drawer.showsScrim.value).toBe(false);
		expect(drawer.trapsFocus.value).toBe(false);
		expect(drawer.locksScroll.value).toBe(false);
		expect(document.body.style.overflow).toBe("scroll");
		document.body.style.overflow = "";
	});

	it("switches instantly, opening and closing", () => {
		// The dock's other destinations are `v-show` flips. A Browse tab that
		// animates is the slow one, which is exactly how it read on a phone.
		const { drawer } = makeDrawer(390, true);
		drawer.open("empty-cart");
		expect(drawer.transitionDurationMs.value).toBe(0);
		drawer.close();
		expect(drawer.transitionDurationMs.value).toBe(0);
	});

	it("never offers the anchor chip it cannot honour", () => {
		// `fitsAnchored` stays a geometry answer; `canAnchor` is the one the
		// chip reads, and a wide lean register still has nothing to anchor to.
		const wideCompact = makeDrawer(1440, true).drawer;
		expect(wideCompact.fitsAnchored.value).toBe(true);
		expect(wideCompact.canAnchor.value).toBe(false);

		expect(makeDrawer(1440, false).drawer.canAnchor.value).toBe(true);
		expect(makeDrawer(900, false).drawer.canAnchor.value).toBe(false);
	});

	it("hands the drawer back to geometry when the shell stops being compact", () => {
		const { drawer, isCompact } = makeDrawer(1440, true);
		expect(drawer.presentation.value).toBe("inline");
		isCompact.value = false;
		expect(drawer.presentation.value).toBe("anchored");
	});
});

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

const mountShell = (width: number, bus = makeBus()) => {
	window.innerWidth = width;
	return mount(Pos, {
		shallow: true,
		global: {
			plugins: [createVuetify()],
			provide: { eventBus: bus },
		},
	});
};

/** The 0ms settle timer the instant presentations schedule. */
const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await nextTick();
};

const tap = (vm: any, id: string) => vm.dockTabs.find((tab: any) => tab.id === id).onTap();

describe("the compact shell lands on the catalogue", () => {
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

	it("boots showing the grid rather than a blank panel", async () => {
		// TABLET compact (768–1099): the catalogue drawer is the grid, as it
		// has been since the landing rule shipped.
		const vm = mountShell(900).vm as any;
		await settle();

		expect(vm.catalogDrawer.presentation.value).toBe("inline");
		expect(vm.catalogDrawer.isOpen.value).toBe(true);
		// A landing, not a resume: the featured category, not wherever this
		// register happened to be last.
		expect(vm.catalogDrawer.openReason.value).toBe("empty-cart");
		expect(vm.compactPanel).toBe("selector");
	});

	it("boots a PHONE onto the movil browse screen, drawer closed", async () => {
		// Below useResponsive's phone boundary the movil shell IS the grid
		// (2026-08-25): the drawer stands down so the catalogue is not drawn
		// twice, and its persistent slot keeps ItemsSelector mounted anyway.
		// The protected invariant is unchanged: no blank panel at boot.
		const vm = mountShell(390).vm as any;
		await settle();

		expect(vm.compactPanel).toBe("selector");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);
		expect(vm.movilStageActive).toBe(true);
		expect(vm.movilShellProps.screen).toBe("browse");
	});

	it("follows the dock between the ticket and the catalogue", async () => {
		// Tablet width: the drawer keeps answering the dock.
		const wrapper = mountShell(900);
		const vm = wrapper.vm as any;
		await settle();

		tap(vm, "cart");
		await settle();
		expect(vm.compactPanel).toBe("invoice");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);

		tap(vm, "browse");
		await settle();
		expect(vm.compactPanel).toBe("selector");
		expect(vm.catalogDrawer.isOpen.value).toBe(true);
		// The point of the whole change: Browse costs the same as Cart did.
		expect(vm.catalogDrawer.transitionDurationMs.value).toBe(0);
	});

	it("follows the dock between the movil screens on a phone", async () => {
		const wrapper = mountShell(390);
		const vm = wrapper.vm as any;
		await settle();

		tap(vm, "cart");
		await settle();
		expect(vm.compactPanel).toBe("invoice");
		expect(vm.movilCartActive).toBe(true);
		expect(vm.movilShellProps.screen).toBe("cart");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);

		tap(vm, "browse");
		await settle();
		expect(vm.compactPanel).toBe("selector");
		expect(vm.movilShellProps.screen).toBe("browse");
		// The drawer never opens on the phone; the browse screen is the grid.
		expect(vm.catalogDrawer.isOpen.value).toBe(false);
	});

	it("draws the movil keypad on the phone's payment view, Payments staying mounted behind it", async () => {
		const vm = mountShell(390).vm as any;
		await settle();

		// The pre-payment validation path (Invoice.vue) owns the transition
		// to the payment view; here we place the shell there directly.
		vm.uiStore?.setActiveView?.("payment");
		await settle();

		expect(vm.compactPanel).toBe("selector");
		expect(vm.movilPayActive).toBe(true);
		expect(vm.movilShellProps.screen).toBe("pay");

		// «Dividir pago» falls back to the classic Payments panel.
		vm.onMovilSplit();
		await settle();
		expect(vm.movilPayActive).toBe(false);
	});

	it("collect rides the bus into the money path, printing close by default", async () => {
		const emitted: Array<[string, unknown]> = [];
		const bus = makeBus();
		const origEmit = bus.emit;
		bus.emit = (event: string, payload?: unknown) => {
			emitted.push([event, payload]);
			origEmit(event, payload);
		};
		const vm = mountShell(390, bus).vm as any;
		await settle();

		vm.onMovilCollect({ mode: "Cash", amount: 120, amountMinor: 12000 });
		const collect = emitted.find(([event]) => event === "movil_collect_payment");
		expect(collect).toBeTruthy();
		expect(collect?.[1]).toEqual({ mode: "Cash", amount: 120, print: true });
	});

	it("fronts a selected service order with the movil screen, and back deselects in the surface", async () => {
		const emitted: Array<[string, unknown]> = [];
		const bus = makeBus();
		const origEmit = bus.emit;
		bus.emit = (event: string, payload?: unknown) => {
			emitted.push([event, payload]);
			origEmit(event, payload);
		};
		const vm = mountShell(390, bus).vm as any;
		await settle();

		// The destination is up but nothing is selected: the hosted QUEUE
		// stays the stage (it owns search and selection).
		vm.hostedDestinationId = "serviceOrder";
		await settle();
		expect(vm.movilOrdenActive).toBe(false);
		expect(vm.movilStageActive).toBe(false);

		// The surface publishes a loaded selection → the movil screen fronts.
		vm.movilOrdenDetail = {
			name: "SO-0001",
			folio: "B-04812",
			customer: "CUST-1",
			customer_name: "Cliente Uno",
			title: "iPhone 12",
			serials: ["356789012345678"],
			advance: 200,
			repair_status: "Ready for pickup",
			lines: [
				{ item_code: "SCR-1", item_name: "Pantalla", qty: 1, rate: 1450, amount: 1450, kind: "part" },
			],
		};
		await settle();
		expect(vm.movilOrdenActive).toBe(true);
		expect(vm.movilShellProps.screen).toBe("orden");
		expect(vm.movilShellProps.ordenView?.orderId).toBe("B-04812");

		// Back = deselect where the selection lives.
		vm.onMovilOrdenBack();
		expect(emitted.some(([event]) => event === "orden:deselect")).toBe(true);

		// Leaving the destination clears the published detail.
		vm.hostedDestinationId = null;
		await settle();
		expect(vm.movilOrdenDetail).toBe(null);
	});

	it("falls back to the classic cart when a movil line is tapped, and returns on the dock", async () => {
		const wrapper = mountShell(390);
		const vm = wrapper.vm as any;
		await settle();

		tap(vm, "cart");
		await settle();
		expect(vm.movilCartActive).toBe(true);

		// The line editor lives in the classic cart until the movil line
		// sheet ships; a tapped line hands over rather than dead-ends.
		vm.onMovilSelectLine();
		await settle();
		expect(vm.movilCartActive).toBe(false);
		expect(vm.compactPanel).toBe("invoice");

		// Re-asking for the cart on the dock returns to the movil screen.
		tap(vm, "cart");
		await settle();
		expect(vm.movilCartActive).toBe(true);
	});

	it("gives the catalogue up to the panels that have a column of their own", async () => {
		// Ofertas is the other `selector` view. Two panels drawn at once is the
		// defect this rule prevents, and it is why the rule reads `items` and
		// not merely `selector`.
		const vm = mountShell(390).vm as any;
		await settle();

		tap(vm, "offers");
		await settle();
		expect(vm.activeView).toBe("offers");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);
	});

	it("closes onto the ticket, never onto nothing", async () => {
		const vm = mountShell(390).vm as any;
		await settle();

		vm.closeCatalogDrawer();
		await settle();

		expect(vm.compactPanel).toBe("invoice");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);
	});

	it("leaves the desktop register exactly as it was", async () => {
		// The rail's Browse still opens the drawer deliberately; a desktop that
		// booted with the catalogue up would have given away the ticket width
		// direction E exists to win back.
		const vm = mountShell(1440).vm as any;
		await settle();

		expect(vm.catalogDrawer.presentation.value).toBe("anchored");
		expect(vm.catalogDrawer.isOpen.value).toBe(false);
		expect(vm.railVisible).toBe(true);
	});
});
