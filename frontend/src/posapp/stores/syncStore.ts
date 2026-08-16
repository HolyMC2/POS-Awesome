/**
 * Lightweight Pinia store for the legacy offline invoice sync queue.
 *
 * This store wraps the offline invoice queue helpers (`syncOfflineInvoices`,
 * `getPendingOfflineInvoiceCount`) and exposes a reactive `pendingInvoicesCount`
 * for status-bar badges. It does **not** drive the full `SyncCoordinator` —
 * the coordinator manages background resource sync independently.
 *
 * **`syncPendingInvoices()`**
 * Reads the pending count, shows a warning toast if any are queued, and then
 * calls `syncOfflineInvoices()`. The sync is skipped entirely when `isOffline()`
 * returns true. On completion it shows success/draft toasts and refreshes the
 * count. Errors are caught and logged; the count is always updated in `finally`.
 *
 * **Options API style**
 * This store uses the Options API form of `defineStore` (with `state` /
 * `actions`) rather than the Setup API used by newer stores in this codebase.
 */
import { defineStore } from "pinia";
import {
	getDeadLetterCount,
	getInvoiceOutboxMode,
	getPendingInvoiceOutboxCount,
	getPendingOfflineInvoiceCount,
	getWriteQueueDeadLetterCount,
	getWriteQueueDraftReviewCount,
	requeueDeadLetterEntry,
	requeueWriteQueueDeadLetter,
	requeueWriteQueueDraftReview,
	resolveWriteQueueDraftReview,
	syncOfflineCashMovements,
	syncOfflineCustomers,
	syncOfflineInvoices,
	syncOfflinePayments,
	syncRestaurantOrders,
	isOffline,
} from "../../offline/index";
import type { OfflineEntityType } from "../../offline/writeQueue";
import { useSyncCoordinator } from "../../offline/sync/useSyncCoordinator";
import { useToastStore } from "./toastStore.js";

export const useSyncStore = defineStore("sync", {
	state: () => ({
		pendingInvoicesCount: 0,
		// SPEC A: sales that exhausted their sync retries — cash in the
		// drawer, invoice not created. Surfaced separately from the plain
		// pending count so they can never hide inside it.
		deadLetterCount: 0,
		draftReviewCount: 0,
	}),
	actions: {
		async updatePendingCount() {
			try {
				const legacyCount = await getPendingOfflineInvoiceCount();
				const outboxCount =
					getInvoiceOutboxMode() === "off"
						? legacyCount
						: await getPendingInvoiceOutboxCount();
				this.pendingInvoicesCount = outboxCount;
				await this.updateDeadLetterCount();
			} catch (error) {
				console.error("Failed to update pending invoices count", error);
			}
		},
		async updateDeadLetterCount() {
			try {
				const previous = this.deadLetterCount;
				const previousDraftReview = this.draftReviewCount;
				// Count BOTH surfaces: the invoice outbox (coordinator mode) and
				// the write_queue (payments / cash / legacy invoices — prod
				// default). write_queue dead-letters were previously invisible.
				const outboxCount =
					getInvoiceOutboxMode() === "off" ? 0 : await getDeadLetterCount();
				const writeQueueCount = await getWriteQueueDeadLetterCount();
				const count = outboxCount + writeQueueCount;
				this.deadLetterCount = count;
				const draftReviewCount = await getWriteQueueDraftReviewCount();
				this.draftReviewCount = draftReviewCount;
				if (count > previous) {
					// durable trace + loud persistent alert: a dead-lettered
					// sale means cash in the drawer with NO invoice.
					import("../utils/telemetry")
						.then(({ track }) =>
							track("crash:offline_sale_dead_letter", count, {
								previous,
							}),
						)
						.catch(() => {});
					const toastStore = useToastStore();
					toastStore.show({
						key: "dead-letter",
						title: `${count} venta(s) sin sincronizar — atención`,
						detail:
							"Cobros hechos sin factura registrada. Abrir Facturas Offline → Reintentar, o llamar al administrador.",
						color: "error",
						timeout: 0,
					});
				}
				if (draftReviewCount > previousDraftReview) {
					const toastStore = useToastStore();
					toastStore.show({
						key: "draft-review",
						title: `${draftReviewCount} venta(s) guardadas como borrador — revisar`,
						detail:
							"La venta existe como borrador sin timbrar/submit. Abrir Facturas Offline → Borradores por revisar.",
						color: "warning",
						timeout: 0,
					});
				}
			} catch (error) {
				console.error("Failed to update dead-letter count", error);
			}
		},
		async requeueDeadLetter(clientRequestId: string) {
			const row = await requeueDeadLetterEntry(clientRequestId);
			if (row) {
				await this.syncPendingInvoices();
			}
			await this.updatePendingCount();
			return row;
		},
		// "Reintentar" must act NOW for every money type. The drains are
		// scattered by design (invoices+cash on resume, payments in the pay
		// view, table orders on the coordinator), so a requeued non-invoice
		// entry used to sit `pending` until whichever trigger next fired —
		// which for a payment could be "never" if the operator stayed off the
		// pay screen. Dispatch the drain that owns the requeued entity instead.
		async drainEntityQueue(entityType: OfflineEntityType | undefined) {
			try {
				switch (entityType) {
					case "payment":
						await syncOfflinePayments();
						return;
					case "cash_movement":
						await syncOfflineCashMovements();
						return;
					case "customer":
						await syncOfflineCustomers();
						return;
					case "restaurant_order":
						await syncRestaurantOrders();
						return;
					default:
						// invoice — and any unknown type, where the invoice
						// drain is the safest historical behaviour.
						await this.syncPendingInvoices();
				}
			} catch (error) {
				// The entry is already back in `pending`; the periodic drain
				// picks it up even when the eager pass fails.
				console.error("Post-requeue drain failed", error);
			}
		},
		async requeueWriteQueueDeadLetter(queueId: number) {
			const row = await requeueWriteQueueDeadLetter(queueId);
			if (row) {
				await this.drainEntityQueue(row.entity_type);
			}
			await this.updatePendingCount();
			return row;
		},
		async requeueDraftReview(queueId: number) {
			const row = await requeueWriteQueueDraftReview(queueId);
			if (row) {
				await this.drainEntityQueue(row.entity_type);
			}
			await this.updatePendingCount();
			return row;
		},
		async resolveDraftReview(queueId: number) {
			const row = await resolveWriteQueueDraftReview(queueId);
			await this.updatePendingCount();
			return row;
		},
		setPendingCount(count: number) {
			this.pendingInvoicesCount = count;
		},
		async syncPendingInvoices() {
			const toastStore = useToastStore();
			const pending = await getPendingOfflineInvoiceCount();

			if (pending) {
				toastStore.show({
					title: `${pending} invoice${pending > 1 ? "s" : ""} pending for sync`,
					color: "warning",
				});
				this.updatePendingCount();
			}

			if (isOffline()) {
				return;
			}

			try {
				const result =
					getInvoiceOutboxMode() === "coordinator"
						? await useSyncCoordinator()
								.runTrigger("user_action")
								.then(async () => ({
									pending:
										await getPendingInvoiceOutboxCount(),
									synced: 0,
									drafted: 0,
								}))
						: await syncOfflineInvoices();
				if (result && (result.synced || result.drafted)) {
					if (result.synced) {
						toastStore.show({
							title: `${result.synced} offline invoice${result.synced > 1 ? "s" : ""} synced`,
							color: "success",
						});
					}
					if (result.drafted) {
						toastStore.show({
							title: `${result.drafted} venta(s) guardadas como borrador — revisar en Facturas Offline`,
							color: "warning",
						});
					}
				}
			} catch (error) {
				console.error("Sync failed", error);
				import("../utils/telemetry")
					.then(({ track }) =>
						track("warn:offline_sync_failed", 1, { pending }),
					)
					.catch(() => {});
			} finally {
				this.updatePendingCount();
			}
		},
	},
});
