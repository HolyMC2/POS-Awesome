// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { command, commandError, enrollDevice, openCaja } from "../src/posapp/components/pos/registers/foundationApi";

const call = vi.fn();

beforeEach(() => {
	localStorage.clear();
	call.mockReset();
	(window as any).frappe = { call, session: { user: "ana@example.com" } };
	(window as any).__ = (value: string) => value;
});

const sent = (index: number) => call.mock.calls[index][0].args;

it("replays a lost response with the same request ID and forgets it on success", async () => {
	call.mockRejectedValueOnce(new TypeError("Failed to fetch"));
	await expect(command("commands.create_register", "new:S1:MOSTRADOR", { store: "S1", label: "Caja" }))
		.rejects.toMatchObject({ code: "outcome_unknown", retryable: true });
	const first = sent(0).request_id;
	expect(first).toMatch(/^[a-f0-9]{32}$/);
	call.mockResolvedValueOnce({ message: { name: "R1" } });
	await expect(command("commands.create_register", "new:S1:MOSTRADOR", { store: "S1", label: "Caja" })).resolves.toEqual({ name: "R1" });
	expect(sent(1).request_id).toBe(first);
	expect(sent(1).schema_version).toBe(1);
	call.mockResolvedValueOnce({ message: { name: "R2" } });
	await command("commands.create_register", "new:S1:MOSTRADOR", { store: "S1", label: "Caja" });
	expect(sent(2).request_id).not.toBe(first);
});

it("starts a new request when the instruction changes or the server definitively refuses", async () => {
	call.mockRejectedValueOnce(new TypeError("offline"));
	await expect(command("commands.configure_register", "configure:R1:3", { label: "A" })).rejects.toBeTruthy();
	const first = sent(0).request_id;
	call.mockRejectedValueOnce({ message: "Refused", status: 417, response: { posa_error: { code: "validation_failed", retryable: false } } });
	await expect(command("commands.configure_register", "configure:R1:3", { label: "B" })).rejects.toMatchObject({ code: "validation_failed" });
	expect(sent(1).request_id).not.toBe(first);
	call.mockResolvedValueOnce({ message: {} });
	await command("commands.configure_register", "configure:R1:3", { label: "B" });
	expect(sent(2).request_id).not.toBe(sent(1).request_id);
});

it("sends device secrets but never stores them with the pending instruction", async () => {
	call.mockRejectedValueOnce(new TypeError("offline"));
	const secret = { terminal_id: "terminal-0000000001", terminal_token: "s".repeat(48) };
	await expect(openCaja("R1", [{ mode_of_payment: "Cash", amount: 0 }], secret)).rejects.toBeTruthy();
	expect(sent(0).terminal_token).toBe(secret.terminal_token);
	const stored = Object.keys(localStorage).map((key) => localStorage.getItem(key)).join("|");
	expect(stored).toContain("R1");
	expect(stored).not.toContain(secret.terminal_token);
	call.mockRejectedValueOnce(new TypeError("offline"));
	await expect(enrollDevice("abcd-2345", "Tablet", secret)).rejects.toBeTruthy();
	expect(Object.values(localStorage).join("|")).not.toContain(secret.terminal_token);
});

it("maps the server envelope with correlation and next actions", () => {
	const parsed = commandError({ message: "Busy", status: 409, response: { posa_error: {
		code: "revision_conflict", retryable: true, correlation_id: "abc", next_actions: ["refresh"] } } });
	expect(parsed).toEqual({ message: "Busy", code: "revision_conflict", retryable: true, correlationId: "abc", nextActions: ["refresh"] });
});
