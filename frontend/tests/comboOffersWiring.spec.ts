/**
 * When the register asks the server for its combos, and what it shows when the
 * server is not there — `docs/COMBOS_GOLDEN_FLOW.md` §1.
 *
 * The whole feature was invisible for a day because nothing called
 * `api/combos.py::get_combos`. Wiring the call is easy; wiring it so it fires
 * the right number of times is the part worth a suite. Two failure modes bound
 * it from either side:
 *
 *   - TOO FEW. A register that fetches once at boot and never again shows
 *     yesterday's bundles after the back office adds one, and quotes the old
 *     saving to a customer whose price list differs.
 *   - TOO MANY. `set_all_items` — the only honest "the catalogue changed"
 *     signal the item layer emits — also fires per page of a paged first load
 *     and on every search that replaces the array. Refreshing on each one is a
 *     round trip per keystroke on the hottest surface in the product.
 *
 * So the assertions here are mostly counts, and the interesting ones are the
 * zeros: the fetch that does NOT happen when a customer is re-selected, when
 * the catalogue re-syncs inside the floor, and when there is no profile yet.
 *
 * The offline half asserts the honesty rules rather than the plumbing: a
 * failure never overwrites a good answer, an empty answer is a real answer and
 * a cold cache renders nothing rather than a stub. `offline/comboOffers.ts` is
 * imported DIRECTLY here for the same reason the composable imports it that
 * way — the barrel is stubbed by half the suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import composableSource from "../src/posapp/composables/pos/combos/useComboOffers.ts?raw";
import shellSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import dbSource from "../src/offline/db.ts?raw";

/**
 * Only `db`'s primitives are stubbed, and only so the suite need not stand up
 * IndexedDB: `offline/comboOffers.ts` itself runs for real, which is the point
 * — its keying and its TTL are the rules under test.
 */
const stub = vi.hoisted(() => ({
	memory: {} as Record<string, any>,
	persist: vi.fn(),
	offline: false,
}));

vi.mock("../src/offline/db", () => ({
	memory: stub.memory,
	persist: stub.persist,
	initPromise: Promise.resolve(),
	isOffline: () => stub.offline,
}));

import {
	CATALOG_REFRESH_FLOOR_MS,
	CATALOG_SYNC_EVENT,
	clearComboOffersCache,
	useComboOffers,
} from "../src/posapp/composables/pos/combos/useComboOffers";
import {
	COMBO_OFFERS_CACHE_KEY,
	COMBO_OFFERS_TTL_MS,
	peekCachedComboOffers,
	saveComboOffers,
} from "../src/offline/comboOffers";

/** The reference combo of the whole feature, as `get_combos` serialises it. */
const PROTECCION = {
	item_code: "COMBO-PROTECCION",
	item_name: "Combo Protección Honor X8A",
	// Frappe hands Decimal-backed fields back as strings often enough that the
	// fixture uses them: a string rate that reached `priceCombo()` would compute
	// the saving by string subtraction.
	rate: "289.00",
	image: "/files/combo-proteccion.png",
	priority: 1,
	targets: ["HONOR-X8A"],
	components: [
		{
			item_code: "CASE-X8A",
			item_name: "Case negro Honor X8A",
			qty: 1,
			rate: "149.00",
			uom: "Nos",
			actual_qty: 12,
			is_stock_item: 1,
		},
		{
			item_code: "MICA-X8A",
			item_name: "Mica Cristal Honor X8A",
			qty: 1,
			rate: "99.00",
			uom: "Nos",
			actual_qty: 8,
			is_stock_item: 1,
		},
		{
			item_code: "INSTALACION",
			item_name: "Instalación",
			qty: 1,
			rate: "77.00",
			uom: "Nos",
			actual_qty: 0,
			is_stock_item: 0,
		},
	],
};

const PROFILE = {
	name: "Doco Demo",
	selling_price_list: "Standard Selling",
	warehouse: "Tienda - D",
};

/** A second register: another price list AND another warehouse. */
const OTHER_PROFILE = {
	name: "Cafeteria Demo",
	selling_price_list: "Menú",
	warehouse: "Cafetería - D",
};

const call = vi.fn(async () => ({ message: [PROTECCION] }));

/** Enough microtasks to settle `load()`'s await chain. Nothing here polls. */
const flush = async () => {
	for (let i = 0; i < 12; i += 1) {
		await Promise.resolve();
	}
};

const makeBus = () => {
	const handlers = new Map<string, Set<(..._args: any[]) => void>>();
	return {
		on: vi.fn((event: string, handler: (..._args: any[]) => void) => {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)?.add(handler);
		}),
		off: vi.fn((event: string, handler: (..._args: any[]) => void) => {
			handlers.get(event)?.delete(handler);
		}),
		emit: (event: string, payload?: unknown) => {
			handlers.get(event)?.forEach((handler) => handler(payload));
		},
		count: (event: string) => handlers.get(event)?.size ?? 0,
	};
};

beforeEach(() => {
	clearComboOffersCache();
	for (const key of Object.keys(stub.memory)) delete stub.memory[key];
	stub.persist.mockClear();
	stub.offline = false;
	call.mockClear();
	call.mockImplementation(async () => ({ message: [PROTECCION] }));
	(globalThis as any).frappe = { call };
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("the trigger matrix", () => {
	it("asks nothing until a register is activated", async () => {
		const posProfile = ref<any>(null);
		const customer = ref<string | null>(null);
		const scope = effectScope();
		const combos = scope.run(() => useComboOffers({ posProfile, customer }))!;

		await flush();
		// No price list and no warehouse: the server has nothing to price or
		// count against, so there is no honest answer to ask for.
		expect(call).not.toHaveBeenCalled();
		expect(combos.offers.value).toEqual([]);

		posProfile.value = PROFILE;
		await nextTick();
		await flush();

		expect(call).toHaveBeenCalledTimes(1);
		expect(call.mock.calls[0]?.[0]).toMatchObject({
			method: "posawesome.posawesome.api.combos.get_combos",
			args: { pos_profile: "Doco Demo", customer: null },
		});
		expect(combos.offers.value).toHaveLength(1);
		scope.stop();
	});

	it("refetches when the register itself changes", async () => {
		const posProfile = ref<any>(PROFILE);
		const scope = effectScope();
		scope.run(() => useComboOffers({ posProfile }))!;
		await flush();
		expect(call).toHaveBeenCalledTimes(1);

		posProfile.value = OTHER_PROFILE;
		await nextTick();
		await flush();

		expect(call).toHaveBeenCalledTimes(2);
		expect(call.mock.calls[1]?.[0]?.args?.pos_profile).toBe("Cafeteria Demo");
		scope.stop();
	});

	it("refetches on a customer change, because their price list can differ", async () => {
		const posProfile = ref<any>(PROFILE);
		const customer = ref<string | null>(null);
		const scope = effectScope();
		scope.run(() => useComboOffers({ posProfile, customer }))!;
		await flush();
		expect(call).toHaveBeenCalledTimes(1);

		customer.value = "Mayoreo SA";
		await nextTick();
		await flush();

		expect(call).toHaveBeenCalledTimes(2);
		expect(call.mock.calls[1]?.[0]?.args?.customer).toBe("Mayoreo SA");
		scope.stop();
	});

	it("does NOT refetch when the customer changes to the same one", async () => {
		const posProfile = ref<any>(PROFILE);
		const customer = ref<any>("Mayoreo SA");
		const scope = effectScope();
		scope.run(() => useComboOffers({ posProfile, customer }))!;
		await flush();
		expect(call).toHaveBeenCalledTimes(1);

		// A store re-assigning an equal value is the ordinary case, not an
		// exotic one: `selectedCustomer` is written on every customer read.
		customer.value = "Mayoreo SA";
		await nextTick();
		await flush();

		// Same profile re-assigned as a fresh object — same price list, same
		// warehouse, so the same answer. The watcher watches the KEY.
		posProfile.value = { ...PROFILE };
		await nextTick();
		await flush();

		expect(call).toHaveBeenCalledTimes(1);
		scope.stop();
	});

	it("refreshes when the catalogue syncs, past the floor", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const posProfile = ref<any>(PROFILE);
		const bus = makeBus();
		const scope = effectScope();
		scope.run(() => useComboOffers({ posProfile, eventBus: bus }))!;
		await flush();
		expect(call).toHaveBeenCalledTimes(1);

		// Boot emits `set_all_items` once per page and every search emits it
		// again. Inside the floor these cost nothing.
		bus.emit(CATALOG_SYNC_EVENT, []);
		bus.emit(CATALOG_SYNC_EVENT, []);
		await flush();
		expect(call).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(CATALOG_REFRESH_FLOOR_MS + 1);
		bus.emit(CATALOG_SYNC_EVENT, []);
		await flush();

		// Past the floor it refreshes even though the in-memory TTL has not
		// expired — a synced catalogue can carry a new bundle or a new price.
		expect(call).toHaveBeenCalledTimes(2);
		scope.stop();
	});

	it("does not treat an offline catalogue change as a sync", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const posProfile = ref<any>(PROFILE);
		const bus = makeBus();
		const scope = effectScope();
		scope.run(() => useComboOffers({ posProfile, eventBus: bus }))!;
		await flush();
		call.mockClear();

		stub.offline = true;
		vi.advanceTimersByTime(CATALOG_REFRESH_FLOOR_MS + 1);
		bus.emit(CATALOG_SYNC_EVENT, []);
		await flush();

		// The event still fires offline — searching the local cache replaces
		// the array — but nothing new was learned, so nothing is asked.
		expect(call).not.toHaveBeenCalled();
		scope.stop();
	});

	it("drops its catalogue listener with the handler, not by name", () => {
		const posProfile = ref<any>(PROFILE);
		const bus = makeBus();
		const scope = effectScope();
		scope.run(() => useComboOffers({ posProfile, eventBus: bus }))!;
		expect(bus.count(CATALOG_SYNC_EVENT)).toBe(1);

		scope.stop();

		// A bare `off(event)` would take the item surfaces' listeners with it.
		expect(bus.off).toHaveBeenCalledWith(CATALOG_SYNC_EVENT, expect.any(Function));
		expect(bus.count(CATALOG_SYNC_EVENT)).toBe(0);
	});

	it("never polls", async () => {
		// Calls, not mentions — the module docstring names both to say it does
		// not use them, and a bare word match would fail on its own promise.
		expect(composableSource).not.toMatch(/setInterval\s*\(/);
		expect(composableSource).not.toMatch(/setTimeout\s*\(/);

		// And the cart is not a trigger: the strip re-ranks client-side, so a
		// scan, a qty step and a removed line all cost zero round trips.
		const posProfile = ref<any>(PROFILE);
		const scope = effectScope();
		const combos = scope.run(() => useComboOffers({ posProfile }))!;
		await flush();
		expect(call).toHaveBeenCalledTimes(1);

		for (let i = 0; i < 20; i += 1) {
			await nextTick();
		}
		expect(call).toHaveBeenCalledTimes(1);
		expect(combos.offers.value).toHaveLength(1);
		scope.stop();
	});

	it("serves the second surface from memory instead of a second round trip", async () => {
		// The drawer wants the category count and the strip wants the tiles, and
		// they mount in the same tick.
		const drawer = useComboOffers();
		const strip = useComboOffers();
		const [a, b] = await Promise.all([
			drawer.load({ pos_profile: PROFILE }),
			strip.load({ pos_profile: PROFILE }),
		]);

		expect(call).toHaveBeenCalledTimes(1);
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});
});

describe("the offline answer", () => {
	it("records a successful answer and serves it with no connection", async () => {
		const first = useComboOffers();
		await first.load({ pos_profile: PROFILE });
		expect(stub.persist).toHaveBeenCalledWith(COMBO_OFFERS_CACHE_KEY);

		clearComboOffersCache();
		stub.offline = true;
		call.mockClear();

		const resumed = useComboOffers();
		const offers = await resumed.load({ pos_profile: PROFILE });

		// No call attempted at all: offline, `frappe.call` resolves slowly or
		// with an HTML error page and either would blank the strip meanwhile.
		expect(call).not.toHaveBeenCalled();
		expect(offers).toHaveLength(1);
		expect(offers[0]?.item_code).toBe("COMBO-PROTECCION");
		// Normalised on the way back out, so a cached string rate cannot reach
		// the saving arithmetic.
		expect(offers[0]?.rate).toBe(289);
		expect(offers[0]?.components).toHaveLength(3);
	});

	it("draws nothing at all on a cold cache offline", async () => {
		stub.offline = true;
		const combos = useComboOffers();
		const offers = await combos.load({ pos_profile: PROFILE });

		expect(call).not.toHaveBeenCalled();
		expect(offers).toEqual([]);
	});

	it("keys the cache by the pricing context, not by the register", async () => {
		const combos = useComboOffers();
		await combos.load({ pos_profile: PROFILE, customer: "Mayoreo SA" });
		clearComboOffersCache();
		stub.offline = true;

		// The same register, a different customer: nothing was ever recorded
		// for this context, so nothing is served. Quoting the wholesale saving
		// to a walk-in is the failure this key prevents.
		expect(await useComboOffers().load({ pos_profile: PROFILE })).toEqual([]);
		expect(
			await useComboOffers().load({ pos_profile: PROFILE, customer: "Mayoreo SA" }),
		).toHaveLength(1);
	});

	it("falls back to the last good answer when the call fails, and retries next time", async () => {
		await useComboOffers().load({ pos_profile: PROFILE });
		clearComboOffersCache();

		const failure = new Error("network");
		call.mockImplementation(async () => {
			throw failure;
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const combos = useComboOffers();
		const offers = await combos.load({ pos_profile: PROFILE });

		// The shop's combos do not vanish because one request timed out...
		expect(offers).toHaveLength(1);
		// ...and the failure is not recorded, so the next natural trigger asks
		// again rather than serving a five-minute-old nothing.
		call.mockClear();
		call.mockImplementation(async () => ({ message: [PROTECCION] }));
		await combos.load({ pos_profile: PROFILE });
		expect(call).toHaveBeenCalledTimes(1);
	});

	it("renders nothing when the call fails and there is no cache", async () => {
		call.mockImplementation(async () => {
			throw new Error("network");
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		expect(await useComboOffers().load({ pos_profile: PROFILE })).toEqual([]);
	});

	it("does not overwrite a good answer with a failure", async () => {
		await useComboOffers().load({ pos_profile: PROFILE });
		clearComboOffersCache();
		call.mockImplementation(async () => {
			throw new Error("network");
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await useComboOffers().load({ pos_profile: PROFILE });

		expect(peekCachedComboOffers(PROFILE)).toHaveLength(1);
	});

	it("treats an empty answer as an answer, and an aged one as no answer", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		saveComboOffers(PROFILE, null, []);
		// "This tenant authored no bundles" is a fact worth keeping: offline it
		// keeps drawing no combo UI on purpose rather than by omission.
		expect(peekCachedComboOffers(PROFILE)).toEqual([]);

		vi.advanceTimersByTime(COMBO_OFFERS_TTL_MS + 1);
		// Past the TTL it is a miss, not a stale saving quoted out loud.
		expect(peekCachedComboOffers(PROFILE)).toBeNull();
	});

	it("refuses to record an answer it cannot attribute to a register", () => {
		saveComboOffers(null, null, [PROTECCION]);
		expect(stub.persist).not.toHaveBeenCalled();
		expect(peekCachedComboOffers(null)).toBeNull();
	});
});

describe("the shell only gains the call", () => {
	it("hydrates the cache slot at boot, so a warm cache is ever read back", () => {
		// A key missing from either map is a cache that is always cold: reads
		// fall through to `keyval` and boot never copies it into `memory`.
		expect(dbSource).toMatch(/combo_offers_cache:\s*"cache"/);
		expect(dbSource).toMatch(/combo_offers_cache:\s*\{\}/);
	});

	it("holds no fetch of its own, and never awaits combos", () => {
		expect(shellSource).toContain("useComboOffers({");
		// The read model is called from the composable, not from the god-file.
		expect(shellSource).not.toContain("api.combos.get_combos");
		expect(shellSource).not.toMatch(/await\s+\w*[cC]ombo/);
		// And the stale claim is gone rather than merely contradicted.
		expect(shellSource).not.toContain("Combos are not fetched yet");
	});

	it("passes the strip its inputs by name", () => {
		// Positionally, the cart's LINES landed where `accessories` goes and the
		// register offered the cashier the four items they had just scanned.
		expect(shellSource).toMatch(/buildSuggestions\(\{/);
		expect(shellSource).toMatch(/combos:\s*comboOffers\.value/);
		expect(shellSource).toMatch(/cart:\s*invoiceDoc\.value\?\.items/);
	});
});
