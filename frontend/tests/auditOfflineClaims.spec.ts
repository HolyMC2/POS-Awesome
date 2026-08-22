import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	RAIL_DESTINATIONS,
	unbackedRailOfflineClaims,
} from "../src/posapp/composables/pos/shell/railDestinations";
import { OFFLINE_SURFACES } from "../src/posapp/components/pos/shell/mobile/offlineSurfaceManifest";

/**
 * R4 — the rail's offline availability claims, verified against the offline
 * layer rather than asserted.
 *
 * This file began as A2's wave-3 audit, where each test DOCUMENTED a
 * contradiction and was expected to fail once the claim was corrected. The
 * claims are now corrected, so it has been turned around: every test here
 * asserts the corrected value AND re-reads the evidence that decided it, so a
 * future edit that flips a value back has to delete a citation to do it.
 *
 * Three of the original ten were wrong. Two were found by the audit; the third
 * (`closing`) was found while re-verifying the audit's own "lightly verified"
 * row, which is the reason the re-verification was asked for.
 */

const OFFLINE = new URL("../src/offline/", import.meta.url);
const offlineFile = (name: string) => fileURLToPath(new URL(name, OFFLINE));
const srcFile = (rel: string) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
const read = (path: string) => readFileSync(path, "utf8");
const claimFor = (id: string) => RAIL_DESTINATIONS.find((d) => d.id === id)?.offlineAvailability;
const backingFor = (id: string) => RAIL_DESTINATIONS.find((d) => d.id === id)?.backedBy;

describe("R4 — corrected claims, with their evidence", () => {
	it("`floor` is queued: the restaurant queue drains table orders", () => {
		const queue = read(offlineFile("restaurantQueue.ts"));
		expect(queue).toContain("enqueueRestaurantMutation");
		expect(queue).toContain("getPendingRestaurantMutationCount");
		expect(queue).toContain("syncRestaurantOrders");

		const orders = read(offlineFile("restaurantOrders.ts"));
		expect(orders).toContain("listPendingTableOrders");
		expect(orders).toContain("markTableOrderPending");

		// The floor store states the intent in its own words, and it is the
		// sentence that overturned the original `blocked`.
		expect(read(srcFile("posapp/stores/floor/floorOrderActions.ts"))).toContain(
			"MUST stay resumable",
		);

		expect(
			claimFor("floor"),
			"Reverting this to `blocked` dims Salón for a waiter the queue is built to keep serving.",
		).toBe("queued");
		expect(backingFor("floor")).toBe("src/offline/restaurantQueue.ts");
	});

	it("`drafts` is blocked: nothing caches drafts", () => {
		const drafts = read(srcFile("posapp/utils/draftInvoices.ts"));
		expect(drafts).toContain("posawesome.posawesome.api.invoices.get_draft_invoices");
		// A bare frappe.call — no Dexie read, so `cachedReadOnly` promised a
		// cache that does not exist and the surface opened empty offline.
		expect(drafts).not.toMatch(/getOffline|Dexie|db\./);
		expect(claimFor("drafts")).toBe("blocked");
		expect(backingFor("drafts")).toBeNull();
	});

	it("`closing` is blocked: the app refuses the close offline, and nothing queues it", () => {
		const shift = read(srcFile("posapp/composables/pos/shared/usePosShift.ts"));
		// Not "the post waits" — the surface does not open at all.
		expect(shift).toContain("Offline — cannot close shift");
		expect(shift).toMatch(/if\s*\(\s*isOffline\(\)\s*\)/);

		// And there is no entity to queue a close under.
		const entities = read(offlineFile("writeQueue.ts"));
		expect(entities).toMatch(/export type OfflineEntityType =[\s\S]{0,200}?restaurant_order/);
		expect(entities).not.toContain('"closing_shift"');

		expect(claimFor("closing")).toBe("blocked");
		expect(backingFor("closing")).toBeNull();
	});

	it("`expense` queues, `browse` reads cache, `sale` stays available", () => {
		const cash = read(offlineFile("cash_movements.ts"));
		expect(cash).toContain("saveOfflineCashMovement");
		expect(cash).toContain("syncOfflineCashMovements");
		expect(claimFor("expense")).toBe("queued");
		expect(backingFor("expense")).toBe("src/offline/cash_movements.ts");

		const cache = read(offlineFile("cache.ts"));
		expect(cache).toContain("searchStoredItems");
		expect(claimFor("browse")).toBe("cachedReadOnly");
		expect(backingFor("browse")).toBe("src/offline/cache.ts");

		// The sale queues at SUBMIT, not at the destination, which is why it
		// is `available` with no backing module of its own.
		expect(claimFor("sale")).toBe("available");
		expect(backingFor("sale")).toBeNull();
	});

	it("`return`, `invoices` and `recharge` are correctly blocked", () => {
		const returns = read(srcFile("posapp/components/pos/flows/Returns.vue"));
		expect(returns).toContain("search_invoices_for_return");
		expect(returns).toContain("get_invoice_for_return");
		expect(claimFor("return")).toBe("blocked");
		expect(claimFor("invoices")).toBe("blocked");
		expect(claimFor("recharge")).toBe("blocked");
		// The mobile manifest independently agrees on airtime.
		expect(OFFLINE_SURFACES.find((s) => s.id === "recharges")?.availability).toBe("blocked");
	});
});

describe("R4 — claims stay checkable", () => {
	it("every `queued` or `cachedReadOnly` names the module that backs it", () => {
		const unbacked = unbackedRailOfflineClaims();
		expect(
			unbacked,
			`These claim the register keeps working offline without naming the code that makes it true — ` +
				`the state this registry shipped in, where 3 of 10 values were wrong and nothing said which: ` +
				JSON.stringify(unbacked),
		).toEqual([]);
	});

	it("every named backing module exists on disk", () => {
		const missing = RAIL_DESTINATIONS.filter((d) => d.backedBy).filter(
			(d) => !existsSync(fileURLToPath(new URL(`../${d.backedBy}`, import.meta.url))),
		);
		// A citation pointing at a deleted file is worse than none: it reads
		// as verified and cannot be checked.
		expect(missing.map((d) => `${d.id} → ${d.backedBy}`)).toEqual([]);
	});

	it("`blocked` and `available` name no backing module", () => {
		const overCited = RAIL_DESTINATIONS.filter(
			(d) =>
				(d.offlineAvailability === "blocked" || d.offlineAvailability === "available") &&
				d.backedBy !== null,
		);
		expect(overCited.map((d) => d.id)).toEqual([]);
	});
});

describe("R4 — the two service-order surfaces cannot be conflated", () => {
	it("the rail's serviceOrder and the manifest's capture surface are named apart", () => {
		// The audit briefly read these as a contradiction. They are two
		// questions: the rail asks whether the POS can PULL a Charge Request
		// (server-only); the manifest asks whether Taller can CAPTURE a new
		// order (queues). Both values are correct.
		expect(claimFor("serviceOrder")).toBe("blocked");

		const ids = OFFLINE_SURFACES.map((s) => s.id);
		expect(
			ids,
			"`service_orders` was renamed because the bare plural read as the rail's destination.",
		).not.toContain("service_orders");
		expect(ids).toContain("service_order_capture");
		expect(OFFLINE_SURFACES.find((s) => s.id === "service_order_capture")?.availability).toBe(
			"queued",
		);
	});

	it("each file points at the other, so neither is reconciled in isolation", () => {
		const rail = read(srcFile("posapp/composables/pos/shell/railDestinations.ts"));
		const manifest = read(
			srcFile("posapp/components/pos/shell/mobile/offlineSurfaceManifest.ts"),
		);
		expect(rail).toContain("service_order_capture");
		expect(manifest).toContain("railDestinations.ts");
	});
});
