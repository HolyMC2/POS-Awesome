import { describe, expect, it, vi } from "vitest";

import { DESTINATIONS } from "../src/posapp/composables/pos/shell/destinationRegistry";
import {
	createDestinationGuard,
	isDestinationEnabled,
	railEntries,
	resolveActivation,
	useDestinationRouting,
	type ActivationContext,
	type DestinationEffects,
} from "../src/posapp/composables/pos/shell/useDestinationRouting";

/**
 * The gate and the single-state guarantee. Both are exercised as plain
 * functions — a gate that can only be reached by mounting the whole shell is a
 * gate nobody tests properly, and this one decides whether a cashier can sell
 * before opening the register.
 */

const ctx = (over: Partial<ActivationContext> = {}): ActivationContext => ({
	isOnline: true,
	shiftOpen: true,
	hasCapability: () => false,
	hasProfileFlag: () => false,
	...over,
});

const effects = (): DestinationEffects & {
	calls: { panel: string[]; sheet: string[]; nav: string[]; closed: number };
} => {
	const calls = { panel: [] as string[], sheet: [] as string[], nav: [] as string[], closed: 0 };
	return {
		calls,
		setPanelView: (v) => calls.panel.push(v),
		openSheet: (id) => calls.sheet.push(id),
		closeSheet: () => {
			calls.closed += 1;
		},
		navigate: (p) => calls.nav.push(p),
		refuse: vi.fn(),
	};
};

describe("the shift is the outermost envelope", () => {
	it("refuses every destination before the shift opens", () => {
		// The canvas annotation on page 1 says it outright: el turno es el sobre
		// de todo lo demás. Until it opens the register genuinely cannot do
		// anything, so nothing is reachable — not even by URL.
		for (const def of DESTINATIONS) {
			const decision = resolveActivation(def.id, ctx({ shiftOpen: false }));
			expect(decision.allowed, `${def.id} was reachable with no shift`).toBe(false);
		}
	});

	it("reports the shift before the network, so nobody fixes the wrong thing", () => {
		// Recarga is online_required AND the shift is shut. Telling the cashier
		// "no connection" sends them to the router; the real answer is the till.
		const decision = resolveActivation("recharge", ctx({ shiftOpen: false, isOnline: false }));
		expect(decision.allowed).toBe(false);
		expect(decision.allowed === false && decision.reason).toBe("shift_closed");
	});
});

describe("capability gating", () => {
	it("hides a destination whose capability the register does not have", () => {
		const decision = resolveActivation("recharge", ctx());
		expect(decision.allowed).toBe(false);
		expect(decision.allowed === false && decision.reason).toBe("gated");
	});

	it("opens it once the preset declares the capability", () => {
		const decision = resolveActivation("recharge", ctx({ hasCapability: (c) => c === "saldo" }));
		expect(decision.allowed).toBe(true);
	});

	it("accepts the legacy profile flag as well as the capability", () => {
		// Additive per plan C3: charge-request tenants shipped before the
		// capability profile existed and must keep working untouched.
		const byFlag = resolveActivation(
			"serviceOrder",
			ctx({ hasProfileFlag: (f) => f === "posa_use_charge_requests" }),
		);
		const byCapability = resolveActivation(
			"serviceOrder",
			ctx({ hasCapability: (c) => c === "external_document_checkout" }),
		);
		expect(byFlag.allowed).toBe(true);
		expect(byCapability.allowed).toBe(true);
	});

	it("treats a destination naming neither gate as universal", () => {
		const def = DESTINATIONS.find((d) => d.id === "drafts")!;
		expect(isDestinationEnabled(def, ctx())).toBe(true);
	});
});

describe("a gated destination is unreachable by URL, not merely hidden", () => {
	const guard = createDestinationGuard(() => ctx());

	it("redirects a deep link into a destination this register lacks", () => {
		// Hiding the rail item while leaving the URL open is a gate with a hole
		// in it — and a bookmark finds the hole first.
		expect(guard("/pos/top-up")).toBe("/pos");
	});

	it("lets an enabled destination through", () => {
		expect(guard("/pos/drafts")).toBe(true);
	});

	it("redirects an online-required destination while offline", () => {
		const offlineGuard = createDestinationGuard(() => ctx({ isOnline: false }));
		expect(offlineGuard("/pos/returns")).toBe("/pos");
	});

	it("stays out of the way of routes it does not own", () => {
		expect(guard("/reports")).toBe(true);
	});
});

describe("offline reachability", () => {
	it("keeps queued and cached destinations open with no server", () => {
		const offline = ctx({ isOnline: false });
		expect(resolveActivation("sale", offline).allowed).toBe(true);
		expect(resolveActivation("expense", offline).allowed).toBe(true);
		expect(resolveActivation("drafts", offline).allowed).toBe(true);
	});

	it("blocks the ones §7 names online-required", () => {
		const offline = ctx({ isOnline: false });
		for (const id of ["return", "closing"]) {
			const decision = resolveActivation(id, offline);
			expect(decision.allowed, id).toBe(false);
			expect(decision.allowed === false && decision.reason).toBe("offline");
		}
	});

	it("marks a blocked destination on the rail rather than removing it", () => {
		// It is configured on; it is just unusable right now. Dropping it from
		// the rail would read as "this register cannot do returns at all".
		const entries = railEntries(ctx({ isOnline: false }));
		const devolucion = entries.find((e) => e.def.id === "return");
		expect(devolucion).toBeDefined();
		expect(devolucion?.blockedOffline).toBe(true);
		expect(devolucion?.enabled).toBe(false);
	});

	it("omits a destination the register is not configured for", () => {
		const entries = railEntries(ctx());
		expect(entries.some((e) => e.def.id === "recharge")).toBe(false);
	});
});

describe("unknown ids", () => {
	it("refuses rather than throwing", () => {
		const decision = resolveActivation("cocina", ctx());
		expect(decision.allowed).toBe(false);
		expect(decision.allowed === false && decision.reason).toBe("unknown");
		expect(decision.allowed === false && decision.destination).toBeNull();
	});
});

describe("one source of truth for where I am", () => {
	it("moves the shell when a panel is activated", () => {
		const fx = effects();
		const routing = useDestinationRouting(() => ctx(), fx);
		routing.activate("browse", "rail");
		expect(routing.activeId.value).toBe("browse");
		expect(fx.calls.panel).toEqual(["items"]);
	});

	it("raises the hosted flow when a sheet is activated", () => {
		const fx = effects();
		const routing = useDestinationRouting(() => ctx(), fx);
		routing.activate("drafts", "rail");
		expect(fx.calls.sheet).toEqual(["drafts"]);
		expect(routing.activeId.value).toBe("drafts");
	});

	it("navigates for a route destination", () => {
		const fx = effects();
		const routing = useDestinationRouting(() => ctx(), fx);
		routing.activate("expense", "rail");
		expect(fx.calls.nav).toEqual(["/cash-movement"]);
	});

	it("does NOT re-navigate when the browser is telling us where we are", () => {
		// popstate and first paint both arrive as `restore`. Pushing again would
		// duplicate the history entry and make Back a button you press twice.
		const fx = effects();
		const routing = useDestinationRouting(() => ctx(), fx);
		routing.syncFromPath("/cash-movement");
		expect(routing.activeId.value).toBe("expense");
		expect(fx.calls.nav).toEqual([]);
	});

	it("lands the shortcut and the rail on identical state", () => {
		const railFx = effects();
		const rail = useDestinationRouting(() => ctx(), railFx);
		rail.activate("return", "rail");

		const keyFx = effects();
		const keyboard = useDestinationRouting(() => ctx(), keyFx);
		keyboard.activateByShortcut("returns.open");

		expect(keyboard.activeId.value).toBe(rail.activeId.value);
		expect(keyFx.calls.sheet).toEqual(railFx.calls.sheet);
	});

	it("returns null for a chord no destination claims", () => {
		const routing = useDestinationRouting(() => ctx(), effects());
		expect(routing.activateByShortcut("payment.submit")).toBeNull();
	});

	it("dismisses back to what was underneath, not to a hardcoded home", () => {
		const fx = effects();
		const routing = useDestinationRouting(() => ctx(), fx);
		routing.activate("browse", "rail");
		routing.activate("invoices", "rail");
		expect(routing.activeId.value).toBe("invoices");

		routing.dismiss();
		// Back to Explorar — assuming Venta would silently drop the cashier out
		// of the catalogue they were mid-search in.
		expect(routing.activeId.value).toBe("browse");
	});

	it("leaves state untouched when a destination is refused", () => {
		const fx = effects();
		const routing = useDestinationRouting(() => ctx(), fx);
		routing.activate("browse", "rail");
		const decision = routing.activate("recharge", "rail");

		expect(decision.allowed).toBe(false);
		expect(routing.activeId.value).toBe("browse");
		expect(fx.refuse).toHaveBeenCalledOnce();
	});

	it("every rail entry resolves to something the shell can render", () => {
		const full = ctx({ hasCapability: () => true, hasProfileFlag: () => true });
		const fx = effects();
		const routing = useDestinationRouting(() => full, fx);

		for (const entry of railEntries(full)) {
			const decision = routing.activate(entry.def.id, "rail");
			expect(decision.allowed, `${entry.def.id} did not resolve`).toBe(true);
		}
		// Every kind was exercised: a panel moved, sheets opened, routes navigated.
		expect(fx.calls.panel.length).toBeGreaterThan(0);
		expect(fx.calls.sheet.length).toBeGreaterThan(0);
		expect(fx.calls.nav.length).toBeGreaterThan(0);
	});
});
