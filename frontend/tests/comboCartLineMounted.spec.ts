import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `ComboCartLine` existed but nothing rendered it — cart rows are built by
 * `ItemsTable`, not the shell, so wave 2's integration could not reach it.
 * This file guards the render path and, just as importantly, the two ways it
 * must NOT fire.
 *
 * Deliberately source-level: `ItemsTable` mounts the whole cart stack
 * (formatters, drag-drop, merge, virtual columns, Vuetify dialogs) and what is
 * being asserted here is a routing decision, not behaviour of those parts.
 * `tests/comboCartLine.spec.ts` (T6) already mounts the component itself.
 */
// Node env (no jsdom pragma): `node:fs` named imports do not interop under
// jsdom in this repo — the same reason cartActionBarLayout.spec.ts is node.
const table = readFileSync(
	fileURLToPath(new URL("../src/posapp/components/pos/invoice/ItemsTable.vue", import.meta.url)),
	"utf8",
);

describe("ItemsTable routes combo lines to ComboCartLine", () => {
	it("imports and renders it", () => {
		expect(table).toContain('import ComboCartLine from "../combos/ComboCartLine.vue"');
		expect(table).toContain("<ComboCartLine");
	});

	it("wraps it in a spanning cell, because a bare div is hoisted out of a table", () => {
		// The component is a flex <div>. Dropped straight into <tbody> the HTML
		// parser moves it BEFORE the table, which renders as a stray row above
		// the cart — the kind of bug that looks like a CSS problem for an hour.
		expect(table).toMatch(/<tr v-if="isComboLine\(item\)"[\s\S]{0,200}<td :colspan=/);
	});

	it("falls through to the ordinary row for everything else", () => {
		expect(table).toMatch(/<CartItemRow\s*\n?\s*v-else/);
	});

	it("does not draw a partially-returned combo as a combo", () => {
		// comboReturns marks a partial return `broken` precisely because
		// "COMBO · 3" beside two surviving components misstates what the
		// customer still has.
		expect(table).toContain("!item?.posa_combo_broken");
	});

	it("keys the row off a posa_-prefixed field, like every other POS field", () => {
		expect(table).toContain("posa_combo_components");
	});
});
