// @vitest-environment jsdom
/**
 * The rail survives every destination that puts an item on it.
 *
 * This is the property the owner found missing, in their own words — *"not all
 * sidebar views are well integrated"*. Opening Gasto from the rail produced a
 * page with no rail at all: `expense` and `closing` were `kind: "route"`, so
 * activating them handed the screen to vue-router, and the rail lives inside
 * the shell that vue-router had just replaced. §17.7's whole premise is that
 * the rail IS the desktop navigation, so a rail item that removes the rail is
 * a navigation dead end — the only ways back were the browser and the actions
 * menu.
 *
 * Two things make this file worth more than the two-line fix it guards:
 *
 * 1. it is driven from `DESTINATIONS`, not from a list typed here, so a tenth
 *    destination added as a bare route fails on the day it is added rather
 *    than on the day an owner opens it;
 * 2. it models `navigate` HONESTLY. A `route` kind is not automatically wrong
 *    — `/floor` has always been a route that mounts the same shell and asks it
 *    to open on the floor, and that is exactly the shape `/cash-movement` and
 *    `/closing` now have. So the fixture asks the REAL router what the path
 *    mounts, and only a path that mounts something else costs the rail. The
 *    deep links keep every reason they had to exist; they stop being different
 *    screens.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { setActivePinia } from "pinia";

/**
 * Sheet loaders are stubbed; the REGISTRY is not.
 *
 * `DestinationHost` lazily imports the real Drafts, Invoice Management,
 * Returns, the saldo picker, the corte and the cash-movement view. Pulling all
 * of them into one unit spec would be testing those components, not this
 * property, and half of them want `frappe` on `window`. Only the loaders are
 * replaced — `DESTINATIONS`, the ids, the kinds and the paths are the real
 * ones, which is the half that has to stay real for this file to mean
 * anything.
 */
vi.mock("../src/posapp/composables/pos/shell/destinationRegistry", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	const vue = await import("vue");
	const loaders = actual.SHEET_COMPONENTS as Record<string, unknown>;
	return {
		...actual,
		SHEET_COMPONENTS: Object.fromEntries(
			Object.keys(loaders).map((id) => [
				id,
				() =>
					Promise.resolve({
						name: `SheetStub_${id}`,
						render: () => vue.h("div", { class: "sheet-stub", "data-sheet": id }),
					}),
			]),
		),
	};
});

import RegisterRail from "../src/posapp/components/pos/shell/rail/RegisterRail.vue";
import DestinationHost from "../src/posapp/components/pos/shell/destinations/DestinationHost.vue";
import {
	DESTINATIONS,
	railTestId,
	type DestinationDef,
} from "../src/posapp/composables/pos/shell/destinationRegistry";
import {
	useDestinationRouting,
	type ActivationContext,
	type RefusalReason,
} from "../src/posapp/composables/pos/shell/useDestinationRouting";
import type { RegisterRailContext } from "../src/posapp/composables/pos/shell/useRegisterRail";
import type { RailGateMap } from "../src/posapp/composables/pos/shell/railDestinations";
import createPosAppRouter, { resolveDestinationRedirect } from "../src/posapp/router/index";
import { pinia } from "../src/posapp/stores";
import { useUIStore } from "../src/posapp/stores/uiStore";

/** Render-function stub: these specs run against the runtime-only Vue build. */
const IconStub = defineComponent({ setup: () => () => h("span", { class: "v-icon" }) });
const ProgressStub = defineComponent({ setup: () => () => h("span", { class: "v-progress" }) });
const BtnStub = defineComponent({
	setup: (_p, { slots }) => () => h("button", {}, slots.default?.()),
});

const ALL_GATES: RailGateMap = {
	floor: true,
	externalDocumentCheckout: true,
	saldo: true,
	closingShift: true,
};

const { router } = createPosAppRouter();

/**
 * Does following this URL land the operator on the register shell?
 *
 * Asked of the REAL routes table rather than of a list here. `registerShell` is
 * stamped by `buildDestinationRoutes`, which builds one route per registry
 * entry — there is no per-route place to type it, and therefore no per-route
 * place to forget it.
 */
function pathMountsRegisterShell(path: string): boolean {
	const resolved = router.resolve(path);
	const matched = resolved.matched[0];
	return Boolean(matched && matched.meta?.registerShell);
}

interface Fixture {
	wrapper: ReturnType<typeof mount>;
	activate: (id: string) => void;
	dismiss: () => void;
	activeId: Ref<string>;
	previousId: Ref<string>;
}

/**
 * The register shell, reduced to the two parts this property is about: the
 * rail, and whatever occupies the content area beside it. Composed by the real
 * `useDestinationRouting` with the real effects contract, so the wiring under
 * test is the shipped wiring and not a paraphrase of it.
 */
function mountShell(overrides: Partial<ActivationContext> = {}): Fixture {
	const context: ActivationContext = {
		isOnline: true,
		shiftOpen: true,
		hasCapability: () => true,
		hasProfileFlag: () => true,
		...overrides,
	};

	let api: ReturnType<typeof useDestinationRouting> | null = null;

	const Shell = defineComponent({
		setup() {
			const hosted = ref<string | null>(null);
			const refusal = ref<RefusalReason | null>(null);
			// The router replaced the shell, and with it the rail. This is the
			// bug modelled, not asserted around.
			const inShell = ref(true);

			const routing = useDestinationRouting(() => context, {
				setPanelView: () => {
					hosted.value = null;
				},
				openSheet: (id) => {
					refusal.value = null;
					hosted.value = id;
				},
				closeSheet: () => {
					refusal.value = null;
					hosted.value = null;
				},
				navigate: (path) => {
					hosted.value = null;
					inShell.value = pathMountsRegisterShell(path);
				},
				refuse: (decision) => {
					refusal.value = decision.reason;
					hosted.value = decision.destination?.id ?? null;
				},
			});
			api = routing;

			const railContext: RegisterRailContext = {
				__: (key: string) => key,
				t: (key: string) => key,
				gates: ref<RailGateMap>({ ...ALL_GATES }),
				activeDestinationId: routing.activeId as Ref<string>,
				shiftOpen: ref(context.shiftOpen),
				offline: ref(!context.isOnline),
				counts: {
					serviceOrderOpenCount: ref(0),
					floorOpenOrdersCount: ref(0),
					draftInvoicesCount: ref(0),
				},
				navigate: (id: string) => routing.activate(id, "rail"),
			};

			return () =>
				inShell.value
					? h("div", { class: "register-shell" }, [
							h(RegisterRail, { context: railContext }),
							hosted.value
								? h(DestinationHost, {
										destinationId: hosted.value,
										refusal: refusal.value,
										t: (key: string) => key,
									})
								: h("div", { class: "sale-surface" }),
						])
					: h("div", { class: "standalone-page" });
		},
	});

	const wrapper = mount(Shell, {
		global: {
			stubs: { VIcon: IconStub, VProgressCircular: ProgressStub, VBtn: BtnStub },
		},
	});

	return {
		wrapper,
		activate: (id: string) => api?.activate(id, "rail"),
		dismiss: () => api?.dismiss(),
		activeId: api!.activeId as Ref<string>,
		previousId: api!.previousId as Ref<string>,
	};
}

/**
 * THE assertion, as one named function so the mutation test can aim at it.
 *
 * Throws with the destination's id in the message: a failure that says
 * "expected false to be true" would leave the next reader bisecting a registry
 * to find out which door was bricked up.
 */
async function assertRailSurvives(id: string): Promise<void> {
	const fixture = mountShell();
	try {
		fixture.activate(id);
		await nextTick();
		await nextTick();

		const html = fixture.wrapper.html();
		if (!fixture.wrapper.find("nav.register-rail").exists()) {
			throw new Error(
				`destination "${id}" removed the rail — it is the only desktop navigation ` +
					`there is, so this is a dead end (§17.7). Rendered instead:\n${html.slice(0, 200)}`,
			);
		}
		if (!fixture.wrapper.find(`[data-rail-destination="${id}"]`).exists()) {
			throw new Error(`destination "${id}" is on the rail but its own rail item is gone`);
		}
	} finally {
		fixture.wrapper.unmount();
	}
}

beforeEach(() => {
	setActivePinia(pinia);
	const ui = useUIStore(pinia);
	ui.capabilityPayload = null;
	ui.posOpeningShift = null;
	ui.posProfile = null;
	(window as unknown as { serverOnline?: boolean }).serverOnline = true;
});

describe("every rail destination keeps the rail", () => {
	for (const def of DESTINATIONS) {
		it(`${def.id} renders beside the rail, not instead of it`, async () => {
			await assertRailSurvives(def.id);
		});
	}

	it("stamps the destination it is showing, from the registry's own handle", async () => {
		const fixture = mountShell();
		fixture.activate("expense");
		await nextTick();
		await nextTick();
		// `destinationTestId` — the host derives its handle from the registry,
		// so a renamed id cannot leave a screenshot lane pointing at the wrong
		// screen. (The rail's own handle is `data-rail-destination`, not the
		// registry's `railTestId`; that pairing has already drifted, and the
		// rail is not this task's file to change.)
		expect(fixture.wrapper.find('[data-testid="destination-expense"]').exists()).toBe(true);
		expect(railTestId("expense")).toBe("rail-expense");
		expect(fixture.wrapper.find('[data-rail-destination="expense"]').exists()).toBe(true);
		fixture.wrapper.unmount();
	});
});

/**
 * The mutation the assertion above exists to catch, performed on the real
 * registry rather than on a copy of it. Restored in `finally`; vitest isolates
 * modules per file, so no other spec sees the flip.
 */
describe("the rail-presence assertion actually bites", () => {
	it("fails BY NAME when a destination is flipped back to a bare route", async () => {
		const def = DESTINATIONS.find((d) => d.id === "expense") as DestinationDef;
		const original = { kind: def.kind, path: def.path };
		// `/barcode` is a real standalone page — the exact shape `/cash-movement`
		// used to have: its own route, its own component, no shell.
		Object.assign(def as unknown as Record<string, unknown>, {
			kind: "route",
			path: "/barcode",
		});

		let failure: Error | null = null;
		try {
			await assertRailSurvives("expense");
		} catch (error) {
			failure = error as Error;
		} finally {
			Object.assign(def as unknown as Record<string, unknown>, original);
		}

		expect(failure, "flipping expense to a bare route was not caught").toBeTruthy();
		expect(failure?.message).toContain("expense");
		expect(failure?.message).toContain("removed the rail");

		// And the registry is back the way it was, so the next test is honest.
		await assertRailSurvives("expense");
	});

	it("does NOT punish a route that mounts the shell — that is the floor pattern", async () => {
		const def = DESTINATIONS.find((d) => d.id === "expense") as DestinationDef;
		const original = def.kind;
		Object.assign(def as unknown as Record<string, unknown>, { kind: "route" });
		try {
			// Same kind, same path: `/cash-movement` mounts the register shell,
			// so following it costs nothing. The property is about where you
			// LAND, not about which mechanism took you there.
			await assertRailSurvives("expense");
		} finally {
			Object.assign(def as unknown as Record<string, unknown>, { kind: original });
		}
	});
});

describe("the deep links still exist, and still land in the shell", () => {
	for (const def of DESTINATIONS) {
		it(`${def.path} resolves to the register shell`, () => {
			const resolved = router.resolve(def.path);
			expect(resolved.matched.length, `${def.path} matched no route`).toBeGreaterThan(0);
			expect(
				pathMountsRegisterShell(def.path),
				`${def.path} does not mount the register shell — a bookmark, a customer ` +
					`display or a support instruction finds that hole first`,
			).toBe(true);
			expect(resolved.matched[0]?.meta?.initialDestination).toBe(def.id);
		});
	}

	it("keeps the two paths that already existed, spelled the way they were", () => {
		// These predate the rail and are not ours to rename: they are in
		// bookmarks, in support instructions and in muscle memory.
		expect(router.resolve("/cash-movement").matched[0]?.meta?.initialDestination).toBe("expense");
		expect(router.resolve("/closing").matched[0]?.meta?.initialDestination).toBe("closing");
		// And they kept the titles they carried, rather than being renamed to
		// their registry labels on the way through.
		expect(router.resolve("/cash-movement").matched[0]?.meta?.title).toBe("Cash Movement");
		expect(router.resolve("/closing").matched[0]?.meta?.title).toBe("Close Shift");
	});

	it("does not resolve a destination path to the standalone pages it used to", () => {
		const cashMovement = router.resolve("/cash-movement").matched[0];
		expect(cashMovement?.meta?.registerShell).toBe(true);
		expect(cashMovement?.meta?.layout).toBe("default");
	});
});

describe("the URL half of the gate is unchanged", () => {
	const boot = (over: { shift?: unknown; capabilities?: string[] } = {}) => {
		const ui = useUIStore(pinia);
		ui.capabilityPayload = { name: "test-preset", capabilities: over.capabilities ?? [] };
		ui.posOpeningShift = "shift" in over ? over.shift : { name: "POSA-OS-TEST" };
		ui.posProfile = {} as never;
	};

	it("still asks nothing before the register has booted", () => {
		// The cold-boot hazard `resolveDestinationRedirect` closed: `shiftOpen`
		// reads false on a register that has merely not answered yet, and asking
		// anyway would refuse every destination.
		expect(resolveDestinationRedirect("/cash-movement")).toBeNull();
		expect(resolveDestinationRedirect("/closing")).toBeNull();
	});

	it("still never redirects /pos to itself", () => {
		// `/pos` IS the `sale` destination and `sale` is shift-gated, so a
		// closed shift would otherwise loop the router forever.
		boot({ shift: null });
		expect(resolveDestinationRedirect("/pos")).toBeNull();
	});

	it("still refuses a gated destination by URL, not only by rail", () => {
		boot();
		expect(resolveDestinationRedirect("/floor")).toBe("/pos");
		expect(resolveDestinationRedirect("/pos/top-up")).toBe("/pos");
	});

	it("opens the same path once the capability is granted", () => {
		boot({ capabilities: ["tables", "saldo"] });
		expect(resolveDestinationRedirect("/floor")).toBeNull();
		expect(resolveDestinationRedirect("/pos/top-up")).toBeNull();
	});

	it("refuses an online-only destination by URL when the register is offline", () => {
		boot();
		(window as unknown as { serverOnline?: boolean }).serverOnline = false;
		// `/closing` is `online_required` — it cannot reconcile against a server
		// it cannot see — and it is refused by URL for the same reason the rail
		// dims it.
		expect(resolveDestinationRedirect("/closing")).toBe("/pos");
		// `/cash-movement` queues instead: the cash left the drawer whether or
		// not the server heard about it.
		expect(resolveDestinationRedirect("/cash-movement")).toBeNull();
	});
});

describe("leaving a destination", () => {
	it("returns to the PREVIOUS destination, never a hardcoded sale", async () => {
		const fixture = mountShell();
		fixture.activate("browse");
		fixture.activate("expense");
		await nextTick();

		expect(fixture.activeId.value).toBe("expense");
		expect(fixture.previousId.value).toBe("browse");

		fixture.dismiss();
		await nextTick();

		expect(fixture.activeId.value).toBe("browse");
		expect(fixture.wrapper.find("nav.register-rail").exists()).toBe(true);
		fixture.wrapper.unmount();
	});

	it("still returns to the sale when the sale is genuinely what was underneath", async () => {
		const fixture = mountShell();
		fixture.activate("closing");
		await nextTick();
		fixture.dismiss();
		await nextTick();

		expect(fixture.activeId.value).toBe("sale");
		fixture.wrapper.unmount();
	});
});
