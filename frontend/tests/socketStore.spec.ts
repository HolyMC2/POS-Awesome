// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useSocketStore } from "../src/posapp/stores/socketStore";
import { useToastStore } from "../src/posapp/stores/toastStore";

describe("socketStore", () => {
	let handlers: Record<string, (payload: any) => void>;

	beforeEach(() => {
		setActivePinia(createPinia());
		handlers = {};
		vi.stubGlobal("__", (value: string, args?: any[]) => {
			if (!args?.length) return value;
			return value.replace(/\{(\d+)\}/g, (_match, index) => String(args[Number(index)] ?? ""));
		});
		vi.stubGlobal("frappe", {
			realtime: {
				on: vi.fn((event: string, handler: (payload: any) => void) => {
					handlers[event] = handler;
				}),
				// socket.connected gate: the store's wait short-circuits
				// when the realtime socket hasn't completed handshake
				// (real-world failure mode of the /posapp frappe-shim
				// behind WebSocket-unaware proxies). For this test we
				// simulate a healthy connection so the event-driven
				// resolution path is exercised, not the fallback.
				socket: { connected: true, emit: vi.fn() },
			},
			msgprint: vi.fn(),
		});
	});

	it("shows a spinner toast and resolves payment waiters on completion", async () => {
		const socketStore = useSocketStore();
		const toastStore = useToastStore();

		socketStore.init();

		const waitPromise = socketStore.waitForPostSubmitPayments("ACC-SINV-0001", 1000);

		handlers.pos_invoice_processed({
			invoice: "ACC-SINV-0001",
			doctype: "Sales Invoice",
			has_post_submit_payment_work: true,
		});

		expect(toastStore.text).toContain("Invoice Submitted");
		expect(toastStore.loading).toBe(true);
		expect(toastStore.timeout).toBe(-1);
		expect(toastStore.text).toContain("Processing payment entries");

		handlers.pos_post_submit_payments_started({
			invoice: "ACC-SINV-0001",
			doctype: "Sales Invoice",
		});

		handlers.pos_post_submit_payments_completed({
			invoice: "ACC-SINV-0001",
			doctype: "Sales Invoice",
		});

		await expect(waitPromise).resolves.toMatchObject({
			status: "completed",
			doctype: "Sales Invoice",
		});
		expect(toastStore.loading).toBe(false);
		expect(toastStore.text).toContain("Payments Processed");
		expect(toastStore.text).toContain("Payment entries processed");
		// The lifecycle is submit → processing → processed, not the same
		// notification three times: the merge counter must never appear.
		expect(toastStore.text).not.toContain("2×");
	});

	it("shows one toast when the same lifecycle event arrives on both rooms", async () => {
		const socketStore = useSocketStore();
		const toastStore = useToastStore();

		socketStore.init();

		// `_posa_publish_dual` emits to the user room AND the doc room; a client
		// joined to both receives two identical copies. Merged by key, that
		// rendered as "Invoice Submitted (2×)" in prod.
		const payload = { invoice: "ACC-SINV-0002", doctype: "Sales Invoice" };
		handlers.pos_invoice_processed(payload);
		handlers.pos_invoice_processed(payload);

		expect(toastStore.text).toContain("Invoice Submitted");
		expect(toastStore.text).not.toContain("2×");
		expect(toastStore.history.filter((entry) => entry.title === "Invoice Submitted")).toHaveLength(1);

		handlers.pos_post_submit_payments_completed(payload);
		handlers.pos_post_submit_payments_completed(payload);

		expect(toastStore.text).toContain("Payments Processed");
		expect(toastStore.text).not.toContain("2×");
	});

	it("still resolves waiters on the duplicate copy", async () => {
		const socketStore = useSocketStore();
		socketStore.init();

		handlers.pos_invoice_processed({
			invoice: "ACC-SINV-0003",
			doctype: "Sales Invoice",
		});
		handlers.pos_invoice_processed({
			invoice: "ACC-SINV-0003",
			doctype: "Sales Invoice",
		});

		await expect(
			socketStore.waitForInvoiceProcessed("ACC-SINV-0003", 1000),
		).resolves.toMatchObject({ status: "processed" });
	});
});
