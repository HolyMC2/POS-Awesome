// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * Coupons and offers reach the invoice when they are ADDED, not only when the
 * list is replaced.
 *
 * `posa_coupons` (PosCoupons.vue) and `pos_offers` (PosOffers.vue) are watched
 * shallowly since 5006a5b54, and those watchers are the only path to the
 * invoice's offer evaluation and the «N Coupons» / «N Offers» counters. Adding
 * by `push` left a customer's gift cards, and therefore every coupon-based
 * offer, invisible to the sale.
 */

const m = vi.hoisted(() => ({ gift: [] as string[] }));

vi.mock("../src/offline/index", () => ({
	db: {
		isOpen: () => true,
		open: vi.fn(async () => undefined),
		table: vi.fn(() => ({
			filter: vi.fn().mockReturnThis(),
			offset: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			toArray: vi.fn(async () => []),
			bulkPut: vi.fn(async () => undefined),
		})),
	},
	checkDbHealth: vi.fn(async () => undefined),
	setCustomerStorage: vi.fn(async () => undefined),
	saveStoredValueSnapshot: vi.fn(),
	memoryInitPromise: Promise.resolve(),
	getCustomersLastSync: vi.fn(() => null),
	setCustomersLastSync: vi.fn(),
	getCustomerStorageCount: vi.fn(async () => 0),
	clearCustomerStorage: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
	getCachedCoupons: vi.fn(() => ({})),
	saveCoupons: vi.fn(),
}));

vi.mock("../src/posapp/format", () => ({ default: {}, useFormat: () => ({}) }));

import PosCoupons from "../src/posapp/components/pos/offers/PosCoupons.vue";
import PosOffers from "../src/posapp/components/pos/offers/PosOffers.vue";
import { useCustomersStore } from "../src/posapp/stores/customersStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

const pass = (name: string) =>
	defineComponent({
		name,
		setup(_props, { slots }) {
			return () => h("div", { class: name }, slots.default?.());
		},
	});

const STANDINS = Object.fromEntries(
	["VCard", "VCardTitle", "VRow", "VCol", "VTextField", "VBtn", "VDataTable", "VAutocomplete", "VIcon"].map(
		(name) => [name, pass(name)],
	),
);

const makeBus = () => {
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	const emitted: Array<[string, unknown]> = [];
	return {
		emitted,
		last: (event: string) => [...emitted].reverse().find(([name]) => name === event)?.[1],
		on: (event: string, fn: (payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn?: (payload?: unknown) => void) => {
			handlers[event] = fn ? (handlers[event] ?? []).filter((h) => h !== fn) : [];
		},
		emit: (event: string, payload?: unknown) => {
			emitted.push([event, payload]);
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

const frappeStub = {
	_: (value: string) => value,
	call: vi.fn((options: { method: string; args?: Record<string, any>; callback?: (r: unknown) => void }) => {
		let message: unknown = [];
		if (options.method.endsWith("get_active_gift_coupons")) {
			message = m.gift;
		} else if (options.method.endsWith("get_pos_coupon")) {
			const code = options.args?.coupon;
			message = {
				msg: "Apply",
				coupon: {
					name: `Coupon ${code}`,
					coupon_code: code,
					coupon_type: "Gift Card",
					pos_offer: `Offer ${code}`,
					customer: options.args?.customer,
				},
			};
		}
		options.callback?.({ message });
		return Promise.resolve({ message });
	}),
};

const mountWith = (component: unknown, bus: ReturnType<typeof makeBus>) =>
	mount(component as never, {
		global: {
			components: STANDINS,
			config: { globalProperties: { __: (value: string) => value, frappe: frappeStub, eventBus: bus } },
		},
	});

describe("coupons reach the invoice when added", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		m.gift = [];
		frappeStub.call.mockClear();
		vi.stubGlobal("frappe", frappeStub);
		vi.stubGlobal("__", (value: string) => value);
		useUIStore().setRegisterData({ pos_profile: { name: "Doco Ventas", company: "Grupo Doco" } as never });
	});

	it("a typed coupon is handed to the invoice and counted", async () => {
		const bus = makeBus();
		const wrapper = mountWith(PosCoupons, bus);
		useCustomersStore().setSelectedCustomer("CUST-1");
		await flushPromises();
		(wrapper.vm as unknown as { add_coupon: (code: string) => void }).add_coupon("GC-A");
		await flushPromises();
		expect(bus.last("update_invoice_coupons")).toEqual([
			expect.objectContaining({ coupon: "Coupon GC-A", coupon_code: "GC-A", pos_offer: "Offer GC-A", applied: 0 }),
		]);
		expect(useUIStore().couponsCount).toBe(1);
	});

	it("every active gift card of the selected customer reaches the invoice", async () => {
		m.gift = ["GC-A", "GC-B"];
		const bus = makeBus();
		mountWith(PosCoupons, bus);
		useCustomersStore().setSelectedCustomer("CUST-1");
		await flushPromises();
		const rows = bus.last("update_invoice_coupons") as Array<{ coupon_code: string }>;
		expect(rows.map((row) => row.coupon_code)).toEqual(["GC-A", "GC-B"]);
		expect(useUIStore().couponsCount).toBe(2);
	});
});

describe("offers reach the counters when added", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		frappeStub.call.mockClear();
		vi.stubGlobal("frappe", frappeStub);
		vi.stubGlobal("__", (value: string) => value);
		useUIStore().setRegisterData({ pos_profile: { name: "Doco Ventas", company: "Grupo Doco" } as never });
	});

	it("a coupon-based item-group gift offer is counted and evaluated", async () => {
		const bus = makeBus();
		const wrapper = mountWith(PosOffers, bus);
		await flushPromises();
		(wrapper.vm as unknown as { updatePosOffers: (offers: unknown[]) => void }).updatePosOffers([
			{
				name: "Mica de regalo",
				row_id: "Mica de regalo",
				offer: "Give Product",
				apply_on: "Item Code",
				apply_type: "Item Group",
				apply_item_group: "Micas",
				coupon_based: 1,
			},
		]);
		await flushPromises();
		expect(useUIStore().offersCount).toBe(1);
		expect(bus.emitted.some(([name]) => name === "update_invoice_offers")).toBe(true);
	});
});
