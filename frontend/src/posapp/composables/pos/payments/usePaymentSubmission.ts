import { unref, type Ref, type ComputedRef } from "vue";
import { bus } from "../../../bus";
import invoiceService from "../../../services/invoiceService";
import { isApiEnvelopeError, unwrapApiResult } from "../../../services/api";
import {
	saveOfflineInvoice,
	isOffline,
	updateLocalStock,
} from "../../../../offline/index";
import { ensureInvoiceClientRequestId } from "../../../../offline/idempotency";
import stockCoordinator from "../../../utils/stockCoordinator";
import { parseBooleanSetting } from "../../../utils/stock";
import { debugLog } from "../../../utils/debug";

declare const frappe: any;
declare const __: (_str: string, _args?: any[]) => string;

// Pull-model billing: drafts built from a doco POS Charge Request carry a
// remarks marker set server-side (charge_requests.prepare_charge_request_invoice).
// The state rides the document — no client-side ref to race or go stale.
const CHARGE_REQUEST_MARKER = /POS Charge Request: (\S+)/;

// SPEC C: cashier-felt sale duration — first add on empty cart → submit
// response (or hold-parked). Fire-and-forget; telemetry never blocks a sale.
async function emitSaleCycle(meta: { held: boolean; background: boolean; itemCount: number }) {
	try {
		const { takeSaleCycleMs } = await import("../../../utils/saleCycle");
		const elapsed = takeSaleCycleMs();
		if (elapsed === null) return;
		const { track } = await import("../../../utils/telemetry");
		track("pos:sale_cycle_ms", elapsed, {
			item_count: meta.itemCount,
			held: meta.held,
			background: meta.background,
		});
	} catch {
		/* ignore */
	}
}

async function markChargeRequestCharged(
	stores: PaymentSubmissionOptions["stores"],
	requestName: string,
	posProfile: string,
	invoiceDoctype: string,
	invoiceName: string,
	attempt = 0,
): Promise<void> {
	try {
		await frappe.call({
			method: "posawesome.posawesome.api.charge_requests.mark_charge_request_charged",
			args: {
				name: requestName,
				pos_profile: posProfile,
				invoice_doctype: invoiceDoctype,
				invoice_name: invoiceName,
			},
		});
		stores?.toastStore?.show({
			title: __("Charge request completed"),
			message: `${requestName} → ${invoiceName}`,
			color: "success",
		});
	} catch (err: any) {
		// Background-submitted invoices may not be docstatus=1 yet — retry
		// once before going loud. The sale itself already stands; the ONLY
		// unacceptable outcome is a silent failure.
		if (attempt < 1) {
			setTimeout(() => {
				void markChargeRequestCharged(
					stores,
					requestName,
					posProfile,
					invoiceDoctype,
					invoiceName,
					attempt + 1,
				);
			}, 5000);
			return;
		}
		console.error("mark_charge_request_charged failed", err);
		stores?.toastStore?.show({
			title: __("Charge request not marked as charged"),
			message: `${__("The sale went through, but request")} ${requestName} ${__("is still Open. A supervisor must mark it charged with invoice")} ${invoiceName}.`,
			color: "error",
			timeout: 0,
		});
	}
}

export interface PaymentSubmissionOptions {
	invoiceDoc: Ref<any>;
	posProfile: Ref<any>;
	stockSettings: Ref<any>;
	invoiceType: Ref<string>;
	is_write_off_change?: Ref<boolean>;
	formatFloat: (_val: any, _prec?: number) => number;
	formatCurrency?: (_val: any, _currency?: string) => string;
	currencyPrecision?: Ref<number>;
	restaurantTipAmount?: Ref<number>;
	isCashback?: Ref<boolean>;
	paidChange?: Ref<number>;
	creditChange?: Ref<number>;
	redeemedCustomerCredit?: Ref<number>;
	customerCreditDict?: Ref<any[]>;
	giftCardRedemptions?: Ref<any[]>;
	diff_payment?: ComputedRef<number>;
	is_credit_sale?: Ref<boolean>;
	loyaltyAmount?: Ref<number>;
	stores?: {
		toastStore?: any;
		syncStore?: any;
		customersStore?: any;
		uiStore?: any;
		invoiceStore?: any;
	};
	/**
	 * Resolver for the floor store — a GETTER supplied by the mounting
	 * component, never a module-level lookup from in here.
	 *
	 * This composable lives in a lazily-imported chunk, and a lazy chunk's
	 * relative import of the entry bundle is a DIFFERENT module URL from the
	 * `?v=<build>` one the loader boots the app with. Both copies evaluate, so
	 * `stores/index.ts` used to hand this file a second `createPinia()` whose
	 * floor store had never seen a register: `isRecordOnly` false and
	 * `activeOrder` null on every mesa sale, which is exactly how a charged
	 * cuenta stayed Open. `stores/index.ts` now pins one pinia per document,
	 * and the seam takes the component's instance regardless — the store it
	 * settles through is the one the salón is looking at, by construction.
	 *
	 * Absent (unit specs, and any caller with no floor) the seam degrades to
	 * the plain retail submit, which is what a register without a floor is.
	 */
	floorStore?: () => FloorStoreSeam | null | undefined;
}

/**
 * The slice of the floor store the payment seam touches. Structural on
 * purpose: a spec can hand in a plain object, and the seam cannot quietly
 * grow a dependency on the rest of the store.
 */
export interface FloorStoreSeam {
	isRecordOnly: boolean;
	activeOrder: { order_uid: string } | null;
	settleActiveOrder: (
		_invoicePayload: Record<string, unknown>,
		_tipAmount?: number,
	) => Promise<any>;
	setActiveOrder: (_order: null) => void;
}

export interface SubmissionCallbacks {
	onSuccess?: (_message: any) => void;
	onPrint?: (
		_doc: any,
		_options?: {
			name?: string;
			doctype?: string;
			waitForPostSubmitPayments?: boolean;
			waitForInvoiceProcessing?: boolean;
		},
	) => void;
	onFinishNavigation?: (_success: boolean) => void;
	onChangeDue?: (_payload: {
		amount: number;
		currency?: string;
		invoice?: string;
	}) => void;
	onScheduleBackgroundCheck?: (_payload: {
		name?: string;
		doctype?: string;
		print?: boolean;
		waitForPostSubmitPayments?: boolean;
		waitForInvoiceProcessing?: boolean;
	}) => void;
}

export function usePaymentSubmission(options: PaymentSubmissionOptions) {
	const {
		invoiceDoc,
		posProfile,
		stockSettings,
		invoiceType,
		formatFloat,
		stores,
	} = options;

	/**
	 * The floor store, or null on a register that has no floor.
	 *
	 * Resolved per call rather than captured: the getter reaches the same
	 * instance the salón and the mesa strip hold, and a caller that supplies
	 * none is a plain retail register by definition.
	 */
	const resolveFloorStore = (): FloorStoreSeam | null => {
		try {
			return options.floorStore?.() || null;
		} catch {
			return null;
		}
	};

	/**
	 * A submitted sale must never leave a cuenta attached to the register.
	 *
	 * Whatever clears the cart next bumps `metadata.changeVersion`, and the
	 * floor's line sync answers a bumped version on a Record-Only register by
	 * pushing the cart's lines at `activeOrder` — an empty cart against a
	 * still-attached cuenta is "remove every line from Mesa 1". Detaching here
	 * is the same ordering `settleActiveOrder`, «Guardar · Volver» and
	 * «Cancelar venta» all take, applied to EVERY submit route: the settle path
	 * has already dropped the order (no-op), and the paths that cannot settle —
	 * an offline mesa sale saved to the queue, a register whose floor store the
	 * caller did not wire — stop short of wiping a cuenta they did not settle.
	 */
	const detachFloorOrderFromCart = () => {
		const floorStore = resolveFloorStore();
		if (floorStore?.activeOrder) floorStore.setActiveOrder(null);
	};

	const formatStockErrors = (errors: any[]) => {
		const settings = unref(stockSettings) || {};
		const profile = unref(posProfile) || {};
		const type = unref(invoiceType);

		// Logic for blocking sale
		let blockSaleBeyondAvailableQty = false;
		if (!["Order", "Quotation"].includes(type)) {
			const val = profile.posa_block_sale_beyond_available_qty;
			blockSaleBeyondAvailableQty =
				val === true ||
				val === "true" ||
				val === 1 ||
				val === "1" ||
				val === "Yes";
		}

		const msg = errors
			.map(
				(e) =>
					`${e.item_code} (${e.warehouse}) - ${formatFloat(e.available_qty)}`,
			)
			.join("\n");

		const blocking =
			!settings.allow_negative_stock || blockSaleBeyondAvailableQty;

		return blocking
			? __("Insufficient stock:\n{0}", [msg])
			: __("Stock is lower than requested:\n{0}", [msg]);
	};

	const formatStockIssueLines = (issues: any[]) =>
		issues
			.map(
				(issue) =>
					`${issue.item_code} (${issue.warehouse || __("Unknown Warehouse")}) - ${formatFloat(issue.available_qty)} / ${formatFloat(issue.requested_qty)} requested`,
			)
			.join("\n");

	const shouldValidateStockForSubmission = (doc: any, type: string) => {
		if (!doc || doc.is_return) {
			return false;
		}

		const doctype = String(doc.doctype || "").trim();
		if (
			["Order", "Quotation"].includes(type) ||
			["Sales Order", "Quotation", "Purchase Order"].includes(doctype)
		) {
			return false;
		}

		if (doctype === "Sales Invoice") {
			return parseBooleanSetting(doc.update_stock);
		}

		return true;
	};

	const validateStockBeforeOnlineSubmission = async (doc: any, profile: any, type: string) => {
		if (!shouldValidateStockForSubmission(doc, type)) {
			return;
		}

		const response = await frappe.call({
			method: "posawesome.posawesome.api.invoices.validate_cart_items",
			args: {
				items: JSON.stringify(doc.items || []),
				pos_profile: profile?.name,
			},
		});
		const payload = response?.message;
		const blockingErrors = Array.isArray(payload)
			? payload
			: Array.isArray(payload?.errors)
				? payload.errors
				: [];
		const warnings = Array.isArray(payload?.warnings)
			? payload.warnings
			: [];

		if (blockingErrors.length) {
			throw new Error(formatStockErrors(blockingErrors));
		}

		if (warnings.length) {
			stores?.toastStore?.show({
				title: __("Stock is lower than requested"),
				detail: formatStockIssueLines(warnings),
				color: "warning",
			});
		}
	};

	const extractSubmissionErrorMessage = (exc: any): string => {
		if (!exc) {
			return __("Unknown error");
		}
		if (isApiEnvelopeError(exc)) {
			return exc.envelope.ok
				? __("Unknown error")
				: exc.envelope.error.message || __("Unknown error");
		}
		if (exc?._server_messages) {
			try {
				const parsed = JSON.parse(exc._server_messages);
				if (Array.isArray(parsed) && parsed.length) {
					const first = parsed[0];
					// Check if message is a JSON string containing errors (stock validation)
					try {
						const msgObj = JSON.parse(first);
						if (msgObj.errors && Array.isArray(msgObj.errors)) {
							return formatStockErrors(msgObj.errors);
						}
					} catch {
						/* Not a JSON string */
					}

					if (typeof first === "string") {
						return frappe?.utils?.strip_html
							? frappe.utils.strip_html(first)
							: first;
					}
				}
			} catch {
				/* ignore parse issues */
			}
		}
		if (exc?.message) {
			try {
				const parsed = JSON.parse(exc.message);
				if (parsed.errors && Array.isArray(parsed.errors)) {
					return formatStockErrors(parsed.errors);
				}
			} catch {
				/* Not a JSON string */
			}
			return exc.message;
		}
		return exc.toString ? exc.toString() : __("Unknown error");
	};

	const getSubmissionErrorCode = (exc: any): string | null => {
		if (!isApiEnvelopeError(exc) || exc.envelope.ok) {
			return null;
		}
		return exc.envelope.error.code || null;
	};

	const buildSubmissionFailureToast = (exc: any, message: string) => {
		const code = getSubmissionErrorCode(exc);
		const requestId = isApiEnvelopeError(exc) ? exc.requestId : null;
		const detail = requestId
			? __("Request ID: {0}", [requestId])
			: undefined;

		if (code === "TIMEOUT" || code === "TRANSPORT_ERROR") {
			return {
				title: __("Connection problem while submitting invoice"),
				detail: detail ? `${message}\n${detail}` : message,
				color: "error",
			};
		}

		// HTTP_ERROR with a parsed server message (Frappe `_server_messages`
		// is decoded inside normalizeTransportFailure) is a real validation
		// or permission failure, not a transport hiccup. Surface the actual
		// reason so operators see "Rate outside ±20% band" / "POS Profile
		// required" instead of a generic "Connection problem".
		const looksLikeTransport =
			!message ||
			/^HTTP \d{3}$/i.test(message) ||
			/network request failed/i.test(message);
		if (code === "HTTP_ERROR") {
			return {
				title: looksLikeTransport
					? __("Connection problem while submitting invoice")
					: __("Unable to submit invoice"),
				detail: detail ? `${message}\n${detail}` : message,
				color: "error",
			};
		}

		if (code === "VALIDATION_ERROR" || code === "BUSINESS_RULE") {
			return {
				title: __("Unable to submit invoice"),
				detail: detail ? `${message}\n${detail}` : message,
				color: "error",
			};
		}

		return {
			title: __("Error submitting invoice: ") + message,
			detail,
			color: "error",
		};
	};

	const fetchSubmittedDocstatus = async (
		doc: any,
	): Promise<number | null> => {
		const doctype =
			doc?.doctype ||
			(unref(posProfile)?.create_pos_invoice_instead_of_sales_invoice
				? "POS Invoice"
				: "Sales Invoice");
		const name = doc?.name;
		if (!doctype || !name) {
			return null;
		}

		try {
			const result = await frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype,
					filters: { name },
					fieldname: ["docstatus"],
				},
			});
			const status = result?.message?.docstatus;
			return Number.isFinite(Number(status)) ? Number(status) : null;
		} catch (error) {
			console.warn(
				"Unable to verify submitted docstatus after conflict",
				error,
			);
			return null;
		}
	};

	const getWriteOffLimit = (profile: any): number | null => {
		if (!profile) return null;
		const possibleLimitFields = [
			"write_off_limit",
			"posa_max_write_off_amount",
			"max_write_off_amount",
			"write_off_amount",
			"posa_write_off_limit",
		];

		for (const field of possibleLimitFields) {
			const rawValue = profile?.[field];
			if (
				rawValue === undefined ||
				rawValue === null ||
				rawValue === ""
			) {
				continue;
			}
			const parsed = formatFloat(rawValue);
			if (parsed > 0) {
				return parsed;
			}
		}

		return null;
	};

	const getEffectiveWriteOffAmount = (
		doc: any,
		profile: any,
		diffAmount: number,
	): number => {
		if (!doc || doc.is_return || !unref(options.is_write_off_change)) {
			return 0;
		}

		const outstanding = Math.max(formatFloat(diffAmount), 0);
		if (outstanding <= 0) {
			return 0;
		}

		const requestedWriteOff = Math.max(
			formatFloat(doc?.write_off_amount || 0),
			0,
		);

		const writeOffLimit = getWriteOffLimit(profile);
		if (writeOffLimit === null) {
			return formatFloat(
				requestedWriteOff > 0
					? Math.min(requestedWriteOff, outstanding)
					: outstanding,
			);
		}

		const cappedByLimit = Math.min(outstanding, writeOffLimit);
		if (requestedWriteOff > 0) {
			return formatFloat(Math.min(requestedWriteOff, cappedByLimit));
		}

		return formatFloat(cappedByLimit);
	};

	const validateDueDate = () => {
		const doc = unref(invoiceDoc);
		if (!doc || !doc.due_date) return;

		const today = frappe?.datetime?.now_date?.();
		if (!today) return;

		const new_date = Date.parse(doc.due_date);
		const parse_today = Date.parse(today);
		if (new_date < parse_today) {
			doc.due_date = today;
		}
	};

	const validateSubmission = async (payment_received = false) => {
		const doc = unref(invoiceDoc);
		const profile = unref(posProfile);
		const prec = unref(options.currencyPrecision) || 2;
		const {
			isCashback,
			paidChange,
			creditChange,
			redeemedCustomerCredit,
			customerCreditDict,
			diff_payment,
		} = options;
		const diff = unref(diff_payment) || 0;
		const writeOffAmount = getEffectiveWriteOffAmount(doc, profile, diff);

		// 1. Ensure return payments are negative
		if (doc.is_return) {
			ensureReturnPaymentsAreNegative();

			// Never refund more cash than was actually paid on the original
			// invoice. Mirrors the backend guard, but blocks here so the cashier
			// gets one clean message instead of a failed submit round-trip
			// (which the API layer would surface as a "connection problem").
			if (doc.posa_refundable_amount != null) {
				let refund = 0;
				(doc.payments || []).forEach((p: any) => {
					refund += Math.abs(formatFloat(p.amount, prec));
				});
				const refundable = formatFloat(doc.posa_refundable_amount, prec);
				if (refund > refundable + 0.001) {
					throw new Error(
						__(
							'Cannot refund {0} for this return: only {1} was paid on the original invoice. Turn on "Store as Credit?" to record it as a credit note that reduces the customer\'s balance.',
							[refund, refundable],
						),
					);
				}
			}
		}

		let current_total_payments = 0;
		if (doc.payments) {
			doc.payments.forEach((p: any) => {
				current_total_payments += formatFloat(p.amount, prec);
			});
		}
		// Add loyalty and credit
		if (options.loyaltyAmount && unref(options.loyaltyAmount))
			current_total_payments += unref(options.loyaltyAmount)!;
		if (
			options.redeemedCustomerCredit &&
			unref(options.redeemedCustomerCredit)
		)
			current_total_payments += unref(options.redeemedCustomerCredit)!;
		if (
			options.giftCardRedemptions &&
			Array.isArray(unref(options.giftCardRedemptions))
		) {
			current_total_payments += unref(options.giftCardRedemptions).reduce(
				(sum: number, row: any) =>
					sum + formatFloat(row?.amount || 0, prec),
				0,
			);
		}

		const invoice_total = formatFloat(
			doc.rounded_total || doc.grand_total,
			prec,
		);
		const effective_total_payments = formatFloat(
			current_total_payments + writeOffAmount,
			prec,
		);
		const writeOffLimit = getWriteOffLimit(profile);
		const writeOffCappedByLimit =
			Boolean(unref(options.is_write_off_change)) &&
			writeOffLimit !== null &&
			diff > writeOffLimit + 0.001;
		const hasAnySettlement =
			effective_total_payments > 0 ||
			(Array.isArray(doc.payments)
				? doc.payments.some(
						(payment: any) =>
							formatFloat(payment?.amount || 0, prec) > 0,
					)
				: false);

		// 2. Validate total payments
		if (
			writeOffCappedByLimit &&
			!profile.posa_allow_partial_payment &&
			effective_total_payments < invoice_total - 0.001
		) {
			throw new Error(
				__(
					"Write off amount exceeds the allowed limit ({0}). Please add payment for the remaining amount.",
					[writeOffLimit],
				),
			);
		}

		if (
			!unref(options.is_credit_sale) &&
			!doc.is_return &&
			!hasAnySettlement &&
			invoice_total > 0
		) {
			throw new Error(__("Please enter payment amount"));
		}

		// 3. Validate partial payments / cash payments
		if (!unref(options.is_credit_sale) && !doc.is_return) {
			let has_cash_payment = false;
			let cash_amount = 0;
			if (doc.payments) {
				doc.payments.forEach((payment: any) => {
					if (
						payment.mode_of_payment.toLowerCase().includes("cash")
					) {
						has_cash_payment = true;
						cash_amount = formatFloat(payment.amount, prec);
					}
				});
			}

			if (has_cash_payment && cash_amount > 0) {
				if (
					!profile.posa_allow_partial_payment &&
					formatFloat(cash_amount + writeOffAmount, prec) <
						invoice_total &&
					invoice_total > 0
				) {
					throw new Error(
						__(
							"Cash payment cannot be less than invoice total when partial payment is not allowed",
						),
					);
				}
			}

			if (
				!profile.posa_allow_partial_payment &&
				effective_total_payments < invoice_total &&
				invoice_total > 0
			) {
				throw new Error(__("The amount paid is not complete"));
			}
		}

		// 4. Validate phone payment
		if (!payment_received && doc.payments) {
			let phone_payment_is_valid = true;
			doc.payments.forEach((payment: any) => {
				if (
					payment.type === "Phone" &&
					![0, "0", "", null, undefined].includes(payment.amount)
				) {
					phone_payment_is_valid = false;
				}
			});
			if (!phone_payment_is_valid) {
				throw new Error(
					__(
						"Please request phone payment or use another payment method",
					),
				);
			}
		}

		// 5. Validate paid_change
		const changeLimit = Math.max(-diff, 0);
		const pChange = unref(paidChange) || 0;
		if (pChange > changeLimit + 0.001) {
			throw new Error(
				__("Paid change cannot be greater than total change!"),
			);
		}

		// 6. Validate cashback
		const cChange = unref(creditChange) || 0;
		let total_change_calc = formatFloat(pChange + Math.abs(cChange), prec);
		if (
			unref(isCashback) &&
			Math.abs(total_change_calc - changeLimit) > 0.01
		) {
			throw new Error(__("Error in change calculations!"));
		}

		// 7. Validate customer credit redemption
		if (customerCreditDict?.value?.length) {
			let credit_calc_check = customerCreditDict.value.filter(
				(row: any) => {
					return (
						formatFloat(row.credit_to_redeem, prec) >
						formatFloat(row.total_credit, prec)
					);
				},
			);
			if (credit_calc_check.length > 0) {
				throw new Error(
					__("Redeemed credit cannot be greater than its total."),
				);
			}
		}

		if (
			!doc.is_return &&
			unref(redeemedCustomerCredit) !== undefined &&
			unref(redeemedCustomerCredit)! > invoice_total
		) {
			throw new Error(
				__("Cannot redeem customer credit more than invoice total"),
			);
		}

		const giftCardRows = Array.isArray(options.giftCardRedemptions?.value)
			? options.giftCardRedemptions?.value || []
			: [];
		const totalGiftCardRedemption = giftCardRows.reduce(
			(sum: number, row: any) =>
				sum + formatFloat(row?.amount || 0, prec),
			0,
		);
		const invalidGiftCardRow = giftCardRows.find(
			(row: any) =>
				formatFloat(row?.amount || 0, prec) > 0 &&
				!String(row?.gift_card_code || "").trim(),
		);
		if (invalidGiftCardRow) {
			throw new Error(__("Gift card code is required for redemption"));
		}
		if (!doc.is_return && totalGiftCardRedemption > invoice_total + 0.001) {
			throw new Error(
				__("Cannot redeem gift cards more than invoice total"),
			);
		}

		return true;
	};

	const buildSubmissionInvoiceDoc = (doc: any) => {
		const submissionDoc = JSON.parse(JSON.stringify(doc || {}));
		ensureInvoiceClientRequestId(submissionDoc);
		return submissionDoc;
	};

	function ensureReturnPaymentsAreNegative() {
		const doc = unref(invoiceDoc);
		if (!doc || !doc.is_return) {
			return;
		}
		// Check if any payment amount is set
		let hasPaymentSet = false;
		if (doc.payments) {
			doc.payments.forEach((payment: any) => {
				if (Math.abs(payment.amount) > 0) {
					hasPaymentSet = true;
				}
			});
		}

		// Credit returns intentionally keep payment rows at 0. If a non-zero row
		// exists, it still must be negative for ERPNext return validation.
		if (!hasPaymentSet && unref(options.isCashback) === false) {
			return;
		}

		// If no payment set, set the default one
		if (!hasPaymentSet && doc.payments) {
			const default_payment = doc.payments.find(
				(payment: any) => payment.default === 1,
			);
			if (default_payment) {
				const amount = doc.rounded_total || doc.grand_total;
				default_payment.amount = -Math.abs(amount);
				if (default_payment.base_amount !== undefined) {
					default_payment.base_amount = -Math.abs(amount);
				}
			}
		}
		// Ensure all set payments are negative
		if (doc.payments) {
			doc.payments.forEach((payment: any) => {
				if (payment.amount > 0) {
					payment.amount = -Math.abs(payment.amount);
				}
				if (
					payment.base_amount !== undefined &&
					payment.base_amount > 0
				) {
					payment.base_amount = -Math.abs(payment.base_amount);
				}
			});
		}
	}

	function restoreReturnPayments() {
		const doc = unref(invoiceDoc);
		if (!doc?.payments) {
			return;
		}

		doc.payments.forEach((payment: any) => {
			if (payment.amount < 0) {
				payment.amount = Math.abs(payment.amount);
			}
			if (payment.base_amount !== undefined && payment.base_amount < 0) {
				payment.base_amount = Math.abs(payment.base_amount);
			}
		});
	}

	const submitInvoice = async (
		print: boolean,
		callbacks: SubmissionCallbacks = {},
	): Promise<any> => {
		const doc = unref(invoiceDoc);
		const profile = unref(posProfile);
		const type = unref(invoiceType);
		const prec = unref(options.currencyPrecision) || 2;
		const {
			isCashback,
			paidChange,
			creditChange,
			redeemedCustomerCredit,
			customerCreditDict,
			diff_payment,
		} = options;

		const {
			onSuccess,
			onPrint,
			onFinishNavigation: finishNavigation,
			onChangeDue,
			onScheduleBackgroundCheck,
		} = callbacks;

		// Every «the sale is done, clear the register» exit in this function
		// goes through this binding, so the detach above rides all of them
		// without eight call sites having to remember it. Still undefined when
		// the caller passed nothing — a submit with no navigation callback does
		// not clear the cart, so it has nothing to protect the cuenta from.
		const onFinishNavigation = finishNavigation
			? (success: boolean) => {
					if (success) detachFloorOrderFromCart();
					finishNavigation(success);
				}
			: undefined;

		if (doc.is_return) {
			ensureReturnPaymentsAreNegative();
		}

		let totalPayedAmount = 0;
		if (doc.payments) {
			doc.payments.forEach((payment: any) => {
				payment.amount = formatFloat(payment.amount, prec);
				totalPayedAmount += payment.amount;
			});
		}

		if (doc.is_return && totalPayedAmount === 0) {
			doc.is_pos = 0;
		}

		if (customerCreditDict?.value?.length) {
			customerCreditDict.value.forEach((row: any) => {
				row.credit_to_redeem = formatFloat(row.credit_to_redeem, prec);
			});
		}

		const diff = unref(diff_payment) || 0;
		const writeOffAmount = getEffectiveWriteOffAmount(doc, profile, diff);
		const changeLimit = !doc.is_return ? Math.max(-diff, 0) : 0;
		let pChange = !doc.is_return
			? formatFloat(Math.min(unref(paidChange) || 0, changeLimit), prec)
			: 0;
		let cChange = !doc.is_return
			? formatFloat(Math.max(changeLimit - pChange, 0), prec)
			: 0;

		if (
			!doc.is_return &&
			changeLimit > 0 &&
			pChange <= 0 &&
			Array.isArray(doc.payments)
		) {
			const configuredCashMop = String(
				profile?.posa_cash_mode_of_payment || "",
			).toLowerCase();
			const paidRows = doc.payments.filter(
				(payment: any) => formatFloat(payment?.amount || 0, prec) > 0,
			);
			const hasCashPaid = paidRows.some((payment: any) => {
				const mode = String(
					payment?.mode_of_payment || "",
				).toLowerCase();
				const type = String(payment?.type || "").toLowerCase();
				if (type === "cash") return true;
				if (configuredCashMop && mode === configuredCashMop)
					return true;
				return mode.includes("cash");
			});
			const hasNonCashPaid = paidRows.some((payment: any) => {
				const mode = String(
					payment?.mode_of_payment || "",
				).toLowerCase();
				const type = String(payment?.type || "").toLowerCase();
				if (type === "cash") return false;
				if (configuredCashMop && mode === configuredCashMop)
					return false;
				return !mode.includes("cash");
			});

			if (hasNonCashPaid && !hasCashPaid) {
				pChange = formatFloat(changeLimit, prec);
				cChange = 0;
			}
		}

		if (doc) {
			ensureInvoiceClientRequestId(doc);
			// Belt-and-suspenders for the backend scope assertions in
			// invoice_processing/creation.py:1025-1027 (PR-1 security
			// hardening). submit_invoice reads pos_profile/company/customer
			// from the serialized invoice doc, not from `data`. If any
			// flow constructs/edits the doc without re-seeding from the
			// active POS Profile, the submit POST 403s with
			// "POS Profile is required for this action." Restamp here
			// so the doc is always in scope by the time we serialize.
			doc.pos_profile = doc.pos_profile || profile?.name;
			doc.company = doc.company || profile?.company;
			doc.customer = doc.customer || profile?.customer;
			doc.write_off_amount = writeOffAmount;
			doc.base_write_off_amount = formatFloat(
				writeOffAmount * (doc.conversion_rate || 1),
				prec,
			);
			doc.paid_change = pChange;
			doc.credit_change = cChange;
		}

		if (!doc.is_return) {
			if (creditChange) creditChange.value = cChange;
			if (paidChange) paidChange.value = pChange;
		}

		const data = {
			total_change: changeLimit,
			paid_change: pChange,
			credit_change: cChange,
			is_credit_sale: unref(options.is_credit_sale) ? 1 : 0,
			is_write_off_change: unref(options.is_write_off_change) ? 1 : 0,
			write_off_amount: writeOffAmount,
			redeemed_customer_credit: unref(redeemedCustomerCredit),
			customer_credit_dict: unref(customerCreditDict),
			gift_card_redemptions: unref(options.giftCardRedemptions) || [],
			is_cashback: unref(isCashback),
		};
		const hasGiftCardRedemption =
			Array.isArray(data.gift_card_redemptions) &&
			data.gift_card_redemptions.some(
				(row: any) => formatFloat(row?.amount || 0, prec) > 0,
			);
		const hasPostSubmitPaymentWork =
			Boolean(profile?.posa_allow_submissions_in_background_job) &&
			(formatFloat(unref(redeemedCustomerCredit) || 0, prec) > 0 ||
				hasGiftCardRedemption ||
				pChange > 0 ||
				cChange > 0);

		if (isOffline()) {
			if (hasGiftCardRedemption) {
				throw new Error(
					__("Gift card redemption requires an online connection"),
				);
			}
			// Store-credit redemption offline reads a CACHED balance, so two
			// terminals could each redeem the same last balance and only the
			// second dead-letters on sync — after the goods left. The balance
			// must be verified live, like gift cards.
			if (formatFloat(unref(redeemedCustomerCredit) || 0, prec) > 0) {
				throw new Error(
					__("Customer credit redemption requires an online connection"),
				);
			}
			try {
				const offlineSaveStartedAt =
					typeof performance !== "undefined" ? performance.now() : Date.now();
				await saveOfflineInvoice({ data, invoice: doc });
				try {
					const { track, trackCustomMark } = await import("../../../utils/telemetry");
					track("pos:offline_invoice_saved", Number(doc?.grand_total) || 0, {
						items: (doc?.items || []).length,
					});
					// Benchmark row durable_queue_acceptance
					// (perf:pos:offline_save_ms): time to durably persist the
					// sale in IndexedDB. pos:offline_invoice_saved above
					// carries MONEY (grand_total), not latency.
					trackCustomMark(
						"pos:offline_save_ms",
						(typeof performance !== "undefined" ? performance.now() : Date.now()) -
							offlineSaveStartedAt,
					);
				} catch {
					/* never block the offline save */
				}
				stores?.syncStore?.updatePendingCount();
				stores?.toastStore?.show({
					title: __("Invoice saved offline"),
					color: "warning",
				});

				if (print && onPrint) {
					onPrint(doc);
				}

				if (stores?.customersStore?.setSelectedCustomer) {
					stores.customersStore.setSelectedCustomer(
						profile?.customer || null,
					);
				}

				if (onFinishNavigation) onFinishNavigation(true);

				return { offline: true };
			} catch (error: any) {
				const errorMsg = error.message || __("Unknown error");
				stores?.toastStore?.show({
					title: __("Cannot Save Offline Invoice: ") + errorMsg,
					color: "error",
				});
				throw error;
			}
		}

		// Online Submission
		try {
			await validateStockBeforeOnlineSubmission(doc, profile, type);
			const submissionDoc = buildSubmissionInvoiceDoc(doc);
			// Record-Only table service settles THROUGH the table order: the server
			// merges the ticket's lines over this payload and routes the result into
			// the SAME submission ledger. Inert for retail and for a counter
			// register in Sales Invoice mode, where `isRecordOnly` is false.
			// The store comes from the caller (see `options.floorStore`) — a
			// module-level lookup here reached a second pinia and read a floor
			// nobody was standing on, which is why this branch never taken.
			const floorStore = resolveFloorStore();
			let message;
			if (floorStore?.isRecordOnly && floorStore.activeOrder) {
				const queuedOrderUid = floorStore.activeOrder.order_uid;
				// `settle_table_order`'s payload IS the invoice document, with
				// the submit metadata nested under `data` — the server splits
				// them straight back into `submit_invoice(invoice, data)`. The
				// tendered `payments` therefore have to ride at the top level:
				// nested under a key the server does not read, `update_invoice`
				// re-derives the payments table from the POS Profile and zeroes
				// it, and the submit dies on "El total pagado 0.0 no coincide
				// con el total de la factura". Lines and provenance still come
				// from the ORDER — the payload does not get a vote on those.
				const settled = await floorStore.settleActiveOrder(
					{
						...submissionDoc,
						data,
					},
					unref(options.restaurantTipAmount) || 0,
				);
				if (settled.queued) {
					// Offline: the settle is QUEUED, not submitted. It replays on
					// reconnect under the SAME client_request_id, so the submission
					// ledger dedupes it — a lost ack cannot double-bill. Nothing
					// exists server-side yet: no fiscal print, no last-invoice
					// stamp. Mirror the TAECEL `held` path: free the register for
					// the next customer; the floor tile keeps the ticket visible
					// with its pending badge until the drain confirms.
					void emitSaleCycle({
						held: false,
						background: true,
						itemCount: (doc?.items || []).length,
					});
					stores?.toastStore?.show({
						title: __("Sin conexión — cuenta en cola"),
						detail: __(
							"Se cobrará automáticamente al reconectar. No se imprime recibo todavía.",
						),
						color: "info",
						timeout: 6000,
					});
					if (stores?.customersStore?.setSelectedCustomer) {
						stores.customersStore.setSelectedCustomer(profile?.customer || null);
					}
					if (onFinishNavigation) onFinishNavigation(true);
					return { queued: true, orderUid: queuedOrderUid };
				}
				// Contract: a fresh online settle returns the submit result under
				// `invoice`; an idempotent REPLAY returns the name only
				// (settle.py deliberately does not re-read the doc). Either way
				// `idempotent: true` is success, never an error. The stub covers
				// the replay path: `submittedDocument` spreads it over the local
				// doc, so the receipt still carries the cart's lines — which on
				// the common ack-loss replay never printed on attempt one.
				message = settled.invoice
					? settled.invoice
					: { name: settled.salesInvoice, docstatus: 1, status: "Paid" };
			} else {
				message = unwrapApiResult(
					await invoiceService.submitInvoice(data, submissionDoc, type, profile),
				);
			}

			const r = { message };

			if (!r.message) {
				const reason = __("No response from server");
				const failedInfo = {
					invoice: doc?.name,
					reason,
				};

				stores?.toastStore?.show({
					title: __(
						"Error submitting invoice: No response from server",
					),
					color: "error",
				});
				const err: any = new Error(reason);
				err.failedInfo = failedInfo;
				throw err;
			}

			const docstatus = r.message?.docstatus;
			const status = r.message?.status;
			const responseInvoiceName = r.message?.name || doc?.name;
			const backgroundReason =
				r.message?.error ||
				r.message?.exc ||
				r.message?.exception ||
				r.message?.message;

			const wasSubmitted =
				docstatus === 1 ||
				status === 1 ||
				(docstatus === undefined && status === undefined);
			const waitForInvoiceProcessing =
				Boolean(profile?.posa_allow_submissions_in_background_job) &&
				!wasSubmitted;
			const submittedDoctype =
				r.message?.doctype ||
				doc?.doctype ||
				(profile?.create_pos_invoice_instead_of_sales_invoice
					? "POS Invoice"
					: "Sales Invoice");
			const submittedDocstatus =
				docstatus !== undefined
					? docstatus
					: status !== undefined
						? status
						: 1;
			const submittedDocument = {
				...doc,
				...(typeof r.message === "object" ? r.message : {}),
				name: responseInvoiceName,
				doctype: submittedDoctype,
				docstatus: submittedDocstatus,
			};

			// SALDO-INTEGRATION-POINT — hold-until-confirm: the server parked
			// the draft while TAECEL runs (posawesome_submit_hold_gates). No
			// print now — the sale auto-submits + prints on confirmation and
			// the SaldoHoldsBadge tracks it. Clear the cart for the next
			// customer immediately.
			if (r.message?.held) {
				void emitSaleCycle({ held: true, background: false, itemCount: (doc?.items || []).length });
				stores?.toastStore?.show({
					title: __("Venta en espera de confirmación TAECEL"),
					detail: r.message?.hold_detail?.message || "",
					color: "info",
					timeout: 6000,
				});
				try {
					const { saldoBus } = await import("@saldo/useSaldoCapture");
					saldoBus.emit("saldo:hold_registered", {
						invoice: responseInvoiceName,
						doctype: submittedDoctype,
					});
				} catch {
					// saldo app absent → gate can't fire server-side either.
				}
				// Web route: frappe-shim never joins the user room, so the
				// pos_invoice_processed fired on hold resume only arrives via
				// the doc room — subscribe the parked invoice now or the badge
				// never hears the resume and the ticket never auto-prints.
				try {
					const { useSocketStore } = await import("../../../stores/socketStore");
					useSocketStore().subscribeToInvoiceDoc(responseInvoiceName, submittedDoctype);
				} catch {
					// Non-fatal: the Desk route still delivers via the user room.
				}
				if (stores?.customersStore?.setSelectedCustomer) {
					stores.customersStore.setSelectedCustomer(
						profile?.customer || null,
					);
				}
				if (onFinishNavigation) onFinishNavigation(true);
				return { held: true, name: responseInvoiceName };
			}

			if (!wasSubmitted && backgroundReason) {
				const failedInfo = {
					invoice: responseInvoiceName,
					reason: backgroundReason,
				};

				stores?.toastStore?.show({
					title: __("Error submitting invoice: {0}", [
						responseInvoiceName || "",
					]),
					color: "error",
					detail: backgroundReason,
				});

				// Background job specific logic
				if (profile?.posa_allow_submissions_in_background_job) {
					if (onFinishNavigation) onFinishNavigation(true);
					if (onScheduleBackgroundCheck) {
						onScheduleBackgroundCheck({
							name: responseInvoiceName,
							doctype: r.message?.doctype,
							print,
							waitForPostSubmitPayments: false,
							waitForInvoiceProcessing: true,
						});
					}
					// Return special status indicating background failure handled
					return {
						backgroundFailure: true,
						reason: backgroundReason,
					};
				}

				const err: any = new Error(backgroundReason);
				err.failedInfo = failedInfo;
				throw err;
			}

			// Success
			if (
				print &&
				onPrint &&
				!waitForInvoiceProcessing &&
				!hasPostSubmitPaymentWork
			) {
				onPrint(submittedDocument, {
					name: responseInvoiceName,
					doctype: submittedDoctype,
					waitForPostSubmitPayments: hasPostSubmitPaymentWork,
					waitForInvoiceProcessing,
				});
			}

			void emitSaleCycle({
				held: false,
				background: waitForInvoiceProcessing,
				itemCount: (doc?.items || []).length,
			});

			// Reset local state vars
			if (customerCreditDict) customerCreditDict.value = [];

			stores?.invoiceStore?.mergeInvoiceDoc?.({
				docstatus: submittedDocstatus,
				name: responseInvoiceName,
				doctype: submittedDoctype,
			});

			if (stores?.uiStore && Number(submittedDocstatus) === 1) {
				// Store the server-assigned name, not the pre-submit doc.name —
				// they diverge on amended/renamed invoices, which would make the
				// reprint fetch a name that doesn't exist server-side.
				// Docstatus-gated: a background submit answers with docstatus 0,
				// and stamping then hands the navbar reprint a DRAFT to print
				// (backtrace B3) — the deferred workflow stamps once confirmed.
				stores.uiStore.setLastInvoice(responseInvoiceName);
			}

			// Pull-model billing: if this draft was built from a charge
			// request (remarks marker), flip it to Charged now that the
			// invoice is real. Fire-and-forget with retry — failures toast
			// loudly, never silently.
			const chargeRequestMatch = String(doc?.remarks || "").match(
				CHARGE_REQUEST_MARKER,
			);
			if (chargeRequestMatch?.[1] && responseInvoiceName) {
				void markChargeRequestCharged(
					stores,
					chargeRequestMatch[1],
					profile?.name || doc?.pos_profile || "",
					submittedDoctype,
					responseInvoiceName,
				);
			}

			if (!waitForInvoiceProcessing) {
				const submittedTitle =
					submittedDoctype === "Sales Order"
						? __("Sales Order {0} is Submitted", [responseInvoiceName])
						: submittedDoctype === "Quotation"
							? __("Quotation {0} is Submitted", [responseInvoiceName])
							: __("Invoice {0} is Submitted", [responseInvoiceName]);
				stores?.toastStore?.show(
					hasPostSubmitPaymentWork
						? {
								key: `invoice-processing::${responseInvoiceName}`,
								title: __("Invoice Submitted"),
								summary: submittedTitle,
								detail: __(
									"Processing payment entries for Invoice {0}",
									[responseInvoiceName],
								),
								color: "info",
								timeout: -1,
								loading: true,
							}
						: {
								key: `invoice-processing::${responseInvoiceName}`,
								title: submittedTitle,
								color: "success",
							},
				);
			}

			if (frappe?.utils?.play_sound) {
				frappe.utils.play_sound("submit");
			}

			// The cashier's next physical act is handing money back — say
			// how much, loudly, so nobody re-reads the Cambio field or does
			// drawer math. pChange is what the server just booked as the
			// change Payment Entry, so the number and the GL always agree.
			// The handler raises a blocking dialog the cashier must dismiss:
			// the toast this replaced was small and self-dismissing, and at a
			// live counter it was routinely missed (Marco, 2026-08-10). It is
			// called after onPrint above and never awaited, so Submit & Print
			// keeps printing behind the dialog. The toast survives only as the
			// fallback for a caller that wires no handler.
			if (pChange > 0 && !doc.is_return) {
				const changeDue = {
					amount: pChange,
					currency: doc.currency,
					invoice: responseInvoiceName,
				};
				if (onChangeDue) {
					onChangeDue(changeDue);
				} else {
					stores?.toastStore?.show({
						title: __("Give back change: {0}", [
							options.formatCurrency
								? options.formatCurrency(pChange, doc.currency)
								: `${pChange}`,
						]),
						color: "warning",
						timeout: 12000,
					});
				}
			}

			// The sale closed, and this says so whatever the change came to.
			// `show_change_due` above cannot: it only fires when there is money
			// to hand back, so an exact-paid sale — every card sale, most
			// transfers — closed without the register announcing it and the
			// customer's screen never reached «Gracias».
			//
			// Here and not in the offline or queued branches above: both of
			// those return before this line, and deliberately. A queued sale has
			// been accepted by this register, not by the server; nothing is
			// booked and nothing is paid, so thanking the customer for it would
			// claim a payment that has not happened.
			//
			// Emitted AFTER `show_change_due` so that on a change sale the
			// server-booked figure is the one that reaches any listener first.
			bus.emit("invoice_submitted", {
				invoice: responseInvoiceName,
				currency: doc.currency,
				...(pChange > 0 && !doc.is_return ? { change_amount: pChange } : {}),
				is_return: Boolean(doc.is_return),
			});

			const submittedItems = Array.isArray(submittedDocument.items)
				? submittedDocument.items
				: [];
			updateLocalStock(submittedItems);
			stockCoordinator.applyInvoiceConsumption(submittedItems, {
				source: "invoice",
			});
			const submittedCodes = submittedItems
				.map((item) => (item ? item.item_code : null))
				.filter((code) => code !== undefined && code !== null);

			if (stores?.uiStore) {
				stores.uiStore.setLastStockAdjustment({
					items: submittedItems,
					item_codes: submittedCodes,
					timestamp: Date.now(),
				});
			}

			if (onFinishNavigation) onFinishNavigation(true);

			if (stores?.customersStore?.setSelectedCustomer) {
				stores.customersStore.setSelectedCustomer(
					profile?.customer || null,
				);
			}

			if (
				onScheduleBackgroundCheck &&
				(waitForInvoiceProcessing || hasPostSubmitPaymentWork)
			) {
				onScheduleBackgroundCheck({
					name: responseInvoiceName,
					doctype: submittedDoctype,
					print,
					waitForPostSubmitPayments: hasPostSubmitPaymentWork,
					waitForInvoiceProcessing,
				});
			}

			if (onSuccess) {
				onSuccess(r.message);
			}

			return { success: true, message: r.message };
		} catch (exc: any) {
			const errorCode = getSubmissionErrorCode(exc);
			const requestId = isApiEnvelopeError(exc)
				? exc.requestId
				: undefined;
			console.error("Error submitting invoice:", {
				code: errorCode,
				requestId,
				error: exc,
			});
			const errorMsg = extractSubmissionErrorMessage(exc);

			if (errorCode === "TIMESTAMP_MISMATCH") {
				const submittedStatus = await fetchSubmittedDocstatus(doc);
				if (submittedStatus === 1) {
					stores?.toastStore?.show({
						title: __("Invoice {0} was already submitted", [
							doc?.name || "",
						]),
						color: "warning",
					});

					if (stores?.uiStore && doc?.name) {
						stores.uiStore.setLastInvoice(doc.name);
					}

					if (onFinishNavigation) {
						onFinishNavigation(true);
					}

					if (stores?.customersStore?.setSelectedCustomer) {
						stores.customersStore.setSelectedCustomer(
							profile?.customer || null,
						);
					}

					// The sale IS submitted — `fetchSubmittedDocstatus` just
					// confirmed docstatus 1 — it merely came back through the
					// duplicate-submission door. Every other success path
					// prints here; without this the operator's timestamp
					// collision cost the customer their ticket, silently
					// (backtrace W4). No deferred wait: the doc is already
					// confirmed, so this is the immediate print path.
					if (print && onPrint) {
						onPrint(doc, {
							name: doc?.name,
							doctype: doc?.doctype,
						});
					}

					if (onSuccess) {
						onSuccess({
							name: doc?.name,
							doctype: doc?.doctype,
							docstatus: 1,
							recovered: true,
						});
					}

					return {
						recoveredDuplicateSubmission: true,
						message: {
							name: doc?.name,
							doctype: doc?.doctype,
							docstatus: 1,
						},
					};
				}
			}

			if (errorCode === "RETURN_PAYMENT_AMOUNT_SIGN") {
				stores?.toastStore?.show({
					title: __("Fixing payment amounts for return invoice..."),
					color: "warning",
				});

				if (doc.payments) {
					doc.payments.forEach((payment: any) => {
						if (payment.amount > 0)
							payment.amount = -Math.abs(payment.amount);
						if (payment.base_amount > 0)
							payment.base_amount = -Math.abs(
								payment.base_amount,
							);
					});
				}
				// Retry
				debugLog("Retrying submission with fixed payment amounts");
				return new Promise((resolve) =>
					setTimeout(
						() => resolve(submitInvoice(print, callbacks)),
						500,
					),
				);
			}

			stores?.toastStore?.show(
				buildSubmissionFailureToast(exc, errorMsg),
			);

			if (profile?.posa_allow_submissions_in_background_job) {
				if (onFinishNavigation) onFinishNavigation(true);
				if (onScheduleBackgroundCheck) {
					onScheduleBackgroundCheck({
						name: doc?.name,
						doctype: doc?.doctype,
						print,
						waitForPostSubmitPayments: false,
						waitForInvoiceProcessing: true,
					});
				}
			}

			throw exc;
		}
	};

	return {
		validateDueDate,
		ensureReturnPaymentsAreNegative,
		restoreReturnPayments,
		validateSubmission,
		submitInvoice,
		extractSubmissionErrorMessage,
	};
}
