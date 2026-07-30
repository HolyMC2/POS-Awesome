/**
 * Frappe realtime WebSocket listener store for background invoice processing.
 *
 * `init()` must be called once at application startup. It attaches five
 * `frappe.realtime` listeners that cover the full background-submission lifecycle:
 *
 * | Event | Effect |
 * |---|---|
 * | `pos_invoice_processed` | Resolves `waitForInvoiceProcessed`; shows success or "processing payments" toast |
 * | `pos_invoice_submit_error` | Rejects `waitForInvoiceProcessed`; shows error toast + `frappe.msgprint` |
 * | `pos_post_submit_payments_started` | Shows loading toast |
 * | `pos_post_submit_payments_completed` | Resolves `waitForPostSubmitPayments`; updates toast to success |
 * | `pos_post_submit_payments_failed` | Rejects `waitForPostSubmitPayments`; shows error toast |
 * | `posa_stock_changed` | Forwards payload to `dispatchRealtimeStockPayload` |
 *
 * **Promise-based waiting**
 * `waitForInvoiceProcessed(invoice, timeoutMs?)` and
 * `waitForPostSubmitPayments(invoice, timeoutMs?)` return Promises that resolve or
 * reject when the corresponding realtime event arrives for that specific invoice
 * name. Both default to a 45-second timeout. If the event has already been
 * received (stored in `processedInvoices` / `postSubmitPayments`) the Promise
 * settles synchronously without registering a waiter.
 *
 * **`has_post_submit_payment_work` flag**
 * When `pos_invoice_processed` includes `has_post_submit_payment_work: true`, a
 * persistent loading toast is shown and callers should also await
 * `waitForPostSubmitPayments` before marking the transaction complete.
 */
import { defineStore } from "pinia";
import { ref, type Ref } from "vue";
import { useToastStore } from "./toastStore";
import { useUIStore } from "./uiStore";
import { dispatchRealtimeStockPayload } from "../utils/realtimeStock";

type InvoiceProcessingPayload = {
  invoice?: string;
  name?: string;
  doctype?: string;
  error?: string;
  message?: string;
  has_post_submit_payment_work?: boolean;
};

type InvoiceProcessingState = {
  status: "processed" | "failed";
  doctype?: string;
  error?: string;
  hasPostSubmitPaymentWork?: boolean;
  updatedAt: number;
};

type PostSubmitPaymentState = {
  status: "started" | "completed" | "failed";
  doctype?: string;
  error?: string;
  updatedAt: number;
};

export const useSocketStore = defineStore("socket", () => {
  const toastStore = useToastStore();
  const uiStore = useUIStore();
  const processedInvoices = ref<Record<string, InvoiceProcessingState>>({});
  const postSubmitPayments = ref<Record<string, PostSubmitPaymentState>>({});
  const invoiceWaiters = new Map<string, Array<{ resolve: (value?: any) => void; reject: (reason?: any) => void }>>();
  const paymentWaiters = new Map<string, Array<{ resolve: (value?: any) => void; reject: (reason?: any) => void }>>();

  // Both maps are keyed by invoice name and were never pruned: a till that
  // runs a 12-hour shift without reloading accumulates one permanent entry
  // per sale in each, and every entry is deeply reactive — so the cost is
  // not just the retained payloads but Vue walking a monotonically growing
  // object on each write. Keep a bounded tail of the most recent sales;
  // nothing reads an entry once its own print has resolved.
  const MAX_TRACKED_INVOICES = 200;

  const pruneOldest = <T extends { updatedAt: number }>(
    registry: Ref<Record<string, T>>,
  ) => {
    const entries = Object.entries(registry.value);
    if (entries.length <= MAX_TRACKED_INVOICES) return;
    // Oldest first, drop the overflow.
    entries.sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
    for (const [key] of entries.slice(0, entries.length - MAX_TRACKED_INVOICES)) {
      delete registry.value[key];
    }
  };

  const resolveWaiters = (
    registry: Map<string, Array<{ resolve: (value?: any) => void; reject: (reason?: any) => void }>>,
    key: string,
    payload: any,
    isError = false,
  ) => {
    const waiters = registry.get(key) || [];
    registry.delete(key);
    waiters.forEach(({ resolve, reject }) => {
      if (isError) {
        reject(payload);
      } else {
        resolve(payload);
      }
    });
  };

  const withTimeout = <T>(
    registry: Map<string, Array<{ resolve: (value?: any) => void; reject: (reason?: any) => void }>>,
    key: string,
    timeoutMs: number,
  ) =>
    new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        const waiters = registry.get(key) || [];
        registry.set(
          key,
          waiters.filter((entry) => entry.resolve !== wrappedResolve),
        );
        reject(new Error(`Timed out waiting for ${key}`));
      }, timeoutMs);

      const wrappedResolve = (value?: T) => {
        clearTimeout(timeoutId);
        resolve(value as T);
      };
      const wrappedReject = (reason?: any) => {
        clearTimeout(timeoutId);
        reject(reason);
      };

      const waiters = registry.get(key) || [];
      waiters.push({ resolve: wrappedResolve, reject: wrappedReject });
      registry.set(key, waiters);
    });

  // Backend `_posa_publish_dual` (api/invoice_processing/creation.py)
  // publishes the post-submit lifecycle events to BOTH the user room
  // (Desk's session-cookie auto-join) AND the doc room
  // (`doc:Sales Invoice/<name>`). The web-route SPA goes through
  // frappe-shim which doesn't reliably auto-join user rooms, so we
  // explicitly subscribe to the doc room here.
  //
  // Frappe v16 socketio handlers (apps/frappe/realtime/handlers.js):
  //   socket.on("doc_subscribe", function (doctype, docname) { ... })
  //   socket.on("doctype_subscribe", function (doctype) { ... })
  // doc_subscribe takes TWO positional args (NOT an object). Earlier
  // attempt sent `{doctype, docname}` to "doctype_subscribe" which
  // joined the wrong room (or none).
  //
  // The doctype MATTERS: a profile with
  // `create_pos_invoice_instead_of_sales_invoice` submits POS Invoices, and
  // the backend publishes to `doc:POS Invoice/<name>`. Defaulting to
  // "Sales Invoice" put those tills in a room nothing is ever published to,
  // so every background sale burned the full wait before the DB fallback
  // rescued it (backtrace W2). Callers that know the doctype pass it.
  function subscribeToInvoiceDoc(invoice: string, doctype?: string) {
    const room = (doctype || "").trim() || "Sales Invoice";
    try {
      if (typeof frappe === "undefined" || !frappe.realtime) return;
      const realtime: any = frappe.realtime;
      if (typeof realtime.emit === "function") {
        realtime.emit("doc_subscribe", room, invoice);
      } else if (realtime.socket && typeof realtime.socket.emit === "function") {
        realtime.socket.emit("doc_subscribe", room, invoice);
      }
    } catch {
      // Subscribe failure is non-fatal — the user room may still
      // deliver if the official socketio_client is in use.
    }
  }

  // Check whether the realtime socket has actually completed its
  // handshake. The frappe-shim's `makeRealtime` lazily creates the
  // socket on first `.on()`, but if the handshake fails (namespace
  // mismatch, cookie absent, etc.) `connected` stays false forever.
  // In that state ANY `withTimeout` wait will burn the full 45 s
  // budget before falling through — making prints feel frozen.
  function isRealtimeConnected(): boolean {
    try {
      const s: any = (frappe as any)?.realtime?.socket;
      return Boolean(s?.connected);
    } catch {
      return false;
    }
  }

  const waitForInvoiceProcessed = async (
    invoice: string,
    timeoutMs = 45000,
    doctype?: string,
  ) => {
    const existing = processedInvoices.value[invoice];
    if (existing?.status === "processed") {
      return existing;
    }
    if (existing?.status === "failed") {
      throw new Error(existing.error || `Invoice ${invoice} failed to submit`);
    }
    // No live socket → the lifecycle event will never arrive.
    // Resolve optimistically; the caller's fallback path
    // (`fetchSubmittedInvoiceDoc`) will hit the DB and confirm.
    if (!isRealtimeConnected()) {
      return {
        status: "processed" as const,
        updatedAt: Date.now(),
      };
    }
    subscribeToInvoiceDoc(invoice, doctype);
    return withTimeout<InvoiceProcessingState>(invoiceWaiters, invoice, timeoutMs);
  };

  const waitForPostSubmitPayments = async (
    invoice: string,
    timeoutMs = 45000,
    doctype?: string,
  ) => {
    const existing = postSubmitPayments.value[invoice];
    if (existing?.status === "completed") {
      return existing;
    }
    if (existing?.status === "failed") {
      throw new Error(existing.error || `Post-submit payment processing failed for ${invoice}`);
    }
    // Invoice is already submitted by the time this wait fires; the
    // bg job only creates Payment Entries. Without a live socket
    // we'd block print 45 s for events that can't reach us. Skip
    // the wait — payment entries will land in the DB regardless.
    if (!isRealtimeConnected()) {
      return {
        status: "completed" as const,
        updatedAt: Date.now(),
      };
    }
    subscribeToInvoiceDoc(invoice, doctype);
    return withTimeout<PostSubmitPaymentState>(paymentWaiters, invoice, timeoutMs);
  };

  let initialised = false;

  function init() {
    if (typeof frappe === "undefined" || !frappe.realtime) return;
    // Guard against double-registration. Each call to `init()` was
    // attaching another set of 6 `frappe.realtime.on(...)` handlers
    // with no `.off()` cleanup. Pos.vue (re)mounts on customer
    // change re-ran init via Payments.vue's `useSocketStore()`
    // chain, so listeners climbed 6 per mount → 22k+ in minutes,
    // visible in Firefox Performance as a 2 k → 22 k listener
    // count and 27 s `vendor-CF6GND7R.js f` self-time (Vue's reactive
    // trigger walking the bloated subscriber list).
    if (initialised) return;
    initialised = true;

    // Global listener for background submission errors
    frappe.realtime.on("pos_invoice_submit_error", (data: InvoiceProcessingPayload) => {
      const message = data.error || data.message || "Unknown error";
      const invoice = data.invoice || "";
      processedInvoices.value[invoice] = {
        status: "failed",
        doctype: data.doctype,
        error: message,
        updatedAt: Date.now(),
      };
      pruneOldest(processedInvoices);
      resolveWaiters(invoiceWaiters, invoice, new Error(message), true);

      if (typeof frappe.msgprint === "function") {
        frappe.msgprint({
          title: __("Invoice Submission Failed"),
          message: __("Background processing failed for Invoice {0}: {1}", [invoice, message]),
          indicator: "red",
        });
      }

      toastStore.show({
        title: __("Background Submission Failed"),
        detail: message,
        color: "error",
        timeout: 8000,
      });
    });

    // Global listener for successful background submission
    frappe.realtime.on("pos_invoice_processed", (data: InvoiceProcessingPayload) => {
      const invoice = data.invoice || data.name;
      if (!invoice) return;
      const hasPostSubmitPaymentWork = Boolean(data.has_post_submit_payment_work);

      const state: InvoiceProcessingState = {
        status: "processed",
        doctype: data.doctype,
        hasPostSubmitPaymentWork,
        updatedAt: Date.now(),
      };
      processedInvoices.value[invoice] = state;
      pruneOldest(processedInvoices);
      resolveWaiters(invoiceWaiters, invoice, state);

      if (hasPostSubmitPaymentWork) {
        toastStore.show({
          key: `invoice-processing::${invoice}`,
          title: __("Invoice Submitted"),
          detail: __("Processing payment entries for Invoice {0}", [invoice]),
          color: "info",
          timeout: -1,
          loading: true,
        });
      } else {
        toastStore.show({
          key: `invoice-processing::${invoice}`,
          title: __("Invoice Submitted"),
          detail: __("Invoice {0} processed successfully", [invoice]),
          color: "success",
        });
      }
    });

    frappe.realtime.on("pos_post_submit_payments_started", (data: InvoiceProcessingPayload) => {
      const invoice = data.invoice || data.name;
      if (!invoice) return;

      postSubmitPayments.value[invoice] = {
        status: "started",
        doctype: data.doctype,
        updatedAt: Date.now(),
      };
      pruneOldest(postSubmitPayments);

      toastStore.show({
        key: `invoice-processing::${invoice}`,
        title: __("Invoice Submitted"),
        detail: __("Processing payment entries for Invoice {0}", [invoice]),
        color: "info",
        timeout: -1,
        loading: true,
      });
    });

    frappe.realtime.on("pos_post_submit_payments_completed", (data: InvoiceProcessingPayload) => {
      const invoice = data.invoice || data.name;
      if (!invoice) return;

      const state: PostSubmitPaymentState = {
        status: "completed",
        doctype: data.doctype,
        updatedAt: Date.now(),
      };
      postSubmitPayments.value[invoice] = state;
      pruneOldest(postSubmitPayments);
      resolveWaiters(paymentWaiters, invoice, state);

      toastStore.show({
        key: `invoice-processing::${invoice}`,
        title: __("Invoice Submitted"),
        detail: __("Payment entries processed for Invoice {0}", [invoice]),
        color: "success",
        timeout: 4000,
        loading: false,
      });
    });

    frappe.realtime.on("pos_post_submit_payments_failed", (data: InvoiceProcessingPayload) => {
      const invoice = data.invoice || data.name;
      const message = data.error || data.message || __("Unknown error");
      if (!invoice) return;

      postSubmitPayments.value[invoice] = {
        status: "failed",
        doctype: data.doctype,
        error: message,
        updatedAt: Date.now(),
      };
      pruneOldest(postSubmitPayments);
      resolveWaiters(paymentWaiters, invoice, new Error(message), true);

      toastStore.show({
        key: `invoice-processing::${invoice}`,
        title: __("Invoice Submitted"),
        detail: message,
        color: "error",
        timeout: 8000,
        loading: false,
      });
    });

    frappe.realtime.on("posa_stock_changed", (data: unknown) => {
      dispatchRealtimeStockPayload(data, {
        setLastStockAdjustment: uiStore.setLastStockAdjustment,
      });
    });

    // SALDO-INTEGRATION-POINT — terminal status from saldo TAECEL
    // worker. Emits on saldoBus → SaldoStatusDialog mounted in Pos.vue
    // shows a modal with Print/Close buttons. Bus + dialog source live
    // in saldo Frappe app under saldo/saldo/public/saldo_pos/.
    //
    // The dynamic import is wrapped because @saldo is a Vite alias to
    // an OUT-OF-TREE Frappe app — if the saldo app isn't site-installed
    // or the alias misconfigs the import resolves to nothing and the
    // modal silently disappears. Fallback path surfaces a toast so the
    // cashier still sees the terminal status verdict.
    frappe.realtime.on("saldo:transaction", async (data: any) => {
      if (!data || !data.name) return;
      try {
        const { saldoBus } = await import("@saldo/useSaldoCapture");
        saldoBus.emit("saldo:result", data);
      } catch (err) {
        console.error("[saldo] dialog bus import failed", err);
        try {
          const tone =
            data.status === "Success"
              ? "success"
              : data.status === "Failed" || data.status === "Refunded"
              ? "error"
              : "warning";
          toastStore.show({
            key: `saldo::${data.name}`,
            title: __("Saldo: {0}", [data.status || ""]),
            detail:
              data.message_es ||
              data.error_message ||
              data.manual_review_reason ||
              data.name,
            color: tone,
            timeout: 12000,
            loading: false,
          });
        } catch {
          // Toast itself failed — final degradation, swallow rather
          // than crash the realtime handler.
        }
      }
    });
  }

  return {
    init,
    processedInvoices,
    postSubmitPayments,
    waitForInvoiceProcessed,
    waitForPostSubmitPayments,
    subscribeToInvoiceDoc,
  };
});
