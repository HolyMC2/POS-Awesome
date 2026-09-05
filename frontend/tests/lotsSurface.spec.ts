// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

import SurfaceSource from "../src/posapp/components/pos/lots/LotsSurface.vue?raw";
import RegistrySource from "../src/posapp/composables/pos/shell/destinationRegistry.ts?raw";
import RailSource from "../src/posapp/composables/pos/shell/railDestinations.ts?raw";
import NavbarSource from "../src/posapp/components/Navbar.vue?raw";

/**
 * SERIES Y LOTES, mounted (owner ask 2026-09-05: «we need a way to search
 * like /desk/serial-no?item_code= with filters and good ui/ux inside the
 * same app»).
 *
 * The surface is mounted against a scripted server: what is asserted is that
 * the list is the server's list, that opening a row asks for its story, and
 * that «Sell this unit» leaves as ONE `lot:confirm` intent — the lot
 * picker's own contract — then closes the surface so the cashier lands back
 * on the sale with the line in the cart.
 */

const searchSerials = vi.fn();
const fetchSerialStory = vi.fn();
const searchBatches = vi.fn();
const fetchBatchStory = vi.fn();

vi.mock("../src/posapp/services/lotLookupService", () => ({
	searchSerials: (...args: any[]) => searchSerials(...args),
	fetchSerialStory: (...args: any[]) => fetchSerialStory(...args),
	searchBatches: (...args: any[]) => searchBatches(...args),
	fetchBatchStory: (...args: any[]) => fetchBatchStory(...args),
}));

const catalogue: Record<string, any> = {
	IPN004625: {
		item_code: "IPN004625",
		item_name: "Samsung A17 Lte 128GB+4GB Negro",
		warehouse: "Escuinapa, Hidalgo #1 DOCO - GD",
		has_serial_no: 1,
		serial_no_data: [],
	},
};
const searchItems = vi.fn(async () => undefined);
vi.mock("../src/posapp/stores/itemsStore", () => ({
	useItemsStore: () => ({
		getItemByCode: (code: string) => catalogue[code],
		searchItems,
	}),
}));

vi.mock("../src/posapp/composables/core/useOnlineStatus", () => ({
	useOnlineStatus: () => ({ isOnline: ref(true) }),
}));
const isPhone = ref(false);
vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({ isPhone }),
}));
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({
		formatCurrency: (value: any) => `$${Number(value).toFixed(2)}`,
		formatFloat: (value: any) => String(Number(value) || 0),
	}),
}));

import LotsSurface from "../src/posapp/components/pos/lots/LotsSurface.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

const SOLD = {
	serial_no: "353150400443913",
	item_code: "IPN004625",
	item_name: "Samsung A17 Lte 128GB+4GB Negro",
	status: "Delivered",
	warehouse: null,
	customer: "ALEJANDRO VAZQUEZ",
	batch_no: null,
	purchase_document_no: null,
	warranty_expiry_date: null,
	posting_date: "2026-07-30",
	last_voucher_type: "Sales Invoice",
	last_voucher_no: "ACC-SINV-2026-02707",
	last_moved_at: "2026-08-04 14:09:36",
	last_outward: true,
	sellable_here: false,
};
const IN_STOCK = {
	...SOLD,
	serial_no: "353207809426830",
	status: "Active",
	warehouse: "Escuinapa, Hidalgo #1 DOCO - GD",
	customer: null,
	last_voucher_type: "Purchase Invoice",
	last_voucher_no: "ACC-PINV-2026-00032",
	last_outward: false,
	sellable_here: true,
};

const searchPayload = (rows = [SOLD, IN_STOCK]) => ({
	rows,
	counts: { all: rows.length, Active: 1, Delivered: 1, Consumed: 0, Inactive: 0, Expired: 0 },
	total: rows.length,
	offset: 0,
	limit: 60,
	warehouses: [{ warehouse: "Escuinapa, Hidalgo #1 DOCO - GD", n: 74 }],
	profile_warehouse: "Escuinapa, Hidalgo #1 DOCO - GD",
	query: "",
	status: "all",
});

const story = (serial = SOLD) => ({
	serial,
	sold_on:
		serial.status === "Delivered"
			? {
					voucher_type: "Sales Invoice",
					voucher_no: "ACC-SINV-2026-02707",
					warehouse: "Escuinapa, Hidalgo #1 DOCO - GD",
					posting_datetime: "2026-08-04 14:09:36",
					outward: true,
					qty: -1,
					cancelled: false,
					party: "ALEJANDRO VAZQUEZ",
					is_return: false,
					return_against: null,
					grand_total: 4299,
					owner: "caja@doco",
					voucher_status: "Paid",
				}
			: null,
	movements: [],
	siblings:
		serial.status === "Delivered"
			? [{ serial_no: IN_STOCK.serial_no, warehouse: IN_STOCK.warehouse, batch_no: null, sellable_here: true }]
			: [],
	profile_warehouse: "Escuinapa, Hidalgo #1 DOCO - GD",
});

const bus = { emitted: [] as Array<{ event: string; payload: any }>, emit(event: string, payload?: any) { this.emitted.push({ event, payload }); } };

// `close` is asserted through its listener prop rather than `wrapper.emitted()`:
// the emit fires after two awaits inside the sell path, and the devtools
// hook VTU records with does not see it there, while the listener does.
const onClose = vi.fn();

const mountSurface = () =>
	mount(LotsSurface, {
		props: { onClose } as any,
		global: {
			provide: { eventBus: bus },
			components: {
				"v-icon": { template: "<i />" },
				"v-alert": { template: "<div class='alert'><slot /></div>" },
			},
		},
	});

beforeEach(() => {
	setActivePinia(createPinia());
	const uiStore = useUIStore();
	uiStore.posProfile = { name: "Doco Ventas", warehouse: "Escuinapa, Hidalgo #1 DOCO - GD" } as any;
	bus.emitted = [];
	onClose.mockReset();
	isPhone.value = false;
	searchSerials.mockReset().mockResolvedValue(searchPayload());
	fetchSerialStory.mockReset().mockImplementation(async (_profile: string, serialNo: string) =>
		story(serialNo === IN_STOCK.serial_no ? IN_STOCK : SOLD),
	);
	searchBatches.mockReset().mockResolvedValue({
		rows: [],
		counts: { available: 0, all: 0, expired: 0, empty: 0 },
		bucket: "available",
		profile_warehouse: null,
		today: "2026-09-05",
		query: "",
	});
	fetchBatchStory.mockReset();
	window.history.replaceState({}, "", "/lots");
});

describe("LotsSurface — the list is the server's list", () => {
	it("asks for serials scoped to the register's profile and draws the rows with the cashier's words", async () => {
		const wrapper = mountSurface();
		await flushPromises();
		expect(searchSerials).toHaveBeenCalledWith("Doco Ventas", expect.objectContaining({ status: "all", limit: 60, offset: 0 }));
		const rows = wrapper.findAll('[role="option"]');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.text()).toContain("353150400443913");
		expect(rows[0]!.text()).toContain("Sold");
		expect(rows[0]!.text()).toContain("ACC-SINV-2026-02707 · 2026-08-04 · ALEJANDRO VAZQUEZ");
		expect(rows[1]!.text()).toContain("In stock");
		expect(rows[1]!.text()).toContain("Escuinapa, Hidalgo #1 DOCO - GD");
		// Tabs carry the server's counts, not the page's.
		expect(wrapper.get('[data-testid="lots-tab-Delivered"]').text()).toContain("1");
	});

	it("re-asks the server when a tab is chosen", async () => {
		const wrapper = mountSurface();
		await flushPromises();
		await wrapper.get('[data-testid="lots-tab-Active"]').trigger("click");
		await flushPromises();
		expect(searchSerials).toHaveBeenLastCalledWith("Doco Ventas", expect.objectContaining({ status: "Active" }));
	});

	it("switches to the batch ledger on the kind toggle", async () => {
		const wrapper = mountSurface();
		await flushPromises();
		await wrapper.get('[data-testid="lots-kind-batch"]').trigger("click");
		await flushPromises();
		expect(searchBatches).toHaveBeenCalledWith("Doco Ventas", expect.objectContaining({ bucket: "available" }));
		expect(wrapper.get('[data-testid="lots-tab-available"]').exists()).toBe(true);
	});
});

describe("LotsSurface — the story", () => {
	it("opens a sold unit onto its ticket, its customer and the units still on the shelf", async () => {
		const wrapper = mountSurface();
		await flushPromises();
		await wrapper.get(`[data-testid="lots-serial-${SOLD.serial_no}"]`).trigger("click");
		await flushPromises();
		expect(fetchSerialStory).toHaveBeenCalledWith("Doco Ventas", SOLD.serial_no);
		const sold = wrapper.get('[data-testid="lots-story-sold"]');
		expect(sold.text()).toContain("Sold on 2026-08-04 14:09");
		expect(sold.text()).toContain("ACC-SINV-2026-02707");
		expect(sold.text()).toContain("ALEJANDRO VAZQUEZ");
		expect(sold.text()).toContain("$4299.00");
		// No primary for a unit that is gone…
		expect(wrapper.find('[data-testid="lots-sell-serial"]').exists()).toBe(false);
		// …but the sibling in stock is one tap away.
		expect(wrapper.get(`[data-testid="lots-sell-sibling-${IN_STOCK.serial_no}"]`).exists()).toBe(true);
	});

	it("sells an in-stock unit as ONE lot:confirm intent and closes", async () => {
		const wrapper = mountSurface();
		await flushPromises();
		await wrapper.get(`[data-testid="lots-serial-${IN_STOCK.serial_no}"]`).trigger("click");
		await flushPromises();
		await wrapper.get('[data-testid="lots-sell-serial"]').trigger("click");
		await flushPromises();
		expect(bus.emitted).toHaveLength(1);
		expect(bus.emitted[0]!.event).toBe("lot:confirm");
		const [add] = bus.emitted[0]!.payload.adds;
		expect(add).toMatchObject({
			item_code: "IPN004625",
			qty: 1,
			serial_no: IN_STOCK.serial_no,
			serial_no_selected: [IN_STOCK.serial_no],
			serial_no_selected_count: 1,
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("sells the sibling straight from a sold unit's story", async () => {
		const wrapper = mountSurface();
		await flushPromises();
		await wrapper.get(`[data-testid="lots-serial-${SOLD.serial_no}"]`).trigger("click");
		await flushPromises();
		await wrapper.get(`[data-testid="lots-sell-sibling-${IN_STOCK.serial_no}"]`).trigger("click");
		await flushPromises();
		expect(bus.emitted[0]!.payload.adds[0]).toMatchObject({ serial_no: IN_STOCK.serial_no, item_code: "IPN004625" });
	});

	it("refuses, with a word, an item the catalogue does not carry", async () => {
		fetchSerialStory.mockResolvedValue(story({ ...IN_STOCK, item_code: "GONE" }));
		const wrapper = mountSurface();
		await flushPromises();
		await wrapper.get(`[data-testid="lots-serial-${IN_STOCK.serial_no}"]`).trigger("click");
		await flushPromises();
		await wrapper.get('[data-testid="lots-sell-serial"]').trigger("click");
		await flushPromises();
		expect(searchItems).toHaveBeenCalledWith("GONE");
		expect(bus.emitted).toHaveLength(0);
		expect(onClose).not.toHaveBeenCalled();
	});
});

describe("LotsSurface — the phone", () => {
	it("fronts the story over the list, and the back chip returns", async () => {
		isPhone.value = true;
		const wrapper = mountSurface();
		await flushPromises();
		expect(wrapper.classes()).not.toContain("lots--story");
		await wrapper.get(`[data-testid="lots-serial-${SOLD.serial_no}"]`).trigger("click");
		await flushPromises();
		expect(wrapper.classes()).toContain("lots--story");
		await wrapper.get('[data-testid="lots-story-back"]').trigger("click");
		await flushPromises();
		expect(wrapper.classes()).not.toContain("lots--story");
	});
});

describe("LotsSurface — a deep link", () => {
	it("opens straight onto the serial a support instruction names", async () => {
		window.history.replaceState({}, "", "/lots?q=35 3150 4004 43913");
		mountSurface();
		await flushPromises();
		expect(fetchSerialStory).toHaveBeenCalledWith("Doco Ventas", "353150400443913");
		expect(searchSerials).toHaveBeenCalledWith("Doco Ventas", expect.objectContaining({ query: "353150400443913" }));
	});
});

describe("LotsSurface — wiring pins", () => {
	it("is a hosted sheet the rail reaches first among the tools, on desk and phone", () => {
		expect(RegistrySource).toContain('id: "lots",');
		expect(RegistrySource).toContain('path: "/lots",');
		expect(RegistrySource).toContain('lots: () => import("../../../components/pos/lots/LotsSurface.vue"),');
		expect(RailSource).toMatch(/"lots",\s*\n\s*"purchase",/);
		expect(NavbarSource).toContain('{ text: "Serials & batches", icon: "mdi-magnify-scan", to: "/lots" }');
	});

	it("rides the picker's own contract into the cart", () => {
		expect(SurfaceSource).toContain('eventBus.emit("lot:confirm", { adds: [add] });');
		expect(SurfaceSource).toContain('emit("close");');
	});
});
