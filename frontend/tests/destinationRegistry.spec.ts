import { describe, expect, it } from "vitest";

import {
	DESTINATION_IDS,
	DESTINATIONS,
	destinationForPath,
	getDestination,
	isKnownDestination,
	SHEET_COMPONENTS,
	type OfflinePolicy,
} from "../src/posapp/composables/pos/shell/destinationRegistry";

/**
 * Registry integrity. These are the properties the rail, the router and the
 * shortcuts engine all assume without checking, which is exactly why they are
 * asserted here once rather than defended in three places.
 */

const POLICIES: readonly OfflinePolicy[] = [
	"offline_local",
	"offline_queue",
	"offline_read",
	"online_required",
];

describe("destination registry", () => {
	it("covers exactly what the rail can reach, in the rail's own order", async () => {
		// The real contract, asserted against T1's tuple rather than a literal
		// copied out of it. A rail id with no routing entry activates to
		// "unknown"; a routing entry with no rail id is a screen nobody can
		// reach. Both fail silently, and a hand-kept list here would only catch
		// them after someone noticed a dead rail item at the counter.
		const { RAIL_DESTINATION_IDS } = await import(
			"../src/posapp/composables/pos/shell/railDestinations"
		);
		expect(DESTINATION_IDS).toEqual([...RAIL_DESTINATION_IDS]);
	});

	it("gives every destination a unique id and a unique deep link", () => {
		const ids = DESTINATIONS.map((d) => d.id);
		const paths = DESTINATIONS.map((d) => d.path);
		expect(new Set(ids).size).toBe(ids.length);
		// Two destinations sharing a path means one of them is unreachable by
		// URL and nobody finds out until a bookmark lands on the wrong screen.
		expect(new Set(paths).size).toBe(paths.length);
	});

	it("declares an offline policy for EVERY destination", () => {
		// Roadmap §7: every surface declares whether it is local, queued,
		// cached-read-only or blocked. A missing declaration must fail here
		// rather than silently read as "works offline" — on the saldo path that
		// default promises a customer airtime the register cannot buy.
		for (const def of DESTINATIONS) {
			expect(POLICIES, `${def.id} has no valid offline policy`).toContain(def.offline);
		}
	});

	it("keeps saldo and shift close online-required, as §7 names them", () => {
		expect(getDestination("recharge")?.offline).toBe("online_required");
		expect(getDestination("closing")?.offline).toBe("online_required");
		// A return moves money back against a submitted original; both halves
		// need the server.
		expect(getDestination("return")?.offline).toBe("online_required");
	});

	it("lets the cart and the expense drawer work with no server", () => {
		// §7 class A — local operator intent.
		expect(getDestination("sale")?.offline).toBe("offline_local");
		// §7 class C — cash physically left the drawer; the act is real whether
		// or not the server heard about it.
		expect(getDestination("expense")?.offline).toBe("offline_queue");
	});

	it("has a component loader for every sheet destination", () => {
		// A `sheet` with no loader renders an empty destination — the desktop
		// equivalent of the blank dock tab that viewContracts.ts warns about.
		for (const def of DESTINATIONS.filter((d) => d.kind === "sheet")) {
			expect(SHEET_COMPONENTS[def.id], `${def.id} has no component`).toBeTypeOf("function");
		}
	});

	it("does not load a component for panels or routes", () => {
		for (const def of DESTINATIONS.filter((d) => d.kind !== "sheet")) {
			expect(SHEET_COMPONENTS[def.id]).toBeUndefined();
		}
	});

	it("binds shortcut ids that the action registry actually knows", async () => {
		// An action id that does not exist is an unbindable chord: the cheat
		// sheet shows nothing and the key does nothing, silently.
		const { isKnownAction } = await import("../src/posapp/shortcuts/actions");
		for (const def of DESTINATIONS) {
			if (def.shortcutActionId) {
				expect(isKnownAction(def.shortcutActionId), `${def.id} → ${def.shortcutActionId}`).toBe(
					true,
				);
			}
		}
	});

	it("gives every panel destination a view the shell can mount", () => {
		for (const def of DESTINATIONS.filter((d) => d.kind === "panel")) {
			expect(["items", "offers", "coupons", "floor"]).toContain(def.panelView);
		}
	});
});

describe("destinationForPath", () => {
	it("resolves an exact deep link", () => {
		expect(destinationForPath("/pos/drafts")?.id).toBe("drafts");
		expect(destinationForPath("/cash-movement")?.id).toBe("expense");
	});

	it("resolves a nested link to its owning destination", () => {
		// A support instruction says "open /pos/drafts/ACC-SINV-0007"; that is
		// still Borradores, not a fall-through to the shell.
		expect(destinationForPath("/pos/drafts/ACC-SINV-0007")?.id).toBe("drafts");
	});

	it("ignores a query string and a trailing slash", () => {
		expect(destinationForPath("/pos/returns/")?.id).toBe("return");
		expect(destinationForPath("/pos/returns?invoice=B-04788")?.id).toBe("return");
	});

	it("returns undefined for a path that is not a destination", () => {
		expect(destinationForPath("/reports")).toBeUndefined();
	});

	it("prefers the longer registered prefix", () => {
		// `/pos` is `venta`; `/pos/browse` must not be swallowed by it.
		expect(destinationForPath("/pos/browse")?.id).toBe("browse");
	});
});

describe("lookup helpers", () => {
	it("knows its own ids and rejects invented ones", () => {
		expect(isKnownDestination("invoices")).toBe(true);
		expect(isKnownDestination("cocina")).toBe(false);
		expect(getDestination("cocina")).toBeUndefined();
	});
});
