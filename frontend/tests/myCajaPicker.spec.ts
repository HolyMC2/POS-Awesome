// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import MyCajaPicker from "../src/posapp/components/pos/shift/MyCajaPicker.vue";

const api = vi.hoisted(() => ({ myCajas: vi.fn(), previewChallenge: vi.fn(), enrollDevice: vi.fn() }));
vi.mock("../src/posapp/components/pos/registers/foundationApi", async (original) => ({ ...(await original<any>()), ...api }));
vi.mock("../src/offline/shiftTerminal", () => ({ getTerminalCredentials: () => ({ terminal_id: "terminal-id-000001", terminal_token: "t".repeat(40) }) }));

const caja = (name: string, extra = {}) => ({ name, label: `Caja ${name}`, store_name: "Centro", company: "Doco", pos_profile: "P",
	mode: "Cash", lifecycle: "Ready", opening_shift: null, is_mine: false, this_device: true, can_open: true, ...extra });

beforeEach(() => {
	vi.clearAllMocks();
	(window as any).__ = (value: string) => value;
});

it("stays out of the way when the cashier has no cajas (legacy profile opening)", async () => {
	api.myCajas.mockResolvedValue({ registers: [], truncated: false, as_of: "" });
	const wrapper = mount(MyCajaPicker, { props: { modelValue: null } });
	await flushPromises();
	expect(wrapper.find('[data-test="my-caja-picker"]').exists()).toBe(false);
	expect(api.myCajas).toHaveBeenCalledWith("terminal-id-000001");
});

it("preselects the only caja this device can open and blocks cajas open by someone else", async () => {
	api.myCajas.mockResolvedValue({ registers: [caja("A"), caja("B", { opening_shift: "OS", cashier_name: "Beto", can_open: false })], truncated: false, as_of: "" });
	const chosen = vi.fn();
	const wrapper = mount(MyCajaPicker, { props: { modelValue: null, "onUpdate:modelValue": chosen } as any });
	await flushPromises();
	expect(chosen.mock.calls[0]?.[0]).toMatchObject({ name: "A" }); // B is taken, so A is unambiguous
	expect(wrapper.get('[data-caja-option="B"]').attributes("disabled")).toBeDefined();
	expect(wrapper.get('[data-caja-option="B"]').text()).toContain("Open by Beto");
	api.myCajas.mockResolvedValue({ registers: [caja("A"), caja("C")], truncated: false, as_of: "" });
	const ambiguous = vi.fn();
	mount(MyCajaPicker, { props: { modelValue: null, "onUpdate:modelValue": ambiguous } as any });
	await flushPromises();
	expect(ambiguous).not.toHaveBeenCalled(); // two openable cajas: the cashier chooses
});

it("confirms the store and caja from the code before connecting this device", async () => {
	api.myCajas.mockResolvedValueOnce({ registers: [caja("A", { this_device: false, can_open: false })], truncated: false, as_of: "" });
	api.previewChallenge.mockResolvedValue({ register: "A", label: "Caja A", store_name: "Centro", purpose: "Enroll" });
	api.enrollDevice.mockResolvedValue({ register: "A", label: "Caja A", store_name: "Centro", generation: "1", replaced: false });
	api.myCajas.mockResolvedValueOnce({ registers: [caja("A")], truncated: false, as_of: "" });
	const wrapper = mount(MyCajaPicker, { props: { modelValue: null } });
	await flushPromises();
	await wrapper.get('[data-caja-option="A"]').trigger("click");
	await wrapper.get('[data-test="device-code-input"]').setValue("abcd-2345");
	await wrapper.get("form").trigger("submit");
	await flushPromises();
	expect(wrapper.get('[data-test="device-code-preview"]').text()).toContain("Centro · Caja A");
	expect(api.enrollDevice).not.toHaveBeenCalled();
	await wrapper.get("form").trigger("submit");
	await flushPromises();
	expect(api.enrollDevice).toHaveBeenCalledWith("abcd-2345", "Caja tablet", { terminal_id: "terminal-id-000001", terminal_token: "t".repeat(40) });
	expect(api.myCajas).toHaveBeenCalledTimes(2);
});
