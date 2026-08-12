import { isOffline, memory, persist } from "./db";
import { syncOfflineCustomers } from "./customers";
import { reduceCacheUsage } from "./cache";
import { ensureOfflineInvoiceRequest } from "./idempotency";
import {
	enqueueInvoiceOutboxEntry,
	getInvoiceOutboxMode,
	syncInvoiceOutboxResource,
	shouldWriteInvoiceOutbox,
} from "./invoiceOutbox";
import { updateLocalStock } from "./stock";
import {
	claimRetryableQueueEntries,
	clearWriteQueueEntries,
	deleteWriteQueueEntryByIndex,
	enqueueWriteQueueEntry,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	markWriteQueueEntryDrafted,
	markWriteQueueEntryFailed,
	markWriteQueueEntrySynced,
	type OfflineEntityType,
} from "./writeQueue";

type AnyRecord = Record<string, any>;

const INVOICE_ENTITY: OfflineEntityType = "invoice";

function draftReasonFromError(error: unknown) {
	let message: string;
	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === "string") {
		message = error;
	} else if (
		error &&
		typeof error === "object" &&
		typeof (error as AnyRecord).message === "string"
	) {
		message = (error as AnyRecord).message;
	} else {
		try {
			message = JSON.stringify(error);
		} catch {
			message = String(error);
		}
	}
	return String(message || "submit_invoice failed").slice(0, 300);
}

// A re-drafted retry must UPDATE the draft the previous pass minted, not mint
// a sibling: update_invoice looks up by data.name only, and two drafts with
// the same posa_client_request_id are BOTH submittable from Desk (core submit
// skips the request-id idempotency) — a double-bill. The name survives the
// operator requeue precisely so this adoption works.
function buildDraftFallbackPayload(
	invoice: AnyRecord,
	priorDraftName: unknown,
): AnyRecord {
	const name = String(priorDraftName || "").trim();
	return name ? { ...invoice, name } : invoice;
}

const asBoolean = (value: any): boolean => {
	return (
		value === true ||
		value === 1 ||
		value === "1" ||
		value === "true" ||
		value === "Yes" ||
		value === "yes"
	);
};

let invoiceSyncInProgress = false;
let invoiceSyncStartedAt: number | null = null;

/**
 * How long a drain may hold the single-flight guard before a resume is allowed
 * to release it. Matched to the write queue's `SYNCING_LEASE_MS`: entries the
 * wedged pass claimed only become re-claimable after that same window, so the
 * release can never put two drains on the same invoice.
 */
export const INVOICE_SYNC_GUARD_STALE_MS = 5 * 60 * 1000;

/**
 * Releases the drain's in-flight guard when its `frappe.call` died with the
 * screen and will never settle. Without this the queue stays undrained for the
 * life of the document — the sale is safe on disk, but it stops leaving.
 *
 * @returns `true` when a wedged guard was actually released.
 */
export function releaseStaleInvoiceSyncGuard(
	maxAgeMs = INVOICE_SYNC_GUARD_STALE_MS,
) {
	if (!invoiceSyncInProgress) {
		return false;
	}
	if (
		invoiceSyncStartedAt !== null &&
		Date.now() - invoiceSyncStartedAt < maxAgeMs
	) {
		return false;
	}
	invoiceSyncInProgress = false;
	invoiceSyncStartedAt = null;
	return true;
}

// Ack-miss reconcile: ask the server whether this offline sale already exists
// as a submitted invoice for its posa_client_request_id. Backed by the
// durable submission ledger + find_invoice_by_client_request_id, so it returns
// acknowledged only when a real submitted invoice is present — a genuine
// (never-submitted) failure returns false / throws, letting the caller draft
// without risking a duplicate. Exported for unit tests.
export async function reconcileAlreadySubmitted(
	invoice: AnyRecord,
): Promise<boolean> {
	const clientRequestId = String(invoice?.posa_client_request_id || "").trim();
	if (!clientRequestId) {
		return false;
	}
	try {
		const response = await frappe.call({
			method: "posawesome.posawesome.api.offline_sync.invoices.reconcile_invoice_outbox_entry",
			args: {
				client_request_id: clientRequestId,
				company: invoice?.company,
				pos_profile: invoice?.pos_profile,
				document_type: invoice?.doctype || "Sales Invoice",
			},
		});
		const result =
			typeof response?.message === "undefined" ? response : response.message;
		return Boolean(result?.acknowledged);
	} catch {
		// No ledger row / not submitted → genuine failure; caller drafts.
		return false;
	}
}

/**
 * Capability-payload version from the current opening's POS Profile
 * (posa_capability_json.version — plan C7). Undefined when no preset is
 * linked (retail default), which is the common case; the guard only bites
 * when both the queued entry and the live opening carry a version and they
 * disagree.
 */
export function getOfflineCapabilityVersion(): number | undefined {
	const openingStorage = memory.pos_opening_storage || {};
	// capability_profile is a sibling of the opening data (plan C7); its
	// version stamps queued invoices. Undefined when no preset is linked.
	const version = openingStorage?.capability_profile?.version;
	return typeof version === "number" ? version : undefined;
}

function shouldValidateOfflineInvoiceStock(invoice: AnyRecord) {
	if (!invoice || invoice.is_return) {
		return false;
	}

	const doctype = String(invoice.doctype || "").trim();
	if (["Sales Order", "Quotation", "Purchase Order"].includes(doctype)) {
		return false;
	}

	if (doctype === "Sales Invoice") {
		return asBoolean(invoice.update_stock);
	}

	if (doctype === "POS Invoice") {
		return true;
	}

	return true;
}

export function validateStockForOfflineInvoice(
	items: AnyRecord[],
	invoice: AnyRecord = {},
) {
	const openingStorage = memory.pos_opening_storage || {};
	const stockSettings = openingStorage?.stock_settings || {};
	const posProfile = openingStorage?.pos_profile || {};

	if (!shouldValidateOfflineInvoiceStock(invoice)) {
		return { isValid: true, invalidItems: [], errorMessage: "" };
	}

	const allowOfflineWithoutStockVerification = asBoolean(
		posProfile?.posa_allow_offline_sale_without_stock_verification,
	);
	if (allowOfflineWithoutStockVerification) {
		return { isValid: true, invalidItems: [], errorMessage: "" };
	}

	const blockSaleBeyondAvailableQty = asBoolean(
		posProfile?.posa_block_sale_beyond_available_qty,
	);
	const allowGlobalNegativeStock = asBoolean(
		stockSettings?.allow_negative_stock,
	);

	const stockCache = memory.local_stock_cache || {};
	const invalidItems: AnyRecord[] = [];
	const requestedByItem = new Map<string, AnyRecord>();

	items.forEach((item) => {
		if (!asBoolean(item?.is_stock_item)) {
			return;
		}

		const itemCode = item.item_code;
		if (!itemCode || Number(item.qty || 0) < 0) {
			return;
		}

		const itemAllowsNegativeStock = asBoolean(item?.allow_negative_stock);
		if (
			!blockSaleBeyondAvailableQty &&
			(allowGlobalNegativeStock || itemAllowsNegativeStock)
		) {
			return;
		}

		const requestedQty = Math.abs(
			Number(item.stock_qty ?? item.qty ?? 0) || 0,
		);
		const existing = requestedByItem.get(itemCode);
		if (existing) {
			existing.requested_qty += requestedQty;
			return;
		}

		requestedByItem.set(itemCode, {
			item_code: itemCode,
			item_name: item.item_name || itemCode,
			requested_qty: requestedQty,
		});
	});

	requestedByItem.forEach((item) => {
		const currentStock = Number(
			stockCache[item.item_code]?.actual_qty || 0,
		);

		if (currentStock - item.requested_qty < 0) {
			invalidItems.push({
				item_code: item.item_code,
				item_name: item.item_name,
				requested_qty: item.requested_qty,
				available_qty: currentStock,
			});
		}
	});

	let errorMessage = "";
	if (invalidItems.length === 1) {
		const item = invalidItems[0];
		if (item) {
			errorMessage = `Not enough stock for ${item.item_name}. You need ${item.requested_qty} but only ${item.available_qty} available.`;
		}
	} else if (invalidItems.length > 1) {
		errorMessage =
			"Insufficient stock for multiple items:\n" +
			invalidItems
				.map(
					(item) =>
						`â€¢ ${item.item_name}: Need ${item.requested_qty}, Have ${item.available_qty}`,
				)
				.join("\n");
	}

	return {
		isValid: invalidItems.length === 0,
		invalidItems,
		errorMessage,
	};
}

function prepareOfflineInvoiceEntry(entry: AnyRecord) {
	ensureOfflineInvoiceRequest(entry);

	if (
		!entry.invoice ||
		!Array.isArray(entry.invoice.items) ||
		!entry.invoice.items.length
	) {
		throw new Error("Cart is empty. Add items before saving.");
	}

	const validation = validateStockForOfflineInvoice(
		entry.invoice.items,
		entry.invoice,
	);
	if (!validation.isValid) {
		throw new Error(validation.errorMessage);
	}

	let cleanEntry;
	try {
		cleanEntry = JSON.parse(JSON.stringify(entry));
	} catch (error) {
		console.error("Failed to serialize offline invoice", error);
		throw error;
	}

	// Stamp the capability-payload version the invoice was BUILT under, so a
	// replay against a server whose profile version has since changed is
	// held for review rather than auto-submitted (plan C7). Absent when the
	// register runs the retail default (no preset) — the guard is inert then.
	const capabilityVersion = getOfflineCapabilityVersion();
	if (capabilityVersion !== undefined) {
		cleanEntry.data = cleanEntry.data || {};
		cleanEntry.data.posa_capability_version = capabilityVersion;
	}

	const replaySources = Array.isArray(cleanEntry?.data?.customer_credit_dict)
		? cleanEntry.data.customer_credit_dict.filter(
				(row: AnyRecord) => Number(row?.credit_to_redeem || 0) > 0,
			)
		: [];

	if (
		Number(cleanEntry?.data?.redeemed_customer_credit || 0) > 0 &&
		cleanEntry?.invoice?.customer &&
		replaySources.length
	) {
		cleanEntry.data.customer_balance_replay = {
			customer: cleanEntry.invoice.customer,
			redeemed_customer_credit: cleanEntry.data.redeemed_customer_credit,
			sources: replaySources,
			timestamp: Date.now(),
		};
	}

	return cleanEntry;
}

export async function saveOfflineInvoice(entry: AnyRecord) {
	const cleanEntry = prepareOfflineInvoiceEntry(entry);
	if (shouldWriteInvoiceOutbox()) {
		await enqueueInvoiceOutboxEntry(cleanEntry);
	}
	const createdEntry = await enqueueWriteQueueEntry(
		INVOICE_ENTITY,
		cleanEntry,
	);

	if (
		entry.invoice?.items &&
		shouldValidateOfflineInvoiceStock(entry.invoice)
	) {
		updateLocalStock(entry.invoice.items);
	}

	return createdEntry;
}

export function getOfflineInvoices() {
	return getQueuedPayloadSnapshots(INVOICE_ENTITY);
}

export async function clearOfflineInvoices() {
	await clearWriteQueueEntries(INVOICE_ENTITY);
}

export async function deleteOfflineInvoice(index: number) {
	await deleteWriteQueueEntryByIndex(INVOICE_ENTITY, index);
}

export function getPendingOfflineInvoiceCount() {
	return getQueuedPayloadCount(INVOICE_ENTITY);
}

export function resetOfflineState() {
	memory.offline_invoices = [];
	memory.offline_customers = [];
	memory.offline_payments = [];
	memory.pos_last_sync_totals = { pending: 0, synced: 0, drafted: 0 };
	persist("pos_last_sync_totals");
}

export function setLastSyncTotals(totals: {
	pending: number;
	synced: number;
	drafted: number;
}) {
	memory.pos_last_sync_totals = totals;
	persist("pos_last_sync_totals");
}

export function getLastSyncTotals() {
	return memory.pos_last_sync_totals || { pending: 0, synced: 0, drafted: 0 };
}

export async function syncOfflineInvoices() {
	if (getInvoiceOutboxMode() === "coordinator") {
		const result = await syncInvoiceOutboxResource(
			async (method, args = {}) => {
				const response = await frappe.call({ method, args });
				return typeof response?.message === "undefined"
					? response || {}
					: response.message;
			},
		);
		const totals = {
			pending: Number((result as AnyRecord).pendingCount || 0),
			synced: Number((result as AnyRecord).acknowledged || 0),
			drafted: 0,
		};
		setLastSyncTotals(totals);
		return totals;
	}

	if (invoiceSyncInProgress) {
		return {
			pending: getPendingOfflineInvoiceCount(),
			synced: 0,
			drafted: 0,
		};
	}

	invoiceSyncInProgress = true;
	invoiceSyncStartedAt = Date.now();
	try {
		await syncOfflineCustomers();

		const invoices = getOfflineInvoices();
		if (!invoices.length) {
			const totals = { pending: 0, synced: 0, drafted: 0 };
			setLastSyncTotals(totals);
			return totals;
		}

		if (isOffline()) {
			return { pending: invoices.length, synced: 0, drafted: 0 };
		}

		const claimedEntries = await claimRetryableQueueEntries(INVOICE_ENTITY);
		if (!claimedEntries.length) {
			return {
				pending: getPendingOfflineInvoiceCount(),
				synced: 0,
				drafted: 0,
			};
		}

		let synced = 0;
		let drafted = 0;

		const currentCapabilityVersion = getOfflineCapabilityVersion();

		for (const entry of claimedEntries) {
			const queuedInvoice = entry.payload;
			// Capability version guard (plan C7): an invoice built under a
			// different capability payload than the register now runs must
			// not auto-submit — its line/flow semantics may not match. Route
			// it to a draft for a human to reconcile instead of applying it
			// blind or losing it.
			const stampedVersion = queuedInvoice?.data?.posa_capability_version;
			if (
				typeof stampedVersion === "number" &&
				typeof currentCapabilityVersion === "number" &&
				stampedVersion !== currentCapabilityVersion
			) {
				console.warn(
					`Offline invoice built under capability v${stampedVersion} ` +
						`but register now runs v${currentCapabilityVersion} — drafting for review`,
				);
				// Ack-miss check FIRST, for the same reason as the submit-failure
				// path below: this entry may already exist submitted server-side
				// (the response was lost, not the write). Drafting it then would
				// mint an orphan carrying the same posa_client_request_id — a
				// double-bill the moment that draft is submitted from Desk.
				if (await reconcileAlreadySubmitted(queuedInvoice.invoice)) {
					synced += 1;
					await markWriteQueueEntrySynced(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						entry.last_attempt_at,
					);
					continue;
				}
				try {
					const draftResponse = await frappe.call({
						method: "posawesome.posawesome.api.invoices.update_invoice",
						args: {
							data: buildDraftFallbackPayload(
								queuedInvoice.invoice,
								entry.draft_invoice_name,
							),
						},
					});
					const invoiceName =
						draftResponse?.message?.name || draftResponse?.name || null;
					drafted += 1;
					await markWriteQueueEntryDrafted(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						entry.last_attempt_at,
						{
							invoiceName,
							reason: `capability_version_mismatch: v${stampedVersion} → v${currentCapabilityVersion}`,
						},
					);
				} catch (draftError) {
					await markWriteQueueEntryFailed(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						draftError,
						entry.last_attempt_at,
					);
				}
				continue;
			}
			try {
				await frappe.call({
					method: "posawesome.posawesome.api.invoices.submit_invoice",
					args: {
						invoice: queuedInvoice.invoice,
						data: queuedInvoice.data,
					},
				});
				synced += 1;
				await markWriteQueueEntrySynced(
					INVOICE_ENTITY,
					Number(entry.queue_id),
					entry.last_attempt_at,
				);
			} catch (error) {
				// submit_invoice is idempotent by posa_client_request_id, but
				// its HTTP response can be lost AFTER the server commits
				// (ack-miss). The old fallback ran update_invoice
				// unconditionally, which creates a fresh draft carrying the
				// same request-id — an orphan DUPLICATE of the already-submitted
				// invoice (double-bill if that draft is later submitted from
				// Desk). Reconcile by request-id first: if the sale already
				// exists submitted, mark synced instead of drafting.
				if (await reconcileAlreadySubmitted(queuedInvoice.invoice)) {
					synced += 1;
					await markWriteQueueEntrySynced(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						entry.last_attempt_at,
					);
					continue;
				}
				console.error(
					"Failed to submit invoice, saving as draft",
					error,
				);
				try {
					const draftResponse = await frappe.call({
						method: "posawesome.posawesome.api.invoices.update_invoice",
						args: {
							data: buildDraftFallbackPayload(
								queuedInvoice.invoice,
								entry.draft_invoice_name,
							),
						},
					});
					const invoiceName =
						draftResponse?.message?.name || draftResponse?.name || null;
					drafted += 1;
					await markWriteQueueEntryDrafted(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						entry.last_attempt_at,
						{
							invoiceName,
							reason: draftReasonFromError(error),
						},
					);
				} catch (draftError) {
					console.error(
						"Failed to save invoice as draft",
						draftError,
					);
					await markWriteQueueEntryFailed(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						draftError,
						entry.last_attempt_at,
					);
				}
			}
		}

		if (
			synced > 0 &&
			drafted === 0 &&
			getPendingOfflineInvoiceCount() === 0
		) {
			reduceCacheUsage();
		}

		const totals = {
			pending: getPendingOfflineInvoiceCount(),
			synced,
			drafted,
		};

		if (totals.pending || drafted) {
			setLastSyncTotals(totals);
		} else {
			setLastSyncTotals({ pending: 0, synced: 0, drafted: 0 });
		}

		return totals;
	} finally {
		invoiceSyncInProgress = false;
		invoiceSyncStartedAt = null;
	}
}
