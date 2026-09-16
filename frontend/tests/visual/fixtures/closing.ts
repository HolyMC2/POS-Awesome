// Local browser fixture: real components and browser storage, simulated server responses.
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
	new URLSearchParams(location.search).get("scenario") || "ready";
const server = {
	opening_shift: "FIXTURE-OPEN",
	terminal_id: "",
	terminal_generation: 0,
	owned: !["legacy", "cashier", "released"].includes(scenario),
	recovery_pending: false,
	can_manage: !["cashier", "released"].includes(scenario),
	status: "Open",
};
if (scenario === "cashier") Object.assign(server, { terminal_id: "previous-browser", terminal_generation: 1 });
if (scenario === "released") server.terminal_generation = 2;
const calls: string[] = [];
const overview = {
	total_invoices: 8,
	company_currency: "MXN",
	draft_invoices: { count: 1 },
	cash_expected: {
		mode_of_payment: "Cash",
		company_currency_total: 1500,
		by_currency: [],
	},
	payments_by_mode: [],
	cash_movements: {
		count: 0,
		company_currency_total: 0,
		by_currency: [],
		by_type: [],
	},
};
(window as any).frappe = {
	_: translate,
	session: { user: "cashier@example.test" },
	call: async (request: any) => {
		const method = request.method || request;
		calls.push(method);
		if (method.endsWith("claim_terminal"))
			Object.assign(server, {
				owned: true,
				recovery_pending: scenario !== "released",
				terminal_generation: 1,
				terminal_id: getTerminalCredentials().terminal_id,
			});
		if (method.endsWith("resolve_terminal_recovery"))
			server.recovery_pending = false;
		return {
			message: method.includes("terminal") ? { ...server } : overview,
		};
	},
};
await initPromise;
memory.manual_offline = false;
if (server.owned)
	Object.assign(server, {
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
const { default: OfflineStatusPanel } = await import("../../../src/posapp/components/navbar/OfflineStatusPanel.vue");
const { useOfflineSyncStore } = await import("../../../src/posapp/stores/offlineSyncStore");
const bus = mitt<any>();
const pinia = createPinia();
const app = createApp({
	render: () =>
		h(VApp, {}, () => [
            h(OfflineStatusPanel, { modelValue: useOfflineSyncStore(pinia).panelOpen, "onUpdate:modelValue": (open: boolean) => useOfflineSyncStore(pinia).setPanelOpen(open) }),
			h(
				"header",
				{
					style: "height:64px;padding:16px 24px;border-bottom:1px solid #555",
				},
				"Muelle POS · Closing shift review",
			),
			h(
				"main",
				{
					style: "height:calc(100dvh - 64px);display:flex;flex-direction:column;",
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
ui.posProfile = {
	name: "Example register",
	currency: "MXN",
	hide_expected_amount: scenario === "blind" ? 1 : 0,
} as any;
ui.posOpeningShift = { name: "FIXTURE-OPEN" };
const flow = useClosingFlowStore(pinia);
bus.on("open_shift_details", async () => {
	flow.$reset();
	flow.pendingDrafts = [{ name: "DRAFT-EXAMPLE" }];
	flow.deletesDrafts = true;
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
				expected_amount: 0,
				closing_amount: 0,
			},
			{
				mode_of_payment: "MercadoPago Point",
				opening_amount: 0,
				expected_amount: 0,
				closing_amount: 0,
			},
		],
	};
	flow.draft = data;
	await nextTick();
	bus.emit("open_ClosingDialog", data);
});
bus.on("submit_closing_pos", () => {
	flow.error =
		"Example refusal: a saved sale still needs review. Sync saved work and try again.";
});
(window as any).closingFixture = { flow, calls };
app.mount("#app");
