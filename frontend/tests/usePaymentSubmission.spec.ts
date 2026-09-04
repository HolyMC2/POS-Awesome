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
	default: {
		submitInvoice: vi.fn(),
	},
}));

vi.mock("../src/posapp/utils/stockCoordinator", () => ({
	default: {
		applyInvoiceConsumption: vi.fn(),
	},
}));

describe("usePaymentSubmission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string, args?: any[]) => {
			if (!args?.length) return value;
			return value.replace(/\{(\d+)\}/g, (_match, index) =>
				String(args[Number(index)] ?? ""),
			);
		});
		vi.stubGlobal("frappe", {
			utils: {
				play_sound: vi.fn(),
			},
		});
	});

	it("restores negative return payments back to normal amounts", () => {
		const invoiceDoc = ref<any>({
			is_return: 0,
			payments: [
				{
					mode_of_payment: "Cash",
					amount: -120,
					base_amount: -120,
					default: 1,
				},
				{ mode_of_payment: "Card", amount: 0, base_amount: 0 },
				{ mode_of_payment: "Bank", amount: 35, base_amount: 35 },
			],
		});

		const { restoreReturnPayments } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(true),
		});

		restoreReturnPayments();

		expect(invoiceDoc.value.payments).toEqual([
			{
				mode_of_payment: "Cash",
				amount: 120,
				base_amount: 120,
				default: 1,
			},
			{ mode_of_payment: "Card", amount: 0, base_amount: 0 },
			{ mode_of_payment: "Bank", amount: 35, base_amount: 35 },
		]);
	});

	it("defers print and schedules background wait when invoice submission is queued", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0001",
			doctype: "Sales Invoice",
			status: 0,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0001",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const onPrint = vi.fn();
		const onScheduleBackgroundCheck = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(10),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(100),
			customerCreditDict: ref([]),
			diff_payment: ref(-10),
		});

		await submitInvoice(true, {
			onPrint,
			onScheduleBackgroundCheck,
			onFinishNavigation: vi.fn(),
		});

		expect(onPrint).not.toHaveBeenCalled();
		expect(onScheduleBackgroundCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ACC-SINV-0001",
				doctype: "Sales Invoice",
				print: true,
				waitForInvoiceProcessing: true,
				waitForPostSubmitPayments: true,
			}),
		);
	});

	it("schedules deferred printing instead of calling onPrint when post-submit work remains", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0002",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0002",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const onPrint = vi.fn();
		const onScheduleBackgroundCheck = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(10),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(100),
			customerCreditDict: ref([]),
			diff_payment: ref(-10),
		});

		await submitInvoice(true, {
			onPrint,
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck,
		});

		expect(onPrint).not.toHaveBeenCalled();
		expect(onScheduleBackgroundCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ACC-SINV-0002",
				doctype: "Sales Invoice",
				waitForInvoiceProcessing: false,
				waitForPostSubmitPayments: true,
			}),
		);
	});

	it("prints immediately when there is no deferred post-submit work", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0004",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0004",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const onPrint = vi.fn();
		const onScheduleBackgroundCheck = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(true, {
			onPrint,
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck,
		});

		expect(onPrint).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ACC-SINV-0004",
				doctype: "Sales Invoice",
				docstatus: 1,
			}),
			expect.objectContaining({
				name: "ACC-SINV-0004",
				doctype: "Sales Invoice",
				waitForInvoiceProcessing: false,
				waitForPostSubmitPayments: false,
			}),
		);
		expect(onScheduleBackgroundCheck).not.toHaveBeenCalled();
	});

	it("prints a newly submitted Sales Order with the server-assigned name", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "SAL-ORD-0001",
		});

		const invoiceDoc = ref<any>({
			doctype: "Sales Order",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			posa_delivery_date: "2026-07-01",
		});
		const onPrint = vi.fn();
		const setLastInvoice = vi.fn();
		const mergeInvoiceDoc = vi.fn((patch) => {
			Object.assign(invoiceDoc.value, patch);
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				posa_allow_sales_order: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Order"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice,
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value, mergeInvoiceDoc },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(true, {
			onPrint,
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(onPrint).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "SAL-ORD-0001",
				doctype: "Sales Order",
				docstatus: 1,
			}),
			expect.objectContaining({
				name: "SAL-ORD-0001",
				doctype: "Sales Order",
				waitForInvoiceProcessing: false,
				waitForPostSubmitPayments: false,
			}),
		);
		expect(mergeInvoiceDoc).toHaveBeenCalledWith({
			name: "SAL-ORD-0001",
			doctype: "Sales Order",
			docstatus: 1,
		});
		expect(invoiceDoc.value.name).toBe("SAL-ORD-0001");
		expect(setLastInvoice).toHaveBeenCalledWith("SAL-ORD-0001");
	});

	it("shows a merged processing toast instead of a plain success toast when post-submit payments are pending", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0003",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0003",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const toastShow = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: toastShow },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(10),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(100),
			customerCreditDict: ref([]),
			diff_payment: ref(-10),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "invoice-processing::ACC-SINV-0003",
				title: "Invoice Submitted",
				loading: true,
			}),
		);
	});

	it("includes gift card redemptions in the submit payload", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0005",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0005",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 390, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-0001",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
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
			giftCardRedemptions,
			diff_payment: ref(390),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(invoiceService.submitInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				gift_card_redemptions: [
					expect.objectContaining({
						gift_card_code: "GC-0001",
						amount: 300,
					}),
				],
			}),
			expect.objectContaining({
				payments: [
					expect.objectContaining({
						mode_of_payment: "Cash",
						amount: 390,
					}),
				],
			}),
			"Invoice",
			expect.any(Object),
		);
	});

	it("adds a stable client request id to invoice submissions", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0099",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0099",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 50, type: "Cash" }],
			rounded_total: 50,
			grand_total: 50,
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
				toastStore: { show: vi.fn() },
				uiStore: {
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

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc.posa_client_request_id).toEqual(expect.any(String));
		expect(invoiceDoc.value.posa_client_request_id).toBe(
			submittedDoc.posa_client_request_id,
		);
	});

	it("reuses the same client request id across repeated invoice submit attempts", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0100",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0100",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 50, type: "Cash" }],
			rounded_total: 50,
			grand_total: 50,
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
				toastStore: { show: vi.fn() },
				uiStore: {
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

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});
		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const firstSubmittedDoc = (invoiceService.submitInvoice as any).mock
			.calls[0][1];
		const secondSubmittedDoc = (invoiceService.submitInvoice as any).mock
			.calls[1][1];

		expect(firstSubmittedDoc.posa_client_request_id).toEqual(
			expect.any(String),
		);
		expect(secondSubmittedDoc.posa_client_request_id).toBe(
			firstSubmittedDoc.posa_client_request_id,
		);
		expect(invoiceDoc.value.posa_client_request_id).toBe(
			firstSubmittedDoc.posa_client_request_id,
		);
	});

	it("blocks offline invoice save when gift card redemption is present", async () => {
		const offlineModule = await import("../src/offline/index");
		(offlineModule.isOffline as any).mockReturnValue(true);

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0006",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [
				{ mode_of_payment: "Gift Card", amount: 300, type: "Bank" },
			],
			rounded_total: 300,
			grand_total: 300,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-0002",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

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
				toastStore: { show: vi.fn() },
				syncStore: { updatePendingCount: vi.fn() },
				uiStore: {
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
			giftCardRedemptions,
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).rejects.toThrow("Gift card redemption requires an online connection");

		(offlineModule.isOffline as any).mockReturnValue(false);
	});

	it("blocks offline invoice save when customer credit is redeemed", async () => {
		const offlineModule = await import("../src/offline/index");
		(offlineModule.isOffline as any).mockReturnValue(true);

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0006B",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 200, type: "Cash" }],
			rounded_total: 200,
			grand_total: 200,
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
				toastStore: { show: vi.fn() },
				syncStore: { updatePendingCount: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(150),
			customerCreditDict: ref([{ credit_origin: "CN-1", credit_to_redeem: 150 }]),
			giftCardRedemptions: ref([]),
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, { onFinishNavigation: vi.fn() }),
		).rejects.toThrow("Customer credit redemption requires an online connection");

		(offlineModule.isOffline as any).mockReturnValue(false);
	});

	it("submits gift card redemptions without requiring a gift card payment row", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0007",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0007",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					account: "1110 - Cash",
					amount: 0,
				},
			],
			rounded_total: 300,
			grand_total: 300,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-ONLY",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
				posa_allow_partial_payment: 0,
				payments: [
					{
						mode_of_payment: "Cash",
						type: "Cash",
						account: "1110 - Cash",
						default: 1,
					},
				],
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
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
			giftCardRedemptions,
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).resolves.not.toThrow();

		expect(invoiceService.submitInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				gift_card_redemptions: [
					expect.objectContaining({
						gift_card_code: "GC-ONLY",
						amount: 300,
					}),
				],
			}),
			expect.objectContaining({
				payments: [
					expect.objectContaining({
						mode_of_payment: "Cash",
						amount: 0,
						account: "1110 - Cash",
					}),
				],
			}),
			"Invoice",
			expect.any(Object),
		);
	});

	it("maps validation envelope failures and preserves the request id", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockRejectedValue(
			new ApiEnvelopeError({
				ok: false,
				data: null,
				error: {
					code: "VALIDATION_ERROR",
					message: "Customer is required",
					retryable: false,
				},
				requestId: "req-validation-1",
				serverTime: "2026-05-01T06:00:00Z",
			}),
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const toastStore = { show: vi.fn() };

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-VALIDATION",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
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
				toastStore,
				uiStore: {
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

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).rejects.toThrow("Customer is required");

		expect(toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Unable to submit invoice",
				detail: expect.stringContaining("req-validation-1"),
				color: "error",
			}),
		);
		expect(consoleError).toHaveBeenCalledWith(
			"Error submitting invoice:",
			expect.objectContaining({
				code: "VALIDATION_ERROR",
				requestId: "req-validation-1",
			}),
		);
		consoleError.mockRestore();
	});

	it("normalizes return payment rows before submit even when cashback is disabled", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-RETURN-0001",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-RETURN-0001",
			doctype: "Sales Invoice",
			is_return: 1,
			items: [{ item_code: "ITEM-1", qty: -1 }],
			payments: [
				{
					mode_of_payment: "Cash",
					amount: 90,
					base_amount: 90,
					type: "Cash",
				},
			],
			rounded_total: -90,
			grand_total: -90,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Return"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
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

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc.payments).toEqual([
			expect.objectContaining({
				mode_of_payment: "Cash",
				amount: -90,
				base_amount: -90,
			}),
		]);
	});

	it("allows gift card submission when no gift card mode of payment is configured", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0008",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0008",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 0, type: "Cash" }],
			rounded_total: 300,
			grand_total: 300,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-MISSING",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
				posa_allow_partial_payment: 0,
				payments: [
					{
						mode_of_payment: "Cash",
						type: "Cash",
						account: "1110 - Cash",
						default: 1,
					},
				],
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
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
			giftCardRedemptions,
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).resolves.not.toThrow();

		expect(invoiceService.submitInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				gift_card_redemptions: [
					expect.objectContaining({
						gift_card_code: "GC-MISSING",
						amount: 300,
					}),
				],
			}),
			expect.objectContaining({
				payments: [
					expect.objectContaining({
						mode_of_payment: "Cash",
						amount: 0,
					}),
				],
			}),
			"Invoice",
			expect.any(Object),
		);
	});

	// Change due — the cashier's next physical act after a cash sale. The
	// small auto-dismissing toast this replaced was routinely missed at a live
	// counter, so the amount now goes to a handler that blocks until confirmed.
	describe("change due", () => {
		const buildCashSale = async (
			overrides: {
				paidChange?: number;
				diff?: number;
				isReturn?: boolean;
			} = {},
		) => {
			const invoiceService = (
				await import("../src/posapp/services/invoiceService")
			).default;
			(invoiceService.submitInvoice as any).mockResolvedValue({
				name: "ACC-SINV-0100",
				doctype: "Sales Invoice",
				docstatus: 1,
			});

			const invoiceDoc = ref<any>({
				name: "ACC-SINV-0100",
				doctype: "Sales Invoice",
				currency: "MXN",
				is_return: overrides.isReturn ? 1 : 0,
				items: [{ item_code: "ITEM-1", qty: 1 }],
				payments: [{ mode_of_payment: "Cash", amount: 500, type: "Cash" }],
				rounded_total: 480,
				grand_total: 480,
			});
			const toastStore = { show: vi.fn() };

			const { submitInvoice } = usePaymentSubmission({
				invoiceDoc,
				posProfile: ref({
					// Off, so the sale takes the immediate path and change is
					// not deferred behind a background job.
					posa_allow_submissions_in_background_job: 0,
					create_pos_invoice_instead_of_sales_invoice: 0,
				}),
				stockSettings: ref({}),
				invoiceType: ref("Invoice"),
				formatFloat: (value) => Number(value || 0),
				formatCurrency: (value: number) => Number(value).toFixed(2),
				stores: {
					toastStore,
					uiStore: {
						setLastInvoice: vi.fn(),
						setLastStockAdjustment: vi.fn(),
					},
					customersStore: { setSelectedCustomer: vi.fn() },
					invoiceStore: { invoiceDoc: invoiceDoc.value },
				},
				isCashback: ref(true),
				paidChange: ref(overrides.paidChange ?? 20),
				creditChange: ref(0),
				redeemedCustomerCredit: ref(0),
				customerCreditDict: ref([]),
				diff_payment: ref(overrides.diff ?? -20),
			});

			return { submitInvoice, toastStore };
		};

		const changeToasts = (toastStore: { show: any }) =>
			toastStore.show.mock.calls.filter((call: any[]) =>
				String(call[0]?.title || "").includes("Give back change"),
			);

		it("hands the booked change to the handler instead of toasting it", async () => {
			const { submitInvoice, toastStore } = await buildCashSale();
			const onChangeDue = vi.fn();

			await submitInvoice(false, {
				onChangeDue,
				onFinishNavigation: vi.fn(),
			});

			expect(onChangeDue).toHaveBeenCalledWith({
				amount: 20,
				currency: "MXN",
				invoice: "ACC-SINV-0100",
			});
			expect(changeToasts(toastStore)).toHaveLength(0);
		});

		it("still toasts when a caller wires no handler", async () => {
			const { submitInvoice, toastStore } = await buildCashSale();

			await submitInvoice(false, { onFinishNavigation: vi.fn() });

			expect(changeToasts(toastStore)).toHaveLength(1);
		});

		it("prints before it asks about the change", async () => {
			// Submit & Print must keep printing while the dialog is up; if the
			// order flipped, the ticket would wait on the cashier's tap.
			const order: string[] = [];
			const { submitInvoice } = await buildCashSale();

			await submitInvoice(true, {
				onPrint: () => {
					order.push("print");
				},
				onChangeDue: () => {
					order.push("change");
				},
				onFinishNavigation: vi.fn(),
			});

			expect(order).toEqual(["print", "change"]);
		});

		it("stays silent when the sale owes no change", async () => {
			const { submitInvoice, toastStore } = await buildCashSale({
				paidChange: 0,
				diff: 0,
			});
			const onChangeDue = vi.fn();

			await submitInvoice(false, {
				onChangeDue,
				onFinishNavigation: vi.fn(),
			});

			expect(onChangeDue).not.toHaveBeenCalled();
			expect(changeToasts(toastStore)).toHaveLength(0);
		});

		it("stays silent on a return, where money moves the other way", async () => {
			const { submitInvoice } = await buildCashSale({ isReturn: true });
			const onChangeDue = vi.fn();

			await submitInvoice(false, {
				onChangeDue,
				onFinishNavigation: vi.fn(),
			});

			expect(onChangeDue).not.toHaveBeenCalled();
		});
	});
});

describe("usePaymentSubmission — a lost ack is resolved by the register, not the cashier", () => {
	// Live drill 2026-09-04: the submit call died in flight AFTER the server
	// booked the sale. The cashier was left on the pay screen with the cart
	// intact and a transient «Failed to fetch»; re-pressing replayed safely,
	// cancelling and re-ringing would have charged twice.
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string, args?: any[]) => {
			if (!args?.length) return value;
			return value.replace(/\{(\d+)\}/g, (_match, index) =>
				String(args[Number(index)] ?? ""),
			);
		});
	});

	const transportFailure = () =>
		new ApiEnvelopeError({
			ok: false,
			data: null,
			error: { code: "TRANSPORT_ERROR", message: "Failed to fetch", retryable: true },
			requestId: "req-lost-ack-1",
			serverTime: null,
		});

	function buildRegister(overrides: Record<string, any> = {}) {
		const toastStore = { show: vi.fn() };
		const syncStore = { updatePendingCount: vi.fn(), syncPendingInvoices: vi.fn(() => Promise.resolve()) };
		const uiStore = { setLastInvoice: vi.fn(), setLastStockAdjustment: vi.fn() };
		const customersStore = { setSelectedCustomer: vi.fn() };
		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOST-ACK",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 57, type: "Cash" }],
			rounded_total: 57,
			grand_total: 57,
			posa_client_request_id: "inv-lost-ack-001",
		});
		const register = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Mostrador",
				customer: "Público en General",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: { toastStore, syncStore, uiStore, customersStore, invoiceStore: { invoiceDoc: invoiceDoc.value } },
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			...overrides,
		});
		return { ...register, invoiceDoc, toastStore, syncStore, uiStore, customersStore };
	}

	async function rejectSubmitWithTransportFailure() {
		const invoiceService = (await import("../src/posapp/services/invoiceService")).default;
		(invoiceService.submitInvoice as any).mockRejectedValue(transportFailure());
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	}

	it("finishes the sale as submitted when the server confirms it booked the request", async () => {
		await rejectSubmitWithTransportFailure();
		const call = vi.fn(async () => ({ message: { docstatus: 1 } }));
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() }, call });
		const { saveOfflineInvoice } = await import("../src/offline/index");

		const register = buildRegister();
		const onFinishNavigation = vi.fn();
		const onPrint = vi.fn();

		const result = await register.submitInvoice(true, { onFinishNavigation, onPrint });

		expect(result).toEqual(
			expect.objectContaining({
				recoveredDuplicateSubmission: true,
				message: expect.objectContaining({ name: "ACC-SINV-LOST-ACK", docstatus: 1 }),
			}),
		);
		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "frappe.client.get_value",
				args: expect.objectContaining({ filters: { name: "ACC-SINV-LOST-ACK" } }),
			}),
		);
		// Booked once, on the server — nothing is queued and the ticket prints.
		expect(saveOfflineInvoice).not.toHaveBeenCalled();
		expect(onFinishNavigation).toHaveBeenCalledWith(true);
		expect(onPrint).toHaveBeenCalledWith(
			register.invoiceDoc.value,
			expect.objectContaining({ name: "ACC-SINV-LOST-ACK" }),
		);
		expect(register.uiStore.setLastInvoice).toHaveBeenCalledWith("ACC-SINV-LOST-ACK");
		expect(register.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Invoice ACC-SINV-LOST-ACK was already submitted" }),
		);
	});

	it("parks the sale in the offline queue and kicks the drain when the server cannot be asked", async () => {
		await rejectSubmitWithTransportFailure();
		const call = vi.fn(async () => {
			throw new Error("Failed to fetch");
		});
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() }, call });
		const { saveOfflineInvoice } = await import("../src/offline/index");
		(saveOfflineInvoice as any).mockResolvedValue({ queue_id: 7 });

		const register = buildRegister();
		const onFinishNavigation = vi.fn();
		const onPrint = vi.fn();

		const result = await register.submitInvoice(true, { onFinishNavigation, onPrint });

		expect(result).toEqual({ offline: true, recoveredFromLostAck: true });
		// The queued payload is the SAME doc, same request id — the replay is
		// idempotent, so a sale the server did book is found, not repeated.
		expect(saveOfflineInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				invoice: expect.objectContaining({
					name: "ACC-SINV-LOST-ACK",
					posa_client_request_id: "inv-lost-ack-001",
				}),
				data: expect.objectContaining({ is_credit_sale: 0 }),
			}),
		);
		expect(register.syncStore.updatePendingCount).toHaveBeenCalled();
		expect(register.syncStore.syncPendingInvoices).toHaveBeenCalled();
		expect(onFinishNavigation).toHaveBeenCalledWith(true);
		expect(onPrint).toHaveBeenCalledWith(register.invoiceDoc.value);
		expect(register.customersStore.setSelectedCustomer).toHaveBeenCalledWith("Público en General");
		expect(register.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Connection lost while charging — sale saved on this register",
				color: "warning",
			}),
		);
	});

	it("parks the sale when the server answers that the draft is still unsubmitted", async () => {
		await rejectSubmitWithTransportFailure();
		const call = vi.fn(async () => ({ message: { docstatus: 0 } }));
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() }, call });
		const { saveOfflineInvoice } = await import("../src/offline/index");
		(saveOfflineInvoice as any).mockResolvedValue({ queue_id: 8 });

		const register = buildRegister();
		const result = await register.submitInvoice(false, { onFinishNavigation: vi.fn() });

		expect(result).toEqual({ offline: true, recoveredFromLostAck: true });
		expect(saveOfflineInvoice).toHaveBeenCalledTimes(1);
		expect(register.syncStore.syncPendingInvoices).toHaveBeenCalled();
	});

	it("keeps the loud failure when the queue refuses the sale", async () => {
		await rejectSubmitWithTransportFailure();
		const call = vi.fn(async () => {
			throw new Error("Failed to fetch");
		});
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() }, call });
		const { saveOfflineInvoice } = await import("../src/offline/index");
		(saveOfflineInvoice as any).mockRejectedValue(new Error("Not enough stock for Tortilla"));

		const register = buildRegister();
		const onFinishNavigation = vi.fn();

		await expect(register.submitInvoice(false, { onFinishNavigation })).rejects.toThrow(
			"Failed to fetch",
		);
		expect(onFinishNavigation).not.toHaveBeenCalled();
		expect(register.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Connection problem while submitting invoice" }),
		);
	});

	it("does not park a sale that redeems a gift card — that must be verified live", async () => {
		await rejectSubmitWithTransportFailure();
		const call = vi.fn(async () => ({ message: { docstatus: 0 } }));
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() }, call });
		const { saveOfflineInvoice } = await import("../src/offline/index");

		const register = buildRegister({
			giftCardRedemptions: ref([{ gift_card: "GC-1", amount: 20 }]),
		});

		await expect(register.submitInvoice(false, {})).rejects.toThrow("Failed to fetch");
		expect(saveOfflineInvoice).not.toHaveBeenCalled();
	});
});

