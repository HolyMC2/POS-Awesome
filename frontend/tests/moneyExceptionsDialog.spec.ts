// @vitest-environment jsdom
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ local: vi.fn(), fetch: vi.fn(), drain: vi.fn(), bus: vi.fn(), call: vi.fn(),
	owner: null as any, memory: { pos_opening_storage: {} } as any, offline: false, online: null as any }));
vi.mock("../src/offline/db", () => ({ memory: m.memory, initPromise: Promise.resolve(), isOffline: () => m.offline }));
vi.mock("../src/offline/moneyExceptions", () => ({ readLocalMoneyExceptions: m.local }));
vi.mock("../src/offline/queueOwnership", () => ({ currentQueueOwner: () => m.owner }));
vi.mock("../src/posapp/services/moneyExceptionsService", () => ({ fetchMoneyExceptions: m.fetch }));
vi.mock("../src/posapp/stores/syncStore", () => ({ useSyncStore: () => ({ drainEntityQueue: m.drain }) }));
vi.mock("../src/posapp/bus", () => ({ bus: { emit: m.bus } }));
vi.mock("../src/posapp/composables/core/useOnlineStatus", () => ({ useOnlineStatus: () => ({ isOnline: m.online }) }));
import Dialog from "../src/posapp/components/pos/payments/exceptions/MoneyExceptionsDialog.vue";
const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const Button = defineComponent({ props: ["disabled", "loading"], setup: (p, { slots }) =>
	() => h("button", { disabled: p.disabled || p.loading }, slots.default?.()) });
const wrappers: VueWrapper[] = [];
const localRow = () => ({ id: "browser:payment:7", origin: "browser", entity_type: "payment", kind: "advance_refund",
	status: "failed", severity: "warning", modified: "2026-09-06 12:00:00", client_request_id: "ORIGINAL-REQUEST",
	message_key: "Saved on this browser; server confirmation is still pending.",
	next_action_key: "Check the original refund request before handing out cash or starting another refund.",
	document: null, amount: 40, currency: "MXN", actions: [{ type: "retry_saved_queue" }] });
const serverRow = () => ({ id: "charge_callback:PCR-7", kind: "charge_callback", status: "Failed", severity: "warning",
	modified: "2026-09-06 12:01:00", message_key: "Payment recorded; the source document update failed.",
	next_action_key: "open_document", document: { doctype: "POS Charge Request", name: "PCR-7" },
	invoice: { doctype: "Sales Invoice", name: "INV-7" }, amount: 100, currency: "MXN",
	actions: [{ type: "open_document", doctype: "POS Charge Request", name: "PCR-7" }] });
const feed = (rows = [serverRow()]) => ({ version: 1, company: "COMPANY", pos_profile: "COUNTER", opening_shift: "SHIFT-1",
	as_of: "2026-09-06 12:02:00", rows, has_more: false, sources: Object.fromEntries(
		["invoice_submissions", "financial_receipts", "charge_callbacks", "processor", "fiscal"].map(key =>
			[key, { status: "supported", count: 0, has_more: false }])) });
function open() {
	const wrapper = mount(Dialog, { props: { posProfile: { name: "COUNTER" } }, global: { components: {
		VDialog: Box, VCard: Box, VCardTitle: Box, VCardText: Box, VAlert: Box, VChip: Box, VBtn: Button, VSelect: Box,
	} } }); wrappers.push(wrapper); return wrapper;
}
function retry(wrapper: VueWrapper) {
	const button = wrapper.get('[data-testid="exception-row-browser"]').findAll("button")[0];
	if (!button) throw new Error("Missing saved-work retry control"); return button;
}
beforeEach(() => {
	vi.clearAllMocks(); m.online = ref(true); m.offline = false;
	m.owner = { queue_user: "cashier@example.com", queue_profile: "COUNTER" };
	m.memory.pos_opening_storage = { pos_profile: { name: "COUNTER" },
		pos_opening_shift: { name: "SHIFT-1", pos_profile: "COUNTER", user: m.owner.queue_user } };
	m.local.mockResolvedValue({ rows: [localRow()], has_more: false, errors: [] });
	m.fetch.mockResolvedValue(feed()); m.drain.mockResolvedValue(undefined);
	(window as any).__ = (value: string) => value; (window as any).frappe = { call: m.call };
});
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

describe("money exception review dialog", () => {
	it("shows mixed browser and server evidence without taking financial action on open", async () => {
		const w = open(); await flushPromises();
		expect(w.findAll('[data-testid="exception-row-browser"]')).toHaveLength(1);
		expect(w.findAll('[data-testid="exception-row-server"]')).toHaveLength(1);
		expect(w.text()).toContain("ORIGINAL-REQUEST"); expect(w.text()).toContain("PCR-7");
		expect(w.text()).toContain("Do not take payment for this order again.");
		expect(m.fetch).toHaveBeenCalledWith("COUNTER", "SHIFT-1");
		expect(m.drain).not.toHaveBeenCalled(); expect(m.call).not.toHaveBeenCalled(); expect(m.bus).not.toHaveBeenCalled();
	});
	it("keeps adapter failure visible alongside successfully loaded records", async () => {
		const response = feed(); response.sources.processor.status = "error"; m.fetch.mockResolvedValue(response);
		const w = open(); await flushPromises();
		expect(w.text()).toContain("Some server sources could not be checked. This is not an all-clear report.");
		expect(w.text()).toContain("Could not check"); expect(w.findAll('[data-testid="exception-row-server"]')).toHaveLength(1);
	});
	it("reports unreadable local data and failed server read without exposing raw errors", async () => {
		m.local.mockRejectedValue(new Error("PRIVATE DATABASE DETAIL")); m.fetch.mockRejectedValue(new Error("PRIVATE SERVER TRACE"));
		const w = open(); await flushPromises();
		expect(w.text()).toContain("Some saved browser work could not be read.");
		expect(w.text()).toContain("Server records could not be checked for this register."); expect(w.text()).not.toContain("PRIVATE");
	});
	it("shows local work offline without server reads or payment drains", async () => {
		m.offline = true; m.online.value = false; const w = open(); await flushPromises();
		expect(w.find('[data-testid="exception-offline"]').exists()).toBe(true);
		expect(w.findAll('[data-testid="exception-row-browser"]')).toHaveLength(1); expect(m.fetch).not.toHaveBeenCalled();
		expect(retry(w).attributes("disabled")).toBeDefined(); await retry(w).trigger("click");
		expect(m.drain).not.toHaveBeenCalled(); expect(m.call).not.toHaveBeenCalled();
	});
	it("uses the existing entity drain and preserves the original saved request", async () => {
		const original = localRow(); m.local.mockResolvedValue({ rows: [original], has_more: false, errors: [] });
		const w = open(); await flushPromises(); await retry(w).trigger("click"); await flushPromises();
		expect(m.drain).toHaveBeenCalledTimes(1); expect(m.drain).toHaveBeenCalledWith("payment");
		expect(original.client_request_id).toBe("ORIGINAL-REQUEST"); expect(m.call).not.toHaveBeenCalled();
		expect(w.text()).toContain("ORIGINAL-REQUEST");
	});
	it("does not paint a completed read from the previous cashier", async () => {
		let finish!: (value: any) => void; m.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
		const w = open(); await flushPromises(); m.owner = { queue_user: "other@example.com", queue_profile: "COUNTER" };
		finish(feed()); await flushPromises(); expect(w.findAll('[data-testid^="exception-row-"]')).toHaveLength(0);
		expect(w.text()).not.toContain("ORIGINAL-REQUEST"); expect(w.text()).toContain("The cashier or register changed.");
	});
	it("clears displayed identities and source links after focus reveals a cashier switch", async () => {
		const w = open(); await flushPromises(); expect(w.text()).toContain("PCR-7");
		m.owner = null; window.dispatchEvent(new Event("focus")); await flushPromises();
		expect(w.text()).not.toContain("PCR-7"); expect(w.text()).not.toContain("ORIGINAL-REQUEST");
		expect(w.findAll("a")).toHaveLength(0); expect(m.drain).not.toHaveBeenCalled();
	});
	it("opens encoded source records without invoking provider or payment endpoints", async () => {
		const source = serverRow(); source.document.name = "PCR/7 #?"; source.actions[0].name = source.document.name;
		m.fetch.mockResolvedValue(feed([source])); const w = open(); await flushPromises(); const link = w.get("a");
		expect(link.attributes("href")).toBe("/app/pos-charge-request/PCR%2F7%20%23%3F");
		expect(link.attributes("rel")).toBe("noopener noreferrer"); expect(link.attributes("target")).toBe("_blank");
		expect(m.call).not.toHaveBeenCalled(); expect(m.drain).not.toHaveBeenCalled();
	});
	it("marks capped results as incomplete", async () => {
		m.local.mockResolvedValue({ rows: [localRow()], errors: [], has_more: true }); const w = open(); await flushPromises();
		expect(w.get('[data-testid="exception-more"]').text()).toContain("This list is limited");
	});
});
