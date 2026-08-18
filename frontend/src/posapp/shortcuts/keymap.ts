/**
 * Keymap packs — the swappable half of the shortcuts engine (roadmap §17.3).
 *
 * A keymap is a VERSIONED ARTIFACT (§9.1): action id → chord list, carrying
 * its own `version` that is bumped by hand whenever bindings change, so a
 * register can say which keymap revision its cashier learned. Presets bind a
 * keymap; a tenant may override individual actions; a user layer sits on top.
 * None of that changes an action's meaning — only which key reaches it.
 *
 * HONESTY RULE for incumbent packs (Eleventa, SICAR, Aspel-style layouts):
 * a pack is authored ONLY from evidence — a real migrating operator's
 * terminal or the incumbent's published documentation — never from memory of
 * what those products "probably" use. A wrong pack is worse than no pack: it
 * teaches a cashier a key that silently does the wrong thing on their first
 * live sale. `muelle-default` ships today; the registry below is built to
 * hold the others the moment a migration produces the evidence.
 */

export interface Keymap {
	id: string;
	/** Bumped by hand on every binding change — this is the artifact version. */
	version: number;
	label: string;
	/** Provenance for non-default packs; required by the honesty rule. */
	evidence?: string;
	bindings: Record<string, string[]>;
}

/**
 * The bindings POSAwesome has shipped. Extracted verbatim from the if-chain
 * in invoiceShortcuts.ts (2026-08-17) so the engine refactor is invisible to
 * every cashier already trained on them — parity is pinned by
 * tests/shortcutsEngine.spec.ts.
 */
export const MUELLE_DEFAULT: Keymap = {
	id: "muelle-default",
	version: 1,
	label: "Muelle POS (default)",
	bindings: {
		// navigation
		"invoice.showInvoicePanel": ["alt+1"],
		"items.focusSearch": ["alt+3"],
		"items.selectTop": ["alt+4"],
		"items.focusToolbarSearch": ["alt+f"],
		"items.toggleSettings": ["alt+m"],
		"app.goToDesk": ["alt+home"],
		"app.lockScreen": ["f8"],
		"app.showShortcuts": ["alt+h"],

		// cart
		"cart.focusQty": ["alt+q"],
		"cart.focusUom": ["alt+u"],
		"cart.focusRate": ["alt+r"],
		"cart.removeFirstItem": ["alt+e"],
		"invoice.focusAdditionalDiscount": ["alt+a"],
		"invoice.focusDeliveryCharges": ["alt+9"],
		"invoice.focusPostingDate": ["alt+backquote"],

		// customer
		"customer.focusSearch": ["alt+5"],
		"customer.selectFirst": ["alt+6"],
		"customer.new": ["f6"],
		"employee.switch": ["f4"],

		// payment — two chords, one action: the Alt+D letter and the Alt+PageUp
		// position both opened the payment screen before the engine existed.
		"payment.open": ["alt+d", "alt+pageup"],
		"payment.submit": ["alt+x"],
		"payment.submitAndPrint": ["alt+p"],

		// documents
		"invoice.saveAndClear": ["alt+s"],
		"invoice.openDrafts": ["alt+l"],
		"orders.openDrafts": ["alt+7"],
		"returns.open": ["alt+8"],
		"invoice.cancelDialog": ["alt+2"],
		"shift.details": ["f7"],
	},
};

/** Every pack the build knows about, by id. */
export const KEYMAP_PACKS: Record<string, Keymap> = {
	[MUELLE_DEFAULT.id]: MUELLE_DEFAULT,
};

export const DEFAULT_KEYMAP_ID = MUELLE_DEFAULT.id;

/** Resolve a pack by id, falling back to the default rather than throwing:
 * an unknown keymap id (stale preset, half-rolled tenant) must degrade to
 * working keys, never to a dead keyboard. */
export const getKeymap = (id?: string | null): Keymap =>
	(id && KEYMAP_PACKS[id]) || MUELLE_DEFAULT;
