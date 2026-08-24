/**
 * Action registry — the stable half of the shortcuts engine (roadmap §17.3).
 *
 * An ACTION ID is permanent vocabulary: `payment.submit` means "submit the
 * sale" forever, on every keymap, in every giro. A KEY is a per-pack opinion
 * about which chord triggers it (see keymap.ts). Decoupling them is what
 * makes incumbent-emulating packs possible without touching a single
 * behavior — and what lets the cheat sheet, conflict detection and future
 * per-tenant overrides all speak about the same things.
 *
 * Labels are English source strings; the UI wraps them in `__()` at render
 * time (never here — this module must stay import-free of the i18n global so
 * it can be reasoned about in tests and on the server later).
 */

export type ShortcutCategory =
	| "navigation"
	| "cart"
	| "customer"
	| "payment"
	| "documents"
	| "app";

export interface ShortcutAction {
	id: string;
	/** English source label for the cheat sheet. */
	label: string;
	category: ShortcutCategory;
	/** Longer help text where the label alone would mislead. */
	hint?: string;
}

/**
 * Every keyboard-reachable POS behavior that exists today, named.
 *
 * An action may be unbound in SOME pack — that is the point of packs. But the
 * DEFAULT pack must bind every action in this list, and
 * tests/shortcutsEngine.spec.ts fails the build otherwise. So adding an entry
 * here is a two-file change: name it, then give it a chord in keymap.ts.
 */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
	// ── navigation ──────────────────────────────────────────────────────
	{ id: "invoice.showInvoicePanel", label: "Show invoice panel", category: "navigation" },
	{ id: "items.focusSearch", label: "Focus item search", category: "navigation" },
	{ id: "items.focusToolbarSearch", label: "Focus toolbar search", category: "navigation" },
	{ id: "items.selectTop", label: "Add top search result", category: "navigation" },
	{ id: "items.toggleSettings", label: "Toggle item settings", category: "navigation" },
	{
		id: "items.priceCheck",
		label: "Price checker",
		category: "navigation",
		hint: "Look up a price without touching the sale",
	},
	{ id: "app.goToDesk", label: "Go to Frappe Desk", category: "app" },
	{ id: "app.lockScreen", label: "Lock POS screen", category: "app" },
	{ id: "app.showShortcuts", label: "Show keyboard shortcuts", category: "app" },

	// ── cart ────────────────────────────────────────────────────────────
	{
		id: "cart.focusQty",
		label: "Edit quantity",
		category: "cart",
		hint: "Cycles through cart rows on repeat",
	},
	{ id: "cart.focusUom", label: "Edit unit of measure", category: "cart", hint: "Cycles through cart rows on repeat" },
	{ id: "cart.focusRate", label: "Edit rate", category: "cart", hint: "Cycles through cart rows on repeat" },
	{ id: "cart.removeFirstItem", label: "Remove first cart item", category: "cart" },
	{ id: "invoice.focusAdditionalDiscount", label: "Edit invoice discount", category: "cart" },
	{ id: "invoice.focusDeliveryCharges", label: "Edit delivery charges", category: "cart" },
	{ id: "invoice.focusPostingDate", label: "Edit posting date", category: "cart" },

	// ── customer ────────────────────────────────────────────────────────
	{ id: "customer.focusSearch", label: "Focus customer search", category: "customer" },
	{ id: "customer.selectFirst", label: "Select first customer", category: "customer" },
	{ id: "customer.new", label: "New customer", category: "customer" },
	{ id: "employee.switch", label: "Switch employee", category: "customer" },

	// ── payment ─────────────────────────────────────────────────────────
	{ id: "payment.open", label: "Open payment screen", category: "payment" },
	{ id: "payment.submit", label: "Submit sale", category: "payment" },
	{ id: "payment.submitAndPrint", label: "Submit sale and print", category: "payment" },

	// ── documents ───────────────────────────────────────────────────────
	{ id: "invoice.saveAndClear", label: "Save draft and clear", category: "documents" },
	{
		id: "invoice.saveQuotation",
		label: "Save quotation",
		category: "documents",
		// The dialog's own subtitle, word for word: the cheat sheet and the
		// dialog it opens should not describe the gesture two different ways —
		// and the row is already in es.csv, so this adds no new string.
		hint: "File this cart as a quotation",
	},
	{ id: "invoice.openDrafts", label: "Open draft invoices", category: "documents" },
	{ id: "orders.openDrafts", label: "Open draft orders", category: "documents" },
	{ id: "returns.open", label: "Open returns", category: "documents" },
	{ id: "invoice.cancelDialog", label: "Cancel current sale", category: "documents" },
	{ id: "shift.details", label: "Shift details", category: "documents" },

	// Rail destinations (Riel y Cajón, docs/POS-RIEL-Y-CAJON-BUILD.md). These
	// five had no action id because they were only ever reachable as dialogs
	// from the actions menu; promoting them to rail destinations makes them
	// addressable, and an addressable destination needs a stable name before
	// anything can bind a chord to it. Drafts and returns are absent from this
	// block on purpose — `invoice.openDrafts` and `returns.open` already exist
	// and the rail reuses them rather than minting synonyms.
	{ id: "cash.openMovement", label: "Open cash movement", category: "documents", hint: "Expense, deposit or cash in" },
	{ id: "invoice.openManagement", label: "Open invoices", category: "documents" },
	{ id: "charges.openRequests", label: "Open service orders", category: "documents", hint: "Repairs and external charge requests" },
	{ id: "saldo.openRecharge", label: "Open recharges", category: "documents" },
	{ id: "shift.close", label: "Close shift", category: "documents", hint: "Corte de caja" },
	{
		id: "catalog.toggleDrawer",
		label: "Open catalogue",
		category: "navigation",
		hint: "Browse items beside the sale",
	},
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];

const BY_ID = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export const getAction = (id: string): ShortcutAction | undefined => BY_ID.get(id);

export const isKnownAction = (id: string): boolean => BY_ID.has(id);

/** Cheat-sheet section order — deliberate, not alphabetical: a cashier scans
 * for the thing they are doing right now, and that is the sale, not the app. */
export const CATEGORY_ORDER: readonly ShortcutCategory[] = [
	"navigation",
	"cart",
	"customer",
	"payment",
	"documents",
	"app",
] as const;

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
	navigation: "Navigation",
	cart: "Cart",
	customer: "Customer",
	payment: "Payment",
	documents: "Documents",
	app: "Application",
};
