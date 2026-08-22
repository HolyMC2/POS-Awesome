import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The empty cart — what it costs, and what it is allowed to say.
 *
 * It used to be a 78 px illustration in a 140 px panel, roughly 270 px of
 * cart, over the line *"Add items from the selector to start building this
 * sale."* Two separate defects in one block: the height, in a register whose
 * whole redesign is density, and the copy, which named a control that stopped
 * existing when the catalogue became a drawer.
 *
 * Both are guarded here, and the copy guard is the one that will still be
 * earning its keep in a year: instructional copy rots every time the shell
 * moves, and nothing else in the suite notices. The *height* is a budget
 * rather than a measurement — jsdom has no layout engine, so a mounted
 * `offsetHeight` would read 0 and prove nothing. What the source can prove is
 * that the box declares a bounded height and declares nothing that could
 * reach the scrollport chain.
 *
 * Source-level for the same reason `comboCartLineMounted.spec.ts` and
 * `cartLineAnatomy.spec.ts` are: `ItemsTable` mounts the entire cart stack
 * (formatters, drag-drop, merge, responsive columns, Vuetify dialogs) and
 * what is asserted here is a layout and vocabulary decision, not the
 * behaviour of any of those parts.
 */
// Node env (no jsdom pragma): `node:fs` named imports do not interop under
// jsdom in this repo — the same reason cartActionBarLayout.spec.ts is node.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const table = read("../src/posapp/components/pos/invoice/ItemsTable.vue");
const ES_CSV = read("../../posawesome/translations/es.csv");

/**
 * The template with its comments removed — what actually renders. The comments
 * are long here on purpose (the empty state is a judgement call and the reason
 * lives beside it), and they name the retired classes, so an assertion about
 * what is GONE has to read past them.
 */
const markup = (() => {
	const match = table.match(/<template>([\s\S]*)<\/template>/);
	if (!match) throw new Error("ItemsTable.vue has no <template> block");
	return match[1].replace(/<!--[\s\S]*?-->/g, "");
})();

/** The component's own `<style scoped>` block — everything this task may style. */
const scopedStyle = (() => {
	const match = table.match(/<style scoped>([\s\S]*?)<\/style>/);
	if (!match) throw new Error("ItemsTable.vue has no <style scoped> block");
	return match[1];
})();

/** Declarations of one rule, comments stripped, as `prop → value`. */
function rule(css: string, selector: string): Record<string, string> {
	const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = stripped.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`));
	if (!match) throw new Error(`no rule for ${selector}`);
	return Object.fromEntries(
		match[1]
			.split(";")
			.map((d) => d.trim())
			.filter(Boolean)
			.map((d) => {
				const colon = d.indexOf(":");
				return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
			}),
	);
}

/** Every selector the scoped block styles, comments stripped. */
function selectors(css: string): string[] {
	return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^}]*\}/g)]
		.flatMap((m) => m[1].split(","))
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Every `__("…")` / `__('…')` literal in the component. */
function translatableStrings(source: string): string[] {
	const out: string[] = [];
	for (const pattern of [/__\(\s*"((?:[^"\\]|\\.)*)"/g, /__\(\s*'((?:[^'\\]|\\.)*)'/g]) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(source)) !== null) {
			if (match[1]?.trim()) out.push(match[1]);
		}
	}
	return out;
}

/**
 * Minimal two-column CSV read, the same shape `registerShellTranslations.spec.ts`
 * uses. `components/pos/invoice` is outside that suite's scanned directories,
 * so these two rows are covered nowhere else.
 */
function translatedSources(): Set<string> {
	const sources = new Set<string>();
	for (const row of ES_CSV.split(/\r?\n/)) {
		if (!row.trim()) continue;
		if (row.startsWith('"')) {
			const end = row.indexOf('",');
			if (end !== -1) sources.add(row.slice(1, end).replace(/""/g, '"'));
		} else {
			const comma = row.indexOf(",");
			if (comma !== -1) sources.add(row.slice(0, comma));
		}
	}
	return sources;
}

/** A populated cart row. The empty state may not cost more than one line of sale. */
const CART_ROW_HEIGHT = 60;

const px = (value: string) => {
	const match = value.match(/^([\d.]+)px$/);
	return match ? Number(match[1]) : Number.NaN;
};

describe("the empty cart costs less than one cart line", () => {
	const note = rule(scopedStyle, ".posa-cart-empty-note");

	it("declares a padding and a type size, and nothing else that sizes it", () => {
		// The retired panel got its ~270 px from `min-height: 140px`, 22 px of
		// vertical padding and a 78 px icon well. None of those may come back
		// under a new name: a fixed height here is height taken from the cart.
		expect(note["min-height"]).toBeUndefined();
		expect(note["height"]).toBeUndefined();
		expect(note["max-height"]).toBeUndefined();
		expect(px(note["padding"]?.split(/\s+/)[0] ?? "")).toBeLessThanOrEqual(16);
	});

	it("fits inside one cart row", () => {
		const [padY] = note["padding"].split(/\s+/).map(px);
		const fontPx = Number(note["font-size"].replace(/rem$/, "")) * 16;
		const lineBox = fontPx * Number(note["line-height"]);
		const total = padY * 2 + lineBox;

		// ~39 px against the illustration's ~270 px. The bar is one cart row
		// because that is the unit the cashier reads the region in: an empty
		// ticket should look like a ticket with nothing on it, not like a
		// different screen.
		expect(total).toBeLessThan(CART_ROW_HEIGHT);
	});

	it("has no illustration left to pay for", () => {
		// The 78 px icon well, its radial gradient and its drop shadow all hung
		// off these class names. Absence in the component is what makes the
		// rules in items-table-styles.css dead rather than merely unused — the
		// markup comment still names them, which is why this reads the rendered
		// template rather than the file.
		expect(markup).not.toContain("posa-cart-empty-state");
		expect(selectors(scopedStyle)).not.toContain(".posa-cart-empty-state");
		expect(markup).not.toContain("emptyStateIcon");
		expect(markup).not.toContain("emptyStateSubtitle");
	});
});

describe("the empty cart names no control that does not exist", () => {
	const strings = translatableStrings(table);

	it("scans something", () => {
		// A regex that quietly matched nothing would pass every assertion below
		// forever. `ItemsTable` carries the cart's dialogs, so this is a floor
		// well under the real count.
		expect(strings.length).toBeGreaterThanOrEqual(4);
	});

	it("does not send the cashier to a selector", () => {
		// THE REGRESSION. The catalogue became a drawer — opened from the rail,
		// from the chord, or from the "Explorar catálogo" button in the scan
		// bar — and the selector column it replaced is gone. Copy pointing at
		// it sends the operator hunting for a panel that will never appear.
		//
		// Scoped to `__()` literals on purpose: `onDragOverFromSelector` and
		// its siblings are drag-drop handler names, not words a cashier reads,
		// and a bare file-wide grep for "selector" would fail on them and be
		// deleted within a week.
		for (const string of strings) {
			expect(string).not.toMatch(/selector/i);
		}
		expect(table).not.toContain("Add items from the selector");
	});

	it("prints no chord, because it resolves none", () => {
		// R8: a chord on a surface must come from the ACTIVE keymap
		// (`chordLabelFor`), never from the artboard or from memory. This file
		// resolves nothing, so any chord in it is a hardcoded guess — and a
		// chip naming a key that does something else is worse than no chip.
		for (const string of strings) {
			expect(string).not.toMatch(/\b(?:alt|ctrl|shift|cmd)\s*\+/i);
			expect(string).not.toMatch(/\bF(?:[1-9]|1[0-2])\b/);
		}
	});

	it("says which of the two empty states it is, and both are translated", () => {
		// "No matching items in cart" is the one that matters: a cart search
		// hiding every line looks exactly like an empty ticket, and a cashier
		// who reads it as one re-rings a sale over the top of six lines.
		expect(table).toContain('__("No items in cart")');
		expect(table).toContain('__("No matching items in cart")');

		const translated = translatedSources();
		expect(translated.has("No items in cart")).toBe(true);
		expect(translated.has("No matching items in cart")).toBe(true);
	});
});

describe("a cart with items is untouched", () => {
	it("renders the note only when nothing is visible", () => {
		expect(table).toMatch(
			/<tr v-if="!visibleItems\.length" class="posa-cart-empty-row">[\s\S]{0,240}posa-cart-empty-note/,
		);
	});

	it("leaves the item loop and both row components alone", () => {
		expect(table).toContain('<template v-for="item in visibleItems" :key="item.posa_row_id">');
		expect(table).toMatch(/<tr v-if="isComboLine\(item\)"[\s\S]{0,200}<td :colspan=/);
		expect(table).toMatch(/<CartItemRow\s*\n?\s*v-else/);
	});

	it("styles nothing but its own line", () => {
		// The empty state may not reach a sale row. One flat class, no
		// descendant combinator, no element selector — so there is no path from
		// this rule to a `<tr>`, a `<td>` or anything a cart line renders.
		expect(selectors(scopedStyle).sort()).toEqual([
			".posa-cart-empty-note",
			".posa-items-table-container",
		]);
	});
});

describe("the single scrollport survives", () => {
	it("adds no layout or scroll property to the cart", () => {
		// 59c5fe1ad: `.dynamic-container` is viewport-locked, every ancestor
		// down to this table is `flex: 1 1 auto; min-height: 0`, and the cart
		// is the ONLY elastic sibling and the ONLY scrollport. This component's
		// scoped block sits INSIDE that scrollport and must stay content —
		// height reclaimed from the illustration goes back to the cart, never
		// into a new box with a size of its own.
		const declarations = scopedStyle.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(declarations).not.toMatch(/(?:^|[;{])\s*flex(?:-\w+)?\s*:/m);
		expect(declarations).not.toMatch(/(?:^|[;{])\s*(?:min-|max-)?height\s*:/m);
		expect(declarations).not.toMatch(/(?:^|[;{])\s*overflow(?:-[xy])?\s*:/m);
	});
});
