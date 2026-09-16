// Layout fixture for the custody corte: real components and browser storage,
// simulated server responses. Layout evidence only — never ledger proof.
//
// Separate from `closing.ts` (which never turns custody on) so the shared
// closing fixture and its checks keep answering for the ordinary corte.
import "vuetify/styles";
import "../../../src/style.css";
import "../../../src/posapp/styles/theme.css";
import "../../../src/posapp/styles/register-tokens.css";
import { createApp, h, nextTick } from "vue";
import { createPinia } from "pinia";
import mitt from "mitt";
import vuetify from "../../../src/posapp/plugins/vuetify";
import { memory, initPromise } from "../../../src/offline/db";
import { getTerminalCredentials } from "../../../src/offline/shiftTerminal";
import { useUIStore } from "../../../src/posapp/stores/uiStore";
import { useClosingFlowStore } from "../../../src/posapp/stores/closingFlowStore";

const translate = (text: string, args?: any[]) =>
	text.replace(/\{(\d+)\}/g, (_, i) => String(args?.[i] ?? `{${i}}`));
Object.assign(window, {
	__: translate,
	format_number: (v: number) => Number(v || 0).toFixed(2),
	flt: (v: any) => Number(v) || 0,
	get_currency_symbol: () => "MX$",
});

const scenario =
	new URLSearchParams(location.search).get("scenario") || "custody";
const custodyOn = scenario !== "plain";
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
const terminalState = {
	opening_shift: "FIXTURE-OPEN",
	terminal_id: "",
	terminal_generation: 0,
	owned: true,
	recovery_pending: false,
	can_manage: true,
	status: "Open",
};
(window as any).frappe = {
	_: translate,
	session: { user: "cashier@example.test" },
	call: async (request: any) => {
		const method = request.method || request;
		if (method.endsWith(".availability"))
			return { message: { enabled: custodyOn } };
		if (method.endsWith(".context"))
			return {
				message: { safe: "Main safe", currency: "MXN", bags: [], counts: [] },
			};
		if (method.endsWith(".command")) {
			const { payload } = request.args;
			const total =
				payload.count.source === "manual"
					? Number(payload.count.amount)
					: payload.count.denominations.reduce(
							(sum: number, row: any) =>
								sum + Math.round(row.value * 100) * row.quantity,
							0,
						) / 100;
			return {
				message: {
					cash_count: "COUNT-FIXTURE",
					modified: "2026-09-15 18:20:00",
					amount: total,
				},
			};
		}
		if (method.includes("terminal")) return { message: { ...terminalState } };
		return { message: overview };
	},
};

await initPromise;
memory.manual_offline = false;
Object.assign(terminalState, {
	terminal_id: getTerminalCredentials().terminal_id,
	terminal_generation: 1,
});
memory.pos_opening_storage = {
	pos_opening_shift: { name: "FIXTURE-OPEN" },
	terminal_status: {},
} as any;

const { default: DestinationHost } = await import(
	"../../../src/posapp/components/pos/shell/destinations/DestinationHost.vue"
);
const { VApp } = await import("vuetify/components");
const bus = mitt<any>();
const pinia = createPinia();
const app = createApp({
	render: () =>
		h(VApp, { class: "posapp" }, () => [
			h(
				"header",
				{
					style: "height:64px;padding:16px 24px;border-bottom:1px solid #ddd",
				},
				"Muelle POS · Closing shift",
			),
			h(
				"main",
				{
					style: "height:calc(100dvh - 64px);display:flex;flex-direction:column;",
				},
				[h(DestinationHost, { destinationId: "closing", t: translate })],
			),
		]),
});
app.use(pinia).use(vuetify);
app.provide("eventBus", bus);
app.provide("frappe", (window as any).frappe);
app.config.globalProperties.__ = translate;
app.config.globalProperties.frappe = (window as any).frappe;
const ui = useUIStore(pinia);
ui.posProfile = {
	name: "Example register",
	currency: "MXN",
	hide_expected_amount: scenario === "blind" ? 1 : 0,
} as any;
ui.posOpeningShift = { name: "FIXTURE-OPEN" };
const flow = useClosingFlowStore(pinia);
bus.on("open_shift_details", async () => {
	flow.$reset();
	const data = {
		pos_opening_shift: "FIXTURE-OPEN",
		pos_profile: "Example register",
		user: "Cashier",
		period_start_date: "2026-09-15 08:00:00",
		period_end_date: "2026-09-15 18:00:00",
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
			{
				mode_of_payment: "MercadoPago Point",
				opening_amount: 0,
				expected_amount: 250,
				closing_amount: 250,
			},
		],
	};
	flow.draft = data;
	await nextTick();
	bus.emit("open_ClosingDialog", data);
});
(window as any).closingLayoutFixture = { flow };
app.mount("#app");
