// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memory, initPromise } from "../src/offline/db";
import { getTerminalCredentials } from "../src/offline/shiftTerminal";
import { useClosingRecovery } from "../src/posapp/composables/pos/closing/useClosingRecovery";

let server: Record<string, any>;
let call: ReturnType<typeof vi.fn>;
beforeEach(async () => {
	await initPromise;
	memory.manual_offline = false;
	(window as any).__ = (text: string) => text;
	memory.pos_opening_storage = {
		pos_opening_shift: { name: "OLD-SHIFT" },
	} as any;
	server = {
		opening_shift: "OLD-SHIFT",
		status: "Open",
		owned: false,
		terminal_id: "",
		terminal_generation: 0,
		can_manage: true,
		recovery_pending: false,
	};
	call = vi.fn(async ({ method }: any) => {
		if (
			method.endsWith("claim_terminal") ||
			method.endsWith("transfer_terminal")
		) {
			Object.assign(server, {
				owned: true,
				terminal_id: getTerminalCredentials().terminal_id,
				terminal_generation: 1,
				recovery_pending: true,
			});
		} else if (method.endsWith("resolve_terminal_recovery"))
			server.recovery_pending = false;
		else if (!method.endsWith("get_terminal_status"))
			throw Error(`Unexpected call: ${method}`);
		return { message: { ...server } };
	});
	(window as any).frappe = { call };
});

const mutations = () =>
	call.mock.calls.filter(
		([request]) => !request.method.endsWith("get_terminal_status"),
	);
const reviewed = async () => {
	const recovery = useClosingRecovery();
	await recovery.refresh();
	recovery.reviewed.value = true;
	recovery.reason.value =
		"Checked old browser: no unsynced sales or cash movements remain.";
	return recovery;
};

describe("closing recovery", () => {
	it("lets an ordinary cashier claim a safely released terminal without attesting a review", async () => {
		Object.assign(server, { can_manage: false, terminal_generation: 2 });
		const recovery = useClosingRecovery();
		await recovery.refresh();
		expect(recovery.canRegisterReleased.value).toBe(true);
		await recovery.registerReleased();
		expect(mutations()).toHaveLength(1);
		expect(mutations()[0][0].method).toMatch(/claim_terminal$/);
		expect(mutations()[0][0].args).not.toHaveProperty("acknowledge_legacy");
		expect(mutations()[0][0].args).not.toHaveProperty("acknowledge_saved_work");
	});

	it.each([
		{ terminal_generation: 0 },
		{ terminal_generation: 2, terminal_id: "another-browser" },
		{ terminal_generation: 2, recovery_pending: true },
	])("does not let a cashier register a legacy, owned, or unreviewed shift: %j", async (state) => {
		Object.assign(server, state, { can_manage: false });
		const recovery = useClosingRecovery();
		await recovery.refresh();
		await recovery.registerReleased();
		expect(mutations()).toHaveLength(0);
	});

	it("rechecks released ownership before claiming to prevent a stale-screen takeover", async () => {
		Object.assign(server, { can_manage: false, terminal_generation: 2 });
		const recovery = useClosingRecovery();
		await recovery.refresh();
		server.terminal_id = "another-browser";
		await recovery.registerReleased();
		expect(mutations()).toHaveLength(0);
		expect(recovery.error.value).toContain("shift changed");
	});

	it("withdraws readiness when refreshing an owned browser fails", async () => {
		Object.assign(server, { owned: true, terminal_generation: 2, terminal_id: getTerminalCredentials().terminal_id });
		const recovery = useClosingRecovery();
		await recovery.refresh();
		expect(recovery.ready.value).toBe(true);
		call.mockRejectedValueOnce(new Error("Connection interrupted"));
		await recovery.refresh();
		expect(recovery.ready.value).toBe(false);
	});
	it("automatically refreshes stale local ownership without registering or attesting", async () => {
		Object.assign(server, {
			owned: true,
			terminal_generation: 2,
			terminal_id: getTerminalCredentials().terminal_id,
		});
		const recovery = useClosingRecovery();
		await recovery.refresh();
		expect(recovery.ready.value).toBe(true);
		expect(memory.pos_opening_storage?.terminal_status?.owned).toBe(true);
		expect(mutations()).toHaveLength(0);
	});

	it("never silently registers an old shift or claims that saved work was reviewed", async () => {
		const recovery = useClosingRecovery();
		await recovery.refresh();
		await recovery.recover();
		expect(recovery.ready.value).toBe(false);
		expect(mutations()).toHaveLength(0);
	});

	it("combines registration and review after a supervisor explicitly records the check", async () => {
		const recovery = await reviewed();
		await recovery.recover();
		expect(
			mutations().map(([request]) => request.method.split(".").pop()),
		).toEqual(["claim_terminal", "resolve_terminal_recovery"]);
		expect(mutations()[1][0].args.reason).toBe(recovery.reason.value);
		expect(recovery.ready.value).toBe(true);
	});

	it("does not offer a supervisor operation to a cashier", async () => {
		server.can_manage = false;
		const recovery = await reviewed();
		await recovery.recover();
		expect(mutations()).toHaveLength(0);
	});

	it("resumes a partial recovery from server status instead of registering twice", async () => {
		const recovery = await reviewed();
		const normal = call.getMockImplementation()!;
		let failed = false;
		call.mockImplementation(async (request: any) => {
			if (
				request.method.endsWith("resolve_terminal_recovery") &&
				!failed
			) {
				failed = true;
				throw Error("Review could not be saved. Try again.");
			}
			return normal(request);
		});
		await recovery.recover();
		expect(recovery.ready.value).toBe(false);
		expect(recovery.error.value).toContain("Review could not be saved");
		await recovery.recover();
		expect(
			mutations().filter(([request]) =>
				request.method.endsWith("claim_terminal"),
			),
		).toHaveLength(1);
		expect(recovery.ready.value).toBe(true);
	});

	it("does not repeat a mutation when its success response was lost", async () => {
		const recovery = await reviewed();
		const normal = call.getMockImplementation()!;
		call.mockImplementation(async (request: any) => {
			const response = await normal(request);
			if (request.method.endsWith("claim_terminal"))
				throw Error("Connection interrupted");
			return response;
		});
		await recovery.recover();
		await recovery.recover();
		expect(
			mutations().filter(([request]) =>
				request.method.endsWith("claim_terminal"),
			),
		).toHaveLength(1);
		expect(recovery.ready.value).toBe(true);
	});

	it("stops if the shift changed or closed during review", async () => {
		const recovery = await reviewed();
		server.status = "Closed";
		await recovery.recover();
		expect(recovery.error.value).toContain("shift changed");
		expect(mutations()).toHaveLength(0);
	});

	it("explains a disconnected browser without attempting recovery", async () => {
		const recovery = await reviewed();
		memory.manual_offline = true;
		await recovery.recover();
		expect(recovery.error.value).toContain("Connect to the internet");
		expect(mutations()).toHaveLength(0);
	});
});
