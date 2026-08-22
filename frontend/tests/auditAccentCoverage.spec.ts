import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A2 audit finding — the single-accent invariant is enforced where it was
 * never at risk, and unenforced where it is most visibly broken.
 *
 * `singleAccent.spec.ts` (T3) walks `components/pos/shell/**` only. Every file
 * under that root was written this wave, to the invariant, by one agent. The
 * surfaces that actually sit on screen beside the band during a sale —
 * `InvoiceActionButtons`, `InvoiceSummary`, `CartItemRow`, the payment
 * surfaces — are all OUTSIDE that root and have never been scanned.
 *
 * The visible consequence, confirmed against `docs/design-evidence/after/`:
 * the action grid directly above the band renders eight buttons in eight
 * saturated fills at once. `secondaryVariant` resolves to `elevated` on
 * desktop, and Vuetify routes `color` to the BACKGROUND for elevated/flat
 * variants (`vuetify/lib/composables/variant.js`), so these are fills, not
 * tinted labels.
 *
 * It breaks §17.7's invariant 2 in the specific way the roadmap warns about:
 * amber and green are supposed to be STATE, never emphasis. Here green means
 * "Sales Return", yellow means "Drafts" and red means "Cancel Sale" — three
 * state colours spent as category labels. Once a cashier learns green is a
 * button colour rather than a signal, the band's green "change to give" stops
 * meaning anything.
 *
 * This spec is a RATCHET, not a fix. It records the inventory as it stands so
 * the number can only go DOWN: a new saturated fill on a sale-path surface
 * fails here immediately, while the existing debt is paid off deliberately
 * rather than by a sweep nobody scheduled. Lower these numbers as they are
 * fixed; never raise one.
 */

const SRC = new URL("../src/posapp/", import.meta.url);

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, SRC)), "utf8");

/**
 * Vuetify theme tokens that render as a SATURATED fill on an elevated or flat
 * button. `primary` is deliberately absent — the brand accent on a primary
 * action is the one use the invariant permits.
 */
const SATURATED = [
	"success",
	"warning",
	"error",
	"info",
	"accent",
	"indigo",
	"deep-purple",
	"secondary",
	"purple",
	"teal",
	"orange",
	"red",
	"green",
	"blue",
	"amber",
] as const;

const SATURATED_COLOR = new RegExp(`color="(${SATURATED.join("|")})"`, "g");

const countSaturated = (source: string) => source.match(SATURATED_COLOR)?.length ?? 0;

/**
 * The sale path: surfaces a cashier has on screen while ringing up, which is
 * where the invariant has to hold for the density to stay legible. Counts are
 * today's reality, not a target.
 */
const SALE_PATH_INVENTORY: ReadonlyArray<readonly [string, number]> = [
	// Ratcheted down by W4-D, 2026-08-22: 24 → 4. The four survivors are all
	// state rendered as a TINT or an OUTLINE, never a fill:
	//   CartItemRow          error/success on `variant="tonal"` chips —
	//                        "Expired" and "Offer Item" are exactly what §17.7
	//                        reserves red and green FOR. They were `flat`.
	//   PaymentActionButtons error on `variant="text"` Cancel Payment.
	//   PosOffers            error on an `variant="outlined"` row action.
	// Vuetify routes `color` to the foreground for every non-elevated/flat
	// variant, so none of these paints a background. Never raise a number.
	["components/pos/invoice/InvoiceActionButtons.vue", 0],
	["components/pos/invoice/InvoiceSummary.vue", 0],
	["components/pos/invoice/CartItemRow.vue", 2],
	["components/pos/payments/PaymentActionButtons.vue", 1],
	["components/pos/payments/PaymentMethods.vue", 0],
	["components/pos/offers/PosOffers.vue", 1],
];

describe("A2 — single-accent coverage hole", () => {
	it.each(SALE_PATH_INVENTORY)(
		"%s carries no MORE than its recorded %i saturated fills",
		(relative, recorded) => {
			expect(
				countSaturated(read(relative)),
				`${relative}: a new saturated fill on a sale-path surface. The band's ` +
					`green means "change to give"; a green button teaches the cashier it means nothing.`,
			).toBeLessThanOrEqual(recorded);
		},
	);

	it("the shipped scan genuinely does not reach the sale path", () => {
		// The finding itself, pinned: if someone widens singleAccent.spec.ts to
		// cover these surfaces, this assertion fails and this whole file should
		// be deleted in favour of the real one.
		const shipped = readFileSync(
			fileURLToPath(new URL("./singleAccent.spec.ts", import.meta.url)),
			"utf8",
		);
		expect(shipped).toContain('components/pos/shell');
		expect(shipped).not.toContain("components/pos/invoice");
	});

	it("the elevated-variant mechanism that made them fills is gone", () => {
		// This assertion used to pin the CAUSE — `secondaryVariant` resolving to
		// `elevated`, which is what turned eight hues into eight backgrounds.
		// W4-D removed the grid entirely, so it now pins the absence: nothing in
		// this file may resolve a variant to `elevated` or `flat` for a
		// SECONDARY action again.
		const source = read("components/pos/invoice/InvoiceActionButtons.vue");
		expect(source).not.toContain('"elevated"');
		expect(source).not.toMatch(/isPhone\.value\s*\?\s*"tonal"\s*:\s*"elevated"/);
	});
});
