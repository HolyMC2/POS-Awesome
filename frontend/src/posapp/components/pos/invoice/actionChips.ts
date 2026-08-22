/**
 * The sale's secondary actions, as keyboard-hint chips (Riel y Cajón §17.7).
 *
 * This replaces an eight-button grid of saturated `v-btn`s that stood between
 * the cart and the band. `Main.dc.html` draws that area as ONE line — counts on
 * the left, a few text-scale chips, figures on the right:
 *
 *     6 líneas · 9 piezas   Descuenta 9 piezas al cobrar
 *     [F3 Borrador] [F5 Factura] [Esc Cancelar]
 *
 * The chips are the reason this module is not just markup. Printing a chord
 * beside a verb is a PROMISE, and the artboard's own chords are wrong for the
 * shipped product: it draws F3/F5/Esc, while the shipped pack binds
 * `invoice.saveAndClear` to Alt+S, `invoice.openDrafts` to Alt+L and
 * `invoice.cancelDialog` to Alt+2. Same ruling as R8, where the mock drew F4 on
 * the catalogue and F4 has meant `employee.switch` since before the engine
 * existed: **the keymap is the truth and the mock is the mock.** So a chip
 * derives its chord from the resolved keymap, and an action with no chord shows
 * its verb with no chord rather than a lie.
 *
 * Pure: no Vue, no store. The caller passes the resolved keymap in.
 */

import { formatChord, type ResolvedKeymap } from "../../../shortcuts";

/**
 * `sale` actions act on the ticket in front of the operator and have no home
 * anywhere else. `destination` actions are ALSO rail destinations since the
 * shell rewire — Drafts, Facturas, Devolución and Recarga each own a rail
 * item now — so on a register that has a rail they are duplicates, and the
 * grid was showing every one of them twice.
 *
 * They are not dropped: below 1100px and on a lean-vertical preset there is no
 * rail, and `Customer Screen` is the only action removed outright because the
 * actions menu already carries it (`settings-action-customer-display`).
 */
export type ChipScope = "sale" | "destination";

export interface ActionChipDef {
	/** Event this chip emits. Unchanged from the button it replaces. */
	id: string;
	/** Registry action id, or null when nothing binds this behaviour. */
	actionId: string | null;
	/** English source label; the component wraps it in `__()`. */
	label: string;
	icon: string;
	scope: ChipScope;
	/** POS Profile flag gating this action, if any. */
	profileFlag?: string;
}

export const ACTION_CHIPS: readonly ActionChipDef[] = [
	{
		id: "save-and-clear",
		actionId: "invoice.saveAndClear",
		label: "Save & Clear",
		icon: "mdi-content-save",
		scope: "sale",
	},
	{
		id: "select-order",
		actionId: "orders.openDrafts",
		label: "Select S.O",
		icon: "mdi-book-search",
		scope: "sale",
		profileFlag: "custom_allow_select_sales_order",
	},
	{
		id: "print-draft",
		// Deliberately null: nothing in the registry binds printing a draft.
		// The chip renders its verb alone rather than inventing a chord.
		actionId: null,
		label: "Print Draft",
		icon: "mdi-printer",
		scope: "sale",
		profileFlag: "posa_allow_print_draft_invoices",
	},
	{
		id: "cancel-sale",
		actionId: "invoice.cancelDialog",
		label: "Cancel Sale",
		icon: "mdi-close-circle",
		scope: "sale",
	},
	{
		id: "load-drafts",
		actionId: "invoice.openDrafts",
		label: "Drafts",
		icon: "mdi-tray-full",
		scope: "destination",
	},
	{
		id: "open-invoice-management",
		actionId: "invoice.openManagement",
		label: "Invoice Mgmt",
		icon: "mdi-folder-search-outline",
		scope: "destination",
	},
	{
		id: "open-returns",
		actionId: "returns.open",
		label: "Sales Return",
		icon: "mdi-backup-restore",
		scope: "destination",
		profileFlag: "posa_allow_return",
	},
	{
		id: "open-saldo-picker",
		actionId: "saldo.openRecharge",
		// English source, Spanish in es.csv — like every other label here. This
		// one shipped as a Spanish literal, which reads fine on these tenants and
		// silently makes the string untranslatable for any other.
		label: "Recharge / Service",
		icon: "mdi-cellphone-arrow-down",
		scope: "destination",
		profileFlag: "saldo_enabled",
	},
] as const;

/**
 * Chord label for an action under the resolved keymap, or null when unbound.
 *
 * Returns the FIRST chord when an action carries several — `payment.open` has
 * both Alt+D and Alt+PageUp, and a chip has room to teach one of them.
 */
export const chordLabelFor = (
	actionId: string | null,
	resolved: ResolvedKeymap | null | undefined,
): string | null => {
	if (!actionId || !resolved) return null;
	const binding = resolved.bindings.find((b) => b.actionId === actionId);
	return binding ? formatChord(binding.chord) : null;
};

const flagEnabled = (profile: Record<string, unknown> | null | undefined, flag?: string) => {
	if (!flag) return true;
	const value = profile?.[flag];
	return value === 1 || value === "1" || value === true;
};

/**
 * Which chips this register shows.
 *
 * `railOwnsDestinations` is true exactly when a rail is mounted to carry them.
 * When it is false — phone, lean-vertical — the destination chips come back,
 * because there is no other way to reach Drafts or Devolución there.
 */
export const visibleChips = (
	profile: Record<string, unknown> | null | undefined,
	railOwnsDestinations: boolean,
): ActionChipDef[] =>
	ACTION_CHIPS.filter(
		(chip) =>
			flagEnabled(profile, chip.profileFlag) &&
			(chip.scope === "sale" || !railOwnsDestinations),
	);
