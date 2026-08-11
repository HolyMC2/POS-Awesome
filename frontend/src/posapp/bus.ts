import mitt from "mitt";
import type { Emitter } from "mitt";
import type { App } from "vue";
import type {
	CartItem,
	Item,
	InvoiceDoc,
	PartialInvoiceDoc,
	POSProfile,
} from "./types/models";
import type { NotificationData } from "./stores/toastStore";
import type { RealtimeStockPayload } from "./utils/realtimeStock";

/** A row of the POS Offer table as held by PosOffers.vue (`pos_offers`). Untyped upstream. */
export interface PosOfferRow {
	name: string;
	offer_applied?: boolean;
	coupon_based?: number | boolean;
	coupon?: string;
	apply_on?: string;
	apply_type?: string;
	apply_item_code?: string;
	offer?: string;
	[key: string]: any;
}

/** A row of the POS Coupon table as held by PosCoupons.vue (`posa_coupons`). Untyped upstream. */
export interface PosCouponRow {
	coupon: string;
	coupon_code?: string;
	type?: string;
	pos_offer?: string;
	applied?: 0 | 1;
	[key: string]: any;
}

/**
 * Closed event map for the app bus. Every event that rides this bus MUST be
 * declared here with its payload type (`void` = no payload) — that is what
 * lets vue-tsc fail a view that mishandles the contract
 * (docs/VERTICAL_PROFILES_PLAN.md C1). Payloads were derived from the actual
 * emit sites (2026-08-09 recon); comments flag shapes that are surprising
 * on purpose and the known-dead ends slated for cleanup.
 *
 * NOT here: `saldo:hold_registered` / `saldo:result` / `saldo:open` /
 * `saldo:hold_print` — those ride `saldoBus` from `@saldo/useSaldoCapture`,
 * a different emitter.
 */
export type Events = {
	// ---- cart / items -------------------------------------------------------
	add_item: Item & { code?: string };
	apply_pricing_rules: void;
	cart_quantities_updated: Record<string, number>;
	set_all_items: Item[];
	set_new_line: boolean;
	focus_cart_item_qty: { item?: CartItem; rowId?: string; itemCode?: string };
	remote_stock_adjustment: RealtimeStockPayload;

	// ---- invoice lifecycle --------------------------------------------------
	clear_invoice: void;
	draft_saved: { doctype?: string; name?: string };
	load_return_invoice: { invoice_doc: PartialInvoiceDoc; return_doc?: InvoiceDoc };
	reset_invoice_type_to_invoice: void;
	send_invoice_doc_payment: InvoiceDoc;
	invoice_submission_failed: { invoice?: string; reason?: string; timestamp?: number };
	recalculate_return_discount: { defer?: boolean };

	// ---- shell → invoice panel requests (CartView contract) -----------------
	open_customer_details: void;
	request_invoice_payment: void;
	recalc_additional_discount: void;

	// ---- pricing / currency -------------------------------------------------
	update_currency: { currency: string; exchange_rate: number; conversion_rate: number };
	update_customer_price_list: string;
	update_buying_price_list: { price_list: string | null; supplier: string } | null;

	// ---- offers / coupons ---------------------------------------------------
	update_pos_offers: PosOfferRow[];
	update_invoice_offers: PosOfferRow[];
	/** Applied OFFER rows (the coupon_based subset) — consumed by PosCoupons. */
	update_applied_coupon_offers: PosOfferRow[];
	update_invoice_coupons: PosCouponRow[];
	set_pos_coupons: PosCouponRow[];
	update_discount_percentage_offer_name: { value: string | null };

	// ---- focus / layout -----------------------------------------------------
	focus_item_search: void;
	focus_additional_discount: void;
	set_compact_panel: "selector" | "invoice";
	/**
	 * "Put me on the cart." Coarser than set_compact_panel: the shell moves the
	 * panel AND the active view together, which is the only way off the inline
	 * payment view that its activeView watcher will not immediately undo.
	 * Emitted by Payments.vue's cancel path; handled in Pos.vue.
	 */
	show_invoice_panel: void;

	// ---- dialogs / shell ----------------------------------------------------
	open_returns: string; // company
	open_new_address: string; // customer
	open_customer_display: void;
	open_employee_switch: void;
	open_shift_details: void; // F7 → shift overview / closing dialog
	lock_pos_screen: void;
	open_mpesa_payments: { company: string; mode_of_payment: string; customer: string };
	set_mpesa_payment: Record<string, any>;
	open_ClosingDialog: Record<string, any>;
	add_the_new_address: { name: string; [key: string]: any };
	set_customer_readonly: boolean; // returns flow locks the customer selector
	submit_closing_pos: Record<string, any>;

	// ---- payments -----------------------------------------------------------
	queue_submit_payment_shortcut: { print?: boolean };

	// ---- notifications ------------------------------------------------------
	show_message: NotificationData;

	// ---- offline / sync / boot ----------------------------------------------
	"data-loaded": string;
	"data-load-progress": { name: string; progress: number };
	"network-online": void;
	"server-online": void;

	// ---- saldo integration (rides this bus, unlike the saldoBus events) -----
	"saldo:picker-add": {
		item_code: string;
		item_name: string;
		rate: number;
		price_list_rate: number;
		saldo_referencia: string;
	};
};

const bus: Emitter<Events> = mitt<Events>();

const eventBusPlugin = {
	emit: bus.emit.bind(bus),
	on: bus.on.bind(bus),
	off: bus.off.bind(bus),
	all: bus.all,
	install: (app: App) => {
		app.config.globalProperties.__ = window.__;
		app.config.globalProperties.frappe = window.frappe;
		app.config.globalProperties.eventBus = bus;

		// Provide for Composition API usage
		app.provide("eventBus", bus);
		app.provide("__", window.__);
		app.provide("frappe", window.frappe);
	},
};

export default eventBusPlugin;
export { bus };
