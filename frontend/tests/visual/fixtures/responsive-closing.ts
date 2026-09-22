// Real closing layout with simulated reads; no shift or payment submission.
import "vuetify/styles";
import "../../../src/style.css";
import "../../../src/posapp/styles/theme.css";
import "../../../src/posapp/styles/register-tokens.css";
import { createApp, h, nextTick } from "vue";
import { createPinia } from "pinia";
import { VApp } from "vuetify/components";
import mitt from "mitt";
import vuetify from "../../../src/posapp/plugins/vuetify";
import { memory, initPromise } from "../../../src/offline/db";
import { useUIStore } from "../../../src/posapp/stores/uiStore";

const translate = (text: string, args: any[] = []) =>
	text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
Object.assign(window, {
	__: translate,
	format_number: (v: number) => Number(v || 0).toFixed(2),
	flt: (v: any) => Number(v) || 0,
	get_currency_symbol: () => "MX$",
});
const overview = {
	total_invoices: 24,
	company_currency: "MXN",
	draft_invoices: { count: 0 },
	cash_expected: {
		mode_of_payment: "Cash",
		company_currency_total: 1500,
		by_currency: [],
	},
	payments_by_mode: [
		{
			mode_of_payment: "Cash",
			currency: "MXN",
			total: 1000,
			company_currency_total: 1000,
		},
	],
	cash_movements: {
		count: 0,
		company_currency_total: 0,
		by_currency: [],
		by_type: [],
	},
};
(window as any).frappe = {
	_: translate,
	session: { user: "fixture@example.test" },
	call: async (request: any) => {
		request.callback?.({ message: overview });
		return { message: overview };
	},
};
await initPromise;
memory.manual_offline = false;
const { default: DestinationHost } = await import(
	"../../../src/posapp/components/pos/shell/destinations/DestinationHost.vue"
);
const bus = mitt<any>();
const pinia = createPinia();
const app = createApp({
	render: () =>
		h(VApp, { class: "posapp" }, () => [
			h(
				"header",
				{ style: "height:64px;flex:none;padding:16px" },
				"Muelle POS · Closing shift",
			),
			h(
				"main",
				{
					style: "height:calc(100dvh - 64px);min-height:0;display:flex;flex-direction:column;overflow:hidden",
				},
				[
					h(DestinationHost, {
						destinationId: "closing",
						t: translate,
					}),
				],
			),
		]),
});
app.use(pinia).use(vuetify);
app.provide("eventBus", bus);
app.provide("frappe", (window as any).frappe);
app.config.globalProperties.__ = translate;
app.config.globalProperties.frappe = (window as any).frappe;
const ui = useUIStore(pinia);
ui.posProfile = { name: "Fixture", currency: "MXN" } as any;
ui.posOpeningShift = { name: "FIXTURE-OPEN" };
bus.on("open_shift_details", async () => {
	await nextTick();
	bus.emit("open_ClosingDialog", {
		pos_opening_shift: "FIXTURE-OPEN",
		pos_profile: "Fixture",
		user: "Cashier",
		period_start_date: "2026-09-22 08:00:00",
		period_end_date: "2026-09-22 18:00:00",
		grand_total: 1000,
		payment_reconciliation: [
			{
				mode_of_payment: "Cash",
				opening_amount: 500,
				expected_amount: 1500,
				closing_amount: 0,
			},
			{
				mode_of_payment: "Wire Transfer",
				opening_amount: 0,
				expected_amount: 400,
				closing_amount: 400,
			},
		],
	});
});
app.mount("#app");
