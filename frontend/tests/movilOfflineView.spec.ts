// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import { buildHeldSales } from "../src/posapp/components/pos/offline/offlineQueueModel";
import {
	OFFLINE_SURFACES,
	type OfflineSurface,
} from "../src/posapp/components/pos/shell/mobile/offlineSurfaceManifest";
import MovilOfflineView from "../src/posapp/components/pos/mobile/offline/MovilOfflineView.vue";

/**
 * The phone's offline surface, mounted.
 *
 * `movilOfflineModel.spec.ts` pins the arithmetic; this file pins that the
 * screen renders THAT arithmetic and not a second copy of it — the held total
 * summed from the rows underneath it, the already-uploaded row visibly apart
 * from the waiting ones, and the capability columns read out of the manifest
 * rather than typed into the template.
 */

type AnyRecord = Record<string, any>;

/** A marker no formatter would produce, so counting it counts MONEY. */
const MONEY = "¤";

const snapshot = (over: AnyRecord = {}): AnyRecord => ({
	queue_id: over.queue_id,
	status: over.status ?? "pending",
	created_at: over.created_at,
	retry_count: over.retry_count ?? 0,
	idempotency_key: `inv-1755900000000-key${over.queue_id}`,
	invoice: {
		name: over.name,
		customer_name: over.customer ?? "Público en general",
		grand_total: over.amount ?? 0,
		items: over.items ?? [{ item_name: "Funda", qty: 1 }],
		payments: [{ mode_of_payment: over.tender ?? "Efectivo", amount: over.amount ?? 0 }],
	},
	data: {},
});

const HELD = [
	{ queue_id: 1, name: "B-04832", created_at: "2026-08-22T18:58:00.000Z", amount: 800, customer: "Nayeli Tzab", tender: "Transferencia" },
	{ queue_id: 2, name: "B-04833", created_at: "2026-08-22T19:12:00.000Z", amount: 200, customer: "Rogelio Ancona" },
	{ queue_id: 3, name: "B-04834", created_at: "2026-08-22T19:31:00.000Z", amount: 518, tender: "Tarjeta" },
	{
		queue_id: 4,
		name: "B-04835",
		created_at: "2026-08-22T19:44:00.000Z",
		amount: 1129,
		customer: "Alejandra Ríos",
		items: [{ item_name: "Combo Protección", qty: 1 }, { item_name: "Mica", qty: 2 }],
	},
];

const UPLOADED = {
	queue_id: 900,
	name: "B-04812",
	status: "synced",
	created_at: "2026-08-22T17:58:00.000Z",
	amount: 3290,
	customer: "Guadalupe Herrera",
};

const rows = (extra: AnyRecord[] = []) =>
	buildHeldSales([...HELD.map((row) => snapshot(row)), snapshot(UPLOADED), ...extra]);

const mountView = (props: Record<string, unknown> = {}) =>
	mount(MovilOfflineView, {
		props: {
			rows: rows(),
			online: false,
			now: new Date("2026-08-22T21:31:00.000Z"),
			formatCurrency: (value: number) => `${MONEY}${value}`,
			...props,
		},
		global: { plugins: [createVuetify()] },
	});

const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("this is the phone's own surface, not the overlay", () => {
	it("declares its scope so the two cannot be confused", () => {
		// `MobileOfflineOverlay` is `role="status"` OVER the current tab and
		// declares `overlay`; the desktop queue declares `surface`. Three
		// treatments of one state, each with its own reason to exist.
		const root = mountView().get('[data-testid="movil-offline"]');

		expect(root.attributes("data-offline-scope")).toBe("mobile-surface");
		expect(root.attributes("role")).toBe("region");
	});
});

describe("the money held", () => {
	it("is the sum of the sales in the list, not an estimate", () => {
		const held = mountView().get('[data-testid="movil-offline-held"]');

		// 800 + 200 + 518 + 1129. The uploaded 3,290 reached the server and is
		// not money this register is carrying.
		expect(held.text()).toBe(`${MONEY}2647`);
	});

	it("declares itself, and is the only total on the screen", () => {
		const wrapper = mountView();

		expect(wrapper.findAll('[data-money-role="queued-total"]')).toHaveLength(1);
		expect(
			countMoney(wrapper.html()),
			"a money figure with no data-money-role is how a third total gets on screen",
		).toBe(wrapper.findAll("[data-money-role]").length);
	});

	it("counts tickets in the singular when there is one", () => {
		const wrapper = mountView({ rows: buildHeldSales([snapshot(HELD[0])]) });

		expect(wrapper.text()).toContain("ticket");
		expect(wrapper.text()).not.toContain("tickets");
	});
});

describe("the queue, as the artboard draws it", () => {
	it("renders the real rows, oldest first", () => {
		const tickets = mountView()
			.findAll(".movil-offline-queue__ticket")
			.map((node) => node.text());

		expect(tickets).toEqual(["B-04832", "B-04833", "B-04834", "B-04835", "B-04812"]);
	});

	it("tells an uploaded sale apart from one still waiting", () => {
		const wrapper = mountView();
		const waiting = wrapper.get('[data-testid="movil-offline-row-1"]');
		const uploaded = wrapper.get('[data-testid="movil-offline-row-900"]');

		expect(waiting.attributes("data-held-state")).toBe("waiting");
		expect(uploaded.attributes("data-held-state")).toBe("uploaded");
		// Not the same chip painted twice: amber is STATE and green is STATE,
		// and a cashier reads the difference before they read the word.
		expect(waiting.get(".movil-offline-queue__chip").attributes("data-held-tone")).toBe(
			"warning",
		);
		expect(uploaded.get(".movil-offline-queue__chip").attributes("data-held-tone")).toBe(
			"positive",
		);
	});

	it("says what the sale was, in one line", () => {
		const row = mountView().get('[data-testid="movil-offline-row-4"]');

		expect(row.text()).toContain("Alejandra Ríos");
		expect(row.get(".movil-offline-queue__lines").text()).toBe(
			"Combo Protección + 2 × Mica · 2 lines · Efectivo",
		);
	});

	it("folds the rest into a count of SALES still queued", () => {
		const extra = Array.from({ length: 19 }, (_, index) =>
			snapshot({
				queue_id: 100 + index,
				name: `B-049${index}`,
				created_at: `2026-08-22T20:${String(index).padStart(2, "0")}:00.000Z`,
				amount: 100,
			}),
		);
		const wrapper = mountView({ rows: rows(extra) });

		expect(wrapper.get('[data-testid="movil-offline-more"]').text()).toContain("19");
	});

	it("states the ordering rule it keeps", () => {
		expect(mountView().get('[data-testid="movil-offline-order-rule"]').exists()).toBe(true);
	});

	it("has an honest empty state — the queue is empty, not the register synced", () => {
		const wrapper = mountView({ rows: [] });
		const empty = wrapper.get('[data-testid="movil-offline-empty"]');

		expect(empty.text()).toContain("Nothing is waiting to upload");
		expect(wrapper.find('[data-testid="movil-offline-more"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="movil-offline-held"]').text()).toBe(`${MONEY}0`);
	});
});

describe("what the shop can still do", () => {
	it("reads both columns out of the manifest", () => {
		const wrapper = mountView();
		const can = wrapper.findAll('[data-testid="movil-offline-can"]');
		const wait = wrapper.findAll('[data-testid="movil-offline-wait"]');

		expect(can.length + wait.length).toBe(OFFLINE_SURFACES.length);
		expect(wait.map((node) => node.attributes("data-offline-surface"))).toEqual([
			"cfdi",
			"recharges",
			"whatsapp",
		]);
	});

	it("is data-driven, not a list typed into the template", () => {
		// Surfaces that do not exist anywhere in this repo. A hardcoded column
		// renders the real manifest and fails here.
		const invented: OfflineSurface[] = [
			{ id: "weighing", labelKey: "Weigh and tare", availability: "available" },
			{ id: "terminal", labelKey: "Card terminal", availability: "blocked" },
		];
		const wrapper = mountView({ surfaces: invented });

		expect(
			wrapper
				.findAll('[data-testid="movil-offline-can"]')
				.map((node) => node.attributes("data-offline-surface")),
		).toEqual(["weighing"]);
		expect(
			wrapper
				.findAll('[data-testid="movil-offline-wait"]')
				.map((node) => node.attributes("data-offline-surface")),
		).toEqual(["terminal"]);
		expect(wrapper.text()).not.toContain("Stamp CFDI");
	});

	it("carries each surface's availability into the markup", () => {
		const cfdi = mountView().get('[data-offline-surface="cfdi"]');

		expect(cfdi.attributes("data-offline-availability")).toBe("blocked");
	});
});

describe("the sentence at the top cannot outrun the queue", () => {
	it("says keep selling while the signal is gone", () => {
		const wrapper = mountView({ online: false });

		expect(wrapper.get(".movil-offline__banner").attributes("data-claim")).toBe("offline");
		expect(wrapper.text()).toContain("Keep selling");
	});

	it("stops promising 'it uploads by itself' once the signal is back", () => {
		// Back online is NOT uploaded. A cashier who reads the offline
		// reassurance after the outage ended closes their shift on a promise
		// nobody made.
		const wrapper = mountView({ online: true });

		expect(wrapper.get(".movil-offline__banner").attributes("data-claim")).toBe("uploading");
		expect(wrapper.text()).toContain("Back online — the queue is emptying itself");
		expect(wrapper.text()).not.toContain("It uploads by itself when the signal returns");
	});

	it("only claims everything is uploaded with an empty queue and a live server", () => {
		const wrapper = mountView({ online: true, rows: [] });

		expect(wrapper.get(".movil-offline__banner").attributes("data-claim")).toBe("clear");
		expect(wrapper.text()).toContain("Everything is uploaded");
	});

	it("names the elapsed fact it is actually reporting", () => {
		const fromShell = mountView({ offlineSince: "2026-08-22T19:44:00.000Z" });
		const fromQueue = mountView();

		expect(fromShell.get('[data-testid="movil-offline-elapsed"]').text()).toContain("no signal");
		expect(fromShell.text()).toContain("1 h 47 m");
		expect(fromQueue.get('[data-testid="movil-offline-elapsed"]').text()).toContain(
			"Holding sales for",
		);
	});

	it("hides the elapsed block rather than showing an empty one", () => {
		const wrapper = mountView({ rows: [], offlineSince: null });

		expect(wrapper.find('[data-testid="movil-offline-elapsed"]').exists()).toBe(false);
	});
});

describe("Reintentar", () => {
	it("asks the container to retry — it never drains anything itself", () => {
		const onRetry = vi.fn();
		const wrapper = mountView({ onRetry });

		wrapper.get('[data-testid="movil-offline-retry"]').trigger("click");

		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("cannot be pressed into a second dispatch while one is in flight", () => {
		const onRetry = vi.fn();
		const wrapper = mountView({ onRetry, retrying: true });
		const button = wrapper.get('[data-testid="movil-offline-retry"]');

		expect(button.attributes("disabled")).toBeDefined();
		expect(button.attributes("aria-busy")).toBe("true");
		button.trigger("click");
		expect(onRetry).not.toHaveBeenCalled();
	});
});
