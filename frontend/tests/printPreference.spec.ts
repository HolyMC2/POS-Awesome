// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePosPrintPreference } from "../src/posapp/services/printPreference";

/**
 * doco's `get_my_preference` accepts GET only; a POST is refused with 403 and
 * the register silently printed with the profile defaults. The call must ask
 * with GET, and anything the server does not answer keeps the legacy values.
 */
describe("resolvePosPrintPreference", () => {
	const legacy = { print_format: "Standard", backend: "system_dialog" as const };
	let call: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		call = vi.fn();
		vi.stubGlobal("frappe", { call });
		localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reads the preference with GET", async () => {
		localStorage.setItem("doco_print_terminal_id", "till-2");
		call.mockResolvedValue({ message: { values: { print_format: "Ticket 80mm", copies: 2 } } });

		const resolved = await resolvePosPrintPreference("Sales Invoice", legacy);

		expect(call).toHaveBeenCalledTimes(1);
		expect(call.mock.calls[0][0]).toMatchObject({
			method: "doco.docoutils.printing.preferences.get_my_preference",
			type: "GET",
			args: { surface: "posawesome", target_doctype: "Sales Invoice", terminal_key: "till-2" },
		});
		expect(resolved).toEqual({ ...legacy, print_format: "Ticket 80mm", copies: 2 });
	});

	it("keeps the legacy values when the server refuses", async () => {
		call.mockRejectedValue(new Error("HTTP 403"));

		await expect(resolvePosPrintPreference("Sales Invoice", legacy)).resolves.toEqual(legacy);
	});
});
