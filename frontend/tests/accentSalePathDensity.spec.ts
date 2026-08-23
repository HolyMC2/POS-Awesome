/**
 * W4-D — the sale path's action area: one accent, and one LINE.
 *
 * Two properties, and neither survives on review alone.
 *
 * The colour half is §17.7 invariant 2: exactly one saturated accent per
 * screen, on the primary. `singleAccent.spec.ts` walks the whole POS and ratchets the count;
 * this file pins the shape.
 *
 * The density half is the one a screenshot proves once and then stops
 * proving. `Main.dc.html` draws the area between the cart and the band as a
 * single ~38px strip — counts, a few text-scale chips, figures. What shipped
 * was an eight-button grid roughly 200px tall. A future edit adding "just one
 * more button" would rebuild the grid a row at a time, and nothing would
 * complain. So the element budget is asserted, not admired.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ACTION_CHIPS, chordLabelFor, visibleChips } from "../src/posapp/components/pos/invoice/actionChips";
import { MUELLE_DEFAULT, resolveKeymap } from "../src/posapp/shortcuts";

const strip = () =>
	readFileSync(
		fileURLToPath(
			new URL("../src/posapp/components/pos/invoice/InvoiceActionButtons.vue", import.meta.url),
		),
		"utf8",
	);

const resolved = resolveKeymap(MUELLE_DEFAULT);

describe("the action area is a strip, not a grid", () => {
	it("renders no v-col at all — the grid is gone", () => {
		// The old implementation was `v-row` + ten `v-col`s. One flex line
		// replaces it; a returning `v-col` here means the grid is regrowing.
		const source = strip();
		expect(source).not.toContain("<v-col");
		expect(source).not.toContain("<v-row");
	});

	it("spends at most two v-btn elements in source, however many chips render", () => {
		// One `v-for` chip button + one PAY. Any third is a hand-placed button,
		// which is how the grid started.
		const buttons = strip().match(/<v-btn\b/g) ?? [];
		expect(buttons.length, `found ${buttons.length} <v-btn> in the strip`).toBeLessThanOrEqual(2);
	});

	it("gives every chip a text variant, so none can become a fill", () => {
		const source = strip();
		expect(source).toMatch(/class="pos-action-strip__chip"[\s\S]{0,200}?variant="text"/);
	});

	it("keeps PAY as the one filled button, and only where no band exists", () => {
		const source = strip();
		expect(source).toMatch(/v-if="!bandOwnsPrimary"[\s\S]{0,400}?variant="flat"[\s\S]{0,200}?color="primary"/);
		// Green is state in this register; PAY must not reclaim it.
		expect(source).not.toContain('color="success"');
		expect(source).not.toContain("#4caf50");
	});
});

describe("chips print chords that are actually bound", () => {
	it("resolves every bound action to a real chord label", () => {
		const bound = ACTION_CHIPS.filter((c) => c.actionId);
		expect(bound.length).toBeGreaterThan(0);
		for (const chip of bound) {
			expect(
				chordLabelFor(chip.actionId, resolved),
				`${chip.id} claims action ${chip.actionId} but the default pack binds no chord for it`,
			).toBeTruthy();
		}
	});

	it("renders the SHIPPED chord, not the artboard's", () => {
		// The mock draws F3/F5/Esc. The pack binds Alt+S / Alt+L / Alt+2, and the
		// keymap is the truth (ruling R8 — the mock drew F4 on the catalogue,
		// and F4 has meant employee.switch since before the engine).
		expect(chordLabelFor("invoice.saveAndClear", resolved)).toBe("Alt + S");
		expect(chordLabelFor("invoice.openDrafts", resolved)).toBe("Alt + L");
		expect(chordLabelFor("invoice.cancelDialog", resolved)).toBe("Alt + 2");
	});

	it("returns null rather than inventing a chord for an unbound action", () => {
		const printDraft = ACTION_CHIPS.find((c) => c.id === "print-draft");
		expect(printDraft?.actionId).toBeNull();
		expect(chordLabelFor(null, resolved)).toBeNull();
	});
});

describe("no capability is dropped when the rail takes the destinations", () => {
	const profile = {
		custom_allow_select_sales_order: 1,
		posa_allow_print_draft_invoices: 1,
		posa_allow_return: 1,
		saldo_enabled: 1,
	};

	it("shows only sale-scoped chips where a rail is mounted", () => {
		const ids = visibleChips(profile, true).map((c) => c.id);
		expect(ids).toEqual(["save-and-clear", "select-order", "print-draft", "cancel-sale"]);
	});

	it("brings the destination chips back where there is no rail", () => {
		// Phone and lean-vertical have no rail, so this strip is the only route
		// to Drafts, Facturas, Devolución and Recarga. Dropping them there would
		// be a real capability loss, not a tidy-up.
		const ids = visibleChips(profile, false).map((c) => c.id);
		expect(ids).toContain("load-drafts");
		expect(ids).toContain("open-invoice-management");
		expect(ids).toContain("open-returns");
		expect(ids).toContain("open-saldo-picker");
	});

	it("honours every POS Profile flag the old buttons honoured", () => {
		const ids = visibleChips({}, false).map((c) => c.id);
		expect(ids).not.toContain("select-order");
		expect(ids).not.toContain("print-draft");
		expect(ids).not.toContain("open-returns");
		expect(ids).not.toContain("open-saldo-picker");
		// Ungated actions survive an empty profile.
		expect(ids).toContain("save-and-clear");
		expect(ids).toContain("cancel-sale");
	});

	it("keeps Customer Screen out, because the actions menu already carries it", () => {
		expect(ACTION_CHIPS.map((c) => c.id)).not.toContain("open-customer-display");
		const menu = readFileSync(
			fileURLToPath(new URL("../src/posapp/components/navbar/NavbarMenu.vue", import.meta.url)),
			"utf8",
		);
		expect(menu).toContain('id: "customer-display"');
	});
});
