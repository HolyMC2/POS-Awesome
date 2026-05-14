// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("../src/posapp/services/api", () => ({
	default: {
		call: callMock,
	},
}));

import {
	DASHBOARD_SECTION_KEYS,
	fetchDashboardEnvelope,
	fetchDashboardSection,
} from "../src/posapp/services/dashboardService";

const EXPECTED_METHOD: Record<string, string> = {
	sales_overview: "posawesome.posawesome.api.dashboard.get_dashboard_sales_overview",
	daily_sales_summary: "posawesome.posawesome.api.dashboard.get_dashboard_daily_sales_summary",
	monthly_sales_summary: "posawesome.posawesome.api.dashboard.get_dashboard_monthly_sales_summary",
	payment_method_report: "posawesome.posawesome.api.dashboard.get_dashboard_payment_method_report",
	discount_void_return_report:
		"posawesome.posawesome.api.dashboard.get_dashboard_discount_void_return_report",
	customer_report: "posawesome.posawesome.api.dashboard.get_dashboard_customer_report",
	staff_performance_report:
		"posawesome.posawesome.api.dashboard.get_dashboard_staff_performance_report",
	profitability_report: "posawesome.posawesome.api.dashboard.get_dashboard_profitability_report",
	branch_location_report: "posawesome.posawesome.api.dashboard.get_dashboard_branch_location_report",
	tax_charges_report: "posawesome.posawesome.api.dashboard.get_dashboard_tax_charges_report",
	sales_trend: "posawesome.posawesome.api.dashboard.get_dashboard_sales_trend",
	item_sales_report: "posawesome.posawesome.api.dashboard.get_dashboard_item_sales_report",
	category_brand_variant_report:
		"posawesome.posawesome.api.dashboard.get_dashboard_category_brand_variant_report",
	inventory_status_report: "posawesome.posawesome.api.dashboard.get_dashboard_inventory_status_report",
	stock_movement_report: "posawesome.posawesome.api.dashboard.get_dashboard_stock_movement_report",
	reorder_purchase_suggestions:
		"posawesome.posawesome.api.dashboard.get_dashboard_reorder_purchase_suggestions",
	inventory_insights: "posawesome.posawesome.api.dashboard.get_dashboard_inventory_insights",
	supplier_overview: "posawesome.posawesome.api.dashboard.get_dashboard_supplier_overview",
};

describe("dashboardService per-section endpoints", () => {
	beforeEach(() => {
		callMock.mockReset();
		callMock.mockResolvedValue({});
	});

	it("exposes one section key per legacy payload slice", () => {
		expect(new Set(DASHBOARD_SECTION_KEYS)).toEqual(new Set(Object.keys(EXPECTED_METHOD)));
	});

	it("routes each section to the matching whitelisted endpoint", async () => {
		for (const section of DASHBOARD_SECTION_KEYS) {
			callMock.mockClear();
			await fetchDashboardSection(section, { pos_profile: "Main POS" });
			expect(callMock).toHaveBeenCalledTimes(1);
			expect(callMock).toHaveBeenCalledWith(EXPECTED_METHOD[section], { pos_profile: "Main POS" });
		}
	});

	it("hits the dedicated envelope endpoint", async () => {
		await fetchDashboardEnvelope({ pos_profile: "Main POS" });
		expect(callMock).toHaveBeenCalledWith(
			"posawesome.posawesome.api.dashboard.get_dashboard_envelope",
			{ pos_profile: "Main POS" },
		);
	});
});
