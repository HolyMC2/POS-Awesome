import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const offlineState = vi.hoisted(() => ({
	openingStorage: null as any,
	pendingOfflineCount: 0,
	offline: false,
	clearOpeningStorage: vi.fn(() => {
		offlineState.openingStorage = null;
	}),
}));

vi.mock("../src/offline/index", () => ({
	initPromise: Promise.resolve(),
	checkDbHealth: vi.fn(),
	getOpeningStorage: vi.fn(() => offlineState.openingStorage),
	setOpeningStorage: vi.fn((value) => {
		offlineState.openingStorage = value;
	}),
	clearOpeningStorage: offlineState.clearOpeningStorage,
	setTaxTemplate: vi.fn(),
	isOffline: vi.fn(() => offlineState.offline),
	getPendingOfflineInvoiceCount: vi.fn(() => offlineState.pendingOfflineCount),
	getBootstrapSnapshot: vi.fn(() => null),
	setBootstrapSnapshot: vi.fn(),
}));

vi.mock("../src/offline/bootstrapSnapshot", () => ({
	createBootstrapSnapshotFromRegisterData: vi.fn(() => ({})),
}));

const pendingWork = vi.hoisted(() => vi.fn(async () => offlineState.pendingOfflineCount));
vi.mock("../src/offline/shiftTerminal", () => ({ getTerminalCredentials: () => ({}), getShiftTerminalContext: () => ({}) }));
vi.mock("../src/offline/shiftQueueGuard", () => ({ getPendingShiftWorkCount: pendingWork }));

import {
	buildSkippedClosingInvoicesPrompt,
	usePosShift,
} from "../src/posapp/composables/pos/shared/usePosShift";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { useToastStore } from "../src/posapp/stores/toastStore";
import { useClosingFlowStore } from "../src/posapp/stores/closingFlowStore";

describe("usePosShift closing warnings", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		offlineState.openingStorage = null;
		offlineState.pendingOfflineCount = 0;
		offlineState.offline = false;
		offlineState.clearOpeningStorage.mockClear();
		pendingWork.mockReset().mockImplementation(async () => offlineState.pendingOfflineCount);
		vi.stubGlobal("frappe", {
			session: { user: "test@example.com" },
			datetime: { nowdate: () => "2026-04-28" },
			call: vi.fn(),
			realtime: { emit: vi.fn() },
		});
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.spyOn(console, "info").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("includes invoice and cancelled return reference details in the warning prompt", () => {
		vi.stubGlobal("window", {
			__: (value: string) => value,
		});

		const message = buildSkippedClosingInvoicesPrompt([
			{
				invoice: "SINV-RET-0001",
				doctype: "Sales Invoice",
				return_against: "ACC-SINV-2026-00222",
			},
		]);

		expect(message).toContain(
			"1 printed return invoice references a cancelled invoice and will be excluded from closing.",
		);
		expect(message).toContain("SINV-RET-0001");
		expect(message).toContain("ACC-SINV-2026-00222");
		expect(message).toContain("The skipped invoice will remain a draft.");
		expect(message).toContain("Do you want to proceed?");
	});

	it("uses shared opening shift state when local close-shift state is empty", async () => {
		const uiStore = useUIStore();
		uiStore.posOpeningShift = { name: "POS-OPEN-0002" };
		(globalThis as any).frappe.call = vi.fn(() =>
			Promise.resolve({
				message: {
					name: "POS-CLOSE-0002",
				},
			}),
		);

		const shift = usePosShift();
		await shift.get_closing_data();

		expect((globalThis as any).frappe.call).toHaveBeenCalledWith(
			"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.make_closing_shift_from_opening",
			{ opening_shift: uiStore.posOpeningShift },
		);
	});

	it("blocks closing while offline sales are still queued", async () => {
		vi.stubGlobal("window", { __: (value: string) => value });
		const uiStore = useUIStore();
		uiStore.posOpeningShift = { name: "POS-OPEN-0004" };
		offlineState.pendingOfflineCount = 3;
		(globalThis as any).frappe.call = vi.fn();

		const shift = usePosShift();
		await shift.get_closing_data();

		// Must NOT prepare a closing shift while unsynced sales exist.
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("blocks closing while offline (reconnect first)", async () => {
		vi.stubGlobal("window", { __: (value: string) => value });
		const uiStore = useUIStore();
		uiStore.posOpeningShift = { name: "POS-OPEN-0005" };
		offlineState.offline = true;
		(globalThis as any).frappe.call = vi.fn();

		const shift = usePosShift();
		await shift.get_closing_data();

		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("checks durable pending work again if money is saved after opening the closing dialog", async () => {
		const uiStore = useUIStore();
		uiStore.posOpeningShift = { name: "OPEN-1", pos_profile: "COUNTER" };
		(globalThis as any).frappe.call = vi.fn(async () => ({ message: { name: "CLOSE-1" } }));
		const shift = usePosShift();
		await shift.get_closing_data();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
		offlineState.pendingOfflineCount = 1;
		await shift.submit_closing_pos({ name: "CLOSE-1", pos_opening_shift: "OPEN-1" });
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
		expect(uiStore.posOpeningShift).not.toBeNull();
	});

	it.each(["prepare", "submit"])("fails closed when durable storage cannot be read at %s", async (step) => {
		useUIStore().posOpeningShift = { name: "OPEN-1" };
		pendingWork.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
		const shift = usePosShift();
		if (step === "prepare") await shift.get_closing_data();
		else await shift.submit_closing_pos({ name: "CLOSE-1", pos_opening_shift: "OPEN-1" });
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("rechecks connectivity at final submit", async () => {
		offlineState.offline = true;
		await usePosShift().submit_closing_pos({ name: "CLOSE-1", pos_opening_shift: "OPEN-1" });
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("keeps counts and the actionable error after a refused submission", async () => {
		vi.stubGlobal("window", { __: (value: string) => value });
		const flow = useClosingFlowStore();
		flow.draft = { pos_opening_shift: "OPEN-1", payment_reconciliation: [{ mode_of_payment: "Cash", closing_amount: 1200 }] };
		(globalThis as any).frappe.call = vi.fn().mockRejectedValue(new Error("Review a saved payment before closing."));
		await usePosShift().submit_closing_pos(flow.draft);
		expect(flow.error).toContain("Review a saved payment");
		expect(flow.draft.payment_reconciliation[0].closing_amount).toBe(1200);
		expect(flow.completed).toBe(false);
		expect(flow.submitting).toBe(false);
	});

	it("confirms a committed closing after its response was lost without submitting twice", async () => {
		vi.stubGlobal("window", { __: (value: string) => value });
		const call = vi.fn(async (method: string) => {
			if (method.endsWith("submit_closing_shift")) throw new TypeError("NetworkError when attempting to fetch resource.");
			if (method === "frappe.client.get_value") return { message: { name: "CLOSE-1", docstatus: 1, pos_opening_shift: "OPEN-1" } };
			return { message: null };
		});
		(globalThis as any).frappe.call = call;
		await usePosShift().submit_closing_pos({ pos_opening_shift: "OPEN-1" });
		expect(useClosingFlowStore().completed).toBe(true);
		expect(call.mock.calls.filter(([method]) => method.endsWith("submit_closing_shift"))).toHaveLength(1);
	});

	it.each([null, { name: "DRAFT", docstatus: 0, pos_opening_shift: "OPEN-1" }, { name: "OTHER", docstatus: 1, pos_opening_shift: "OPEN-2" }])("does not treat an unverified closing as success: %j", async (record) => {
		vi.stubGlobal("window", { __: (value: string) => value });
		const flow = useClosingFlowStore();
		flow.draft = { pos_opening_shift: "OPEN-1", payment_reconciliation: [{ closing_amount: 1200 }] };
		(globalThis as any).frappe.call = vi.fn(async (method: string) => {
			if (method === "frappe.client.get_value") return { message: record };
			throw new TypeError("NetworkError when attempting to fetch resource.");
		});
		await usePosShift().submit_closing_pos(flow.draft);
		expect(flow.completed).toBe(false);
		expect(flow.error).toContain("may already be closed");
		expect(flow.draft.payment_reconciliation[0].closing_amount).toBe(1200);
	});

	it("does not send a second close request while the first is pending", async () => {
		let finish: (value: unknown) => void = () => {};
		(globalThis as any).frappe.call = vi.fn((method: string) => method === "frappe.client.get_value" ? Promise.resolve({ message: null }) : new Promise((resolve) => { finish = resolve; }));
		const shift = usePosShift();
		const first = shift.submit_closing_pos({ pos_opening_shift: "OPEN-1" });
		await vi.waitFor(() => expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1));
		await shift.submit_closing_pos({ pos_opening_shift: "OPEN-1" });
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
		finish({ message: null });
		await first;
		expect(useClosingFlowStore().submitting).toBe(false);
	});

	it("puts draft review in the screen and preserves counts when totals are refreshed", async () => {
		vi.stubGlobal("window", { __: (value: string) => value, confirm: vi.fn() });
		useUIStore().posOpeningShift = { name: "OPEN-1" };
		const flow = useClosingFlowStore();
		flow.draft = { pos_opening_shift: "OPEN-1", payment_reconciliation: [{ mode_of_payment: "Cash", closing_amount: 1200 }], posa_difference_note: "Drawer checked" };
		(globalThis as any).frappe.call = vi.fn(async () => ({ message: {
			closing_shift: { pos_opening_shift: "OPEN-1", payment_reconciliation: [{ mode_of_payment: "Cash", expected_amount: 1100, closing_amount: 0 }] },
			pending_drafts: [{ name: "DRAFT-1" }], drafts_will_be_deleted: true,
		} }));
		await usePosShift().get_closing_data();
		expect((window as any).confirm).not.toHaveBeenCalled();
		expect(flow.reviewRequired).toBe(true);
		expect(flow.reviewAccepted).toBe(false);
		expect(flow.draft.payment_reconciliation[0]).toMatchObject({ closing_amount: 1200, expected_amount: 1100 });
		expect(flow.draft.posa_difference_note).toBe("Drawer checked");
	});

	it("explains terminal recovery when closing an unregistered legacy shift", async () => {
		vi.stubGlobal("window", { __: (value: string) => value });
		const opening = { name: "LEGACY-OPEN", posa_terminal_generation: 0 };
		useUIStore().posOpeningShift = opening;
		const reason = "This browser must own the shift before saving work. Open Offline Status to register or recover this terminal.";
		pendingWork.mockRejectedValueOnce(new Error(reason));
		await usePosShift().submit_closing_pos({ pos_opening_shift: opening.name });
		expect(useToastStore().text).toContain(reason);
		expect(useToastStore().text).not.toContain("Reconnect and retry");
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
		expect(useUIStore().posOpeningShift).toEqual(opening);
	});

	it("clears shared opening shift and invoice state after closing shift submit", async () => {
		const uiStore = useUIStore();
		const invoiceStore = useInvoiceStore();
		uiStore.posOpeningShift = { name: "POS-OPEN-0003" };
		invoiceStore.setAdditionalDiscount(75);
		offlineState.openingStorage = {
			pos_opening_shift: { name: "POS-OPEN-0003" },
		};
		(globalThis as any).frappe.call = vi.fn((method: string) => {
			if (method.includes("submit_closing_shift")) {
				return Promise.resolve({
					message: {
						name: "POS-CLOSE-0003",
					},
				});
			}
			return Promise.resolve({ message: null });
		});

		const shift = usePosShift();
		shift.pos_opening_shift.value = { name: "POS-OPEN-0003" };
		shift.pos_profile.value = { name: "Main POS" };
		shift.submit_closing_pos({ name: "POS-CLOSE-0003" });
		await Promise.resolve();
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(uiStore.posOpeningShift).toBeNull();
		expect(invoiceStore.additionalDiscount).toBe(0);
		expect(offlineState.clearOpeningStorage).toHaveBeenCalled();
	});
});
