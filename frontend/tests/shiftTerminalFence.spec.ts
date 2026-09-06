// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie/dist/dexie.mjs";
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, initPromise, memory } from "../src/offline/db";
import { getPendingShiftWorkCount } from "../src/offline/shiftQueueGuard";
import { assertTerminalEnqueueAllowed, getTerminalCredentials, terminalFenceKey } from "../src/offline/shiftTerminal";
import ShiftTerminalStatus from "../src/posapp/components/navbar/ShiftTerminalStatus.vue";

const scope = { name: "FENCE-OPEN", user: "fence-cashier@example.com", pos_profile: "FENCE-COUNTER" };
const key = terminalFenceKey(scope.name);
let server: any;
let call: ReturnType<typeof vi.fn>;
let wrapper: ReturnType<typeof mount> | undefined;

beforeEach(async () => {
    await initPromise;
    await db.table("write_queue").clear();
    await db.table("invoice_outbox").clear();
    await db.table("keyval").delete(key);
    memory.manual_offline = false;
    for (const name of ["offline_invoices", "offline_customers", "offline_payments", "offline_cash_movements"]) memory[name] = [];
    const proof = getTerminalCredentials();
    server = { opening_shift: scope.name, terminal_id: proof.terminal_id, terminal_generation: 1,
        status: "Open", owned: true, can_manage: false, recovery_pending: false };
    memory.pos_opening_storage = { pos_profile: { name: scope.pos_profile },
        pos_opening_shift: { ...scope, posa_terminal_id: proof.terminal_id, posa_terminal_generation: 1 },
        terminal_status: { ...server } };
    call = vi.fn(async ({ method }: any) => {
        if (method.endsWith("list_manageable_open_shifts")) return { message: { can_manage: false, shifts: [] } };
        if (method.endsWith("get_terminal_status")) return { message: { ...server } };
        throw Error("Unexpected call " + method);
    });
    (window as any).__ = (value: string) => value;
    (window as any).frappe = { session: { user: scope.user }, call };
    // The exact durable write performed before dispatching final close.
    expect(await getPendingShiftWorkCount(scope, true)).toBe(0);
});

afterEach(() => { wrapper?.unmount();wrapper = undefined;vi.restoreAllMocks(); });
const enqueue = () => assertTerminalEnqueueAllowed({ invoice: { posa_pos_opening_shift: scope.name } });
async function openPanel() {
    wrapper = mount(ShiftTerminalStatus);
    await flushPromises();
    expect(wrapper.get('[data-test="terminal-resume"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-test="manager-terminal-selector"]').exists()).toBe(false);
    return wrapper;
}

it("offers cashier resume after uncertain close and keeps the fence until old close proof is revoked", async () => {
    const panel = await openPanel();
    await expect(enqueue()).rejects.toThrow("closing or being released");
    const normal = call.getMockImplementation()!;
    call.mockImplementation(async (request: any) => {
        if (!request.method.endsWith("resume_terminal")) return normal(request);
        expect(request.args).toMatchObject({ opening_shift: scope.name, terminal_generation: 1, drained: 1,
            ...getTerminalCredentials() });
        expect(await db.table("keyval").get(key)).toBeTruthy();
        server.terminal_generation = 2;
        return { message: { ...server } };
    });
    await panel.get('[data-test="terminal-resume"]').trigger("click");
    await vi.waitFor(() => expect(panel.findAll("button").find(b => b.text() === "Check terminal status")!.attributes("disabled")).toBeUndefined());
    await flushPromises();
    expect(await db.table("keyval").get(key)).toBeUndefined();
    expect(memory.pos_opening_storage.pos_opening_shift.posa_terminal_generation).toBe(2);
    await expect(enqueue()).resolves.toBeUndefined();
});

it("keeps a lost resume reply fenced and lets the cashier check status before retrying", async () => {
    const panel = await openPanel();
    const normal = call.getMockImplementation()!;
    let replies = 0;
    call.mockImplementation(async (request: any) => {
        if (!request.method.endsWith("resume_terminal")) return normal(request);
        server.terminal_generation += 1;
        if (++replies === 1) throw Error("Reply lost after commit");
        return { message: { ...server } };
    });
    await panel.get('[data-test="terminal-resume"]').trigger("click");
    await vi.waitFor(() => expect(panel.findAll("button").find(b => b.text() === "Check terminal status")!.attributes("disabled")).toBeUndefined());
    await flushPromises();
    await expect(enqueue()).rejects.toThrow("closing or being released");
    expect(panel.get('[role="alert"]').text()).toContain("Reply lost");
    const refresh = panel.findAll("button").find(button => button.text() === "Check terminal status")!;
    await refresh.trigger("click");await flushPromises();
    expect(await db.table("keyval").get(key)).toBeTruthy();
    await panel.get('[data-test="terminal-resume"]').trigger("click");
    await vi.waitFor(() => expect(panel.findAll("button").find(b => b.text() === "Check terminal status")!.attributes("disabled")).toBeUndefined());
    await flushPromises();
    expect(await db.table("keyval").get(key)).toBeUndefined();
    await expect(enqueue()).resolves.toBeUndefined();
});

it("keeps the fence when a concurrent close commits before post-resume status refresh", async () => {
    const panel = await openPanel();
    const normal = call.getMockImplementation()!;
    call.mockImplementation(async (request: any) => {
        if (!request.method.endsWith("resume_terminal")) return normal(request);
        const response = { ...server, terminal_generation: 2 };
        server = { ...response, status: "Closed" };
        return { message: response };
    });
    await panel.get('[data-test="terminal-resume"]').trigger("click");
    await vi.waitFor(() => expect(panel.findAll("button").find(b => b.text() === "Check terminal status")!.attributes("disabled")).toBeUndefined());
    await flushPromises();
    expect(await db.table("keyval").get(key)).toBeTruthy();
    await expect(enqueue()).rejects.toThrow("closing or being released");
});

it("does not delete another tab's new closing fence interleaved with resume recovery", async () => {
    const panel = await openPanel();
    const normal = call.getMockImplementation()!;
    call.mockImplementation(async (request: any) => {
        if (!request.method.endsWith("resume_terminal")) return normal(request);
        server.terminal_generation = 2;
        return { message: { ...server } };
    });
    const table = db.table("keyval");
    const read = table.get.bind(table);
    let armed = true;
    let competing: Promise<unknown> | undefined;
    vi.spyOn(table, "get").mockImplementation((name: any) => read(name).then((result) => {
        if (name === key && server.terminal_generation === 2 && armed) {
            armed = false;
            // A separate tab's transaction queues after this read. It must
            // either precede the conditional read or follow the atomic delete.
            competing = Dexie.ignoreTransaction(() => db.transaction("rw", table,
                () => table.put({ key, value: { generation: 2, created_at: Date.now() } })));
        }
        return result;
    }));
    await panel.get('[data-test="terminal-resume"]').trigger("click");
    await vi.waitFor(() => expect(panel.findAll("button").find(b => b.text() === "Check terminal status")!.attributes("disabled")).toBeUndefined());
    await competing;
    expect(armed).toBe(false);
    expect((await read(key))?.value.generation).toBe(2);
    await expect(enqueue()).rejects.toThrow("closing or being released");
});

it.each(["cashier", "profile", "shift"])("retains the fence when the active %s changes while resume is in flight", async (changed) => {
    const panel = await openPanel();
    const normal = call.getMockImplementation()!;
    call.mockImplementation(async (request: any) => {
        if (!request.method.endsWith("resume_terminal")) return normal(request);
        server.terminal_generation = 2;
        if (changed === "cashier") (window as any).frappe.session.user = "other@example.com";
        if (changed === "profile") memory.pos_opening_storage.pos_profile.name = "OTHER";
        if (changed === "shift") memory.pos_opening_storage.pos_opening_shift.name = "OTHER-OPEN";
        return { message: { ...server } };
    });
    await panel.get('[data-test="terminal-resume"]').trigger("click");
    await vi.waitFor(() => expect(panel.findAll("button").find(b => b.text() === "Check terminal status")!.attributes("disabled")).toBeUndefined());
    expect(await db.table("keyval").get(key)).toBeTruthy();
});
