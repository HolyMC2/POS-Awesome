import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { useClosingSummary } from "../src/posapp/composables/pos/closing/useClosingSummary";

const formatters = {
	formatCurrencyWithSymbol: (value: number, currency: string) =>
		`${currency} ${Number(value || 0).toFixed(2)}`,
	formatCount: (value: number) => String(value ?? 0),
	formatCurrency: (value: number) => Number(value || 0).toFixed(2),
	currencySymbol: (currency: string) => currency,
	__: (text: string) => text,
};

function buildSummary(overviewPayload: any) {
	const overview = ref(overviewPayload);
	const posProfile = ref({ currency: "MXN" });
	const dialogData = ref({ currency: "MXN" });
	return useClosingSummary(overview, posProfile, dialogData, formatters);
}

describe("useClosingSummary customer credit redeemed", () => {
	it("exposes totals from the overview payload", () => {
		const summary = buildSummary({
			company_currency: "MXN",
			customer_credit_redeemed: {
				count: 3,
				company_currency_total: 450.5,
				by_currency: [
					{
						currency: "MXN",
						total: 450.5,
						company_currency_total: 450.5,
						invoice_count: 3,
					},
				],
			},
		});

		expect(summary.customerCreditRedeemed.value.count).toBe(3);
		expect(summary.customerCreditRedeemed.value.company_currency_total).toBe(450.5);

		const tile = summary.secondaryInsights.value.find(
			(card: any) => card.key === "customer-credit-redeemed",
		);
		expect(tile).toBeTruthy();
		expect(tile.value).toBe("MXN 450.50");
		expect(tile.caption).toContain("3");
	});

	it("defaults to zero when the overview lacks the block (pre-migrate server)", () => {
		const summary = buildSummary({ company_currency: "MXN" });

		expect(summary.customerCreditRedeemed.value.count).toBe(0);
		expect(summary.customerCreditRedeemed.value.company_currency_total).toBe(0);

		const tile = summary.secondaryInsights.value.find(
			(card: any) => card.key === "customer-credit-redeemed",
		);
		expect(tile).toBeTruthy();
		expect(tile.value).toBe("MXN 0.00");
	});
});
