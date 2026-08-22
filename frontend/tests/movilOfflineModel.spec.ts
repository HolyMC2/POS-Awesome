// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildHeldSales, summariseHeldSales } from "../src/posapp/components/pos/offline/offlineQueueModel";
import {
	OFFLINE_SURFACES,
	type OfflineSurface,
} from "../src/posapp/components/pos/shell/mobile/offlineSurfaceManifest";
import {
	buildMobileOfflinePage,
	mobileCapabilityColumns,
	resolveOfflineElapsed,
} from "../src/posapp/components/pos/mobile/offline/movilOfflineModel";

/**
 * The phone's offline surface, asserted against the artboard's own arithmetic.
 *
 * `MovilOffline.dc.html` states four numbers that have to agree with each
 * other: **23 tickets**, **$9,013.00**, five drawn rows (four `espera`, one
 * `subido`) and **"…y 19 tickets más en la cola"**. They agree only if the
 * held total is summed from the queue and the fold counts held sales rather
 * than table rows, which is exactly what this file pins.
 *
 * Rows are built through `buildHeldSales` from write-queue snapshots rather
 * than hand-written as `HeldSale` objects: a fixture shaped like the output
 * would pass while the real queue shape drifted underneath it.
 */

type AnyRecord = Record<string, any>;

const snapshot = (over: AnyRecord = {}): AnyRecord => ({
	queue_id: over.queue_id,
	status: over.status ?? "pending",
	created_at: over.created_at,
	retry_count: 0,
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

/** The four the artboard draws, oldest last as it draws them. */
const DRAWN = [
	{ queue_id: 4, name: "B-04835", created_at: "2026-08-22T19:44:00.000Z", amount: 1129, customer: "Alejandra Ríos" },
	{ queue_id: 3, name: "B-04834", created_at: "2026-08-22T19:31:00.000Z", amount: 518 },
	{ queue_id: 2, name: "B-04833", created_at: "2026-08-22T19:12:00.000Z", amount: 200, customer: "Rogelio Ancona" },
	{ queue_id: 1, name: "B-04832", created_at: "2026-08-22T18:58:00.000Z", amount: 800, customer: "Nayeli Tzab" },
];

/**
 * 23 held sales totalling 9,013 — the artboard's pair — plus the one already
 * uploaded, which it draws dimmed at the bottom and at 17:58 is the OLDEST
 * row of all. That last detail is the trap `buildMobileOfflinePage` exists to
 * avoid; see "the oldest rows are the uploaded ones" below.
 */
const filler = (index: number) =>
	snapshot({
		queue_id: 100 + index,
		name: `B-049${String(index).padStart(2, "0")}`,
		created_at: `2026-08-22T20:${String(index).padStart(2, "0")}:00.000Z`,
		// 18 × 335 + 336 = 6,366; with the four drawn (2,647) that is 9,013.
		amount: index === 18 ? 336 : 335,
	});

const queueSnapshots = () => [
	...DRAWN.map((row) => snapshot(row)),
	...Array.from({ length: 19 }, (_, index) => filler(index)),
	snapshot({
		queue_id: 900,
		name: "B-04812",
		status: "synced",
		created_at: "2026-08-22T17:58:00.000Z",
		amount: 3290,
		customer: "Guadalupe Herrera",
	}),
];

const rows = () => buildHeldSales(queueSnapshots());

describe("the money the phone says it is holding", () => {
	it("sums the queue rather than reporting a counter", () => {
		const page = buildMobileOfflinePage(rows());

		// The artboard's figure, and the sum of the rows behind it. Both, so a
		// change to either has to change the other.
		expect(page.summary.totalHeld).toBe(9013);
		expect(page.summary.totalHeld).toBe(
			buildHeldSales(queueSnapshots())
				.filter((row) => row.state !== "uploaded")
				.reduce((sum, row) => sum + row.amount, 0),
		);
	});

	it("counts 23 tickets, and leaves the uploaded one out of the money", () => {
		const page = buildMobileOfflinePage(rows());

		expect(page.summary.ticketCount).toBe(23);
		// The confirmed 3,290 is on the server. Folding it into the held total
		// would overstate by a third the one figure this screen exists to
		// state correctly.
		expect(page.summary.uploadedCount).toBe(1);
		expect(page.summary.totalHeld).not.toBe(9013 + 3290);
	});
});

describe("which five rows a 390 px screen shows", () => {
	it("draws four waiting and one uploaded, and folds nineteen", () => {
		const page = buildMobileOfflinePage(rows());

		expect(page.rows).toHaveLength(5);
		expect(page.rows.filter((row) => row.state === "uploaded")).toHaveLength(1);
		// The artboard's sentence, arrived at rather than typed in.
		expect(page.hiddenHeldCount).toBe(19);
	});

	it("counts SALES in the fold, not table rows", () => {
		// 23 held + 1 uploaded = 24 rows; 24 − 5 drawn = 19 only by accident of
		// this fixture. Drop a second uploaded row in and the row arithmetic
		// gives 18 while the true answer stays 19 — "y 18 tickets más en la
		// cola" would be a lie about money.
		const withMoreHistory = [
			...queueSnapshots(),
			snapshot({
				queue_id: 901,
				name: "B-04811",
				status: "synced",
				created_at: "2026-08-22T17:40:00.000Z",
				amount: 90,
			}),
		];
		const page = buildMobileOfflinePage(buildHeldSales(withMoreHistory));

		expect(page.hiddenHeldCount).toBe(19);
	});

	it("keeps the oldest-first promise the screen prints", () => {
		const shuffled = [...queueSnapshots()].reverse();
		const page = buildMobileOfflinePage(buildHeldSales(shuffled));
		const held = page.rows.filter((row) => row.state !== "uploaded");

		expect(held.map((row) => row.ticket)).toEqual([
			"B-04832",
			"B-04833",
			"B-04834",
			"B-04835",
		]);
	});

	it("does not let uploaded history push every waiting sale off the screen", () => {
		// THE trap. Uploaded rows are by definition from before the outage,
		// which makes them the oldest; a naive `slice(0, 5)` over one
		// oldest-first list shows five green rows while twenty-three tickets
		// sit behind them, and the shopkeeper reads it as "all clear".
		const history = Array.from({ length: 8 }, (_, index) =>
			snapshot({
				queue_id: 800 + index,
				name: `B-047${index}`,
				status: "synced",
				created_at: `2026-08-22T1${index}:00:00.000Z`,
				amount: 100,
			}),
		);
		const page = buildMobileOfflinePage(buildHeldSales([...history, ...queueSnapshots()]));

		expect(page.rows.filter((row) => row.state !== "uploaded")).toHaveLength(4);
		expect(page.rows.filter((row) => row.state === "uploaded")).toHaveLength(1);
	});

	it("shows the most recent confirmation, not the oldest one", () => {
		const page = buildMobileOfflinePage(
			buildHeldSales([
				...queueSnapshots(),
				snapshot({
					queue_id: 902,
					name: "B-04899",
					status: "synced",
					created_at: "2026-08-22T20:40:00.000Z",
					amount: 55,
				}),
			]),
		);
		const uploaded = page.rows.filter((row) => row.state === "uploaded");

		// "Se sube solo" is evidenced by the sale that went up a minute ago,
		// not by one from this morning.
		expect(uploaded.map((row) => row.ticket)).toEqual(["B-04899"]);
	});

	it("is empty when nothing is held, even with history to show", () => {
		const onlyHistory = buildHeldSales([
			snapshot({ queue_id: 900, name: "B-04812", status: "synced", created_at: "2026-08-22T17:58:00.000Z", amount: 3290 }),
		]);
		const page = buildMobileOfflinePage(onlyHistory);

		// The list then says the queue is empty, which is true. Drawing an
		// uploaded row under "Ventas guardadas en esta caja" would not be.
		expect(page.rows).toEqual([]);
		expect(page.hiddenHeldCount).toBe(0);
	});

	it("survives an empty queue and a missing one", () => {
		expect(buildMobileOfflinePage([]).rows).toEqual([]);
		expect(buildMobileOfflinePage(null).summary.totalHeld).toBe(0);
		expect(buildMobileOfflinePage(undefined).hiddenHeldCount).toBe(0);
	});
});

describe("the two columns come from the manifest", () => {
	it("puts every declared surface in exactly one column", () => {
		const columns = mobileCapabilityColumns();

		expect(columns.canDo.length + columns.mustWait.length).toBe(OFFLINE_SURFACES.length);
		expect(columns.canDo.some((surface) => columns.mustWait.includes(surface))).toBe(false);
	});

	it("splits on the manifest's own availability, not on a list of ids", () => {
		// Invented surfaces, so nothing here can be satisfied by a hardcoded
		// answer that happens to match today's manifest.
		const invented: OfflineSurface[] = [
			{ id: "weighing", labelKey: "Weigh and tare", availability: "available" },
			{ id: "lot_capture", labelKey: "Lot and expiry", availability: "queued" },
			{ id: "price_list", labelKey: "Price list", availability: "cached-read-only" },
			{ id: "terminal", labelKey: "Card terminal", availability: "blocked" },
		];
		const columns = mobileCapabilityColumns(invented);

		expect(columns.canDo.map((s) => s.id)).toEqual(["weighing", "lot_capture", "price_list"]);
		expect(columns.mustWait.map((s) => s.id)).toEqual(["terminal"]);
	});

	it("agrees with the audited manifest on the three that cannot be queued", () => {
		// §8 R4 — timbrado goes to the PAC, airtime is bought from the carrier
		// in real time, WhatsApp needs the network.
		expect(mobileCapabilityColumns().mustWait.map((s) => s.id)).toEqual([
			"cfdi",
			"recharges",
			"whatsapp",
		]);
	});
});

describe("how long this has been going on, and which fact that is", () => {
	const now = new Date("2026-08-22T21:31:00.000Z");

	it("names the connection when the shell knows when it dropped", () => {
		const elapsed = resolveOfflineElapsed({
			offlineSince: "2026-08-22T19:44:00.000Z",
			summary: summariseHeldSales(rows()),
			now,
		});

		expect(elapsed.source).toBe("connection");
		expect(elapsed.labelKey).toBe("no signal");
		expect(elapsed.value).toBe("1 h 47 m");
	});

	it("falls back to the queue's age under a DIFFERENT label", () => {
		const elapsed = resolveOfflineElapsed({
			offlineSince: null,
			summary: summariseHeldSales(rows()),
			now,
		});

		// The oldest held sale is 18:58, not 19:44: the register was carrying
		// money before this outage. Calling that "sin señal desde" would be the
		// same class of lie as "En línea · sincronizado" over a full queue.
		expect(elapsed.source).toBe("queue");
		expect(elapsed.labelKey).toBe("Holding sales for");
		expect(elapsed.labelKey).not.toBe("no signal");
		expect(elapsed.value).toBe("2 h 33 m");
	});

	it("says nothing rather than guess when neither fact is known", () => {
		const elapsed = resolveOfflineElapsed({
			offlineSince: null,
			summary: summariseHeldSales([]),
			now,
		});

		expect(elapsed).toEqual({ source: "none", labelKey: "", value: "" });
	});
});
