import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaymentSubmission } from "../src/posapp/composables/pos/payments/usePaymentSubmission";
import { ApiEnvelopeError } from "../src/posapp/services/api";

vi.mock("../src/offline/index", () => ({
	isOffline: vi.fn(() => false),
	saveOfflineInvoice: vi.fn(),
	updateLocalStock: vi.fn(),
}));

vi.mock("../src/posapp/services/invoiceService", () => ({
	default: { submitInvoice: vi.fn() },
}));

vi.mock("../src/posapp/utils/stockCoordinator", () => ({
	default: { applyInvoiceConsumption: vi.fn() },
}));

const timestampMismatch = () =>
	new ApiEnvelopeError({
		ok: false,
		data: null,
		error: {
			code: "TIMESTAMP_MISMATCH",
			message: "Document has been modified after you have opened it",
			retryable: false,
		},
		requestId: "req-mismatch-1",
		serverTime: "2026-07-30T06:00:00Z",
	});

const buildSubmission = (
	overrides: { docstatus?: number; uiStore?: any; toastStore?: any } = {},
) => {
	const invoiceDoc = ref<any>({
		name: "ACC-SINV-DUP",
		doctype: "Sales Invoice",
		is_return: 0,
		items: [{ item_code: "ITEM-1", qty: 1 }],
		payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
		rounded_total: 100,
		grand_total: 100,
	});

	vi.stubGlobal("frappe", {
		utils: { play_sound: vi.fn() },
		call: vi.fn(async () => ({
			message: { docstatus: overrides.docstatus ?? 1 },
		})),
	});

	const { submitInvoice } = usePaymentSubmission({
		invoiceDoc,
		posProfile: ref({
			posa_allow_submissions_in_background_job: 0,
			create_pos_invoice_instead_of_sales_invoice: 0,
		}),
		stockSettings: ref({}),
		invoiceType: ref("Invoice"),
		formatFloat: (value) => Number(value || 0),
		stores: {
			toastStore: overrides.toastStore ?? { show: vi.fn() },
			uiStore: overrides.uiStore ?? {
				setLastInvoice: vi.fn(),
				setLastStockAdjustment: vi.fn(),
			},
			customersStore: { setSelectedCustomer: vi.fn() },
			invoiceStore: { invoiceDoc: invoiceDoc.value },
		},
		isCashback: ref(false),
		paidChange: ref(0),
		creditChange: ref(0),
		redeemedCustomerCredit: ref(0),
		customerCreditDict: ref([]),
		diff_payment: ref(0),
	});

	return { submitInvoice, invoiceDoc };
};

describe("duplicate-submission recovery still prints the ticket", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string, args?: any[]) =>
			args?.length
				? value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""))
				: value,
		);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const invoiceService = (await import("../src/posapp/services/invoiceService"))
			.default;
		(invoiceService.submitInvoice as any).mockRejectedValue(timestampMismatch());
	});

	it("prints when the collided submit turns out to have landed", async () => {
		const onPrint = vi.fn();
		const { submitInvoice } = buildSubmission({ docstatus: 1 });

		const result = await submitInvoice(true, { onPrint });

		// The sale IS submitted; it just came back through the duplicate door.
		// Without this the operator's timestamp collision silently cost the
		// customer their receipt.
		expect(result).toMatchObject({ recoveredDuplicateSubmission: true });
		expect(onPrint).toHaveBeenCalledTimes(1);
		expect(onPrint).toHaveBeenCalledWith(
			expect.objectContaining({ name: "ACC-SINV-DUP" }),
			expect.objectContaining({
				name: "ACC-SINV-DUP",
				doctype: "Sales Invoice",
			}),
		);
	});

	it("prints immediately — never through the deferred wait", async () => {
		const onPrint = vi.fn();
		const { submitInvoice } = buildSubmission({ docstatus: 1 });

		await submitInvoice(true, { onPrint });

		// The doc is already confirmed submitted, so neither deferred flag may
		// be set or the ticket would queue behind a wait that never resolves.
		const [, options] = onPrint.mock.calls[0]!;
		expect(options?.waitForInvoiceProcessing).toBeUndefined();
		expect(options?.waitForPostSubmitPayments).toBeUndefined();
	});

	it("does not print when the operator did not ask for a print", async () => {
		const onPrint = vi.fn();
		const { submitInvoice } = buildSubmission({ docstatus: 1 });

		await submitInvoice(false, { onPrint });

		expect(onPrint).not.toHaveBeenCalled();
	});

	it("stamps the reprint cache so the navbar serves this sale", async () => {
		const uiStore = { setLastInvoice: vi.fn(), setLastStockAdjustment: vi.fn() };
		const { submitInvoice } = buildSubmission({ docstatus: 1, uiStore });

		await submitInvoice(true, { onPrint: vi.fn() });

		expect(uiStore.setLastInvoice).toHaveBeenCalledWith("ACC-SINV-DUP");
	});

	it("still reports a real failure when the doc never actually submitted", async () => {
		const onPrint = vi.fn();
		const { submitInvoice } = buildSubmission({ docstatus: 0 });

		// A draft on the other side of a mismatch is a genuine failure —
		// printing here would hand out a receipt for an unrecorded sale.
		await expect(submitInvoice(true, {})).rejects.toThrow();
		expect(onPrint).not.toHaveBeenCalled();
	});
});
