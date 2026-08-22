/**
 * How a cashier finds the sale they are about to reverse
 * (`Devolucion.dc.html`, roadmap §5.4 / §5.6 "Reverse").
 *
 * Pure by construction — no Vue, no store, no `__()`. Same reasoning as
 * `composables/pos/shell/railDestinations.ts`: this list has to be reasoned
 * about in a test today and resolved per preset later, and neither is
 * possible if the only way to produce it is to mount a component.
 *
 * Two rules the artboard cannot state and this module must:
 *
 * 1. **A method names a capability GATE, never a giro.** "Por serie o IMEI"
 *    is not "the phone shop's search" — it is the search a register gets
 *    when its preset grants `serial_imei`. §4.2's rule is that what the giro
 *    does not use does not appear, so a carnicería's return screen has four
 *    ways to find a sale, not five with one greyed out (R3).
 * 2. **A chip is drawn from the ACTIVE keymap, never from the mock.** The
 *    artboard prints F1–F4. `MUELLE_DEFAULT` binds none of those to a return
 *    search, and F4 has meant `employee.switch` since before the shortcuts
 *    engine existed. R8 settled that argument once for the catalogue drawer
 *    (which got `alt+b`, not the F4 the mock draws); the same answer applies
 *    here. An unbound method renders its label with no chip — never a chip
 *    for a key that does nothing.
 */

import { isKnownAction } from "../../../../shortcuts/actions";
import { formatChord, type ResolvedKeymap } from "../../../../shortcuts/engine";

export const RETURN_FIND_METHOD_IDS = [
	"ticket",
	"item",
	"customer",
	"serial",
	"noReceipt",
] as const;

export type ReturnFindMethodId = (typeof RETURN_FIND_METHOD_IDS)[number];

/**
 * Capability questions the shell answers for the finder.
 *
 * - `serialIdentity` — does this giro track serials/IMEIs at all
 *   (`verticalStore.has("serial_imei")`)? A register that never records one
 *   cannot search by one, and offering the search would be a dead end drawn
 *   to look like a feature.
 * - `noReceiptReturns` — is the supervised no-ticket path enabled on this
 *   register (`POS Profile.posa_allow_return_without_invoice`)? This flag
 *   already gates the button Returns.vue ships today; the finder reads the
 *   same one rather than minting a second answer to one question.
 */
export type ReturnFindGate = "serialIdentity" | "noReceiptReturns";

export type ReturnFindGateMap = Readonly<Record<ReturnFindGate, boolean>>;

/**
 * `search` methods look up an original sale. `supervised` is the no-ticket
 * path, which finds nothing — it AUTHORISES a return with no original, and
 * §5.4 requires it to carry actor, reason and approval. It shares the panel
 * because that is where the cashier looks, not because it is a fifth search.
 */
export type ReturnFindKind = "search" | "supervised";

export interface ReturnFindMethod {
	id: ReturnFindMethodId;
	/**
	 * English source string; the view wraps it in `__()` at render time. Never
	 * translated here — this module stays free of the i18n global, the rule
	 * `shortcuts/actions.ts` and `railDestinations.ts` both follow.
	 */
	label: string;
	/** Short caption under the label; empty where the label says it all. */
	hint: string;
	placeholder: string;
	icon: string;
	kind: ReturnFindKind;
	gate: ReturnFindGate | null;
	/**
	 * Action id from `shortcuts/actions.ts`. `null` means the shortcuts engine
	 * has no action for this method — legal, and true of all five today. An
	 * INVENTED id is not legal: the cheat sheet and conflict detection both
	 * resolve ids against that registry, so a name that is not in it would
	 * render a chip nothing can ever press.
	 *
	 * Binding these is the three-file change R8 spells out (name it in
	 * `actions.ts`, chord it in `keymap.ts`, implement it in
	 * `invoiceShortcuts.ts`) and all three files belong to the lead. The
	 * moment those ids exist, filling them in here is the only edit this
	 * module needs — `describeFindMethods` resolves whatever it is given.
	 */
	shortcutActionId: string | null;
	/**
	 * The server query this method issues, as a repo-checkable name. Same
	 * discipline as `railDestinations.backedBy`: a claim that a method can
	 * find something points at the code that finds it, so the claim can be
	 * re-read in a minute instead of trusted.
	 */
	dataSource: string;
}

export const RETURN_FIND_METHODS: readonly ReturnFindMethod[] = [
	{
		id: "ticket",
		label: "By ticket",
		hint: "",
		placeholder: "Ticket number",
		icon: "mdi-receipt-text-outline",
		kind: "search",
		gate: null,
		shortcutActionId: null,
		// The one search the shipped endpoint was built for: `invoice_name` is
		// a LIKE over the invoice name.
		dataSource: "api.invoices.search_invoices_for_return(invoice_name)",
	},
	{
		id: "item",
		label: "By item or code",
		hint: "",
		placeholder: "Item code or name",
		icon: "mdi-barcode",
		kind: "search",
		gate: null,
		shortcutActionId: null,
		// `search_invoices_for_return` has no item filter, so this resolves in
		// two hops — see findOriginalSale.ts.
		dataSource: "frappe.client.get_list({doctype} Item) → search_invoices_for_return",
	},
	{
		id: "customer",
		label: "By customer",
		hint: "",
		placeholder: "Name, phone or RFC",
		icon: "mdi-account-outline",
		kind: "search",
		gate: null,
		shortcutActionId: null,
		// The endpoint ORs customer_name / customer_id / mobile_no / tax_id, so
		// one field covers all four without asking the cashier which one they
		// are holding.
		dataSource: "api.invoices.search_invoices_for_return(customer_*)",
	},
	{
		id: "serial",
		label: "By serial or IMEI",
		hint: "",
		placeholder: "Serial or IMEI",
		icon: "mdi-cellphone",
		kind: "search",
		gate: "serialIdentity",
		shortcutActionId: null,
		dataSource: "frappe.client.get_list({doctype} Item) → search_invoices_for_return",
	},
	{
		id: "noReceipt",
		label: "No ticket",
		hint: "needs a signature",
		placeholder: "",
		// Registered in `plugins/icons/mdiIconPaths.ts`, which is the whole set
		// this build ships — an unregistered name renders blank, and
		// `mdiIconCoverage.spec.ts` fails the build for exactly that.
		icon: "mdi-alert-circle-outline",
		kind: "supervised",
		gate: "noReceiptReturns",
		shortcutActionId: null,
		// Nothing is looked up: this path builds an empty return and the
		// existing `return_without_invoice` sends it. What it needs is a
		// decision, and that lives in noTicketGate.ts.
		dataSource: "none — supervised, see noTicketGate.ts",
	},
] as const;

/** Every chord the ACTIVE keymap binds to this action, human-formatted. */
export const chordsForAction = (
	actionId: string | null,
	resolved: ResolvedKeymap | null | undefined,
): string[] => {
	// An id the registry does not know cannot be bound, and must not be
	// searched for either: a typo'd id that happened to match a stale binding
	// would draw a chip for a key the cheat sheet never mentions.
	if (!actionId || !resolved || !isKnownAction(actionId)) {
		return [];
	}
	return resolved.bindings
		.filter((binding) => binding.actionId === actionId)
		.map((binding) => formatChord(binding.chord));
};

export interface ResolvedFindMethod extends ReturnFindMethod {
	/** Empty when the active keymap binds nothing — render no chip. */
	chords: string[];
}

/**
 * The methods this register offers, in artboard order, with their real chords.
 *
 * A gated-off method is ABSENT from the result rather than present-and-
 * disabled (R3). The cashier of a register that does not track IMEIs should
 * never learn that an IMEI search exists somewhere else.
 */
export const describeFindMethods = (
	gates: ReturnFindGateMap,
	resolved?: ResolvedKeymap | null,
): ResolvedFindMethod[] =>
	RETURN_FIND_METHODS.filter((method) => method.gate === null || gates[method.gate]).map(
		(method) => ({ ...method, chords: chordsForAction(method.shortcutActionId, resolved) }),
	);

/** Narrow an arbitrary string to a find-method id (router/persisted value). */
export const isReturnFindMethodId = (value: unknown): value is ReturnFindMethodId =>
	typeof value === "string" &&
	(RETURN_FIND_METHOD_IDS as readonly string[]).includes(value);

/**
 * The method a register should open on.
 *
 * Always a `search` method, never the supervised one: landing on the
 * no-ticket path would put the exception in front of the cashier before the
 * ordinary route, and most returns arrive with the ticket in hand.
 */
export const defaultFindMethod = (gates: ReturnFindGateMap): ReturnFindMethodId =>
	describeFindMethods(gates).find((method) => method.kind === "search")?.id ?? "ticket";
