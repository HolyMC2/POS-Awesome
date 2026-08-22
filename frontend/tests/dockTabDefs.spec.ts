import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";

import {
	DOCK_TAB_IDS,
	buildDockTabDefs,
	isDockTabDimmedOffline,
	type DockTabContext,
} from "../src/posapp/vertical/viewContracts";

/**
 * The dock-tab chain has three links: the frontend tuple (DOCK_TAB_IDS), the
 * backend tuple (VALID_DOCK_TABS, parity-tested from Python) and a DockTabDef
 * per id. The third link was previously guarded ONLY by `vue-tsc` — true, but
 * it means a type-check skipped in a hurry ships a dock tab that renders blank.
 * These assertions make the same guarantee at runtime, where the test suite
 * sees it.
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

describe("dock tab defs — the third link", () => {
	it("defines exactly one def per declared id, in the same order", () => {
		const defs = buildDockTabDefs(makeCtx());

		// Order matters as much as membership: a preset stores its tabs as a CSV
		// of these ids, so the tuple is the render order too.
		expect(Object.keys(defs)).toEqual([...DOCK_TAB_IDS]);
	});

	it("gives every def the members the shell renders", () => {
		const defs = buildDockTabDefs(makeCtx());

		for (const id of DOCK_TAB_IDS) {
			const def = defs[id];
			expect(def, `no def for "${id}"`).toBeTruthy();
			// Pos.vue filters on `tab.icon` — a def without one is dropped from
			// the dock silently, which is the exact failure this chain exists to
			// prevent.
			expect(def.icon, `"${id}" has no icon`).toBeTruthy();
			expect(typeof def.label).toBe("function");
			expect(typeof def.ariaLabel).toBe("function");
			expect(typeof def.isActive).toBe("function");
			expect(typeof def.onTap).toBe("function");
		}
	});

	it("never announces a tab by colour alone", () => {
		// The badge is a colour-coded pill; the count has to reach a screen
		// reader through the accessible name as well (WCAG 2.2 AA, §5).
		const defs = buildDockTabDefs(makeCtx({ serviceOrderOpenCount: ref(4) }));

		expect(defs.serviceOrder.ariaLabel()).toContain("4");
	});
});

describe("offline dimming", () => {
	it("dims only the tab that genuinely needs the server", () => {
		const defs = buildDockTabDefs(makeCtx());
		const dimmed = DOCK_TAB_IDS.filter((id) =>
			isDockTabDimmedOffline(defs[id], false),
		);

		// Coupons are REDEEMED server-side. Offers are cached rules the register
		// already holds, so they stay live — the visual difference between the
		// two is the honest one.
		expect(dimmed).toEqual(["coupons"]);
	});

	it("dims nothing while the server is reachable", () => {
		const defs = buildDockTabDefs(makeCtx());
		const dimmed = DOCK_TAB_IDS.filter((id) =>
			isDockTabDimmedOffline(defs[id], true),
		);

		expect(dimmed).toEqual([]);
	});

	it("keeps every tab in the dock offline — dimmed, never removed", () => {
		// "El dock no miente": offline is a STATE drawn on top of what the
		// cashier was doing, not a destination that rearranges their thumb's
		// muscle memory.
		const defs = buildDockTabDefs(makeCtx());

		expect(Object.keys(defs)).toHaveLength(DOCK_TAB_IDS.length);
	});
});

describe("a count the shell forgot to wire", () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
	});

	it("suppresses the badge instead of throwing inside a render", () => {
		// Pos.vue's script block is plain JS, so a missing context field sails
		// past vue-tsc. A bare `.value` would throw mid-render and take the whole
		// dock down — and only on the one preset that names this tab.
		const ctx = makeCtx();
		delete (ctx as Partial<DockTabContext>).serviceOrderOpenCount;

		const defs = buildDockTabDefs(ctx as DockTabContext);

		expect(() => defs.serviceOrder.badge?.()).not.toThrow();
		expect(defs.serviceOrder.badge?.()).toBe(0);
		expect(() => defs.serviceOrder.ariaLabel()).not.toThrow();
	});
});
