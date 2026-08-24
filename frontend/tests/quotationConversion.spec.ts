import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	DESTINATIONS,
	SHEET_COMPONENTS,
	getDestination,
	destinationForPath,
} from "../src/posapp/composables/pos/shell/destinationRegistry";
import {
	RAIL_DESTINATION_IDS,
	getRailDestination,
	isOfflineBlocked,
	visibleRailDestinations,
} from "../src/posapp/composables/pos/shell/railDestinations";

const call = vi.fn();
vi.mock("../src/posapp/services/api", () => ({
	default: { call: (...args: any[]) => call(...args) },
}));

/**
 * The wiring around the Cotizaciones lane — the parts a mounted spec cannot
 * see (DOCUMENTOS_GOLDEN_FLOW §1).
 *
 * Two things are pinned here. First, the destination is REACHABLE: the rail id,
 * the registry def and the lazy component have to agree, and a rail entry
 * without a `SHEET_COMPONENTS` row is a lit pill over an empty surface — the
 * exact failure the destination audit found for four flows in August.
 *
 * Second, the client never decides a price. Every argument the service sends is
 * an identifier or the cart's own rate; nothing is computed from a rate the
 * server sent back, which is what keeps the panel and the cart from disagreeing
 * about what the customer was promised.
 */

describe("the destination is reachable", () => {
	it("has a rail id, a registry def and a component", () => {
		expect(RAIL_DESTINATION_IDS).toContain("quotations");
		expect(getDestination("quotations")).toBeTruthy();
		expect(typeof SHEET_COMPONENTS.quotations).toBe("function");
	});

	it("sits with the other documents rather than at the end of the rail", () => {
		const ids = [...RAIL_DESTINATION_IDS];
		expect(ids.indexOf("quotations")).toBeLessThan(ids.indexOf("drafts"));
		expect(ids.indexOf("quotations")).toBeGreaterThan(ids.indexOf("expense"));
	});

	it("is deep-linkable, like every other destination", () => {
		expect(getDestination("quotations")?.path).toBe("/pos/quotations");
		expect(destinationForPath("/pos/quotations")?.id).toBe("quotations");
		// A folio appended to the path still lands on the lane.
		expect(destinationForPath("/pos/quotations/SAL-QTN-2026-00114")?.id).toBe("quotations");
	});

	it("is hosted beside the rail, not navigated to", () => {
		expect(getDestination("quotations")?.kind).toBe("sheet");
	});

	it("declares itself online-only on BOTH registries", () => {
		// The two lists are read by different consumers — the router guard reads
		// `offline`, the rail reads `offlineAvailability` — and a disagreement
		// means a pill that is lit while the guard refuses it.
		expect(getDestination("quotations")?.offline).toBe("online_required");
		const rail = getRailDestination("quotations");
		expect(rail?.offlineAvailability).toBe("blocked");
		expect(isOfflineBlocked(rail!)).toBe(true);
	});

	it("is hidden on a register that does not quote, on BOTH registries", () => {
		// The rail's gate and the router's `profileFlag` read the same POS
		// Profile flag on purpose: gate it in one place only and the pill
		// disappears while the URL still resolves — or the reverse, a lit pill
		// onto a surface the guard refuses. The server asserts the same flag on
		// all four endpoints, so this pair is the courtesy, not the enforcement.
		const rail = getRailDestination("quotations");
		expect(rail?.gate).toBe("quotations");
		const def = DESTINATIONS.find((entry) => entry.id === "quotations");
		expect(def?.capability).toBeNull();
		expect(def?.profileFlag).toBe("custom_allow_create_quotation");

		const gates = {
			floor: false,
			externalDocumentCheckout: false,
			saldo: false,
			closingShift: false,
			quotations: false,
			giftCards: false,
			dashboard: false,
		};
		expect(visibleRailDestinations(gates).map((entry) => entry.id)).not.toContain("quotations");
		expect(
			visibleRailDestinations({ ...gates, quotations: true }).map((entry) => entry.id),
		).toContain("quotations");
	});
});

describe("the service layer", () => {
	beforeEach(() => {
		call.mockReset();
		call.mockResolvedValue({});
	});

	it("asks the read module for the list and the write module for the rest", async () => {
		const { fetchQuotations, createQuotationFromCart, loadQuotationForSale } = await import(
			"../src/posapp/services/quotationService"
		);
		await fetchQuotations("Caja 1", { bucket: "expired" });
		expect(call.mock.calls[0]?.[0]).toBe(
			"posawesome.posawesome.api.quotations.get_quotations",
		);
		await loadQuotationForSale("Caja 1", "SAL-QTN-1");
		expect(call.mock.calls[1]?.[0]).toBe(
			"posawesome.posawesome.api.quotation_conversion.load_quotation_for_sale",
		);
		await createQuotationFromCart({
			posProfile: "Caja 1",
			payload: { customer: "CUST-9", items: [] },
		});
		expect(call.mock.calls[2]?.[0]).toBe(
			"posawesome.posawesome.api.quotation_conversion.create_quotation_from_cart",
		);
	});

	it("sends the cart's OWN rate, which is the promise being made", async () => {
		const { createQuotationFromCart } = await import(
			"../src/posapp/services/quotationService"
		);
		await createQuotationFromCart({
			posProfile: "Caja 1",
			validityDays: 7,
			note: "apartan con el 30 %",
			payload: {
				customer: "CUST-9",
				items: [{ item_code: "SALA", qty: 1, rate: 14900, price_list_rate: 15400 }],
			},
		});
		const args = call.mock.calls[0]?.[1];
		expect(args.pos_profile).toBe("Caja 1");
		expect(args.validity_days).toBe(7);
		expect(args.note).toBe("apartan con el 30 %");
		expect(args.payload.items[0].rate).toBe(14900);
	});

	it("sends the register's profile, never a company the client chose", async () => {
		// The server derives the company from the profile — a `company` argument
		// would be a scope a cashier could widen by editing a request.
		const { fetchQuotations } = await import("../src/posapp/services/quotationService");
		await fetchQuotations("Caja 1");
		expect(Object.keys(call.mock.calls[0]?.[1] ?? {})).toEqual([
			"pos_profile",
			"status_bucket",
			"search",
		]);
	});
});

describe("a refusal is a result, not an exception", () => {
	it("narrows to the converted branch with the invoice named", async () => {
		const { isRefusedQuotation } = await import("../src/posapp/services/quotationService");
		const refused = {
			allowed: false as const,
			reason: "converted" as const,
			quotation: {} as any,
			invoice: "ACC-SINV-2026-04791",
			invoice_doctype: "Sales Invoice",
		};
		expect(isRefusedQuotation(refused)).toBe(true);
		if (isRefusedQuotation(refused)) {
			expect(refused.invoice).toBe("ACC-SINV-2026-04791");
		}
	});

	it("does not mistake an allowed load for a refusal", async () => {
		const { isRefusedQuotation } = await import("../src/posapp/services/quotationService");
		expect(
			isRefusedQuotation({
				allowed: true,
				reason: "honoured",
				expired: false,
				quotation: {} as any,
				lines: [],
				quoted_total: 0,
				today_total: 0,
				invoice_doc: {},
			}),
		).toBe(false);
	});
});
