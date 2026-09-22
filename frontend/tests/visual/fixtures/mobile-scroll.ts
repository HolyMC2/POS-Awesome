// Real presentation components; no server, sale, payment or shift writes.
import "vuetify/styles";
import "../../../src/posapp/styles/theme.css";
import "../../../src/posapp/styles/register-tokens.css";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { VApp } from "vuetify/components";
import vuetify from "../../../src/posapp/plugins/vuetify";
import MobileSaleScreen from "../../../src/posapp/components/pos/mobile/sale/MobileSaleScreen.vue";
import MovilCobroView from "../../../src/posapp/components/pos/mobile/pay/MovilCobroView.vue";
import { resolveBandState } from "../../../src/posapp/composables/pos/shell/bandState";
import RecargasLedger from "../../../src/posapp/components/pos/recargas/RecargasLedger.vue";
import Reports from "../../../src/posapp/components/reports/Reports.vue";
import { useUIStore } from "../../../src/posapp/stores/uiStore";

(window as any).__ = (text: string, args: unknown[] = []) =>
	text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
const items = Array.from({ length: 24 }, (_, i) => ({
	item_code: `ITEM-${i}`,
	item_name: `Accesorio ${i + 1} con nombre largo para comprobar el ajuste`,
	qty: 1,
	rate: 100,
	amount: 100,
}));
const money = (value: number) => `$${value.toFixed(2)}`;
const screen = new URLSearchParams(location.search).get("screen");
const envelope = {
	enabled: true,
	default_scope: "current",
	selected_profiles: ["Fixture"],
	available_profiles: [{ name: "Fixture", dashboard_enabled: true }],
	company: "Fixture",
	currency: "MXN",
	date_context: {
		today: "2026-09-22",
		month_start: "2026-09-01",
		report_month: "2026-09",
	},
};
(window as any).frappe = {
	_: (window as any).__,
	session: { user: "fixture@example.test" },
	call: (request: any) => {
		const message = request.method.endsWith("get_dashboard_access")
			? { allowed: true }
			: {
					...envelope,
					inventory_insights: {
						low_stock_items: items.map((item) => ({
							...item,
							actual_qty: 2,
							warehouse: "Fixture",
						})),
						fast_moving_items: items.map((item) => ({
							...item,
							sold_qty: 10,
							sales_amount: 1000,
						})),
					},
				};
		request.callback?.({ message });
		return Promise.resolve({ message });
	},
};
const pinia = createPinia();
useUIStore(pinia).setPosProfile({ name: "Fixture", currency: "MXN" } as any);
createApp({
	render: () =>
		h(VApp, { class: "posapp" }, () =>
			h(
				"main",
				{
					// The shell's allocated space after its header, warning and dock.
					style: "height:calc(100dvh - 180px);min-height:0;display:flex;flex-direction:column;overflow:hidden;margin-top:100px",
				},
				[
					screen === "recharge-history"
						? h(
								"section",
								{
									style: "overflow:auto;min-width:0;min-height:0",
								},
								[
									h(RecargasLedger, {
										ledger: {
											complete: true,
											operations: 24,
											sold: 2400,
											refunded: 0,
											needsAttention: 0,
											commission: null,
											entries: items.map((item, i) => ({
												id: item.item_code,
												time: "18:45",
												carrier:
													"Compañía con nombre largo",
												product: item.item_name,
												reference:
													"123456789012345678901234567890",
												amount: 100,
												outcome: "applied" as const,
											})),
										},
										formatCurrency: money,
									}),
								],
							)
						: screen === "dashboard"
							? h(Reports)
							: screen === "pay"
								? h(MovilCobroView, {
										total: 2400,
										tendered: 0,
										currency: "MXN",
										formatCurrency: money,
										profile: {
											payments: [
												{
													mode_of_payment: "Cash",
													type: "Cash",
													default: 1,
												},
												{
													mode_of_payment: "Card",
													type: "Bank",
												},
											],
										},
										customerName:
											"Cliente con nombre largo",
										itemCount: 24,
										canCollect: true,
									})
								: h(MobileSaleScreen, {
										items,
										state: resolveBandState({
											kind: "sale",
											total: 2400,
											itemCount: 24,
										}),
										subtotal: 2400,
										tax: 0,
										customerName:
											"Cliente con nombre largo",
										formatCurrency: money,
									}),
				],
			),
		),
})
	.use(pinia)
	.use(vuetify)
	.mount("#app");
