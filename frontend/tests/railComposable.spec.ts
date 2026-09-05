// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

import {
	useRegisterRail,
	type RegisterRailContext,
} from "../src/posapp/composables/pos/shell/useRegisterRail";
import type { RailGateMap } from "../src/posapp/composables/pos/shell/railDestinations";

const ALL_GATES: RailGateMap = {
	floor: true,
	externalDocumentCheckout: true,
	saldo: true,
	closingShift: true,
	quotations: true,
	giftCards: true,
	dashboard: true,
};

function makeContext(overrides: Partial<Record<string, unknown>> = {}) {
	const navigate = vi.fn();
	const state = {
		gates: ref<RailGateMap>({ ...ALL_GATES, ...((overrides.gates as object) || {}) }),
		activeDestinationId: ref((overrides.activeDestinationId as string) ?? "sale"),
		shiftOpen: ref((overrides.shiftOpen as boolean) ?? true),
		offline: ref((overrides.offline as boolean) ?? false),
		serviceOrderOpenCount: ref((overrides.serviceOrderOpenCount as number) ?? 0),
		floorOpenOrdersCount: ref((overrides.floorOpenOrdersCount as number) ?? 0),
		draftInvoicesCount: ref((overrides.draftInvoicesCount as number) ?? 0),
	};

	const ctx: RegisterRailContext = {
		__: (key: string) => key,
		// Stands in for a cafetería preset's label map.
		t: (key: string) => (key === "Browse" ? "Menú" : key === "Floor" ? "Salón" : key),
		gates: state.gates,
		activeDestinationId: state.activeDestinationId,
		shiftOpen: state.shiftOpen,
		offline: state.offline,
		counts: {
			serviceOrderOpenCount: state.serviceOrderOpenCount,
			floorOpenOrdersCount: state.floorOpenOrdersCount,
			draftInvoicesCount: state.draftInvoicesCount,
		},
		navigate,
	};

	return { ctx, state, navigate, rail: useRegisterRail(ctx) };
}

const byId = (items: readonly { id: string }[], id: string) => items.find((i) => i.id === id)!;

describe("useRegisterRail — labels", () => {
	it("routes renamed nouns through the preset resolver and the rest through __()", () => {
		const { rail } = makeContext();
		// `floor` carries the vocabulary flag now that `browse` (the other
		// renamed noun, "Menú") left the rail 2026-08-24.
		expect(byId(rail.items.value, "floor").label).toBe("Salón");
		// Plain __() — a preset renaming "Drafts" would be a translation, not
		// vocabulary.
		expect(byId(rail.items.value, "drafts").label).toBe("Drafts");
	});
});

describe("useRegisterRail — badges", () => {
	it("pins each badge to its declared count", () => {
		const { rail, state } = makeContext();
		state.serviceOrderOpenCount.value = 4;
		state.floorOpenOrdersCount.value = 7;
		expect(byId(rail.items.value, "serviceOrder").badge).toBe(4);
		expect(byId(rail.items.value, "floor").badge).toBe(7);
	});

	it("draws no pill at zero", () => {
		const { rail } = makeContext();
		expect(byId(rail.items.value, "serviceOrder").badge).toBeNull();
	});

	it("draws no pill where no count is declared", () => {
		const { rail } = makeContext();
		expect(byId(rail.items.value, "sale").badge).toBeNull();
		expect(byId(rail.items.value, "return").badge).toBeNull();
	});

	it("announces the count in words, never by colour alone", () => {
		const { rail, state } = makeContext();
		state.serviceOrderOpenCount.value = 4;
		expect(byId(rail.items.value, "serviceOrder").ariaLabel).toBe("Service Order — 4");
	});
});

describe("useRegisterRail — shift gate (§5.1)", () => {
	it("disables every destination until the shift opens", () => {
		const { rail } = makeContext({ shiftOpen: false });
		expect(rail.railDisabled.value).toBe(true);
		expect(rail.items.value.every((item) => item.disabled)).toBe(true);
	});

	it("says why, so the state is not just a grey column", () => {
		const { rail } = makeContext({ shiftOpen: false });
		expect(byId(rail.items.value, "sale").ariaLabel).toContain("Shift not open");
	});

	it("lights nothing while the shift is closed", () => {
		const { rail } = makeContext({ shiftOpen: false, activeDestinationId: "sale" });
		expect(rail.items.value.some((item) => item.active)).toBe(false);
	});

	it("refuses navigation while closed and allows it once open", () => {
		const { rail, state, navigate } = makeContext({ shiftOpen: false });
		expect(rail.activate("sale")).toBe(false);
		expect(navigate).not.toHaveBeenCalled();

		state.shiftOpen.value = true;
		expect(rail.activate("sale")).toBe(true);
		expect(navigate).toHaveBeenCalledWith("sale");
	});
});

describe("useRegisterRail — offline", () => {
	it("dims only the destinations that need a server to be truthful", () => {
		const { rail } = makeContext({ offline: true });
		const dimmed = rail.items.value.filter((item) => item.dimmed).map((item) => item.id);
		// Tracks the registry's audited values (see railDestinations.spec.ts):
		// `floor` is queued, not blocked — a waiter with no signal keeps taking
		// orders — and `drafts` is blocked, because nothing caches them.
		expect(dimmed.sort()).toEqual([
			"closing",
			"comandas",
			"dashboard",
			"drafts",
			"giftCards",
			"invoices",
			"lots",
			"payments",
			"purchase",
			"quotations",
			"recharge",
			"return",
			"serviceOrder",
		]);
	});

	it("keeps the sale reachable offline", () => {
		const { rail, navigate } = makeContext({ offline: true });
		expect(byId(rail.items.value, "sale").disabled).toBe(false);
		expect(rail.activate("sale")).toBe(true);
		expect(navigate).toHaveBeenCalledWith("sale");
	});

	it("refuses a blocked destination and explains it", () => {
		const { rail, navigate } = makeContext({ offline: true });
		expect(rail.activate("invoices")).toBe(false);
		expect(navigate).not.toHaveBeenCalled();
		expect(byId(rail.items.value, "invoices").ariaLabel).toContain("Needs connection");
	});

	it("dims nothing while online", () => {
		const { rail } = makeContext();
		expect(rail.items.value.some((item) => item.dimmed)).toBe(false);
	});
});

describe("useRegisterRail — keyboard", () => {
	const press = (rail: ReturnType<typeof useRegisterRail>, key: string) =>
		rail.onKeydown(new KeyboardEvent("keydown", { key }));

	it("moves down and wraps at the end", () => {
		const { rail } = makeContext();
		const last = rail.items.value.length - 1;
		expect(press(rail, "ArrowDown")).toBe(true);
		expect(rail.focusedIndex.value).toBe(1);

		rail.focusIndex(last);
		press(rail, "ArrowDown");
		expect(rail.focusedIndex.value).toBe(0);
	});

	it("moves up and wraps at the start", () => {
		const { rail } = makeContext();
		press(rail, "ArrowUp");
		// The ring is the PILLS: tools live in the "More" flyout, which owns
		// its own focus, so the wrap lands on the last pill (Corte).
		expect(rail.focusedIndex.value).toBe(rail.keyboardItems.value.length - 1);
		expect(rail.keyboardItems.value.at(-1)?.id).toBe("closing");
	});

	it("jumps with Home and End", () => {
		const { rail } = makeContext();
		press(rail, "End");
		expect(rail.focusedIndex.value).toBe(rail.keyboardItems.value.length - 1);
		press(rail, "Home");
		expect(rail.focusedIndex.value).toBe(0);
	});

	it("activates with Enter and with Space", () => {
		const { rail, navigate } = makeContext();
		rail.focusIndex(0);
		expect(press(rail, "Enter")).toBe(true);
		expect(navigate).toHaveBeenCalledWith("sale");

		press(rail, "ArrowDown");
		expect(press(rail, " ")).toBe(true);
		expect(navigate).toHaveBeenCalledWith("payments");
	});

	it("ignores keys it does not own, so typing still reaches the shell", () => {
		const { rail } = makeContext();
		expect(press(rail, "a")).toBe(false);
		expect(press(rail, "Tab")).toBe(false);
	});

	it("keeps focus on a disabled entry instead of reshaping the rail", () => {
		// Skipping disabled entries would move the rail under the operator's
		// fingers when the connection drops.
		const { rail } = makeContext({ offline: true });
		const invoicesIndex = rail.items.value.findIndex((item) => item.id === "invoices");
		rail.focusIndex(invoicesIndex);
		expect(rail.focusedIndex.value).toBe(invoicesIndex);
		expect(rail.activateFocused()).toBe(false);
	});

	it("clamps a stale focus index when the rail shrinks", () => {
		const { rail, state } = makeContext();
		rail.focusIndex(rail.items.value.length - 1);
		state.gates.value = { ...ALL_GATES, floor: false, saldo: false, closingShift: false };
		// activateFocused clamps before reading, so a shrunk rail cannot throw.
		expect(() => rail.activateFocused()).not.toThrow();
		expect(rail.focusedIndex.value).toBeLessThan(rail.items.value.length);
	});
});

describe("useRegisterRail — groups", () => {
	it("splits render groups without losing an entry", () => {
		const { rail } = makeContext();
		expect(rail.footerItems.value.map((item) => item.id)).toEqual(["closing"]);
		expect(
			rail.primaryItems.value.length + rail.toolsItems.value.length + rail.footerItems.value.length,
		).toBe(rail.items.value.length);
		// The keyboard ring is the pills; every tool is off it and in the flyout.
		expect(rail.keyboardItems.value.length + rail.toolsItems.value.length).toBe(
			rail.items.value.length,
		);
		expect(rail.keyboardItems.value.some((item) => item.group === "tools")).toBe(false);
	});

	it("the More pill wears the active tool, and nothing when a pill is active", () => {
		const active = ref("sale");
		const rail = useRegisterRail({
			__: (k) => k,
			t: (k) => k,
			gates: ref<RailGateMap>({ ...ALL_GATES }),
			activeDestinationId: active,
			shiftOpen: ref(true),
			offline: ref(false),
			counts: {},
			navigate: () => {},
		});
		expect(rail.activeTool.value).toBeNull();
		// `payments` graduated to a primary pill 2026-08-24, so a tool wearing
		// the More pill is exercised with `purchase` now.
		active.value = "purchase";
		expect(rail.activeTool.value?.id).toBe("purchase");
		expect(rail.activeTool.value?.hint).toBe("Orders to suppliers");
		expect(rail.toolsItems.value.map((item) => item.id)).toEqual([
			"lots",
			"purchase",
			"barcode",
			"giftCards",
			"dashboard",
		]);
	});

	it("reacts to a computed gate source", () => {
		const saldo = ref(true);
		const gates = computed<RailGateMap>(() => ({ ...ALL_GATES, saldo: saldo.value }));
		const rail = useRegisterRail({
			__: (k) => k,
			t: (k) => k,
			gates,
			activeDestinationId: ref("sale"),
			shiftOpen: ref(true),
			offline: ref(false),
			counts: {},
			navigate: vi.fn(),
		});
		expect(rail.items.value.some((item) => item.id === "recharge")).toBe(true);
		saldo.value = false;
		expect(rail.items.value.some((item) => item.id === "recharge")).toBe(false);
	});
});
