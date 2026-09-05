/**
 * Invoice keyboard EFFECTS — the "what happens" half of the shortcuts engine.
 *
 * The "which key" half moved to `posapp/shortcuts/` (roadmap §17.3): this
 * module no longer knows a single chord. It maps stable ACTION IDS to the
 * behaviors they always had, so a keymap pack can rebind anything — or an
 * incumbent-emulating pack can move every key at once — without touching a
 * line of the logic below. Parity with the pre-engine if-chain is pinned by
 * tests/shortcutsEngine.spec.ts; per-effect behavior by
 * tests/invoiceShortcuts.spec.ts.
 */
import type { Emitter } from "mitt";
import type { Events } from "../../../bus";
import { actionForEvent } from "../../../shortcuts";

const consumeEvent = (event: KeyboardEvent) => {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation?.();
};
const showCompactPanel = (
	eventBus: { emit: (_event: string, _payload?: unknown) => void } | undefined,
	panel: "selector" | "invoice",
) => {
	eventBus?.emit?.("set_compact_panel", panel);
};

type ShortcutField = "qty" | "uom" | "rate" | "discount_percentage";

interface InvoiceShortcutsVm {
	toastStore: { show: (_payload: { title: string; color: string }) => void };
	eventBus: {
		emit: Emitter<Events>["emit"];
		on?: Emitter<Events>["on"];
		off?: Emitter<Events>["off"];
	};
	uiStore: {
		setActiveView: (_view: string) => void;
		triggerItemSearchFocus: () => void;
		triggerItemSearchReset: () => void;
		selectTopItem: () => void;
		toggleItemSettings: () => void;
		/** A Pay round-trip is already open — see show_payment's in-flight latch. */
		paymentRequestPending?: boolean;
	};
	$refs: {
		actionToolbar?: {
			focusSearch?: () => void;
		};
		customerSection?: {
			openNewCustomer?: () => void;
			selectFirstCustomer?: () => void;
		};
		customerComponent?: {
			openNewCustomer?: () => void;
			selectFirstCustomer?: () => void;
		};
		deliveryChargesComponent?: { focusDeliveryCharges?: () => void };
		postingDateComponent?: { focusPostingDate?: () => void };
		itemSearchField?: {
			focus?: () => void;
			$el?: { querySelector?: (_s: string) => { focus?: () => void } };
		};
		itemsTableRef?: {
			focusItemField?: (_index: number, _field: ShortcutField) => void;
		};
		itemsTable?: {
			focusItemField?: (_index: number, _field: ShortcutField) => void;
		};
	};
	items?: Array<Record<string, unknown>>;
	paymentVisible?: boolean;
	shortcutSubmitInFlight?: boolean;
	cancel_dialog?: boolean;
	shortcutCycle?: Record<ShortcutField, number>;
	flushBackgroundUpdates?: () => Promise<void> | void;
	schedulePricingRuleApplication?: {
		(_force?: boolean): void;
		flush?: () => void;
		cancel?: () => void;
	};
	triggerBackgroundFlush?: {
		(): void;
		flush?: () => void;
		cancel?: () => void;
	};
	close_payments?: () => void;
	focusCustomerSearchField?: () => void;
	get_draft_orders?: () => void;
	open_returns?: () => void;
	show_payment?: () => Promise<void> | void;
	focusAdditionalDiscountField?: () => void;
	remove_item?: (_item: Record<string, unknown>) => void;
	get_draft_invoices?: () => void;
	save_and_clear_invoice?: () => void;
	confirmPaymentSubmission: () => Promise<boolean>;
	focusItemTableField: (_field: ShortcutField) => void;
}

type ShortcutEffect = (
	this: InvoiceShortcutsVm,
	_event: KeyboardEvent,
) => void | Promise<void>;

/**
 * Submit-the-sale path, shared by `payment.submit` (Alt+X) and
 * `payment.submitAndPrint` (Alt+P). The guards are load-bearing: an already
 * open payment screen must let the key through untouched, and a repeat or an
 * in-flight round-trip must be swallowed so a leaned-on key cannot queue a
 * second submit against a screen that has not opened yet.
 */
const submitSale = async function (
	this: InvoiceShortcutsVm,
	event: KeyboardEvent,
	shouldPrint: boolean,
) {
	if (this.paymentVisible) {
		return;
	}
	if (event.repeat || this.shortcutSubmitInFlight || this.uiStore?.paymentRequestPending) {
		consumeEvent(event);
		return;
	}
	consumeEvent(event);
	this.shortcutSubmitInFlight = true;

	try {
		const shouldSubmit = await this.confirmPaymentSubmission();
		if (!shouldSubmit) {
			return;
		}
		await this.flushBackgroundUpdates?.();
		this.triggerBackgroundFlush?.flush?.();
		this.schedulePricingRuleApplication?.flush?.();
		showCompactPanel(this.eventBus, "selector");
		await this.show_payment?.();
		this.eventBus.emit("queue_submit_payment_shortcut", {
			print: shouldPrint,
		});
	} finally {
		this.shortcutSubmitInFlight = false;
	}
};

/** Action id → effect. Keys live in the keymap, never here. */
export const INVOICE_SHORTCUT_EFFECTS: Record<string, ShortcutEffect> = {
	"employee.switch"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_employee_switch");
	},

	"customer.new"(event) {
		consumeEvent(event);
		this.$refs.customerSection?.openNewCustomer?.() ||
			this.$refs.customerComponent?.openNewCustomer?.();
	},

	"shift.details"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_shift_details");
	},

	"app.lockScreen"(event) {
		consumeEvent(event);
		this.eventBus.emit("lock_pos_screen");
	},

	"app.showShortcuts"(event) {
		consumeEvent(event);
		this.eventBus.emit("show_shortcuts_cheatsheet");
	},

	// ── Riel y Cajón destinations ───────────────────────────────────────
	// These six do not act on the invoice; they ask the SHELL to change
	// destination. They live here anyway because this is the surface that
	// owns the keyboard while a sale is on screen, and an effect map with a
	// hole in it fails tests/shortcutsEngine.spec.ts — every action in the
	// registry must be bound, and every bound action must do something.
	//
	// One event carrying an id, rather than six named events: the rail, the
	// router and the chord all name the same destination, so a seventh
	// destination should cost a registry entry and nothing else.
	"cash.openMovement"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_destination", "expense");
	},

	"collections.open"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_destination", "payments");
	},

	"invoice.openManagement"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_destination", "invoices");
	},

	"charges.openRequests"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_destination", "serviceOrder");
	},

	"saldo.openRecharge"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_destination", "recharge");
	},

	"shift.close"(event) {
		consumeEvent(event);
		this.eventBus.emit("open_destination", "closing");
	},

	"invoice.saveQuotation"(event) {
		consumeEvent(event);
		// The dialog reads the cart from the invoice store, so there is nothing
		// to hand over. `NavbarMenu.vue` owns the listener and the dialog.
		this.eventBus.emit("open_save_quotation");
	},

	"catalog.toggleDrawer"(event) {
		consumeEvent(event);
		this.eventBus.emit("toggle_catalog_drawer");
	},

	"items.priceCheck"(event) {
		consumeEvent(event);
		// Deliberately does NOT touch the compact panel or the cart: a price
		// lookup must be answerable mid-sale without disturbing the ticket.
		this.eventBus.emit("show_price_check");
	},

	"invoice.showInvoicePanel"(event) {
		consumeEvent(event);
		if (typeof this.close_payments === "function") {
			this.close_payments();
		} else {
			// Same hand-off close_payments makes. The listener lives on the
			// shell, not on this vm, so the request lands whether or not the
			// invoice panel implements close_payments — and the shell moves
			// the panel and the active view together.
			this.eventBus?.emit?.("show_invoice_panel");
		}
	},

	"invoice.cancelDialog"(event) {
		consumeEvent(event);
		this.cancel_dialog = true;
	},

	"items.focusSearch"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "selector");
		this.uiStore.setActiveView("items");
		// Reset, not focus: the chord means «ready for the next search»
		// (owner, 2026-09-05), so whatever the box held is gone on the way in.
		this.uiStore.triggerItemSearchReset();
		this.eventBus.emit("focus_item_search");
	},

	"items.selectTop"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "selector");
		this.uiStore.setActiveView("items");
		this.uiStore.selectTopItem();
	},

	"customer.focusSearch"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.focusCustomerSearchField?.();
	},

	"customer.selectFirst"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.$refs.customerSection?.selectFirstCustomer?.() ||
			this.$refs.customerComponent?.selectFirstCustomer?.();
	},

	"orders.openDrafts"(event) {
		consumeEvent(event);
		this.get_draft_orders?.();
	},

	"returns.open"(event) {
		consumeEvent(event);
		this.open_returns?.();
	},

	"invoice.focusDeliveryCharges"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.$refs.deliveryChargesComponent?.focusDeliveryCharges?.();
	},

	"invoice.focusPostingDate"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.$refs.postingDateComponent?.focusPostingDate?.();
	},

	"payment.open"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "selector");
		this.show_payment?.();
	},

	"app.goToDesk"(event) {
		consumeEvent(event);
		// Same deskless bug as OpeningDialog.go_desk: set_route("/") maps to
		// nothing on /posapp and reload() re-entered the SPA.
		window.location.href = "/desk";
	},

	"cart.focusQty"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.focusItemTableField("qty");
	},

	"invoice.focusAdditionalDiscount"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.focusAdditionalDiscountField?.();
	},

	"cart.focusUom"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.focusItemTableField("uom");
	},

	"cart.focusRate"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.focusItemTableField("rate");
	},

	"cart.removeFirstItem"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		const firstItem = this.items?.[0];
		if (firstItem) {
			this.remove_item?.(firstItem);
		}
	},

	"cart.focusDiscount"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		this.focusItemTableField("discount_percentage");
	},

	/**
	 * Alt+↓ — the door into the ROW scope. Lands on the LAST line (the one
	 * just added, in a running sale) and from there ↑↓ walk the cart and the
	 * bare keys work on the focused line (`CartItemRow.onRowKeydown`).
	 */
	"cart.focusRows"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		if (typeof document === "undefined") return;
		const rows = document.querySelectorAll<HTMLElement>(".posa-cart-item-row[tabindex]");
		const last = rows[rows.length - 1];
		if (last) {
			last.scrollIntoView?.({ block: "nearest" });
			last.focus();
		}
	},

	"items.focusToolbarSearch"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "invoice");
		if (this.$refs.actionToolbar?.focusSearch) {
			this.$refs.actionToolbar.focusSearch();
			return;
		}
		const input = this.$refs.itemSearchField;
		if (input?.focus) {
			input.focus();
		} else {
			input?.$el?.querySelector?.("input")?.focus?.();
		}
	},

	"invoice.openDrafts"(event) {
		consumeEvent(event);
		this.get_draft_invoices?.();
	},

	"items.toggleSettings"(event) {
		consumeEvent(event);
		showCompactPanel(this.eventBus, "selector");
		this.uiStore.toggleItemSettings();
	},

	"invoice.saveAndClear"(event) {
		consumeEvent(event);
		this.save_and_clear_invoice?.();
	},

	async "payment.submit"(event) {
		await submitSale.call(this, event, false);
	},

	async "payment.submitAndPrint"(event) {
		await submitSale.call(this, event, true);
	},
};

const invoiceShortcuts: Record<string, unknown> & ThisType<InvoiceShortcutsVm> =
	{
		async handleInvoiceShortcut(event: KeyboardEvent) {
			if (event.defaultPrevented) {
				return;
			}

			const actionId = actionForEvent(event);
			if (!actionId) {
				return;
			}

			const effect = INVOICE_SHORTCUT_EFFECTS[actionId];
			if (!effect) {
				// Bound to an action this surface does not implement (a keymap
				// may name actions owned by other screens) — leave the event
				// alone so the browser/other handlers still see it.
				return;
			}

			await effect.call(this, event);
		},

		focusItemTableField(field: ShortcutField) {
			const count = this.items?.length || 0;
			if (!count) {
				return;
			}

			if (!this.shortcutCycle) {
				this.shortcutCycle = { qty: 0, uom: 0, rate: 0, discount_percentage: 0 };
			}

			let index = Number.isInteger(this.shortcutCycle[field])
				? this.shortcutCycle[field]
				: 0;
			if (index >= count) {
				index = 0;
			}
			this.shortcutCycle[field] = (index + 1) % count;
			this.$refs.itemsTableRef?.focusItemField?.(index, field) ||
				this.$refs.itemsTable?.focusItemField?.(index, field);
		},
	};

export default invoiceShortcuts;
