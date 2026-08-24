// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import OrdenDetail from "../src/posapp/components/pos/flows/orden/OrdenDetail.vue";
import OrdenQueue from "../src/posapp/components/pos/flows/orden/OrdenQueue.vue";
import { describeBuckets } from "../src/posapp/components/pos/flows/orden/ordenModel";
import type {
	ServiceOrderCard,
	ServiceOrderDetail,
} from "../src/posapp/services/serviceOrderService";

/**
 * Órdenes de servicio, mounted (artboard `Orden.dc.html`).
 *
 * The two presentational halves are mounted here, because what they get wrong
 * is visible: a dimmed card with no reason on it, or a free line that reads
 * like a discount. The SURFACE's own guarantees are negatives — it prices
 * nothing, forks no invoice path, draws no second band — and those live in
 * `ordenSources.spec.ts`, which reads real files and therefore cannot run
 * under jsdom (jsdom shims `node:path`, and `resolve` comes back undefined).
 */

const MONEY = "¤";
const currency = (value: number) => `${MONEY}${Number(value).toFixed(2)}`;
const float = (value: number) => String(value);

const card = (overrides: Partial<ServiceOrderCard> = {}): ServiceOrderCard => ({
	name: "PCR-1",
	folio: "RO-00048",
	customer: "CUST-1",
	customer_name: "Alejandra Ríos Bautista",
	serials: [],
	title: "Samsung A54 · pantalla rota",
	amount_total: 1910,
	advance: 600,
	invoiced: false,
	warranty: false,
	no_charge: false,
	...overrides,
});

const detail = (overrides: Partial<ServiceOrderDetail> = {}): ServiceOrderDetail => ({
	...card(),
	technician: "ivan@doco.mx",
	worked_minutes: 508,
	lines: [
		{
			item_code: "SERV-PANT",
			item_name: "Cambio de pantalla — Samsung A54",
			qty: 1,
			rate: 1450,
			amount: 1450,
			kind: "labor",
			provenance: "labor",
			billable: true,
		},
		{
			item_code: "IPN002218",
			item_name: "Pantalla OLED Samsung A54",
			qty: 1,
			rate: 980,
			amount: 980,
			kind: "part",
			provenance: "stock",
			billable: true,
		},
		{
			item_code: "IPN009001",
			item_name: "Cristal trasero del cliente",
			qty: 1,
			rate: 0,
			amount: 0,
			kind: "part",
			provenance: "customer_supplied",
			billable: false,
		},
	],
	...overrides,
});

const mountQueue = (cards: ServiceOrderCard[], props: Record<string, unknown> = {}) =>
	mount(OrdenQueue, {
		props: {
			cards,
			chips: describeBuckets({ ready: cards.length, working: 9, delivered: 2 }, "ready"),
			query: "",
			selected: null,
			bucket: "ready",
			formatCurrency: currency,
			...props,
		},
	});

const mountDetail = (order: ServiceOrderDetail | null) =>
	mount(OrdenDetail, {
		props: { order, formatCurrency: currency, formatFloat: float },
	});

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("the queue column", () => {
	it("draws a chip per bucket the register can report on", () => {
		const queue = mountQueue([card()]);
		const chips = queue.findAll('[data-bucket]');
		expect(chips.map((chip) => chip.attributes("data-bucket"))).toEqual([
			"ready",
			"working",
			"delivered",
		]);
	});

	it("leaves «En trabajo» unpressable, because Taller owns that work", () => {
		const queue = mountQueue([card()]);
		expect(queue.find('[data-bucket="working"]').attributes("disabled")).toBeDefined();
	});

	it("says why an invoiced order cannot be charged, instead of only dimming it", () => {
		// A card that dims without a reason is a card that gets clicked twice.
		const queue = mountQueue([card({ invoiced: true })]);
		const found = queue.find('[data-testid="orden-card-PCR-1"]');
		expect(found.classes()).toContain("orden-queue__card--muted");
		expect(found.text()).toContain("It cannot be charged twice");
	});

	it("shows the advance where there is one and says «Sin anticipo» where there is not", () => {
		expect(mountQueue([card({ advance: 600 })]).text()).toContain("Advance");
		expect(mountQueue([card({ advance: 0 })]).text()).toContain("No advance");
	});

	it("names the folio the customer is holding", () => {
		expect(mountQueue([card()]).text()).toContain("#RO-00048");
	});

	it("asks for the selection rather than making it", async () => {
		// Asserted through a listener PROP, not `wrapper.emitted()`: in this
		// harness `emitted()` records the native click and never the component's
		// own `select`, so an `emitted()` assertion here passes or fails for
		// reasons that have nothing to do with the component.
		const onSelect = vi.fn();
		const queue = mountQueue([card()], { onSelect });
		await queue.find('[data-testid="orden-card-PCR-1"]').trigger("click");
		expect(onSelect).toHaveBeenCalledWith("PCR-1");
	});

	it("refuses to open the bucket Taller owns", async () => {
		const onBucket = vi.fn();
		const queue = mountQueue([card()], { onBucket });
		await queue.find('[data-bucket="working"]').trigger("click");
		expect(onBucket).not.toHaveBeenCalled();

		await queue.find('[data-bucket="delivered"]').trigger("click");
		expect(onBucket).toHaveBeenCalledWith("delivered");
	});

	it("tells an empty search apart from an empty queue", () => {
		expect(mountQueue([]).text()).toContain("No service order is ready to charge.");
		expect(mountQueue([], { query: "9991" }).text()).toContain("No service order matches that.");
	});

	it("keeps saying where these orders come from", () => {
		// The counter does not create them and cannot change them; a surface
		// that hides that invites a cashier to try.
		expect(mountQueue([card()]).text()).toContain("created and worked in Taller");
	});

	it("never puts a raw device id on a card", () => {
		const html = mountQueue([card({ serials: ["356938035643821"] })]).html();
		expect(html).not.toContain("356938035643821");
	});
});

describe("the detail panel", () => {
	it("waits rather than showing an empty bill", () => {
		expect(mountDetail(null).find('[data-testid="orden-detail-idle"]').exists()).toBe(true);
	});

	it("prints where each line came from", () => {
		const text = mountDetail(detail()).text();
		expect(text).toContain("labour");
		expect(text).toContain("from stock");
		expect(text).toContain("customer's part");
	});

	it("shows the customer's own part at zero, not as a discount", () => {
		const panel = mountDetail(detail());
		const free = panel.find('[data-provenance="customer_supplied"]');
		expect(free.classes()).toContain("orden-detail__row--free");
		expect(free.text()).toContain("no charge");
		expect(free.text()).toContain(currency(0));
	});

	it("states the order, the advance and the balance — and no subtotal or IVA", () => {
		// The read model has no tax and cannot have one: the Sales Invoice
		// applies it from the profile's template when the request is loaded.
		// Splitting a total here would be the surface guessing at the ticket.
		const text = mountDetail(detail()).text();
		expect(text).toContain("Balance due");
		expect(text).toContain(currency(1310));
		expect(text).not.toContain("Subtotal");
		expect(text).not.toContain("IVA");
	});

	it("hides the advance row when nothing was paid in advance", () => {
		expect(mountDetail(detail({ advance: 0 })).text()).not.toContain("Advance");
	});

	it("reports bench time once, on the header", () => {
		expect(mountDetail(detail()).text()).toContain("8 h 28 m");
	});

	it("masks the device id it shows", () => {
		const panel = mountDetail(detail({ serials: ["356938035643821"] }));
		expect(panel.find('[data-testid="orden-device-id"]').text()).toBe("IMEI 35•••••••••3821");
		expect(panel.html()).not.toContain("356938035643821");
	});

	it("names the invoice once the order has been billed", () => {
		const panel = mountDetail(detail({ invoiced: true, invoice: "ACC-SINV-2026-00214" }));
		expect(panel.text()).toContain("ACC-SINV-2026-00214");
	});
});
