import { ownsQueueEntry } from "./queueOwnership";
import { isOffline } from "./db";
import { syncOfflineCustomers } from "./customers";
import {
	claimRetryableQueueEntries,
	clearWriteQueueEntries,
	deleteWriteQueueEntryByIndex,
	deleteWriteQueueEntry,
	getQueueEntries,
	enqueueWriteQueueEntry,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	markWriteQueueEntryFailed,
	markWriteQueueEntrySynced,
	type OfflineEntityType,
} from "./writeQueue";

type AnyRecord = Record<string, any>;

const PAYMENT_ENTITY: OfflineEntityType = "payment";

function prepareOfflinePaymentEntry(entry: AnyRecord) {
	const nextEntry = JSON.parse(JSON.stringify(entry));

	if (nextEntry?.args?.payload?.pos_profile && typeof nextEntry.args.payload.pos_profile === "object") {
		const profile = nextEntry.args.payload.pos_profile;
		nextEntry.args.payload.pos_profile = {
			posa_use_pos_awesome_payments:
				profile.posa_use_pos_awesome_payments,
			posa_allow_make_new_payments: profile.posa_allow_make_new_payments,
			posa_allow_reconcile_payments:
				profile.posa_allow_reconcile_payments,
			posa_allow_mpesa_reconcile_payments:
				profile.posa_allow_mpesa_reconcile_payments,
			cost_center: profile.cost_center,
			posa_cash_mode_of_payment: profile.posa_cash_mode_of_payment,
			name: profile.name,
		};
	}

	return nextEntry;
}

export async function saveOfflinePayment(entry: AnyRecord) {
	try {
		const cleanEntry = prepareOfflinePaymentEntry(entry);
		return await enqueueWriteQueueEntry(PAYMENT_ENTITY, cleanEntry);
	} catch (error) {
		console.error("Failed to serialize offline payment", error);
		throw error;
	}
}

export function getOfflinePayments() {
	return getQueuedPayloadSnapshots(PAYMENT_ENTITY);
}

export async function getPendingAdvanceRefund(originalPayment: string) {
	const entries = await getQueueEntries(PAYMENT_ENTITY);
	const matches = entries.filter((entry) => entry.payload?.args?.payload?.operation === "refund_customer_advance"
		&& entry.payload.args.payload.original_payment_entry === originalPayment);
	if (matches.length > 1) throw new Error(__("Multiple pending refunds need review before another refund."));
	return matches[0] || null;
}

function verifyPaymentResult(result: AnyRecord) {
	// The processor deliberately returns HTTP 200 for partial failures so
	// successful tenders can commit. HTTP success alone cannot acknowledge
	// the queued intent: its original ID must survive for the remaining work.
	const submitted = (entry: AnyRecord) => entry && typeof entry.name === "string" &&
		entry.name.length > 0 && Number(entry.docstatus) === 1;
	if (!result || !Array.isArray(result.errors) || result.errors.length ||
		!Array.isArray(result.new_payments_entry) || !Array.isArray(result.all_payments_entry) ||
		!Array.isArray(result.reconciled_payments) || !result.all_payments_entry.length ||
		!result.all_payments_entry.every(submitted) || !result.new_payments_entry.every(submitted) ||
		!result.reconciled_payments.every((entry: AnyRecord) => entry &&
			typeof entry.payment_entry === "string" && entry.payment_entry.length > 0 &&
			Number.isFinite(Number(entry.allocated_amount)) && Number(entry.allocated_amount) > 0)) {
		throw new Error(__("Payment is not fully confirmed. Keep the original request and review pending payments before retrying."));
	}
}

function verifyAdvanceRefundResult(payload: AnyRecord, result: AnyRecord) {
	if (Number(result?.docstatus) !== 1 || !result?.refund_payment_entry ||
		result?.client_request_id !== payload.client_request_id ||
		result?.original_payment_entry !== payload.original_payment_entry ||
		!Number.isFinite(Number(result?.refunded_amount)) ||
		Math.abs(Number(result.refunded_amount) - Number(payload.amount)) > 0.0001) {
		throw new Error(__("Refund is not confirmed. Check pending payments before handing out cash."));
	}
}

/** Persist the confirmed intent before HTTP; an uncertain result keeps its ID. */
export async function submitAdvanceRefund(payload: AnyRecord) {
	if (isOffline()) throw new Error(__("Reconnect to refund an unused advance."));
	const pending = await getPendingAdvanceRefund(payload.original_payment_entry);
	if (pending && pending.payload.args.payload.client_request_id !== payload.client_request_id) {
		throw new Error(__("Review the existing pending refund before starting another."));
	}
	const entry = pending || await saveOfflinePayment({ args: { payload } });
	const saved = entry.payload.args.payload;
	const response = await frappe.call({
		method: "posawesome.posawesome.api.payment_entry.process_pos_payment",
		args: { payload: saved },
	});
	verifyAdvanceRefundResult(saved, response?.message);
	await deleteWriteQueueEntry(PAYMENT_ENTITY, Number(entry.queue_id));
	return response.message;
}

export async function clearOfflinePayments() {
	await clearWriteQueueEntries(PAYMENT_ENTITY);
}

export async function deleteOfflinePayment(index: number) {
	await deleteWriteQueueEntryByIndex(PAYMENT_ENTITY, index);
}

export function getPendingOfflinePaymentCount() {
	return getQueuedPayloadCount(PAYMENT_ENTITY);
}

export async function syncOfflinePayments() {
	await syncOfflineCustomers();

	const payments = getOfflinePayments();
	if (!payments.length) {
		return { pending: 0, synced: 0 };
	}
	if (isOffline()) {
		return { pending: payments.length, synced: 0 };
	}

	const claimedEntries = await claimRetryableQueueEntries(PAYMENT_ENTITY);
	if (!claimedEntries.length) {
		return { pending: getPendingOfflinePaymentCount(), synced: 0 };
	}

	let synced = 0;

	for (const entry of claimedEntries) {
		if (!ownsQueueEntry(entry)) break;
		try {
			const response = await frappe.call({
				method: "posawesome.posawesome.api.payment_entry.process_pos_payment",
				args: entry.payload.args,
			});
			if (entry.payload.args?.payload?.operation === "refund_customer_advance") {
				verifyAdvanceRefundResult(entry.payload.args.payload, response?.message);
			} else {
				verifyPaymentResult(response?.message);
			}
			synced += 1;
			await markWriteQueueEntrySynced(
				PAYMENT_ENTITY,
				Number(entry.queue_id),
				entry.last_attempt_at,
			);
		} catch (error) {
			console.error("Failed to submit payment", error);
			await markWriteQueueEntryFailed(
				PAYMENT_ENTITY,
				Number(entry.queue_id),
				error,
				entry.last_attempt_at,
			);
		}
	}

	return { pending: getPendingOfflinePaymentCount(), synced };
}
