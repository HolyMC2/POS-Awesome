// @vitest-environment jsdom
//
// Frappe's `frappe.call` contract is callback-OR-promise, not both. The
// shim was throwing AFTER calling the `error` callback on non-2xx
// responses, which (a) double-signalled the error and (b) landed in
// window.onunhandledrejection as "Uncaught (in promise) Error: HTTP …"
// for errors that were already handled cleanly via the callback path.
// The fix: when the caller passed an `error` callback, swallow the
// throw. This spec pins that contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFrappeShim } from "../src/posapp/utils/frappe-shim";
import api from "../src/posapp/services/api";

describe("frappe-shim error-callback contract", () => {
	beforeEach(() => {
		(window as any).posawesome_boot = {
			user: "playwright-bot@lab.xoloitzcuintles.com",
			lang: "en",
			sysdefaults: {},
		};
		(window as any).posawesome_csrf_token = "test-csrf";
		(window as any).posawesome_build_version = "test-build";
		installFrappeShim();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete (window as any).frappe;
		delete (window as any).posawesome_boot;
		// installFrappeShim() is idempotent via __posa_shim_installed;
		// drop the marker so the next test's install actually runs.
		delete (window as any).__posa_shim_installed;
	});

	it("invokes the error callback AND resolves silently on non-2xx (no unhandled rejection)", async () => {
		const errCb = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					exception: "PermissionError: nope",
					_server_messages: '["{\\"message\\":\\"nope\\"}"]',
					_error_message: "nope",
				}),
				{ status: 403, headers: { "Content-Type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		// MUST resolve, not reject. The error callback is the signal.
		const result = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.invoices.submit_invoice",
			args: { invoice: "{}", data: "{}" },
			error: errCb,
		});

		expect(errCb).toHaveBeenCalledTimes(1);
		const err = errCb.mock.calls[0][0];
		// Error carries the parsed body so callers (api.normalize…) can
		// surface the real server message in the toast.
		expect(err.status).toBe(403);
		expect(err.response).toMatchObject({
			exception: expect.stringContaining("PermissionError"),
		});
		// And the call itself resolves to null — the caller chose the
		// callback path; the promise is just a void completion signal.
		expect(result).toBeNull();
	});

	it("STILL throws on non-2xx when caller did NOT pass an error callback (promise contract)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("{}", { status: 500 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			(window as any).frappe.call({
				method: "posawesome.posawesome.api.invoices.submit_invoice",
				args: {},
				// no `error:` cb — caller wants the promise-rejection signal
			}),
		).rejects.toThrow(/HTTP 500/);
	});

	it("handles a network failure once through the error callback without calling success", async () => {
		const failure = new TypeError("Failed to fetch");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
		const error = vi.fn();
		const callback = vi.fn();
		await expect((window as any).frappe.call({ method: "pos.test", error, callback })).resolves.toBeNull();
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith(failure);
		expect(callback).not.toHaveBeenCalled();
	});

	it("preserves awaited network rejection when no error callback owns it", async () => {
		const failure = new TypeError("Failed to fetch");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
		await expect((window as any).frappe.call("pos.test", {})).rejects.toBe(failure);
	});

	it("retains API envelope failure and awaited API rejection through the real shim", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		expect(await api.callEnvelope("pos.test")).toMatchObject({ ok: false, error: { retryable: true } });
		await expect(api.call("pos.test")).rejects.toThrow("Failed to fetch");
		// Allow ignored internal promises to settle: Vitest must see no unhandled error.
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("does not swallow defects thrown by an error callback", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		const defect = new Error("callback defect");
		await expect((window as any).frappe.call({ method: "pos.test", error: () => { throw defect; } })).rejects.toBe(defect);
	});
});
