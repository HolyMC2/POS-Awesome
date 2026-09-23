// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import StoreCajas from "../src/posapp/components/pos/registers/StoreCajas.vue";

const api = vi.hoisted(() => ({
	listStores: vi.fn(), listCajas: vi.fn(), cajaDetail: vi.fn(), setLifecycle: vi.fn(), issueChallenge: vi.fn(),
	approveRoute: vi.fn(), setupOptions: vi.fn(), createCaja: vi.fn(), configureCaja: vi.fn(), createStore: vi.fn(),
}));
vi.mock("../src/posapp/components/pos/registers/foundationApi", async (original) => ({
	...(await original<any>()), ...api,
}));

const store = { name: "S1", store_code: "CENTRO", store_name: "Centro", company: "Doco", status: "Active", timezone: "America/Mazatlan",
	revision: "1", registers: 2, open: 1, attention: 1, can_configure: true, can_supervise: true };
const row = (name: string, extra = {}) => ({ name, register_code: name, label: `Caja ${name}`, store: "S1", store_code: "CENTRO",
	store_name: "Centro", company: "Doco", pos_profile: "P", mode: "Cash", lifecycle: "Ready", work_state: "Available",
	connectivity: "Unknown", last_seen_at: null, opening_shift: null, cashier: null, cashier_name: null, opened_at: null,
	is_mine: false, attention: [], severity: "none", device_connected: true, revision: "4", ...extra });
const detail = (extra = {}) => ({ name: "MOSTRADOR", register_code: "MOSTRADOR", label: "Caja Mostrador", store: "S1", store_name: "Centro",
	store_code: "CENTRO", company: "Doco", pos_profile: "P", mode: "Cash", lifecycle: "Draft", revision: "4",
	configuration_revision: "1", requires_enrolled_device: true, work_state: "Available", runtime_revision: "1",
	connectivity: "Unknown", last_seen_at: null, shift: null, device: null, pending_configuration: false,
	legacy_profile_route: false, route_change_approved: false, capabilities: ["configure"], as_of: "2026-09-22 10:00:00",
	readiness: [{ key: "device", message: "Connect this caja's device.", owner: "device" }],
	actions: [{ action_id: "configure", enabled: true, blocking_reason: null, required_capability: "configure" },
		{ action_id: "activate", enabled: false, blocking_reason: "Connect this caja's device.", required_capability: "configure" },
		{ action_id: "connect_device", enabled: true, blocking_reason: null, required_capability: "enroll" }],
	drawer_account: "Caja 1 - D", ...extra });

beforeEach(() => {
	sessionStorage.clear();
	vi.clearAllMocks();
	(window as any).frappe = { session: { user: "manager" } };
	(window as any).__ = (value: string) => value;
	api.listStores.mockResolvedValue({ stores: [store], can_create_in: [], as_of: "", next_cursor: null });
	api.listCajas.mockResolvedValue({ registers: [row("MOSTRADOR", { lifecycle: "Draft", attention: ["setup_incomplete"] }),
		row("CAJA2", { opening_shift: "OS-1", cashier: "ana", cashier_name: "Ana", opened_at: "2026-09-22 09:10:00", work_state: "Open", connectivity: "Stale" })],
	summary: { total: 2, open: 1, attention: 1, setup: 1 }, as_of: "2026-09-22 10:00:00", coverage: "complete", next_cursor: null });
	api.cajaDetail.mockResolvedValue(detail());
});

it("lists cajas by recognizable name, cashier and separate status axes", async () => {
	const wrapper = mount(StoreCajas);
	await flushPromises();
	expect(api.listCajas).toHaveBeenCalledWith("S1", "all", "", null);
	const open = wrapper.get('[data-caja="CAJA2"]').text();
	expect(open).toContain("Caja CAJA2 · Ana");
	expect(open).toContain("Open since 09:10");
	expect(open).toContain("No contact"); // stale contact never reads as closed or free
	expect(wrapper.get('[data-caja="MOSTRADOR"]').text()).toContain("Setup incomplete");
	await wrapper.get('[data-test="caja-filter-attention"]').trigger("click");
	expect(api.listCajas).toHaveBeenLastCalledWith("S1", "attention", "", null);
	wrapper.unmount();
});

it("shows readiness with the owning action and keeps blocked activation disabled", async () => {
	api.issueChallenge.mockResolvedValue({ code: "ABCD-2345", expires_at: "2026-09-22 10:10:00", label: "Caja Mostrador", purpose: "Enroll" });
	const wrapper = mount(StoreCajas);
	await flushPromises();
	await wrapper.get('[data-caja="MOSTRADOR"]').trigger("click");
	await flushPromises();
	expect(wrapper.get('[data-test="caja-readiness"]').text()).toContain("Connect this caja's device.");
	expect(wrapper.get('[data-test="caja-action-activate"]').attributes("disabled")).toBeDefined();
	await wrapper.get('[data-test="caja-action-connect_device"]').trigger("click");
	await flushPromises();
	expect(api.issueChallenge).toHaveBeenCalledWith("MOSTRADOR", "Enroll", {});
	expect(wrapper.get('[data-test="device-code"]').text()).toContain("ABCD-2345");
	wrapper.unmount();
});

it("requires a reason before suspending and surfaces revision conflicts without discarding the view", async () => {
	api.cajaDetail.mockResolvedValue(detail({ lifecycle: "Ready", readiness: [], actions: [
		{ action_id: "suspend", enabled: true, blocking_reason: null, required_capability: "supervise" }] }));
	api.setLifecycle.mockRejectedValue({ message: "Someone changed this record.", code: "revision_conflict", retryable: true, correlationId: "c1", nextActions: [] });
	const wrapper = mount(StoreCajas);
	await flushPromises();
	await wrapper.get('[data-caja="MOSTRADOR"]').trigger("click");
	await flushPromises();
	await wrapper.get('[data-test="caja-action-suspend"]').trigger("click");
	const form = wrapper.get('[data-test="reason-form"]');
	await form.get("textarea").setValue("Drawer lock is broken");
	await form.trigger("submit");
	await flushPromises();
	expect(api.setLifecycle).toHaveBeenCalledWith("MOSTRADOR", "Suspended", "4", "Drawer lock is broken");
	expect(wrapper.get('[data-test="caja-error"]').text()).toContain("c1");
	expect(wrapper.get('[data-test="reason-form"] textarea').element).toHaveProperty("value", "Drawer lock is broken");
	wrapper.unmount();
});

it("ignores late detail responses and returns focus to the chosen caja", async () => {
	let finish!: (_value: any) => void;
	api.cajaDetail.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
	api.cajaDetail.mockResolvedValueOnce(detail({ name: "CAJA2", label: "Caja Dos" }));
	const wrapper = mount(StoreCajas, { attachTo: document.body });
	await flushPromises();
	await wrapper.get('[data-caja="MOSTRADOR"]').trigger("click");
	await wrapper.get('[data-caja="CAJA2"]').trigger("click");
	await flushPromises();
	finish(detail({ label: "Late" }));
	await flushPromises();
	expect(wrapper.get('[data-test="caja-detail"]').text()).toContain("Caja Dos");
	await wrapper.get('[data-test="back-cajas"]').trigger("click");
	await flushPromises();
	expect(document.activeElement?.getAttribute("data-caja")).toBe("CAJA2");
	wrapper.unmount();
});

it("explains the empty state and keeps shift review reachable for users without stores", async () => {
	api.listStores.mockResolvedValue({ stores: [], can_create_in: [], as_of: "", next_cursor: null });
	// Listener prop, not wrapper.emitted(): VTU records only native events in this repo.
	const onShowShifts = vi.fn();
	const wrapper = mount(StoreCajas, { props: { onShowShifts } as any });
	await flushPromises();
	expect(wrapper.get('[data-test="no-stores"]').text()).toContain("Shifts keep working as before");
	await wrapper.get('[data-test="no-stores"] button').trigger("click");
	expect(onShowShifts).toHaveBeenCalled();
	expect(api.listCajas).not.toHaveBeenCalled();
	wrapper.unmount();
});
