import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { usePosPaySelection } from "../src/posapp/composables/pos/payments/usePosPaySelection";

import {
	getAllowedPartyTypes,
	normalizePartyTypeForPaymentType,
	shouldShowReconciliationSections,
	canApplyExistingCredits,
	matchesInvoiceDirection,
} from "../src/posapp/components/pos_pay/paymentModes";

describe("paymentModes", () => {
	it("allows customer receipts and supplier refunds", () => {
		expect(getAllowedPartyTypes("Receive")).toEqual(["Customer", "Supplier"]);
	});

	it("allows customer, supplier, and employee in pay mode", () => {
		expect(getAllowedPartyTypes("Pay")).toEqual([
			"Customer",
			"Supplier",
			"Employee",
		]);
	});

	it("normalizes unsupported receive-mode party types back to customer", () => {
		expect(normalizePartyTypeForPaymentType("Receive", "Employee")).toBe(
			"Customer",
		);
	});

	it("hides reconciliation sections for employee pay mode", () => {
		expect(shouldShowReconciliationSections("Pay", "Employee")).toBe(false);
	});

	it("keeps reconciliation sections visible for supplier pay mode", () => {
		expect(shouldShowReconciliationSections("Pay", "Supplier")).toBe(true);
	});

	it.each([
		["Receive", "Customer", 1], ["Pay", "Supplier", 1],
		["Pay", "Customer", -1], ["Receive", "Supplier", -1],
	])("matches signed balances for %s %s", (direction, party, sign) => {
		expect(matchesInvoiceDirection(100 * Number(sign), String(direction), String(party))).toBe(true);
		expect(matchesInvoiceDirection(-100 * Number(sign), String(direction), String(party))).toBe(false);
		expect(matchesInvoiceDirection(0, String(direction), String(party))).toBe(false);
		expect(matchesInvoiceDirection(Infinity, String(direction), String(party))).toBe(false);
		expect(canApplyExistingCredits(String(direction), String(party))).toBe(sign === 1);
	});

	it("shows a positive refund tender target while preserving the signed invoice", () => {
		vi.stubGlobal("flt", (value: unknown) => Number(value) || 0);
		try {
			const selection = usePosPaySelection({ posProfile: ref({ currency: "MXN" }), currency_filter: ref("ALL") });
			selection.selected_invoices.value = [{ voucher_no: "RETURN-1", outstanding_amount: -100 }];
			selection.payment_methods.value = [{ amount: 40 }];
			expect(selection.total_selected_invoices.value).toBe(100);
			expect(selection.total_of_diff.value).toBe(60);
			expect(selection.selected_invoices.value[0].outstanding_amount).toBe(-100);
		} finally { vi.unstubAllGlobals(); }
	});
});
