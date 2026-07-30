// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useSocketStore } from "../src/posapp/stores/socketStore";

const realtimeHandlers = new Map<string, (payload: any) => void>();
let emitSpy: ReturnType<typeof vi.fn>;

// These waits are started only to observe the room they subscribe to; no
// event ever arrives, so each one times out after the test has finished.
// Swallow that so it doesn't surface as an unhandled rejection.
const expectTimeout = (promise: Promise<unknown>) => promise.catch(() => undefined);

const installFrappe = ({ connected = true } = {}) => {
	realtimeHandlers.clear();
	emitSpy = vi.fn();
	(globalThis as any).frappe = {
		realtime: {
			socket: { connected },
			emit: emitSpy,
			on: (event: string, handler: (payload: any) => void) => {
				realtimeHandlers.set(event, handler);
			},
		},
		msgprint: vi.fn(),
	};
	(globalThis as any).__ = (value: string) => value;
};

describe("socketStore doc-room subscriptions", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		installFrappe();
	});

	it("joins the POS Invoice room when the caller submits POS Invoices", () => {
		const store = useSocketStore();

		void expectTimeout(store.waitForInvoiceProcessed("ACC-PINV-0001", 50, "POS Invoice"));

		// Defaulting to "Sales Invoice" put these tills in a room the backend
		// never publishes to, so every background sale burned the full wait.
		expect(emitSpy).toHaveBeenCalledWith(
			"doc_subscribe",
			"POS Invoice",
			"ACC-PINV-0001",
		);
	});

	it("keeps Sales Invoice as the default when no doctype is supplied", () => {
		const store = useSocketStore();

		void expectTimeout(store.waitForInvoiceProcessed("ACC-SINV-0001", 50));

		expect(emitSpy).toHaveBeenCalledWith(
			"doc_subscribe",
			"Sales Invoice",
			"ACC-SINV-0001",
		);
	});

	it("falls back to Sales Invoice for a blank doctype rather than an empty room", () => {
		const store = useSocketStore();

		void expectTimeout(store.waitForInvoiceProcessed("ACC-SINV-0002", 50, "   "));

		expect(emitSpy).toHaveBeenCalledWith(
			"doc_subscribe",
			"Sales Invoice",
			"ACC-SINV-0002",
		);
	});

	it("carries the doctype into the post-submit payment wait too", () => {
		const store = useSocketStore();

		void expectTimeout(store.waitForPostSubmitPayments("ACC-PINV-0003", 50, "POS Invoice"));

		expect(emitSpy).toHaveBeenCalledWith(
			"doc_subscribe",
			"POS Invoice",
			"ACC-PINV-0003",
		);
	});

	it("does not subscribe at all when the realtime socket is down", async () => {
		installFrappe({ connected: false });
		const store = useSocketStore();

		// Resolves optimistically; the caller's DB check is the real gate.
		await expect(
			store.waitForInvoiceProcessed("ACC-SINV-0004", 50, "POS Invoice"),
		).resolves.toMatchObject({ status: "processed" });
		expect(emitSpy).not.toHaveBeenCalled();
	});
});

describe("socketStore bounded history", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		installFrappe();
	});

	it("keeps only the most recent sales instead of growing all shift", () => {
		const store = useSocketStore();
		store.init();
		const onProcessed = realtimeHandlers.get("pos_invoice_processed")!;

		for (let i = 0; i < 260; i += 1) {
			onProcessed({ invoice: `INV-${String(i).padStart(4, "0")}` });
		}

		const keys = Object.keys(store.processedInvoices);
		expect(keys.length).toBe(200);
		// Oldest dropped, newest retained.
		expect(keys).not.toContain("INV-0000");
		expect(keys).toContain("INV-0259");
	});

	it("bounds the post-submit payment map as well", () => {
		const store = useSocketStore();
		store.init();
		const onCompleted = realtimeHandlers.get("pos_post_submit_payments_completed")!;

		for (let i = 0; i < 240; i += 1) {
			onCompleted({ invoice: `PAY-${String(i).padStart(4, "0")}` });
		}

		expect(Object.keys(store.postSubmitPayments).length).toBe(200);
	});

	it("leaves a normal shift's worth of sales untouched", () => {
		const store = useSocketStore();
		store.init();
		const onProcessed = realtimeHandlers.get("pos_invoice_processed")!;

		for (let i = 0; i < 40; i += 1) {
			onProcessed({ invoice: `INV-${i}` });
		}

		expect(Object.keys(store.processedInvoices).length).toBe(40);
		expect(store.processedInvoices["INV-0"]?.status).toBe("processed");
	});
});
