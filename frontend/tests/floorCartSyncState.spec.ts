// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, reactive, ref } from "vue";

/**
 * "Did my round land?" — the question the register had no answer to.
 *
 * The cart→order sync is an 800 ms debounce and a POST. Both were invisible:
 * `markSyncing` keys on the TABLE name (so a cup tab reported nothing at all)
 * and says "a write is in flight", not "your edit is safe". These tests pin the
 * state machine the mesa strip reads, including the two cases that decide
 * whether it tells the truth: opening a table must NOT read as unsaved, and a
 * no-op edit must not strand it on «guardando…».
 */

const updateTableOrder = vi.fn();
// PARTIAL: `floorCartBridge` reaches into the same module for `ensureLineUid`,
// and a wholesale mock strands it — the sync then throws inside the watcher and
// every state assertion below reads `undefined` for reasons that have nothing
// to do with the state machine.
vi.mock("../src/posapp/api/restaurant", async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	updateTableOrder: (...args: unknown[]) => updateTableOrder(...args),
}));

import { createCartSync, type CartSyncState } from "../src/posapp/stores/floor/floorCartSync";
import type { OrderRow } from "../src/posapp/api/restaurant";

/**
 * A server line as the endpoint actually returns one — `notes` and
 * `course_idx` present, not merely absent. `buildLineDelta` compares those two
 * fields, so a fixture that omits them makes every freshly opened ticket look
 * edited and quietly tests something else.
 */
const line = (uid: string, qty = 1) => ({
	line_uid: uid,
	item_code: "CAP",
	item_name: "Capuchino",
	qty,
	uom: null,
	rate: 48,
	amount: 48 * qty,
	notes: null,
	course_idx: 1,
	fired: 0,
});

const orderRow = (lines: ReturnType<typeof line>[]): OrderRow =>
	({
		name: "TO-1",
		order_uid: "ord-1",
		table: "tbl-1",
		pos_profile: "Barra 1",
		company: "Café",
		status: "Open",
		tab_name: "Sofía",
		guest_count: 2,
		service_type: "Dine In",
		customer: null,
		opened_by: null,
		waiter: null,
		items_count: lines.length,
		unsent_count: lines.length,
		total: lines.reduce((sum, row) => sum + row.amount, 0),
		modified: "2026-08-23 09:02:00",
		lines,
	}) as OrderRow;

/** A cart stand-in with the one reactive field the sync watches. */
const makeCart = () =>
	reactive({
		metadata: { changeVersion: 0 },
		items: [] as any[],
		posaTabName: null as string | null,
		posaGuestCount: null as number | null,
		posaServiceType: null as string | null,
		clear() {
			this.items = [];
			this.metadata.changeVersion += 1;
		},
		setItems(items: any[]) {
			this.items = items;
			this.metadata.changeVersion += 1;
		},
	});

const setup = () => {
	const cart = makeCart();
	const activeOrder = ref<OrderRow | null>(null);
	const states: CartSyncState[] = [];
	const sync = createCartSync({
		invoiceStore: () => cart,
		activeOrder,
		isRecordOnly: computed(() => true),
		markSyncing: () => {},
		onOrderUpdated: (order) => {
			activeOrder.value = order;
		},
		onSyncState: (state) => states.push(state),
		onError: () => {},
	});
	return { cart, activeOrder, states, sync };
};

beforeEach(() => {
	vi.useFakeTimers();
	updateTableOrder.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("cart sync state", () => {
	it("opening a table reads as saved, never as an unsaved round", async () => {
		// The regression this pins: `loadOrderIntoCart` writes the whole ticket
		// into the cart and bumps the same change version a waiter's typing
		// does. Reporting "pending" on the bump alone put «guardando…» over a
		// table nobody had touched yet.
		const { cart, activeOrder, states, sync } = setup();
		const order = orderRow([line("l1"), line("l2")]);
		activeOrder.value = order;

		sync.loadOrderIntoCart(order);
		await nextTick();

		expect(states).not.toContain("pending");
		expect(states.at(-1)).toBe("saved");
		expect(cart.posaTabName).toBe("Sofía");
	});

	it("a typed round goes pending, then saving, then saved", async () => {
		const { cart, activeOrder, states, sync } = setup();
		const order = orderRow([line("l1")]);
		activeOrder.value = order;
		sync.loadOrderIntoCart(order);
		await nextTick();
		states.length = 0;

		updateTableOrder.mockResolvedValue(orderRow([line("l1"), line("l2")]));
		cart.setItems([
			{ posa_row_id: "l1", item_code: "CAP", item_name: "Capuchino", qty: 1, rate: 48, amount: 48 },
			{ posa_row_id: "l2", item_code: "CAP", item_name: "Capuchino", qty: 1, rate: 48, amount: 48 },
		]);
		await nextTick();

		expect(states).toEqual(["pending"]);

		await vi.advanceTimersByTimeAsync(900);

		expect(updateTableOrder).toHaveBeenCalledTimes(1);
		expect(states).toEqual(["pending", "saving", "saved"]);
	});

	it("a no-op edit settles on saved instead of hanging on saving", async () => {
		// A qty typed back to what it already was produces an EMPTY delta. The
		// push returns early — and used to leave the strip mid-sentence.
		const { cart, activeOrder, states, sync } = setup();
		const order = orderRow([line("l1")]);
		activeOrder.value = order;
		sync.loadOrderIntoCart(order);
		await nextTick();
		states.length = 0;

		// Same version bump, same lines.
		cart.metadata.changeVersion += 1;
		await nextTick();
		await vi.advanceTimersByTimeAsync(900);

		expect(updateTableOrder).not.toHaveBeenCalled();
		expect(states.at(-1)).toBe("saved");
	});

	it("a failed push says so rather than claiming the round landed", async () => {
		const { cart, activeOrder, states, sync } = setup();
		const order = orderRow([line("l1")]);
		activeOrder.value = order;
		sync.loadOrderIntoCart(order);
		await nextTick();
		states.length = 0;

		updateTableOrder.mockRejectedValue(new Error("network"));
		cart.setItems([
			{ posa_row_id: "l1", item_code: "CAP", item_name: "Capuchino", qty: 3, rate: 48, amount: 144 },
		]);
		await nextTick();
		await vi.advanceTimersByTimeAsync(900);

		expect(states.at(-1)).toBe("error");
	});

	it("detaching the order returns the strip to idle", async () => {
		const { activeOrder, states, sync } = setup();
		const order = orderRow([line("l1")]);
		activeOrder.value = order;
		sync.loadOrderIntoCart(order);
		await nextTick();
		states.length = 0;

		sync.reset();

		expect(states).toEqual(["idle"]);
	});
});
