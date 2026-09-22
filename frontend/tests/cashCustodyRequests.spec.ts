// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/offline/shiftTerminal", () => ({
	getShiftTerminalContext: () => ({
		terminal_id: "browser",
		terminal_token: "secret",
		terminal_generation: 1,
	}),
}));
import {
	command,
	pendingActions,
	amount,
} from "../src/posapp/components/pos/custody/api";
const call = vi.fn();
beforeEach(() => {
	localStorage.clear();
	call.mockReset();
	(window as any).frappe = { session: { user: "cashier" }, call };
});
describe("cash custody interrupted request recovery", () => {
	it("replays the same request after lost response and reload discovery", async () => {
		call.mockRejectedValueOnce(
			new TypeError("NetworkError"),
		).mockResolvedValueOnce({ message: { movement: "MOVE-1" } });
		const payload = {
			pos_profile: "QA",
			opening_shift: "SHIFT",
			bag: "BAG",
			count: { source: "manual", amount: 1000, reason: "Physical count" },
		};
		await expect(command("receive", payload)).rejects.toThrow(
			"NetworkError",
		);
		const pending = pendingActions("QA");
		expect(pending).toEqual([{ action: "receive", payload }]);
		expect(JSON.stringify(pending)).not.toContain("secret");
		await expect(
			command(pending[0]!.action, pending[0]!.payload),
		).resolves.toEqual({ movement: "MOVE-1" });
		expect(call.mock.calls[0]![0].args.payload.request_id).toBe(
			call.mock.calls[1]![0].args.payload.request_id,
		);
		expect(pendingActions("QA")).toEqual([]);
	});
	it("refuses changed instructions while a result is unknown", async () => {
		call.mockRejectedValue(new TypeError("NetworkError"));
		await expect(
			command("prepare", { pos_profile: "QA", seal: "ONE" }),
		).rejects.toThrow();
		await expect(
			command("prepare", { pos_profile: "QA", seal: "TWO" }),
		).rejects.toThrow("unconfirmed");
		expect(call).toHaveBeenCalledTimes(1);
	});
	it("allows correction after an explicit server refusal", async () => {
		call.mockRejectedValueOnce({
			status: 417,
			serverMessage: "Count mismatch",
		}).mockResolvedValueOnce({ message: { bag: "B" } });
		await expect(
			command("prepare", { pos_profile: "QA", seal: "ONE" }),
		).rejects.toBeTruthy();
		await expect(
			command("prepare", { pos_profile: "QA", seal: "TWO" }),
		).resolves.toEqual({ bag: "B" });
		expect(call.mock.calls[0]![0].args.payload.request_id).not.toBe(
			call.mock.calls[1]![0].args.payload.request_id,
		);
	});
	it("does not replace an unreadable recovery record with a new request", async () => {
		const key = "cash-custody-request:cashier:QA:prepare";
		localStorage.setItem(key, "{damaged");
		await expect(
			command("prepare", { pos_profile: "QA", seal: "ONE" }),
		).rejects.toThrow("Saved cash recovery details");
		expect(call).not.toHaveBeenCalled();
		expect(localStorage.getItem(key)).toBe("{damaged");
	});
	it("does not send when browser storage cannot preserve the retry identity", async () => {
		const storage = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			});
		await expect(
			command("prepare", { pos_profile: "QA", seal: "ONE" }),
		).rejects.toThrow("No cash action was sent");
		expect(call).not.toHaveBeenCalled();
		storage.mockRestore();
	});
	it("sums mixed coin denominations without fractional-cent drift", () => {
		expect(
			amount({
				denominations: [
					{ value: 0.1, quantity: 3 },
					{ value: 0.2, quantity: 1 },
				],
			}),
		).toBe(0.5);
	});
});
