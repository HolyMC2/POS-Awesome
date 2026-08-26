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
import type { KotProjection } from "../offline/restaurantTypes";

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
	/**
	 * The server accepted a submission: the document exists, it is submitted,
	 * and — for a sale — it is paid. Emitted once per successful ONLINE submit
	 * from `usePaymentSubmission`, whatever the change came to.
	 *
	 * Its reason for existing is the case `show_change_due` cannot report.
	 * That event fires only when there is change to hand back, so a sale
	 * settled to the peso — every card sale, most transfers — closed without
	 * the register ever saying so, and the customer's screen never reached its
	 * «Gracias» state.
	 *
	 * NOT emitted for an offline or queued sale. Those are accepted by the
	 * REGISTER, not by the server: nothing is booked yet and nothing has been
	 * paid, so announcing a completed sale on one would be a claim about the
	 * customer's money that is not true. `is_return` rides along so a listener
	 * that has nothing to say about a refund can stay silent without re-reading
	 * the invoice.
	 */
	invoice_submitted: {
		invoice?: string;
		currency?: string;
		/** The change the server booked as a Payment Entry; absent when none. */
		change_amount?: number;
		is_return?: boolean;
	};
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
	/**
	 * The scan field's text changed (every keystroke, scanner wedges included).
	 * Emitted by `useItemsSelectorSearchInput`; the shell debounces it and
	 * opens the catalogue drawer on the matches — see
	 * `resolveSearchDrawerIntent`.
	 */
	item_search_changed: string;
	focus_additional_discount: void;
	set_compact_panel: "selector" | "invoice";
	/**
	 * "Put me on the cart." Coarser than set_compact_panel: the shell moves the
	 * panel AND the active view together, which is the only way off the inline
	 * payment view that its activeView watcher will not immediately undo.
	 * Emitted by Payments.vue's cancel path; handled in Pos.vue.
	 */
	show_invoice_panel: void;
	/**
	 * "Put me on this selector view." The floor's ticket panel needs it: after
	 * opening a table the next thing a waiter does is add food, and only the
	 * shell can move the panel and the active view in the one pass that
	 * survives the activeView watcher. Handled in Pos.vue.
	 */
	set_selector_view: string;

	// ---- dialogs / shell ----------------------------------------------------
	open_returns: string; // company
	/**
	 * «Guardar cotización» — raise the save dialog over whatever is on screen.
	 * Carries nothing: the dialog reads the cart from the invoice store, so any
	 * surface can ask for it without owning the lines (see
	 * `flows/cotizaciones/SaveQuotationDialog.vue`).
	 */
	open_save_quotation: void;
	open_new_address: string; // customer
	open_customer_display: void;
	open_employee_switch: void;
	open_shift_details: void; // F7 → shift overview / closing dialog
	lock_pos_screen: void;
	show_shortcuts_cheatsheet: void; // Alt+H → keymap discoverability overlay
	show_price_check: void; // Alt+C → read-only price lookup
	/**
	 * Riel y Cajón (§17.7): the shell changes destination. ONE event carrying
	 * a `RailDestinationId`, not one event per destination — the rail, the
	 * router and the chord all name the same thing, so adding a tenth
	 * destination should cost a registry entry and nothing else. Typed as
	 * `string` rather than importing the union, because bus.ts is imported by
	 * everything and must not pull the shell's module graph in behind it.
	 */
	open_destination: string;
	toggle_catalog_drawer: void; // Alt+B → the catalogue beside the sale
	/**
	 * The band's `recharge.submit` pressed while Recargas is the hosted
	 * destination. The shell owns the band and the destination owns the
	 * intent, so the press travels back down as an event rather than the
	 * shell reaching into a component it only hosts. Handled in
	 * `RecargasDestination.vue`.
	 */
	"recharge:submit": void;
	open_mpesa_payments: { company: string; mode_of_payment: string; customer: string };
	set_mpesa_payment: Record<string, any>;
	open_ClosingDialog: Record<string, any>;
	add_the_new_address: { name: string; [key: string]: any };
	set_customer_readonly: boolean; // returns flow locks the customer selector
	submit_closing_pos: Record<string, any>;

	// ---- payments -----------------------------------------------------------
	queue_submit_payment_shortcut: { print?: boolean };
	/**
	 * The movil keypad's COLLECT AND CLOSE (MovilCobroView, round 2 of the
	 * mobile wiring). The screen captures {mode, amount} and emits an intent;
	 * every money decision — row selection, zeroing the other tenders, the
	 * submit itself — happens in Payments.vue's handler, which rides the SAME
	 * `submit(null, false, print)` the band shortcut uses, behind the same
	 * paymentVisible / in-flight guards.
	 */
	movil_collect_payment: { mode?: string | null; amount?: number; print?: boolean };
	/**
	 * Service-order destination intents (OrdenSurface owns the selection and
	 * the charge; the shell only sends the press). `orden:collect` predates
	 * this map's coverage of it; `orden:deselect` (movil round 3) clears the
	 * selection so the phone's back chip can return to the queue.
	 */
	"orden:collect": void;
	"orden:deselect": void;
	/** The movil browse bar's scan glyph → ItemsSelector's own camera
	 *  scanner (the ONE scanner; the phone only rings its doorbell). */
	"movil:start-camera": void;
	/**
	 * The movil browse bar's tap → focus the ONE search input. Its own event
	 * because `focusItemSearch` refuses coarse pointers ON PURPOSE (no
	 * uninvited keyboards over the queue) — a tap on the search bar is the
	 * explicit invitation that rule exists to protect.
	 */
	"movil:focus-search": void;
	/** The movil browse bar's × → clear the ONE search input, restoring the
	 *  full grid without a soft-keyboard backspace session. */
	"movil:clear-search": void;
	/**
	 * A payment was CAPTURED against a party's open invoices — i.e. `PayView`'s
	 * Payment Entry path finished, not the cart's. Distinct from
	 * `invoice_submitted`, which announces a SALE: the two ride different
	 * submission composables and mean different things to a listener.
	 *
	 * Emitted once per `finalizeSubmission` in `usePosPaySubmission`, which is
	 * reached only after the server accepted the capture or the offline queue
	 * took it — see the emit site in `PayView.vue` for why that callback is the
	 * honest seam and `processPayment()` resolving is not.
	 *
	 * `queued` distinguishes the two: an offline capture is accepted by the
	 * REGISTER, not by the server, so a listener that re-reads receivables would
	 * be reading a balance nothing has moved yet.
	 */
	payment_captured: { customer?: string; queued?: boolean };

	// ---- restaurant floor ---------------------------------------------------
	/**
	 * A table order was opened or resumed on the floor screen. The shell answers
	 * by moving to the cart — tapping a table means "take this table's order",
	 * and the floor has nothing left to say until the next tap.
	 */
	floor_order_opened: { order_uid: string };
	/**
	 * A course was fired and the server returned the kitchen projection. Nothing
	 * listens yet — printing is the QZ path's job and lands with the kitchen
	 * ticket format — but the event is the seam it will attach to.
	 */
	floor_course_fired: KotProjection;
	/**
	 * The band's «ENVIAR A COCINA» pressed on a mesa-owned sale. The fire lives
	 * in `FloorView` — with its telemetry mark and the poll that tells the
	 * waiter whether the kitchen actually got paper — so the press travels
	 * there rather than growing a second call site onto the kitchen path.
	 */
	floor_fire_active_course: void;
	/**
	 * The salón band's «COBRAR CUENTA» pressed. The selected cuenta is NOT in
	 * the cart (the floor asks before it acts), so `FloorView` hydrates it and
	 * then hands off to the invoice panel's payment validator like every other
	 * Charge. Handled in `FloorView.vue`.
	 */
	floor_charge_selected_account: void;
	/**
	 * «GUARDAR · VOLVER AL SALÓN» / «Volver al salón». Flush the line sync,
	 * detach the order, clear the register, land on the floor — an ordering
	 * only the shell can perform, so the mesa strip asks for it by name.
	 * Handled in `Pos.vue`.
	 */
	floor_return_to_salon: void;

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
