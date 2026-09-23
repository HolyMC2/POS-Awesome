// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import RegistersWorkspace from "../src/posapp/components/pos/registers/RegistersWorkspace.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

const { list, details } = vi.hoisted(() => ({ list: vi.fn(), details: vi.fn() }));
vi.mock("../src/posapp/components/pos/registers/api", () => ({ listShifts: list, shiftDetail: details }));
vi.mock("../src/posapp/components/navbar/ShiftTerminalStatus.vue", () => ({ default: { name: "ShiftTerminalStatus", template: '<div data-test="terminal-review" />', props: ["initialShift", "managementOnly"] } }));
const row = (name = "OPEN-1", extra = {}) => ({ name, user: "cashier", cashier_name: "Ana", pos_profile: "Doco Ventas", company: "Doco", warehouse: "Centro", status: "Open", period_start_date: "2026-09-21 08:00:00", recovery_pending: false, older_shift: true, is_mine: true, ...extra });
const page = (shifts = [row()], next_cursor: string | null = null) => ({ shifts, can_manage: true, summary: { open: 3, attention: 2 }, as_of: "2026-09-22 10:00:00", next_cursor });
const detail = (shift = row(), extra = {}) => ({ shift, can_manage: true, amounts_hidden: false, cash_movements_enabled: true, closing_enabled: true, currency: "MXN", as_of: "2026-09-22 10:00:00", tenders: [{ mode_of_payment: "Cash", opening_amount: 100, expected_amount: 475 }], movements: [], ...extra });
const emit = vi.fn();
const render = () => mount(RegistersWorkspace, { global: { provide: { eventBus: { emit } }, stubs: { "v-icon": true } } });

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	list.mockResolvedValue(page());
	details.mockResolvedValue(detail());
	(window as any).__ = (value: string) => value;
});

it("reviews shifts before opening one and only reads detail on selection", async () => {
	const wrapper = render();
	await flushPromises();
	expect(list).toHaveBeenCalledWith("attention", "", null);
	expect(details).not.toHaveBeenCalled();
	await wrapper.get('[data-test="open-shift"]').trigger("click");
	expect(emit).toHaveBeenCalledWith("registers:open-shift");
	await wrapper.get('[data-shift="OPEN-1"]').trigger("click");
	await flushPromises();
	expect(details).toHaveBeenCalledWith("OPEN-1");
	expect(wrapper.text()).toContain("Server expected amounts");
	expect(wrapper.find('[data-test="shift-close"]').exists()).toBe(false);
	wrapper.unmount();
});

it("routes financial actions only for the active cashier's exact shift", async () => {
	useUIStore().posOpeningShift = { name: "OPEN-1" } as any;
	const wrapper = render();
	await flushPromises();
	await wrapper.get('[data-shift="OPEN-1"]').trigger("click");
	await flushPromises();
	await wrapper.get('[data-test="shift-cash"]').trigger("click");
	expect(emit).toHaveBeenCalledWith("open_destination", "expense");
	await wrapper.get('[data-test="shift-close"]').trigger("click");
	expect(emit).toHaveBeenCalledWith("open_destination", "closing");
	details.mockResolvedValue(detail(row("OPEN-2", { is_mine: false })));
	await wrapper.get('[data-test="refresh-shifts"]').trigger("click");
	await flushPromises();
	expect(wrapper.find('[data-test="resume-sale"]').exists()).toBe(false);
	expect(wrapper.find('[data-test="shift-close"]').exists()).toBe(false);
	expect(useUIStore().posOpeningShift?.name).toBe("OPEN-1");
	wrapper.unmount();
});

it("keeps blind counts hidden and passes the selected foreign shift into recovery", async () => {
	details.mockResolvedValue(detail(row("OPEN-1", { is_mine: false }), { amounts_hidden: true }));
	const wrapper = render();
	await flushPromises();
	await wrapper.get('[data-shift="OPEN-1"]').trigger("click");
	await flushPromises();
	expect(wrapper.get('[data-test="blind-count"]').exists()).toBe(true);
	expect(wrapper.text()).not.toContain("475");
	await wrapper.get('[data-test="review-browser"]').trigger("click");
	expect(wrapper.findComponent({ name: "ShiftTerminalStatus" }).props()).toMatchObject({ initialShift: "OPEN-1", managementOnly: true });
	wrapper.unmount();
});

it("discards late detail responses and preserves the queue when returning", async () => {
	list.mockResolvedValue(page([row("OPEN-1"), row("OPEN-2", { cashier_name: "Beto" })]));
	let finishFirst!: (_value: any) => void;
	details.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
	details.mockResolvedValueOnce(detail(row("OPEN-2", { cashier_name: "Beto" })));
	const wrapper = render();
	await flushPromises();
	await wrapper.get('[data-shift="OPEN-1"]').trigger("click");
	await wrapper.get('[data-shift="OPEN-2"]').trigger("click");
	await flushPromises();
	finishFirst(detail());
	await flushPromises();
	expect(wrapper.get('[data-test="shift-detail"]').text()).toContain("Beto");
	expect(wrapper.get('[data-test="shift-detail"]').text()).not.toContain("Ana");
	await wrapper.get('[data-test="back-shifts"]').trigger("click");
	expect(wrapper.findAll("[data-shift]")).toHaveLength(2);
	expect(list).toHaveBeenCalledTimes(1);
	wrapper.unmount();
});

it("does not append an old page after changing the queue", async () => {
	list.mockResolvedValueOnce(page([row()], "next"));
	let finishMore!: (_value: any) => void;
	list.mockImplementationOnce(() => new Promise((resolve) => { finishMore = resolve; }));
	list.mockResolvedValueOnce(page([row("CLOSED", { status: "Closed" })]));
	const wrapper = render();
	await flushPromises();
	await wrapper.get('[data-test="more-shifts"]').trigger("click");
	await wrapper.get('[data-test="queue-closed"]').trigger("click");
	await flushPromises();
	finishMore(page([row("LATE")], "more"));
	await flushPromises();
	expect(wrapper.find('[data-shift="CLOSED"]').exists()).toBe(true);
	expect(wrapper.find('[data-shift="LATE"]').exists()).toBe(false);
	wrapper.unmount();
});

it("shows a failed refresh instead of leaving old money or an empty success state", async () => {
	const wrapper = render();
	await flushPromises();
	await wrapper.get('[data-shift="OPEN-1"]').trigger("click");
	await flushPromises();
	details.mockRejectedValue(new Error("No access"));
	list.mockRejectedValue(new Error("Disconnected"));
	await wrapper.get('[data-test="refresh-shifts"]').trigger("click");
	await flushPromises();
	expect(wrapper.text()).toContain("could not be loaded");
	expect(wrapper.text()).toContain("Could not update shifts");
	expect(wrapper.text()).not.toContain("475");
	expect(wrapper.text()).not.toContain("No shifts need review");
	wrapper.unmount();
});
