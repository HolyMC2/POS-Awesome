import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
	DOCK_TAB_IDS,
	buildDockTabDefs,
	type DockTabContext,
} from "../src/posapp/vertical/viewContracts";

/**
 * `serviceOrder` promotes Orden de servicio from a dialog to a dock
 * destination (roadmap §17.6 addendum). The repair preset spends `floor` —
 * which it never uses — on this tab.
 *
 * The id is English while the label is Spanish, on purpose: ids share one
 * namespace with the rail's destinations, wording goes through `t()`.
 */

const makeCtx = (over: Partial<DockTabContext> = {}): DockTabContext => ({
	__: (key: string) => key,
	t: (key: string) => key,
	offersCount: ref(0),
	couponsCount: ref(0),
	itemsCount: ref(0),
	floorOpenOrdersCount: ref(0),
	serviceOrderOpenCount: ref(0),
	activeView: ref("items"),
	compactPanel: ref("selector"),
	paymentPending: ref(false),
	isSelectorViewActive: () => false,
	setSelectorView: () => {},
	showInvoicePanel: () => {},
	triggerInvoicePay: () => {},
	...over,
});

describe("the serviceOrder dock tab", () => {
	it("is appended last, so no configured dock reorders", () => {
		// Presets store their tabs as a CSV of these ids. Inserting in the middle
		// would silently reshuffle every dock already saved in the field.
		expect(DOCK_TAB_IDS[DOCK_TAB_IDS.length - 1]).toBe("serviceOrder");
		expect([...DOCK_TAB_IDS]).toEqual([
			"browse",
			"offers",
			"cart",
			"coupons",
			"pay",
			"floor",
			"serviceOrder",
		]);
	});

	it("badges the orders still owed to this register", () => {
		const defs = buildDockTabDefs(makeCtx({ serviceOrderOpenCount: ref(4) }));

		expect(defs.serviceOrder.badge?.()).toBe(4);
		expect(defs.serviceOrder.badgeSm).toBe(true);
	});

	it("shows no badge when nothing is owed", () => {
		// Pos.vue renders the pill on `tab.badge && tab.badge()`, so 0 must stay
		// falsy rather than paint an empty amber dot.
		const defs = buildDockTabDefs(makeCtx({ serviceOrderOpenCount: ref(0) }));

		expect(defs.serviceOrder.badge?.()).toBe(0);
	});

	it("takes its label from the vertical resolver, not a plain translation", () => {
		// A repair counter says "Órdenes de servicio"; a retail register that
		// never enables the tab has no word for it at all — same reasoning that
		// puts "Floor" through `t()` and makes it "Salón".
		const t = vi.fn((key: string) => (key === "Service Orders" ? "Órdenes de servicio" : key));
		const __ = vi.fn((key: string) => key);
		const defs = buildDockTabDefs(makeCtx({ t, __ }));

		expect(defs.serviceOrder.label()).toBe("Órdenes de servicio");
		expect(t).toHaveBeenCalledWith("Service Orders");
		expect(__).not.toHaveBeenCalledWith("Service Orders");
	});

	it("names the count in its accessible label", () => {
		const t = (key: string) => (key === "Service Orders" ? "Órdenes de servicio" : key);
		const defs = buildDockTabDefs(makeCtx({ t, serviceOrderOpenCount: ref(4) }));

		expect(defs.serviceOrder.ariaLabel()).toBe("Órdenes de servicio — 4");
	});

	it("drops the dash when there is nothing to announce", () => {
		const t = (key: string) => (key === "Service Orders" ? "Órdenes de servicio" : key);
		const defs = buildDockTabDefs(makeCtx({ t, serviceOrderOpenCount: ref(0) }));

		expect(defs.serviceOrder.ariaLabel()).toBe("Órdenes de servicio");
	});

	it("is active only on its own view", () => {
		const activeView = ref("serviceOrder");
		const defs = buildDockTabDefs(makeCtx({ activeView }));

		expect(defs.serviceOrder.isActive()).toBe(true);

		activeView.value = "floor";
		expect(defs.serviceOrder.isActive()).toBe(false);
	});

	it("routes through the shell's selector switch like every other destination", () => {
		const setSelectorView = vi.fn();
		const defs = buildDockTabDefs(makeCtx({ setSelectorView }));

		defs.serviceOrder.onTap();

		expect(setSelectorView).toHaveBeenCalledWith("serviceOrder");
	});

	it("works offline — a repair order is taken with the network down", () => {
		// Deliberately NOT `needsSignal`. Photos and intake are local; only the
		// coupon redemption path genuinely needs the server.
		const defs = buildDockTabDefs(makeCtx());

		expect(defs.serviceOrder.needsSignal).toBeUndefined();
	});

	it("never draws itself busy — there is no round trip to wait on", () => {
		const defs = buildDockTabDefs(makeCtx());

		expect(defs.serviceOrder.busy).toBeUndefined();
	});
});

describe("one register, one vocabulary", () => {
	/**
	 * The rail and the dock name the SAME destinations. If one resolves a label
	 * through `verticalStore.t()` and the other through plain `__()`, a
	 * cafetería register says "Menú" on the rail and "Buscar" in the dock — the
	 * exact split the canvas's `movil` annotation forbids.
	 *
	 * `t()` falls back to `__()` when the preset overrides nothing, so this
	 * costs a retail register nothing at all.
	 */
	const CAFETERIA_LABELS: Record<string, string> = {
		Browse: "Menú",
		Cart: "Cuenta",
		Floor: "Salón",
	};
	const cafeteriaT = (key: string) => CAFETERIA_LABELS[key] ?? key;

	it("renames every destination the cafetería preset renames", () => {
		const defs = buildDockTabDefs(makeCtx({ t: cafeteriaT }));

		// Exactly the three the reference canvas draws renamed on MovilCafe and
		// MovilSalon: Buscar → Menú, Carrito → Cuenta, Floor → Salón.
		expect(defs.browse.label()).toBe("Menú");
		expect(defs.cart.label()).toBe("Cuenta");
		expect(defs.floor.label()).toBe("Salón");
	});

	it("carries the rename into the accessible name too", () => {
		// A blind cashier on a cafetería must hear "Cuenta", not "Cart".
		const defs = buildDockTabDefs(
			makeCtx({ t: cafeteriaT, itemsCount: ref(6) }),
		);

		expect(defs.cart.ariaLabel()).toContain("Cuenta");
		expect(defs.cart.ariaLabel()).not.toContain("Cart");
	});

	it("never sends a renameable label through the plain translator", () => {
		// The real regression this guards: someone edits a label back to `__()`
		// and the rename silently stops working on one surface only.
		const __ = vi.fn((key: string) => key);
		const defs = buildDockTabDefs(makeCtx({ t: cafeteriaT, __ }));

		for (const id of ["browse", "cart", "floor", "serviceOrder"] as const) {
			defs[id].label();
			defs[id].ariaLabel();
		}

		for (const key of ["Browse", "Cart", "Floor", "Service Orders"]) {
			expect(__, `"${key}" must go through t(), not __()`).not.toHaveBeenCalledWith(key);
		}
	});

	it("leaves the mechanisms alone — they read the same on every giro", () => {
		// Ofertas, Cupones and Cobrar are drawn identically on retail, cafetería
		// and salón artboards. They name what the button DOES, not a noun the
		// giro owns, so a preset has no business renaming them.
		const t = vi.fn((key: string) => key);
		const defs = buildDockTabDefs(makeCtx({ t }));

		defs.offers.label();
		defs.coupons.label();
		defs.pay.label();

		for (const key of ["Offers", "Coupons", "Pay"]) {
			expect(t, `"${key}" should not be renameable`).not.toHaveBeenCalledWith(key);
		}
	});

	it("leaves a retail register exactly as it was", () => {
		// t() with no preset overrides is __(); nothing about retail changes.
		const defs = buildDockTabDefs(makeCtx({ t: (key: string) => key }));

		expect(defs.browse.label()).toBe("Browse");
		expect(defs.cart.label()).toBe("Cart");
	});
});

describe("preset swaps", () => {
	it("lets a repair preset spend floor on serviceOrder", () => {
		// A preset picks a SUBSET of the vocabulary; the repair counter has no
		// tables, so it trades the tab it would never tap for the one it lives in.
		const repairDock = ["browse", "offers", "cart", "coupons", "pay", "serviceOrder"];

		for (const id of repairDock) {
			expect(DOCK_TAB_IDS).toContain(id);
		}
		expect(repairDock).not.toContain("floor");
	});

	it("leaves cafetería on floor, renamed by the resolver", () => {
		const t = (key: string) => (key === "Floor" ? "Salón" : key);
		const defs = buildDockTabDefs(makeCtx({ t, floorOpenOrdersCount: ref(7) }));

		expect(defs.floor.label()).toBe("Salón");
		expect(defs.floor.ariaLabel()).toBe("Salón — 7");
	});
});
