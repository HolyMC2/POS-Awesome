import { ref, type Ref } from "vue";
import { isOffline, saveOfflinePayment } from "../../../../offline/index";
import { ensurePaymentClientRequestId } from "../../../../offline/idempotency";
// MP-INTEGRATION-POINT: the collect-on-account tool drives the MercadoPago Point
// terminal through the SAME gate the sale checkout uses (one createPointOrder
// call site — see mpSingleChargePath.spec).
import { useMpPointSaleGate } from "./useMpPointSaleGate";
import { useEmployeeStore } from "../../../stores/employeeStore";

declare const frappe: any;
declare const __: (_text: string, _args?: any[]) => string;
declare const flt: (_value: unknown, _precision?: number) => number;

type PosPaySubmissionArgs = {
	customerName: Ref<string>;
	partyName?: Ref<string>;
	partyType?: Ref<string>;
	paymentType?: Ref<string>;
	company: Ref<any>;
	posProfile: Ref<any>;
	posOpeningShift: Ref<any>;
	postingDate?: Ref<string | null>;
	exchangeRate: Ref<number>;
	invoiceTotalCurrency: Ref<string>;
	referenceNo: Ref<string>;
	referenceDate: Ref<string>;
	autoAllocatePaymentAmount: Ref<boolean>;
	payment_methods: Ref<any[]>;
	selected_invoices: Ref<any[]>;
	selected_payments: Ref<any[]>;
	selected_mpesa_payments: Ref<any[]>;
	total_selected_payments: Ref<number>;
	total_selected_mpesa_payments: Ref<number>;
	total_payment_methods: Ref<number>;
	clearSelections: () => void;
	resetPaymentMethodAmounts: () => void;
	load_print_page: (_name: string) => void;
	eventBus: { emit: (_event: string, _payload?: unknown) => void };
	get_outstanding_invoices: () => void;
	get_unallocated_payments: () => void;
	get_draft_mpesa_payments_register: () => void;
	set_mpesa_search_params: () => void;
	autoReconcile: (
		_posProfileSearch?: string | null,
		_options?: { suppressToast?: boolean },
	) => Promise<any>;
};

export function usePosPaySubmission({
	customerName,
	partyName,
	partyType,
	paymentType,
	company,
	posProfile,
	posOpeningShift,
	postingDate,
	exchangeRate,
	invoiceTotalCurrency,
	referenceNo,
	referenceDate,
	autoAllocatePaymentAmount,
	payment_methods,
	selected_invoices,
	selected_payments,
	selected_mpesa_payments,
	total_selected_payments,
	total_selected_mpesa_payments,
	total_payment_methods,
	clearSelections,
	resetPaymentMethodAmounts,
	load_print_page,
	eventBus,
	get_outstanding_invoices,
	get_unallocated_payments,
	get_draft_mpesa_payments_register,
	set_mpesa_search_params,
	autoReconcile,
}: PosPaySubmissionArgs) {
	const isSubmitting = ref(false);

	// MP-INTEGRATION-POINT: a terminal-charge gate scoped to this collect
	// surface. No draft doc here — it charges a chosen outstanding invoice by
	// name. No-op (enabled() false) for profiles without MercadoPago Point.
	const employeeStore = useEmployeeStore();
	const mpGate = useMpPointSaleGate({
		getInvoiceDoc: () => null,
		getPosProfile: () => posProfile.value,
		isSupervisor: () => Boolean(employeeStore.currentCashier?.is_supervisor),
	});

	// Charge the MercadoPago Point portion of a collection on the terminal
	// before any Payment Entry is booked. Returns true to proceed (nothing to
	// charge, or the terminal approved), false to abort (offline, no single
	// invoice to match, or the cashier cancelled). MERCADOPAGO one-invoice
	// rule: the connector matches by external_reference = invoice name, so a
	// terminal collection must target exactly ONE selected invoice.
	async function chargeMercadoPagoIfNeeded(): Promise<boolean> {
		if (!mpGate.enabled()) return true;
		// Only a "Receive" collection drives the customer's card terminal; a
		// supplier "Pay" never should, so never charge it there.
		if ((paymentType?.value || "Receive") !== "Receive") return true;
		const mopName = mpGate.pointMop();
		const mpAmount = payment_methods.value
			.filter((m: any) => m?.mode_of_payment === mopName)
			.reduce((acc: number, m: any) => acc + (flt(m?.amount) || 0), 0);
		if (!(mpAmount > 0)) return true;

		if (isOffline()) {
			frappe.msgprint(
				__("The MercadoPago terminal can't be charged while offline."),
			);
			return false;
		}
		if (selected_invoices.value.length !== 1) {
			frappe.msgprint(
				__("A MercadoPago terminal charge needs a single selected invoice."),
			);
			return false;
		}
		const target = selected_invoices.value[0] || {};
		return mpGate.ensureChargedForInvoice({
			invoiceName: target.name,
			amount: mpAmount,
			currency: invoiceTotalCurrency.value,
			invoiceDoctype: target.doctype || "Sales Invoice",
		});
	}

	async function processPayment({
		printAfter = false,
	}: { printAfter?: boolean } = {}) {
		if (isSubmitting.value) return;

		isSubmitting.value = true;
		const party = partyName?.value || customerName.value;
		const resolvedPartyType = partyType?.value || "Customer";
		const resolvedPaymentType = paymentType?.value || "Receive";
		const resolvedPostingDate = postingDate?.value || null;
		const resolvedReferenceNo =
			referenceNo?.value?.trim() || posOpeningShift.value?.name || null;
		const resolvedReferenceDate =
			referenceDate?.value?.trim() || resolvedPostingDate || null;

		const finalizeSubmission = () => {
			clearSelections();
			resetPaymentMethodAmounts();
			referenceNo.value = "";
			referenceDate.value = "";
			customerName.value = party;
			get_outstanding_invoices();
			get_unallocated_payments();
			set_mpesa_search_params();
			get_draft_mpesa_payments_register();
		};

		try {
			if (!party) {
				frappe.throw(__("Please select a party"));
			}

			const total_payments =
				total_selected_payments.value +
				total_selected_mpesa_payments.value +
				total_payment_methods.value;

			if (total_payments <= 0) {
				frappe.throw(__("Please make a payment or select a payment"));
			}

			const hasNewPayments = flt(total_payment_methods.value) > 0;
			const hasAllocatedSelections =
				flt(total_selected_payments.value) > 0 ||
				flt(total_selected_mpesa_payments.value) > 0;

			if (
				!hasNewPayments &&
				selected_invoices.value.length === 0 &&
				hasAllocatedSelections
			) {
				frappe.throw(__("Please select an invoice"));
			}

			const selectedInvoicesForPayload = selected_invoices.value.map(
				(invoice: any) => ({ ...invoice }),
			);

			const totalSelectedInvoicesAmount =
				selectedInvoicesForPayload.reduce(
					(acc: number, invoice: any) =>
						acc + flt(invoice?.outstanding_amount || 0),
					0,
				);

		const payload = {
			customer: party,
			party,
			party_type: resolvedPartyType,
			payment_type: resolvedPaymentType,
			company: company.value,
			currency: invoiceTotalCurrency.value,
			posting_date: resolvedPostingDate,
			exchange_rate: exchangeRate.value || null,
			reference_no: resolvedReferenceNo,
			reference_date: resolvedReferenceDate,
			pos_opening_shift_name: posOpeningShift.value.name,
			pos_profile_name: posProfile.value.name,
			pos_profile: posProfile.value,
			payment_methods: payment_methods.value
				.filter((m: any) => flt(m.amount) > 0)
				.map((m: any) => ({
					mode_of_payment: m.mode_of_payment,
					amount: m.amount,
					row_id: m.row_id,
					bank_account: m.bank_account || null,
				})),
				selected_invoices: selectedInvoicesForPayload,
				selected_payments: selected_payments.value,
				total_selected_invoices: flt(totalSelectedInvoicesAmount),
				selected_mpesa_payments: selected_mpesa_payments.value,
				total_selected_payments: flt(total_selected_payments.value),
				total_payment_methods: flt(total_payment_methods.value),
				auto_allocate_payment_amount: !!autoAllocatePaymentAmount.value,
				total_selected_mpesa_payments: flt(
					total_selected_mpesa_payments.value,
				),
			};
			ensurePaymentClientRequestId(payload);

			// MP-INTEGRATION-POINT: drive the terminal for the MercadoPago Point
			// portion BEFORE booking. If it isn't approved (or can't run), abort
			// so no Payment Entry is created for money the terminal never took.
			if (!(await chargeMercadoPagoIfNeeded())) {
				return;
			}

			if (isOffline()) {
				try {
					await saveOfflinePayment({ args: { payload } });
					eventBus.emit("show_message", {
						title: __("Payment saved offline"),
						color: "warning",
					});
					finalizeSubmission();
				} catch (error: any) {
					frappe.msgprint(
						__("Cannot Save Offline Payment: ") +
							(error.message || __("Unknown error")),
					);
				}
				return;
			}

			const response: any = await new Promise((resolve, reject) => {
				frappe.call({
					method: "posawesome.posawesome.api.payment_entry.process_pos_payment",
					args: { payload },
					freeze: true,
					freeze_message: __("Processing Payment"),
					callback: (r: any) => resolve(r),
					error: (err: any) => reject(err),
				});
			});

			if (!response || !response.message) {
				return;
			}

			frappe.utils.play_sound("submit");

			// Show exchange gain/loss notification as toast (non-intrusive)
			if (response.message?.net_gain_loss) {
				const netAmount = response.message.net_gain_loss;
				const currency = response.message.exchange_gain_loss_summary?.[0]?.currency || '';
				const label = netAmount >= 0 ? __("Gain") : __("Loss");

				// "show_notification" never had a listener — the exchange
				// gain/loss toast silently vanished. show_message is the
				// wired toast channel.
				eventBus.emit("show_message", {
					title: __("{0}: {1} {2}", [label, Math.abs(netAmount).toFixed(2), currency]),
					color: netAmount >= 0 ? "success" : "warning",
					timeout: 4000,
				});
			}

			if (autoAllocatePaymentAmount.value) {
				const autoReconcileResult = await autoReconcile(null, {
					suppressToast: true,
				});
				const autoReconcileSummary =
					autoReconcileResult?.summary ||
					__("Auto reconciliation completed after payment submit.");
				eventBus.emit("show_message", {
					title: `${__("Payment submitted.")} ${autoReconcileSummary}`,
					color: autoReconcileResult?.total_allocated ? "success" : "info",
				});
			}

			if (printAfter) {
				const payment_name =
					response.message.new_payments_entry &&
					response.message.new_payments_entry.length > 0
						? response.message.new_payments_entry[0].name
						: null;

				if (payment_name) {
					load_print_page(payment_name);
				} else {
					frappe.msgprint(
						__(
							"Payment submitted but print function could not be executed. Payment name not found.",
						),
					);
				}
			}

			finalizeSubmission();
		} catch (error) {
			console.error("Failed to process payment", error);
			throw error;
		} finally {
			isSubmitting.value = false;
		}
	}

	return {
		isSubmitting,
		processPayment,
		// MP-INTEGRATION-POINT: PayView mounts <MpPointSaleGateDialog :gate> with
		// this so the terminal modal (status / retry / cancel / choose) renders.
		mpGate,
	};
}
