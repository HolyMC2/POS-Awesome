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
	| "lines"
	| "customer"
	| "payment"
	| "documents"
	| "app";

/**
 * Where a chord is listened for.
 *
 * `global` (the default) is the document listener: Alt chords and F-keys
 * that work from anywhere on the register. `row` is a CART LINE with the
 * keyboard focus on it — bare keys (`+`, `-`, `p`, `d`, Supr…) that would be
 * unthinkable as global chords, because typing "p" in the search box must
 * type a p. The row's own keydown asks the engine for these; the document
 * listener never sees them. Owner ask 2026-09-05: «a more robust item select
 * system keyboard driven… like SICAR, keyboard only for searching, selecting,
 * editing prices, discount».
 */
export type ShortcutScope = "global" | "row";

export interface ShortcutAction {
	id: string;
	/** English source label for the cheat sheet. */
	label: string;
	category: ShortcutCategory;
	/** Longer help text where the label alone would mislead. */
	hint?: string;
	/** Defaults to `global`. */
	scope?: ShortcutScope;
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
	{
		id: "items.focusSearch",
		label: "Focus item search",
		category: "navigation",
		// The box is CLEARED on the way in (owner, 2026-09-05): the chord is
		// «ready for the next search», not «put the cursor after what is
		// already there». The multiplier rides the same box: `3*` before a
		// term or a scan adds three.
		hint: "Clears the box · type 3* before a term or a scan to add three",
	},
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
	{
		id: "cart.focusDiscount",
		label: "Edit line discount",
		category: "cart",
		hint: "Cycles through cart rows on repeat",
	},
	{
		id: "cart.focusRows",
		label: "Jump to the cart lines",
		category: "cart",
		hint: "Lands on the last line; the keys below then work on it",
	},

	// ── lines (a cart line has the focus) ───────────────────────────────
	// Bare keys, on purpose: this is the SICAR-style loop — arrow to the
	// line, +/− the quantity, P for the price, D for the discount, S for the
	// serial, Supr to drop it, Enter for the whole line, Esc back to the box.
	{ id: "row.previous", label: "Previous line", category: "lines", scope: "row" },
	{ id: "row.next", label: "Next line", category: "lines", scope: "row" },
	{ id: "row.increment", label: "One more", category: "lines", scope: "row" },
	{ id: "row.decrement", label: "One less", category: "lines", scope: "row" },
	{ id: "row.quantity", label: "Type the quantity", category: "lines", scope: "row" },
	{ id: "row.price", label: "Change the price", category: "lines", scope: "row" },
	{ id: "row.discount", label: "Line discount %", category: "lines", scope: "row" },
	{
		id: "row.lots",
		label: "Serial or batch",
		category: "lines",
		scope: "row",
		hint: "Opens the picker for a tracked item",
	},
	{ id: "row.details", label: "Open line details", category: "lines", scope: "row" },
	{ id: "row.remove", label: "Remove line", category: "lines", scope: "row" },
	{ id: "row.back", label: "Back to search", category: "lines", scope: "row" },
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

export const actionScope = (id: string): ShortcutScope => getAction(id)?.scope ?? "global";

/** Cheat-sheet section order — deliberate, not alphabetical: a cashier scans
 * for the thing they are doing right now, and that is the sale, not the app. */
export const CATEGORY_ORDER: readonly ShortcutCategory[] = [
	"navigation",
	"cart",
	"lines",
	"customer",
	"payment",
	"documents",
	"app",
] as const;

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
	navigation: "Navigation",
	cart: "Cart",
	lines: "Cart lines · with a line focused",
	customer: "Customer",
	payment: "Payment",
	documents: "Documents",
	app: "Application",
};
