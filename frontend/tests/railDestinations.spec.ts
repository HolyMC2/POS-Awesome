import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	RAIL_DESTINATIONS,
	RAIL_DESTINATION_IDS,
	RAIL_OFFLINE_ATTR_VALUES,
	getRailDestination,
	isOfflineBlocked,
	isRailDestinationId,
	railDestinationsInGroup,
	visibleRailDestinations,
	type RailGateMap,
} from "../src/posapp/composables/pos/shell/railDestinations";
import { isKnownAction } from "../src/posapp/shortcuts/actions";

const ALL_GATES: RailGateMap = {
	floor: true,
	externalDocumentCheckout: true,
	saldo: true,
	closingShift: true,
	quotations: true,
	giftCards: true,
	dashboard: true,
};

const gates = (overrides: Partial<RailGateMap> = {}): RailGateMap => ({
	...ALL_GATES,
	...overrides,
});

const idsOf = (destinations: readonly { id: string }[]) => destinations.map((d) => d.id);

describe("rail destination registry", () => {
	it("stays pure — no Vue, no store, no i18n global", () => {
		// The registry has to be readable by a test with no DOM and, later,
		// resolvable server-side into a §9.1 artifact. An import of vue or of
		// a store is what quietly ends that.
		const source = readFileSync(
			resolve(process.cwd(), "src/posapp/composables/pos/shell/railDestinations.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/from "vue"/);
		expect(source).not.toMatch(/from "\.\.\/\.\.\/\.\.\/stores/);
		// A CALL with a literal, not the two underscores: the file discusses
		// `__()` in prose and must stay free to explain why it avoids it.
		expect(source).not.toMatch(/__\("/);
		expect(source).not.toMatch(/window\.__/);
	});

	it("renders the artboard's order for a fully-capable register", () => {
		// 2026-08-24: `browse` left the rail (owner: "basically the same as
		// sale") and `payments` took the second slot, promoted out of the
		// tools flyout ("it's that important").
		expect(idsOf(visibleRailDestinations(gates()))).toEqual([
			"sale",
			"payments",
			"floor",
			"serviceOrder",
			"expense",
			// Cotizaciones sits with the other documents, before Borradores.
			"quotations",
			"drafts",
			"invoices",
			"return",
			"recharge",
			// The tools group — one "More" pill on the rail, four entries in
			// its flyout (canvas «Riel con herramientas»).
			"purchase",
			"barcode",
			"giftCards",
			"dashboard",
			"closing",
		]);
	});

	it("exposes every declared id, with no duplicates", () => {
		// `browse` is the one vocabulary-only id: in the union (the registry
		// routes it, the dock draws it, Alt+B reaches it) but with no rail
		// entry. Everything the rail DOES draw must be in the union, in the
		// union's order.
		const drawable = [...RAIL_DESTINATION_IDS].filter((id) => id !== "browse");
		expect(idsOf(RAIL_DESTINATIONS)).toEqual(drawable);
		expect(new Set(RAIL_DESTINATION_IDS).size).toBe(RAIL_DESTINATION_IDS.length);
	});

	it("puts only the session control in the footer group", () => {
		const visible = visibleRailDestinations(gates());
		expect(idsOf(railDestinationsInGroup(visible, "footer"))).toEqual(["closing"]);
		// Recarga is a selling destination and belongs above the spacer.
		expect(idsOf(railDestinationsInGroup(visible, "primary"))).toContain("recharge");
	});

	it("looks a destination up by id and misses cleanly", () => {
		expect(getRailDestination("sale")?.label).toBe("Sale");
		expect(getRailDestination("nope")).toBeUndefined();
	});
});

describe("rail capability gating", () => {
	it("renders the retail rail: no Salón, Recarga present", () => {
		// retail-phones grants saldo but not floor.
		const retail = visibleRailDestinations(gates({ floor: false }));
		expect(idsOf(retail)).not.toContain("floor");
		expect(idsOf(retail)).toContain("recharge");
	});

	it("renders the cafetería swap: Salón added, Recarga dropped", () => {
		const cafeteria = visibleRailDestinations(gates({ saldo: false }));
		expect(idsOf(cafeteria)).toContain("floor");
		expect(idsOf(cafeteria)).not.toContain("recharge");
		// Salón sits right after Cobranza — with Menú off the rail, a
		// table-service operator reaches the floor two steps from the top.
		expect(idsOf(cafeteria).slice(0, 3)).toEqual(["sale", "payments", "floor"]);
	});

	it("removes a gated destination entirely rather than disabling it", () => {
		const withoutRepair = visibleRailDestinations(gates({ externalDocumentCheckout: false }));
		expect(idsOf(withoutRepair)).not.toContain("serviceOrder");
	});

	it("honours posa_hide_closing_shift by dropping the footer entry", () => {
		expect(idsOf(visibleRailDestinations(gates({ closingShift: false })))).not.toContain("closing");
	});

	it("hides Cotizaciones on a register that does not quote", () => {
		expect(idsOf(visibleRailDestinations(gates({ quotations: false })))).not.toContain("quotations");
		expect(idsOf(visibleRailDestinations(gates()))).toContain("quotations");
	});

	/**
	 * The one failure this registry cannot report on its own.
	 *
	 * A `RailGate` is answered by the `railGates` literal inside `Pos.vue`, and
	 * that file's `<script>` is plain JS with `checkJs` off — so a gate declared
	 * here and never answered there reads `undefined`, i.e. falsy, i.e. the
	 * destination silently disappears from EVERY register. `pnpm type-check`
	 * cannot see it and no mount spec would either, because the shell's own
	 * mounts pass their gates in by hand. Reading the shell's source is the only
	 * place the two halves meet.
	 */
	it("has an answer in Pos.vue for every gate a destination declares", () => {
		const shell = readFileSync(
			resolve(process.cwd(), "src/posapp/components/pos/shell/Pos.vue"),
			"utf8",
		);
		const literal = shell.match(/const railGates = computed\(\(\) => \(\{([\s\S]*?)\}\)\);/);
		expect(literal, "Pos.vue no longer declares a `railGates` computed").toBeTruthy();
		const answered = [...literal![1].matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
		const declared = [...new Set(RAIL_DESTINATIONS.map((d) => d.gate).filter(Boolean))];
		expect(declared.length).toBeGreaterThan(0);
		for (const gate of declared) {
			expect(
				answered,
				`Pos.vue's railGates never answers "${gate}" — that destination would vanish from every register`,
			).toContain(gate);
		}
	});

	it("never removes an ungated destination", () => {
		const none = visibleRailDestinations({
			floor: false,
			externalDocumentCheckout: false,
			saldo: false,
			closingShift: false,
			quotations: false,
			giftCards: false,
			dashboard: false,
		});
		expect(idsOf(none)).toEqual([
			"sale",
			"payments",
			"expense",
			"drafts",
			"invoices",
			"return",
			"purchase",
			"barcode",
		]);
	});
});

describe("rail offline contract", () => {
	it("declares an availability for every destination", () => {
		for (const destination of RAIL_DESTINATIONS) {
			expect(["available", "queued", "cachedReadOnly", "blocked"]).toContain(
				destination.offlineAvailability,
			);
		}
	});

	it("never blocks the sale — selling offline is the product promise", () => {
		expect(getRailDestination("sale")?.offlineAvailability).toBe("available");
		expect(isOfflineBlocked(getRailDestination("sale")!)).toBe(false);
	});

	// Corrected 2026-08-22 after the wave-3 audit (A2) measured these claims
	// against `src/offline/` instead of taking them on trust. They were design
	// assertions when this list was written, and two of them were wrong:
	//
	//   floor   blocked  → queued   `restaurantQueue.ts` enqueues table
	//                               mutations; `floorOrderActions.ts` says in
	//                               its own comment that an offline order
	//                               "MUST stay resumable, because a waiter with
	//                               no signal still has to keep adding to the
	//                               tab". Dimming it told that waiter to stop.
	//   drafts  cached   → blocked  `utils/draftInvoices.ts` is a bare
	//                               frappe.call. There is no Dexie read for
	//                               drafts, so "shows what the cache holds"
	//                               promised a cache that does not exist.
	//
	// The registry now carries `backedBy` naming the module behind each claim,
	// so the next reader can check rather than trust.
	it("dims only the surfaces that would lie without a server", () => {
		const blocked = RAIL_DESTINATIONS.filter(isOfflineBlocked).map((d) => d.id);
		expect(blocked.sort()).toEqual([
			"closing",
			"dashboard",
			"drafts",
			"giftCards",
			"invoices",
			"payments",
			"purchase",
			"quotations",
			"recharge",
			"return",
			"serviceOrder",
		]);
	});

	it("keeps the hamburger's pages in the tools group, absent when gated", () => {
		// `payments` is not among them since 2026-08-24 — it graduated to the
		// rail's second pill.
		const visible = visibleRailDestinations(gates());
		expect(idsOf(railDestinationsInGroup(visible, "tools"))).toEqual([
			"purchase",
			"barcode",
			"giftCards",
			"dashboard",
		]);
		// Gated = absent, not disabled (R3): a cashier never sees Tablero, a
		// profile without gift cards never sees Monedero.
		const cashier = visibleRailDestinations(gates({ dashboard: false, giftCards: false }));
		expect(idsOf(railDestinationsInGroup(cashier, "tools"))).toEqual([
			"purchase",
			"barcode",
		]);
		// Every tool explains itself in the flyout; no pill ever needs to.
		for (const tool of railDestinationsInGroup(visible, "tools")) {
			expect(tool.hint, `${tool.id} has no hint`).toBeTruthy();
		}
		for (const pill of railDestinationsInGroup(visible, "primary")) {
			expect(pill.hint).toBeUndefined();
		}
	});

	it("keeps queued and cached surfaces reachable", () => {
		// `barcode` carries the rail's cachedReadOnly claim now that `browse`
		// (the other one) has no rail entry.
		for (const id of ["expense", "floor", "barcode", "sale"] as const) {
			expect(isOfflineBlocked(getRailDestination(id)!)).toBe(false);
		}
	});

	it("names the module behind every non-trivial offline claim", () => {
		// The audit's real lesson: an unevidenced claim reads exactly like a
		// measured one. `queued` and `cachedReadOnly` assert that specific code
		// exists to make them true, so they must say which code.
		for (const destination of RAIL_DESTINATIONS) {
			if (destination.offlineAvailability === "queued" || destination.offlineAvailability === "cachedReadOnly") {
				expect(
					destination.backedBy,
					`${destination.id} claims "${destination.offlineAvailability}" without naming the module that delivers it`,
				).toBeTruthy();
			}
		}
	});
});

describe("rail shortcut binding", () => {
	it("binds only to action ids the shortcuts engine already knows", () => {
		// An invented id would show in the cheat sheet as a shortcut that does
		// nothing and would escape conflict detection entirely (§17.3).
		for (const destination of RAIL_DESTINATIONS) {
			if (destination.shortcutActionId) {
				expect(isKnownAction(destination.shortcutActionId)).toBe(true);
			}
		}
	});

	it("binds every destination the shortcuts engine has an action for", () => {
		const bound = Object.fromEntries(
			RAIL_DESTINATIONS.map((d) => [d.id, d.shortcutActionId]),
		);
		expect(bound).toMatchObject({
			sale: "invoice.showInvoicePanel",
			serviceOrder: "charges.openRequests",
			expense: "cash.openMovement",
			// Reused, not re-minted: these two shipped with the engine.
			drafts: "invoice.openDrafts",
			return: "returns.open",
			invoices: "invoice.openManagement",
			recharge: "saldo.openRecharge",
			closing: "shift.close",
		});
	});

	it("mints no synonym for a behavior that already had an id", () => {
		// One behavior, one permanent id (§17.3). A second id for "open
		// drafts" would split the cheat sheet and escape conflict detection.
		const ids = RAIL_DESTINATIONS.map((d) => d.shortcutActionId).filter(Boolean);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("leaves a destination unbound rather than guessing an id", () => {
		// Floor has no action yet; null is the honest value.
		expect(getRailDestination("floor")?.shortcutActionId).toBeNull();
	});
});

describe("rail vocabulary", () => {
	it("routes only genuinely renamed nouns through the preset resolver", () => {
		// A noun every giro calls the same thing must not go through t(), or
		// the preset label map becomes a second translation layer.
		const vocabulary = RAIL_DESTINATIONS.filter((d) => d.vocabulary).map((d) => d.id);
		// `browse` ("Menú") left the rail; `floor` ("Salón") is the one
		// renamed noun still drawn.
		expect(vocabulary.sort()).toEqual(["floor"]);
	});
});

describe("rail id vocabulary — the single list T4 and T5 import", () => {
	it("narrows an arbitrary string to a known id", () => {
		expect(isRailDestinationId("serviceOrder")).toBe(true);
		expect(isRailDestinationId("closing")).toBe(true);
		// Operator language is never an id: the registry exists so a preset
		// can rename the NOUN without moving the key.
		expect(isRailDestinationId("venta")).toBe(false);
		expect(isRailDestinationId("orden")).toBe(false);
		expect(isRailDestinationId("")).toBe(false);
	});

	it("guards exactly the declared ids, so a copy cannot drift from it", () => {
		for (const id of RAIL_DESTINATION_IDS) {
			expect(isRailDestinationId(id)).toBe(true);
		}
		expect(RAIL_DESTINATION_IDS.filter(isRailDestinationId)).toHaveLength(
			RAIL_DESTINATION_IDS.length,
		);
	});

	it("publishes the data-offline vocabulary as the same tokens the type allows", () => {
		expect([...RAIL_OFFLINE_ATTR_VALUES].sort()).toEqual([
			"available",
			"blocked",
			"cachedReadOnly",
			"queued",
		]);
		for (const destination of RAIL_DESTINATIONS) {
			expect(RAIL_OFFLINE_ATTR_VALUES).toContain(destination.offlineAvailability);
		}
	});
});
