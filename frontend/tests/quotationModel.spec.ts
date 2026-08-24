import { describe, expect, it } from "vitest";

import {
	QUOTATION_TABS,
	describeDue,
	describeTabs,
	emptyCounts,
	expiryWarning,
	getQuotationTab,
	hasProvenance,
	isQuotationEstado,
	matchesQuery,
	nextIndex,
	type QuotationRow,
} from "../src/posapp/components/pos/flows/cotizaciones/quotationModel";

/**
 * The Cotizaciones lane's arithmetic (DOCUMENTOS_GOLDEN_FLOW §1).
 *
 * Every rule here is one a cashier reads off the screen and repeats to a
 * customer, so each test names the sentence rather than the branch.
 */

const row = (overrides: Partial<QuotationRow> = {}): QuotationRow => ({
	name: "SAL-QTN-2026-00114",
	customer: "CUST-1",
	customer_name: "Fam. Zavala Ruiz",
	date: "2026-08-21",
	valid_till: "2026-08-28",
	total: 18450,
	estado: "active",
	days_left: 5,
	converted_invoice: null,
	converted_invoice_doctype: null,
	...overrides,
});

describe("estado tabs", () => {
	it("draws the four tabs in the artboard's order", () => {
		expect(QUOTATION_TABS.map((tab) => tab.id)).toEqual([
			"active",
			"expiring",
			"expired",
			"converted",
		]);
	});

	it("keeps `Expired quote` as its own source string", () => {
		// `Expired` already exists in es.csv as «Expirado» — masculine, for a
		// plazo. Every noun on this surface is a cotización, and a two-column
		// CSV has no context column, so the key has to differ.
		expect(getQuotationTab("expired").label).toBe("Expired quote");
		expect(QUOTATION_TABS.some((tab) => tab.label === "Expired")).toBe(false);
	});

	it("renders every tab even at zero", () => {
		const tabs = describeTabs(emptyCounts(), "active");
		expect(tabs).toHaveLength(4);
		expect(tabs.every((tab) => tab.count === 0)).toBe(true);
		expect(tabs.filter((tab) => tab.active).map((tab) => tab.id)).toEqual(["active"]);
	});

	it("counts what the server counted", () => {
		const tabs = describeTabs(
			{ active: 6, expiring: 2, expired: 9, converted: 31 },
			"expired",
		);
		expect(tabs.map((tab) => tab.count)).toEqual([6, 2, 9, 31]);
		expect(tabs.find((tab) => tab.active)?.id).toBe("expired");
	});

	it("narrows an unknown estado to nothing", () => {
		expect(isQuotationEstado("cancelled")).toBe(false);
		expect(isQuotationEstado("converted")).toBe(true);
	});
});

describe("the Vence column", () => {
	it("counts the days down while the quote is alive", () => {
		expect(describeDue(row({ days_left: 5 }))).toEqual({
			key: "{0} days left",
			count: 5,
			tone: "good",
		});
	});

	it("turns amber inside the 48-hour window", () => {
		expect(describeDue(row({ estado: "expiring", days_left: 2 }))?.tone).toBe("warn");
		expect(describeDue(row({ estado: "expiring", days_left: 1 }))).toEqual({
			key: "tomorrow",
			count: null,
			tone: "warn",
		});
	});

	it("says «expires today», not «0 days left»", () => {
		expect(describeDue(row({ estado: "expiring", days_left: 0 }))).toEqual({
			key: "expires today",
			count: null,
			tone: "warn",
		});
	});

	it("reports an expired quote by magnitude, not by a minus sign", () => {
		expect(describeDue(row({ estado: "expired", days_left: -3 }))).toEqual({
			key: "expired {0} days ago",
			count: 3,
			tone: "bad",
		});
	});

	it("has nothing to count for a quote with no validity date", () => {
		expect(describeDue(row({ valid_till: "", days_left: null }))).toBeNull();
	});

	it("has nothing to count for a quote that is already sold", () => {
		// The row shows «Convertida · F-04791»; a countdown beside it would be
		// answering a question nobody is asking any more.
		expect(describeDue(row({ estado: "converted", days_left: 5 }))).toBeNull();
	});
});

describe("the expiry warning", () => {
	it("is absent while the quote is honoured", () => {
		expect(expiryWarning({ expired: false, quoted_total: 149, today_total: 169 })).toBeNull();
	});

	it("names BOTH totals", () => {
		expect(expiryWarning({ expired: true, quoted_total: 149, today_total: 169 })).toEqual({
			quotedTotal: 149,
			todayTotal: 169,
			unchanged: false,
		});
	});

	it("says so when the quote expired but nothing repriced", () => {
		const warning = expiryWarning({ expired: true, quoted_total: 149, today_total: 149 });
		expect(warning?.unchanged).toBe(true);
	});

	it("compares in cents, so a float tail is not a price change", () => {
		const warning = expiryWarning({ expired: true, quoted_total: 0.1 + 0.2, today_total: 0.3 });
		expect(warning?.unchanged).toBe(true);
	});
});

describe("line provenance", () => {
	it("is the server's opinion, never recomputed here", () => {
		expect(hasProvenance({ provenance: { quoted_rate: 149, today_rate: 169 } })).toBe(true);
		expect(hasProvenance({ provenance: null })).toBe(false);
	});
});

describe("the search box", () => {
	it("matches a folio or a customer, case-insensitively", () => {
		expect(matchesQuery(row(), "00114")).toBe(true);
		expect(matchesQuery(row(), "zavala")).toBe(true);
		expect(matchesQuery(row(), "ZAVALA")).toBe(true);
		expect(matchesQuery(row(), "peña")).toBe(false);
	});

	it("matches everything when the box is empty", () => {
		expect(matchesQuery(row(), "   ")).toBe(true);
	});
});

describe("the keyboard ring", () => {
	it("is the ledger's, clamped rather than wrapped", () => {
		expect(nextIndex("ArrowDown", 2, 3)).toBe(2);
		expect(nextIndex("ArrowUp", 0, 3)).toBe(0);
		expect(nextIndex("Home", 2, 3)).toBe(0);
		expect(nextIndex("End", 0, 3)).toBe(2);
	});

	it("leaves a key it does not own alone", () => {
		expect(nextIndex("Escape", 0, 3)).toBeNull();
	});
});
