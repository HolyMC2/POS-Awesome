/**
 * "Compatible" — the one claim on the phone's browse screen that a cashier
 * repeats to a customer out loud.
 *
 * `MovilExplorar.dc.html` draws a `Compatible` chip beside the category chips
 * and a footer reading "18 compatibles con Honor X8A". The idea is real and
 * it is the best thing on that artboard: the register knows which phone the
 * customer is holding, so it offers the cases and micas that FIT it instead of
 * the whole accessory wall. The question this module answers first is whether
 * the DATA can back that claim, because a chip labelled Compatible that
 * quietly shows everything is worse than no chip — the cashier hands over a
 * case for the wrong phone with the register's word behind them.
 *
 * WHAT EXISTS, VERIFIED (08-22)
 *
 * Exactly one authored compatibility relation ships in this product:
 * `POS Combo`'s `targets` child table (`POS Combo Target`, a Link to Item),
 * surfaced by `api/combos.py::get_combos` as `targets: [item_code]` and
 * described by the doctype itself as "Items this combo is FOR". A merchant who
 * builds "Combo Protección Honor X8A" and targets it at the Honor X8A has
 * stated, in their own data, that those parts fit that phone.
 *
 * WHAT DOES NOT EXIST
 *
 *   - No Item field links a loose accessory to the devices it fits. The app
 *     ships no such Custom Field (`hooks.py`'s fixtures list has no `Item-…`
 *     entry at all) and the catalogue read model carries only `item_group`,
 *     `brand`, `variant_of` — a colour variant of a template, not a device.
 *   - No service order carries the customer's device either. The repair path
 *     arrives as a Charge Request from Taller, and
 *     `api/charge_requests.py::load_charge_request` returns the LINES to
 *     charge plus a reference — nothing naming the equipment on the bench.
 *
 * `composables/pos/combos/comboCatalog.ts` reached the same conclusion from
 * the up-sell strip's side and wrote it down: "the register has no authored
 * 'these go together' relation for loose items". This module is that finding
 * applied to a filter instead of a strip.
 *
 * SO THE FILTER SHIPS ONLY WHERE THE DATA REACHES
 *
 * The compatible set for a device D is built from the combos that explicitly
 * target D, and contains:
 *
 *   1. those combos themselves — `targets` says so directly; and
 *   2. their components — the same record says "Case + Mica + Instalación go
 *      with the Honor X8A", so each part is compatible with it by the
 *      merchant's own declaration, not by our inference.
 *
 * Nothing else is in the set. In particular a UNIVERSAL combo (empty
 * `targets`, "fits anything") is deliberately excluded: it is compatible with
 * D in the trivial sense, but including it makes a register whose combos are
 * all universal show an unfiltered list under a chip that promises filtering —
 * the exact failure this module exists to prevent. A chip that means "chosen
 * for the phone in front of you" must contain only things chosen for it.
 *
 * The one way a wrong item enters the set is a merchant bundling a part that
 * does not fit into a combo they targeted at D. That is their record saying it
 * fits, and it is auditable — `provenance` names which combo put each code
 * there. Guessing from item groups or sales history would not be.
 *
 * NEVER FALLS BACK TO EVERYTHING. `applyCompatibilityFilter` returns an EMPTY
 * list when the scope is unsupported, never the input. An empty screen is a
 * visible bug someone reports; a full screen under a Compatible chip is an
 * invisible one that a customer takes home.
 */

import type { ComboOffer } from "../../../../composables/pos/combos/comboCatalog";

/**
 * Filter id for the Compatible chip. Deliberately NOT a `CatalogCategory` id:
 * a category selects a slice of the catalogue, this narrows whatever slice is
 * selected, and the two compose (Compatible + Fundas is a meaningful screen).
 */
export const COMPATIBLE_FILTER_ID = "compatible";

/** Where a code in the compatible set came from. Auditable by construction. */
export type CompatibilityProvenance = "combo" | "combo-component";

export interface CompatibilityInput {
	/** The register's combos, from `useComboOffers`. The only authored source. */
	combos?: readonly ComboOffer[];
	/** The ticket, as lines or as bare item codes — both shapes are accepted. */
	cart?: readonly (string | { item_code?: unknown })[];
	/**
	 * An explicitly named device, for a caller that knows one.
	 *
	 * NOTHING SUPPLIES THIS TODAY: see the module note on Charge Requests. It
	 * is typed and tested so a service order that starts carrying the customer's
	 * equipment plugs in here, and — importantly — an explicit device still has
	 * to clear the same gate. Naming a phone no combo targets does not create a
	 * compatible set; it produces `supported: false`, and no chip.
	 */
	deviceItemCode?: string | null;
	/** Display names by item code, for the footer's claim. Falls back to code. */
	deviceNames?: Readonly<Record<string, string>>;
}

/**
 * Why the chip is or is not offered. Asserted on directly by tests, because
 * "no chip" has three causes and only one of them is a bug.
 */
export type CompatibilityReason =
	/** A device is identified and combos target it — the chip is offered. */
	| "targeted"
	/** Nothing on the ticket is a device any combo targets. */
	| "no-device"
	/** A device is known, but no authored record says what fits it. */
	| "no-authored-targets";

export interface CompatibilityScope {
	/** The ONLY gate. False means: do not draw the chip, do not make the claim. */
	supported: boolean;
	/** The device the claim is about. Empty string when unsupported. */
	deviceItemCode: string;
	/** What to call it in the footer. Falls back to the code. */
	deviceName: string;
	/** Item codes a merchant record says fit that device. Empty when unsupported. */
	codes: ReadonlySet<string>;
	/** Which combo put each code in the set — `combo::PARENT_CODE`. */
	provenance: ReadonlyMap<string, { via: CompatibilityProvenance; combo: string }>;
	reason: CompatibilityReason;
}

const EMPTY_SCOPE = (reason: CompatibilityReason): CompatibilityScope => ({
	supported: false,
	deviceItemCode: "",
	deviceName: "",
	codes: new Set<string>(),
	provenance: new Map(),
	reason,
});

const codeOf = (entry: string | { item_code?: unknown } | null | undefined): string =>
	String((typeof entry === "string" ? entry : entry?.item_code) ?? "").trim();

/**
 * Combos indexed by the device they target.
 *
 * Blank targets are dropped rather than indexed under "", which would make a
 * half-filled `POS Combo Target` row match a cart line whose `item_code` had
 * not loaded yet — the same blank-matches-blank trap `comboCatalog.ts`'s
 * `cartCodes` guards against.
 */
const indexByTarget = (combos: readonly ComboOffer[]): Map<string, ComboOffer[]> => {
	const index = new Map<string, ComboOffer[]>();
	for (const combo of combos ?? []) {
		for (const target of combo?.targets ?? []) {
			const code = String(target ?? "").trim();
			if (!code) continue;
			const bucket = index.get(code);
			if (bucket) bucket.push(combo);
			else index.set(code, [combo]);
		}
	}
	return index;
};

/**
 * Resolve what, if anything, the register may claim compatibility with.
 *
 * When several devices on one ticket are targeted, the LAST one wins: on a
 * phone the cashier is working the item they just scanned, and a claim about a
 * phone sold three lines ago would be about the wrong customer's hand. One
 * device, one claim — "compatible" plural across two phones is not a sentence
 * the footer can say honestly.
 */
export const resolveCompatibilityScope = (
	input: CompatibilityInput = {},
): CompatibilityScope => {
	const { combos = [], cart = [], deviceItemCode, deviceNames } = input ?? {};

	const byTarget = indexByTarget(combos);
	if (byTarget.size === 0) {
		// No combo targets anything. Nothing to say about any device, including
		// an explicitly named one.
		return EMPTY_SCOPE(deviceItemCode ? "no-authored-targets" : "no-device");
	}

	const explicit = String(deviceItemCode ?? "").trim();
	let device = "";
	if (explicit) {
		device = explicit;
	} else {
		for (const entry of cart ?? []) {
			const code = codeOf(entry);
			if (code && byTarget.has(code)) device = code;
		}
	}

	if (!device) return EMPTY_SCOPE("no-device");

	const targeting = byTarget.get(device) ?? [];
	if (!targeting.length) return EMPTY_SCOPE("no-authored-targets");

	const codes = new Set<string>();
	const provenance = new Map<string, { via: CompatibilityProvenance; combo: string }>();

	const remember = (raw: unknown, via: CompatibilityProvenance, combo: string) => {
		const code = String(raw ?? "").trim();
		// The device is not an accessory for itself, and it is already on the
		// ticket — offering the customer a second Honor X8A is not the claim.
		if (!code || code === device || codes.has(code)) return;
		codes.add(code);
		provenance.set(code, { via, combo });
	};

	for (const combo of targeting) {
		const parent = String(combo?.item_code ?? "").trim();
		remember(parent, "combo", parent);
		for (const component of combo?.components ?? []) {
			remember(component?.item_code, "combo-component", parent);
		}
	}

	if (codes.size === 0) return EMPTY_SCOPE("no-authored-targets");

	return {
		supported: true,
		deviceItemCode: device,
		deviceName: String(deviceNames?.[device] ?? "").trim() || device,
		codes,
		provenance,
		reason: "targeted",
	};
};

/**
 * Narrow a list to what the scope says fits.
 *
 * Returning `[]` for an unsupported scope is the whole safety property of this
 * module and it is not a convenience: the alternative — returning the input —
 * is how a Compatible chip ends up showing the full catalogue while the footer
 * counts it as compatible. Callers gate on `scope.supported` before offering
 * the chip at all, so the empty return is unreachable in the shipped screen and
 * exists to make the WRONG wiring fail loudly instead of quietly.
 */
export const applyCompatibilityFilter = <T extends { item_code?: unknown }>(
	items: readonly T[],
	scope: CompatibilityScope | null | undefined,
): T[] => {
	if (!scope?.supported) return [];
	return (items ?? []).filter((item) => scope.codes.has(String(item?.item_code ?? "").trim()));
};

/** Whether the chip may be drawn at all. One place, so no surface re-derives it. */
export const offersCompatibleFilter = (
	scope: CompatibilityScope | null | undefined,
): boolean => Boolean(scope?.supported);
