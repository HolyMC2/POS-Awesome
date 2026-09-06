// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { memory, initPromise } from "../src/offline/db";
import { getTerminalCredentials } from "../src/offline/shiftTerminal";
import ShiftTerminalStatus from "../src/posapp/components/navbar/ShiftTerminalStatus.vue";

beforeEach(async () => {
    await initPromise;
    memory.pos_opening_storage = null;
    memory.manual_offline = false;
    (window as any).__ = (text: string) => text;
});

it("lets a supervisor without an own opening authorize this browser for a selected cashier", async () => {
    const proof = getTerminalCredentials();
    const call = vi.fn(async ({ method, args }: any) => {
        if (method.endsWith("list_manageable_open_shifts")) return { message: { can_manage: true, shifts: [
            { name: "OTHER-OPEN", user: "cashier@example.com", pos_profile: "COUNTER" },
        ] } };
        if (method.endsWith("get_terminal_status")) return { message: { owned: false, recovery_pending: false } };
        if (method.endsWith("transfer_terminal")) return { message: { owned: true, recovery_pending: true } };
        throw new Error("Unexpected call " + method);
    });
    (window as any).frappe = { session: { user: "manager@example.com" }, call };
    const wrapper = mount(ShiftTerminalStatus);
    await flushPromises();
    expect(wrapper.find('[data-test="manager-terminal-selector"]').exists()).toBe(true);
    await wrapper.get('[data-test="manager-shift-select"]').setValue("OTHER-OPEN");
    await flushPromises();
    await wrapper.get('[data-test="manager-shift-reason"]').setValue("Original device failed; collected receipts retained for review");
    await wrapper.get('[data-test="manager-shift-ack"]').setValue(true);
    await wrapper.get('[data-test="manager-shift-transfer"]').trigger("click");
    await flushPromises();
    const transfer = call.mock.calls.find(([request]) => request.method.endsWith("transfer_terminal"))[0];
    expect(transfer.args).toMatchObject({ opening_shift: "OTHER-OPEN", ...proof, acknowledge_saved_work: 1 });
    expect(wrapper.get('[data-test="manager-shift-handoff"]').text()).toContain("cashier sign in here");
    expect(memory.pos_opening_storage).toBeNull();
    (window as any).frappe.session.user = "cashier@example.com";
    expect(getTerminalCredentials()).toEqual(proof);
    wrapper.unmount();
});
