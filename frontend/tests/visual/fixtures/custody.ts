// UI-only fixture: real components/storage, simulated financial responses. Never use as ledger proof.
import "vuetify/styles";
import "../../../src/style.css";
import "../../../src/posapp/styles/theme.css";
import "../../../src/posapp/styles/register-tokens.css";
import { createApp, h, reactive } from "vue";
import photoScript from "../../../../posawesome/public/js/cash_photos.js?raw";
import spanishCSV from "../../../../posawesome/translations/es.csv?raw";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import vuetify from "../../../src/posapp/plugins/vuetify";
import { useUIStore } from "../../../src/posapp/stores/uiStore";
import { memory, initPromise } from "../../../src/offline/db";
import { getTerminalCredentials } from "../../../src/offline/shiftTerminal";
const query = new URLSearchParams(location.search),
	scenario = query.get("scenario") || "cashier";
const spanish = Object.fromEntries(
	spanishCSV
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const cells = line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || [];
			return cells
				.slice(0, 2)
				.map((cell) =>
					cell
						.replace(/,$/, "")
						.replace(/^"|"$/g, "")
						.replace(/""/g, '"'),
				);
		}),
);
const translate = (s: string, args: any[] = []) =>
	String(query.get("lang") === "es" ? spanish[s] || s : s).replace(
		/\{(\d+)\}/g,
		(_, i) => String(args[i] ?? `{${i}}`),
	);
Object.assign(window, {
	__: translate,
	format_number: (v: any) => Number(v || 0).toFixed(2),
	flt: (v: any) => Number(v) || 0,
});
const cashier = "cashier@example.test",
	supervisor = "supervisor@example.test";
const data: any = reactive({
	safe: "Main safe",
	currency: "MXN",
	float_target: 1000,
	drawer_limit: 5000,
	can_manage: scenario === "supervisor",
	can_transfer: scenario === "supervisor",
	offsite_cash_account: "Caja fuerte casa - DOCO",
	offsite_cash_account_name: "Caja fuerte casa",
	balance: 15330,
	loose_balance: 1000,
	in_transit: 12500,
	bags: [
		{
			name: "BAG-1",
			seal: "FLOAT-025",
			purpose: "Float",
			state: "Available",
			amount: 1000,
			prepared_by: "previous.cashier@example.test",
			verified_by: supervisor,
			modified: "2026-09-15 09:00:00",
		},
		{
			name: "BAG-2",
			seal: "SALES-084",
			purpose: "Takings",
			state: "Unverified",
			amount: 2350,
			prepared_by: "previous.cashier@example.test",
			modified: "2026-09-15 08:50:00",
		},
		{
			name: "BAG-3",
			seal: "FLOAT-024",
			purpose: "Float",
			state: "Disputed",
			amount: 980,
			prepared_by: cashier,
			modified: "2026-09-15 08:40:00",
		},
		{
			name: "BAG-4",
			seal: "BANK-016",
			purpose: "Takings",
			state: "In Transit",
			amount: 12500,
			prepared_by: cashier,
			modified: "2026-09-15 08:30:00",
		},
		{
			name: "BAG-5",
			seal: "BANK-015",
			purpose: "Takings",
			state: "Deposited",
			amount: 5000,
			prepared_by: cashier,
			modified: "2026-09-14 08:30:00",
		},
	],
	counts: [
		{
			name: "COUNT-1",
			scope: "Bag",
			state: "Exception",
			bag: "BAG-3",
			amount: 980,
			expected_amount: 1000,
			difference: -20,
			counted_by: cashier,
			note: "Twenty pesos missing after a second count",
			modified: "2026-09-15 08:40:00",
			count_json: JSON.stringify({
				source: "denominations",
				denominations: [
					{ value: 100, quantity: 9 },
					{ value: 20, quantity: 4 },
				],
			}),
		},
	],
});
if (scenario === "empty") {
	data.bags = [];
	data.counts = [];
}
const calls: any[] = [];
(window as any).frappe = {
	_: translate,
	session: { user: scenario === "supervisor" ? supervisor : cashier },
	call: async (request: any) => {
		calls.push(request);
		if (scenario === "error")
			throw Error("Connection unavailable. Reconnect and refresh.");
		if (request.method.endsWith(".list_photos")) return { message: { photos: [], can_upload: true, max_photos: 6, max_bytes: 5242880 } };
		if (request.method.endsWith(".availability"))
			return { message: { enabled: true } };
		if (request.method.endsWith(".context"))
			return { message: JSON.parse(JSON.stringify(data)) };
		if (request.method.endsWith(".command")) {
			const { action, payload } = request.args;
			if (action === "save_drawer")
				return {
					message: {
						cash_count: "COUNT-DRAWER",
						modified: "2026-09-15 10:00:00",
						amount:
							payload.count.source === "manual"
								? Number(payload.count.amount)
								: payload.count.denominations.reduce(
										(sum: any, row: any) =>
											sum +
											Math.round(row.value * 100) *
												row.quantity,
										0,
									) / 100,
					},
				};
			const bag = data.bags.find((b: any) => b.name === payload.bag);
			if (bag && action === "receive") bag.state = "Issued";
			if (bag && action === "transfer_safe") Object.assign(bag, { state: "Transferred", transfer_account: data.offsite_cash_account, transferred_by: supervisor, transferred_on: "2026-09-23 20:30:00", transfer_journal: "QA-JV-1" });
			return {
				message: {
					bag: bag?.name,
					transfer_account: bag?.transfer_account,
					journal_entry: bag?.transfer_journal,
					state: bag?.state,
					amount: bag?.amount,
				},
			};
		}
		return { message: {} };
	},
};
new Function(photoScript)();
await initPromise;
memory.manual_offline = false;
const terminal = getTerminalCredentials();
memory.pos_opening_storage = {
	pos_opening_shift: {
		name: "FIXTURE-OPEN",
		posa_terminal_id: terminal.terminal_id,
		posa_terminal_generation: 1,
	},
	terminal_status: { owned: true },
} as any;
const { default: CashCustodyView } = await import(
	"../../../src/posapp/components/pos/custody/CashCustodyView.vue"
);
const { default: CashClosingAllocation } = await import(
	"../../../src/posapp/components/pos/custody/CashClosingAllocation.vue"
);
const { VApp } = await import("vuetify/components");
const pinia = createPinia();
const router = createRouter({
	history: createMemoryHistory(),
	routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});
const events: any = reactive({});
const app = createApp({
	render: () =>
		h(VApp, { class: "posapp" }, () => [
			h(
				"header",
				{
					style: "padding:16px 24px;border-bottom:1px solid var(--pos-border);height:60px;font-weight:600",
				},
				"MuellePOS · Cash handover",
			),
			h("main", { style: "height:calc(100dvh - 60px);overflow:auto" }, [
				scenario === "closing"
					? h(CashClosingAllocation, {
							profile: "Register 1",
							opening: "FIXTURE-OPEN",
							currency: "MXN",
							onPrepared: (v: any) => (events.prepared = v),
							onCounted: (v: any) => (events.counted = v),
						})
					: h(CashCustodyView),
			]),
		]),
});
app.use(pinia).use(vuetify).use(router);
const ui = useUIStore(pinia);
ui.posProfile = { name: "Register 1", currency: "MXN" } as any;
ui.posOpeningShift = { name: "FIXTURE-OPEN" };
vuetify.theme.global.name.value =
	query.get("theme") === "dark" ? "dark" : "light";
app.config.globalProperties.__ = translate;
(window as any).custodyFixture = { data, calls, events };
app.mount("#app");
