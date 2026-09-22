// Real restaurant components with deterministic local state; no server writes.
import "vuetify/styles";
import "../../../src/style.css";
import "../../../src/posapp/styles/theme.css";
import "../../../src/posapp/styles/register-tokens.css";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { VApp } from "vuetify/components";
import mitt from "mitt";
import vuetify from "../../../src/posapp/plugins/vuetify";

const translate = (text: string, args: any[] = []) =>
	text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
Object.assign(window, {
	__: translate,
	flt: (v: unknown) => Number(v) || 0,
	format_number: (v: number) => Number(v || 0).toFixed(2),
	get_currency_symbol: () => "MX$",
	frappe: {
		_: translate,
		defaults: { get_default: () => "MXN" },
		utils: {},
		session: { user: "fixture@example.test" },
		realtime: { on() {}, off() {}, emit() {} },
		datetime: {
			nowdate: () => "2026-09-22",
			get_today: () => "2026-09-22",
		},
		call: async () => ({ message: null }),
	},
});
const { default: FloorView } = await import(
	"../../../src/posapp/components/floor/FloorView.vue"
);
const { useFloorStore } = await import("../../../src/posapp/stores/floorStore");
const { useUIStore } = await import("../../../src/posapp/stores/uiStore");
const pinia = createPinia();
const bus = mitt<any>();
const intents: unknown[] = [];
bus.on("*", (type, payload) => intents.push({ type, payload }));
const app = createApp({
	render: () =>
		h(VApp, { class: "posapp" }, () => [
			h(
				"header",
				{ style: "height:56px;flex:none;padding:16px;font-weight:700" },
				"Mesas · Salón",
			),
			h(
				"main",
				{
					style: "height:calc(100dvh - 120px);display:flex;min-height:0;overflow:hidden",
				},
				[h(FloorView, { ownsStage: true })],
			),
			h(
				"footer",
				{
					style: "height:64px;flex:none;padding:16px;border-top:1px solid #ccc",
				},
				"Explorar · Cuenta · Mesas · Cobrar",
			),
		]),
});
app.use(pinia).use(vuetify).provide("eventBus", bus);
app.config.globalProperties.__ = translate;
app.config.globalProperties.frappe = (window as any).frappe;
const ui = useUIStore(pinia);
ui.posProfile = { name: "Fixture", currency: "MXN" } as any;
ui.setCapabilityPayload({
	name: "cafeteria-mesas",
	capabilities: ["tables", "tab_identity", "service_types"],
	layout: { dock_tabs: ["browse", "cart", "floor", "pay"] },
});
const floor = useFloorStore(pinia);
floor.floors = [
	"Salón principal",
	"Terraza con nombre largo",
	"Segundo piso",
].map(
	(name, i) =>
		({
			name: `floor-${i}`,
			floor_name: name,
			layout: { cols: 12, rows: 15, cell: 44 },
		}) as any,
);
floor.activeFloor = "floor-0";
floor.tables = Array.from(
	{ length: 18 },
	(_, i) =>
		({
			name: `table-${i}`,
			table_label: `Mesa ${i + 1}`,
			floor: i < 16 ? "floor-0" : "floor-1",
			seats: 4,
			is_active: 1,
			needs_cleaning: i === 14 ? 1 : 0,
			layout: null,
		}) as any,
);
const order = (i: number, table: string | null, name: string) =>
	({
		order_uid: `order-${i}`,
		name: `order-${i}`,
		table,
		tab_name: name,
		total: 1280 + i,
		items_count: 4,
		unsent_count: 2,
		guest_count: 3,
		status: "Open",
		modified: new Date().toISOString(),
	}) as any;
floor.orders = [
	order(1, "table-0", "Sofía Hernández"),
	order(2, "table-0", "Familia de la terraza con nombre largo"),
	order(3, "table-2", "Ana"),
	...Array.from({ length: 5 }, (_, i) =>
		order(i + 4, null, `Cuenta sin mesa ${i + 1}`),
	),
];
floor.activate = async () => undefined;
floor.deactivate = () => undefined;
floor.refresh = async () => undefined;
floor.openTab = async (name: string) => {
	intents.push({ type: "open-tab", name });
	return null;
};
floor.openOrCreate = async (table: any) => {
	const row =
		floor.orders.find((o) => o.table === table.name) ||
		order(99, table.name, "Nueva cuenta");
	floor.activeOrder = row;
	return row;
};
floor.resumeOrder = async (row: any) => {
	intents.push({ type: "resume", uid: row.order_uid });
	floor.activeOrder = row;
	return row;
};
floor.markClean = async (name: string) => {
	intents.push({ type: "clean", name });
};
(window as any).__mesasFixture = { floor, intents };
app.mount("#app");
