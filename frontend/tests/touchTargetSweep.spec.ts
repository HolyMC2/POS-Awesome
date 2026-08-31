import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getResponsiveVisibleHeaders } from "../src/posapp/composables/pos/items/useItemsTableResponsive";

const sourcePath = (relativePath: string) =>
	fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url));

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const readCss = (relativePath: string) =>
	stripComments(readFileSync(sourcePath(relativePath), "utf8"));

/** Body of the brace-matched block whose `{` follows `from`. */
const blockBody = (css: string, from: number) => {
	const open = css.indexOf("{", from);
	let depth = 0;
	for (let index = open; index < css.length; index += 1) {
		if (css[index] === "{") depth += 1;
		else if (css[index] === "}") {
			depth -= 1;
			if (depth === 0) return css.slice(open + 1, index);
		}
	}
	throw new Error(`unbalanced braces after offset ${from}`);
};

/** Every `@media (pointer: coarse)` body in a stylesheet, concatenated. */
const coarseRules = (css: string) => {
	const bodies: string[] = [];
	const opener = /@media\s*\(pointer:\s*coarse\)/g;
	let match: RegExpExecArray | null;
	while ((match = opener.exec(css)) !== null) {
		bodies.push(blockBody(css, match.index));
	}
	if (bodies.length === 0) throw new Error("no pointer:coarse block found");
	return bodies.join("\n");
};

interface Rule {
	selector: string;
	body: string;
}

const parseRules = (block: string): Rule[] => {
	const flat = block.replace(/\s+/g, " ");
	const rules: Rule[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		rules.push({ selector: match[1].trim(), body: match[2].trim() });
	}
	return rules;
};

/** Raw value of `property` on the first rule whose selector contains `fragment`. */
const declaration = (block: string, fragment: string, property: string) => {
	for (const rule of parseRules(block)) {
		if (!rule.selector.includes(fragment)) continue;
		const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(
			rule.body,
		);
		if (found) return found[1].trim();
	}
	return undefined;
};

/** First pixel length in a value — the floor of `max(96px, 12%)` is 96. */
/** Percentage out of a width declaration — the unit table columns honour. */
const pctOf = (value: string | undefined) => {
	const found = /(\d+(?:\.\d+)?)%/.exec(value ?? "");
	if (!found) throw new Error(`no percentage in ${String(value)}`);
	return Number(found[1]);
};

const pxOf = (value: string | undefined) => {
	const found = /(\d+(?:\.\d+)?)px/.exec(value ?? "");
	if (!found) throw new Error(`no px length in ${String(value)}`);
	return Number(found[1]);
};

const cartCss = readCss("posapp/components/pos/invoice/items-table-styles.css");
const themeCss = readCss("posapp/styles/theme.css");
const customerSource = readFileSync(
	sourcePath("posapp/components/pos/customer/Customer.vue"),
	"utf8",
);
const customerMarkup = /<template>([\s\S]*?)<\/template>\s*<style/.exec(
	customerSource,
)?.[1] as string;
const customerStyles = stripComments(
	/<style scoped>([\s\S]*?)<\/style>/.exec(customerSource)?.[1] ?? "",
);

const purchaseStyles = stripComments(
	/<style scoped>([\s\S]*?)<\/style>/.exec(
		readFileSync(
			sourcePath("posapp/components/pos/purchase/PurchaseItemsTable.vue"),
			"utf8",
		),
	)?.[1] ?? "",
);

const scopedStyles = (relativePath: string) =>
	stripComments(
		/<style scoped>([\s\S]*?)<\/style>/.exec(
			readFileSync(sourcePath(relativePath), "utf8"),
		)?.[1] ?? "",
	);

const rateInfoStyles = scopedStyles("posapp/components/pos/items/ItemRateInfoMenu.vue");
const catalogRowStyles = scopedStyles("posapp/components/pos/items/CatalogItemRow.vue");

const cartTouch = coarseRules(cartCss);
const themeTouch = coarseRules(themeCss);
const customerTouch = coarseRules(customerStyles);
const purchaseTouch = coarseRules(purchaseStyles);
const rateInfoTouch = coarseRules(rateInfoStyles);

describe("cart UOM stepper on touch", () => {
	it("shows the arrows without waiting for a hover that never comes", () => {
		expect(declaration(cartTouch, ".uom-arrow", "opacity")).toBe("1");
	});

	it("leaves the mouse behaviour alone — arrows still reveal on hover", () => {
		expect(cartCss).toMatch(/\.uom-arrow\s*\{[^}]*opacity:\s*0/);
		expect(cartCss).toMatch(
			/\.posa-cart-table__editor-box:hover \.uom-arrow\s*\{[^}]*opacity:\s*1/,
		);
	});

	it("gives the arrows the qty stepper's target, overriding the 20px floor", () => {
		for (const property of ["width", "min-width"]) {
			const value = declaration(cartTouch, ".uom-arrow", property);
			expect(pxOf(value)).toBe(32);
			// The base rule is `20px !important`; without this we lose.
			expect(value).toContain("!important");
		}
		for (const property of ["height", "min-height"]) {
			const value = declaration(cartTouch, ".uom-arrow", property);
			expect(pxOf(value)).toBe(44);
			expect(value).toContain("!important");
		}
	});

	it("widens the UOM column enough to hold two arrows and a unit", () => {
		// This used to assert a px floor out of `width: max(100px, 7%)`. That
		// floor never applied: measured 2026-08-18, a `max()` width on a
		// `table-layout: fixed` column resolves to NEITHER operand — the
		// column falls back to the equal-share pool (802px cart: `6%` -> 48px,
		// `max(44px, 6%)` -> 133.5px). So the test was reading a number the
		// browser threw away, and passed while the cart shipped mis-sized
		// columns. What is actually load-bearing is that touch gets a BIGGER
		// share than the base rule, since the arrows only appear there.
		const touch = pctOf(declaration(cartTouch, 'data-column-key="uom"', "width"));
		const base = pctOf(declaration(cartCss, 'data-column-key="uom"', "width"));

		expect(touch).toBeGreaterThan(base);
		// Two 32px arrows, their gaps and a readable unit need ~100px; on the
		// ~800px cart this share is what pays for them.
		expect(touch).toBeGreaterThanOrEqual(12);
	});

	it("never charges the narrow phone for that width — UOM is dropped there", () => {
		const headers = [
			{ key: "item_name", title: "Name", required: true },
			{ key: "qty", title: "QTY", required: true },
			{ key: "uom", title: "UOM" },
			{ key: "rate", title: "Rate", required: true },
			{ key: "amount", title: "Amount", required: true },
			{ key: "actions", title: "Actions", required: true },
		];
		const keysAt = (width: number) =>
			getResponsiveVisibleHeaders(headers, width).map((header) => header.key);

		expect(keysAt(420)).not.toContain("uom");
		// 900, not 600. The column budget (`useItemsTableResponsive.ts`) now
		// prices UOM at its real 76px and refuses to buy it out of the item
		// name's readable width: at 600px a cart cannot hold two arrows, a unit
		// AND a name, so UOM leaves the row grid there too. 900px is the first
		// width where every column in this set is affordable at once.
		expect(keysAt(900)).toContain("uom");
	});

	it("lets a tap on any editor pill reach the 44px floor", () => {
		expect(
			pxOf(declaration(cartTouch, ".posa-cart-table__editor-display", "min-height")),
		).toBe(44);
	});
});

describe("cart delete and expand buttons on touch", () => {
	it("takes the height floor from theme.css", () => {
		const value = declaration(themeTouch, ".posa-cart-table__delete-btn", "min-height");
		expect(pxOf(value)).toBe(44);
		expect(value).toContain("!important");
		expect(
			declaration(themeTouch, ".posa-cart-table__expand-btn", "min-height"),
		).toBe(value);
	});

	it("keeps them out of the 44px-square list — that width does not fit", () => {
		for (const rule of parseRules(themeTouch)) {
			if (!/min-width/.test(rule.body)) continue;
			expect(rule.selector).not.toContain("posa-cart-table__delete-btn");
			expect(rule.selector).not.toContain("posa-cart-table__expand-btn");
		}
	});

	it("replaces the phone column budget with card mode", () => {
		// At breakpoint-xs the row is a grid card (PHONE CARD MODE block):
		// the actions cell is a grid area sized by its content, so the
		// delete button always fits, and the expand chevron is gone — the
		// whole-row tap opens the same fullscreen sheet. The LAST xs rule
		// for each column must therefore be the card-mode one.
		const lastBody = (columnKey: string) => {
			const pattern = new RegExp(
				`breakpoint-xs[^{}]*data-column-key="${columnKey}"[^{}]*\\{([^{}]*)\\}`,
				"g",
			);
			const bodies = [...cartCss.matchAll(pattern)].map((match) => match[1]);
			expect(bodies.length).toBeGreaterThan(0);
			return bodies[bodies.length - 1] as string;
		};

		expect(lastBody("actions")).toMatch(/grid-area\s*:\s*del/);
		expect(lastBody("data-table-expand")).toMatch(/display\s*:\s*none/);
	});

	it("grows the target area rather than shrinking it", () => {
		const BEFORE_DELETE = 34 * 28;
		const BEFORE_EXPAND = 32 * 32;
		const deleteWidth = pxOf(
			declaration(cartTouch, ".posa-cart-table__delete-btn", "width"),
		);
		const expandWidth = pxOf(
			declaration(cartTouch, ".posa-cart-table__expand-btn", "width"),
		);

		expect(deleteWidth * 44).toBeGreaterThan(BEFORE_DELETE);
		expect(expandWidth * 44).toBeGreaterThan(BEFORE_EXPAND);
	});
});

describe("purchase items table on touch", () => {
	const buttons = [
		[".pos-table__qty-counter .qty-control-btn", ".pos-table__qty-counter"],
		[".pos-table__editor-box .pos-table__editor-btn", ".pos-table__editor-box"],
	] as const;

	it("lifts both steppers to the cart's 32 x 44 target", () => {
		for (const [selector] of buttons) {
			for (const property of ["width", "min-width"]) {
				const value = declaration(purchaseTouch, selector, property);
				expect(pxOf(value)).toBe(32);
				// Base rules are `24px !important`.
				expect(value).toContain("!important");
			}
			for (const property of ["height", "min-height"]) {
				const value = declaration(purchaseTouch, selector, property);
				expect(pxOf(value)).toBe(44);
				expect(value).toContain("!important");
			}
		}
	});

	it("beats theme.css by specificity, not by stylesheet order", () => {
		// Scoped selectors gain [data-v-…], so a bare `.qty-control-btn` ties
		// with theme.css's `.posapp .qty-control-btn` at (0,2,0) and the winner
		// depends on bundle order. Anything fighting that rule must be a
		// descendant selector.
		for (const rule of parseRules(purchaseTouch)) {
			if (!/min-width|min-height/.test(rule.body)) continue;
			for (const selector of rule.selector.split(",")) {
				expect(selector.trim()).toContain(" ");
			}
		}
	});

	it("widens both boxes enough to hold the bigger controls", () => {
		const widest = (container: string, middle: string, property: string) => {
			const pad = pxOf(declaration(purchaseStyles, container, "padding"));
			const gap = pxOf(declaration(purchaseStyles, container, "gap"));
			const button = 32;
			return 2 * pad + 2 * gap + 2 * button + pxOf(declaration(purchaseStyles, middle, property));
		};

		const uomBudget = pxOf(declaration(purchaseTouch, ".pos-table__editor-box", "max-width"));
		const qtyBudget = pxOf(declaration(purchaseTouch, ".pos-table__qty-counter", "max-width"));

		expect(widest(".pos-table__editor-box", ".uom-select", "min-width")).toBeLessThanOrEqual(
			uomBudget,
		);
		expect(
			widest(".pos-table__qty-counter", ".pos-table__qty-display", "max-width"),
		).toBeLessThanOrEqual(qtyBudget);
	});

	it("makes the tap-to-edit displays reach the floor too", () => {
		expect(pxOf(declaration(purchaseTouch, ".pos-table__qty-display", "height"))).toBe(44);
		expect(pxOf(declaration(purchaseTouch, ".pos-table__editor-display", "height"))).toBe(44);
	});

	it("leaves the mouse layout at its original density", () => {
		expect(purchaseStyles).toMatch(/\.qty-control-btn\s*\{[^}]*width:\s*24px/);
		expect(purchaseStyles).toMatch(/\.pos-table__editor-btn\s*\{[^}]*width:\s*24px/);
		expect(purchaseStyles).toMatch(/\.pos-table__qty-counter\s*\{[^}]*max-width:\s*100px/);
	});
});

describe("customer selector on touch", () => {
	// Three 44px glyphs inside the field plus Vuetify's clear-x left the
	// input with no width to be tapped at all, so the x became the fleet's
	// de-facto search button — every cashier had to be told. Nothing
	// interactive may move back inside the field.
	const insideField = customerMarkup.slice(
		customerMarkup.indexOf("<v-autocomplete"),
		customerMarkup.indexOf("#prepend-item"),
	);

	it("empties the field of controls so the field itself is the target", () => {
		expect(customerMarkup).not.toContain("posa-customer-icon");
		expect(insideField).not.toMatch(/@click/);
		// What is left inside is a search cue that takes no click of its own.
		expect(insideField).toContain('prepend-inner-icon="mdi-magnify"');
	});

	it("opens the search from a tap anywhere on the field's box", () => {
		expect(customerMarkup).toMatch(
			/class="customer-field-shell"\s+@click="onCustomerFieldClick"/,
		);
		expect(customerSource).toMatch(
			/const onCustomerFieldClick = \(\) => \{[\s\S]*?focusCustomerSearch\(\)/,
		);
		// …and stays out of the way of the close, or a second tap could
		// never dismiss it.
		expect(customerSource).toMatch(
			/const onCustomerFieldClick = \(\) => \{[\s\S]*?if \(isMenuOpen\.value\) \{\s*return;/,
		);
	});

	it("gives the field and both labelled buttons the 44px floor", () => {
		expect(
			pxOf(declaration(customerTouch, ".v-field", "min-height")),
		).toBeGreaterThanOrEqual(44);
		expect(
			pxOf(declaration(customerTouch, ".customer-action-btn", "min-height")),
		).toBe(44);
	});

	it("keeps the demoted reload a full list row rather than a glyph", () => {
		expect(
			pxOf(declaration(customerStyles, ".customer-menu-action", "min-height")),
		).toBeGreaterThanOrEqual(44);
	});

	it("names both demoted actions at the top of the open list", () => {
		// The list is teleported out of the component, so its rows are pinned
		// here rather than in tests/customerSelectorAffordances.spec.ts. They
		// have to be labelled, and they have to be in `prepend-item` — above
		// the results, where someone who opened the field to search meets
		// them without hunting.
		const prependItem = customerMarkup.slice(
			customerMarkup.indexOf("#prepend-item"),
			customerMarkup.indexOf('#item="{ props, item }"'),
		);

		expect(prependItem).toContain('__("New Customer")');
		expect(prependItem).toContain('__("Reload customers")');
		expect(prependItem).toMatch(/@click="new_customer"/);
		expect(prependItem).toMatch(/@click="reload_customers"/);
		// Offline still greys reload out; it just does it as a disabled row
		// now instead of a 0.3-opacity glyph.
		expect(prependItem).toContain(':disabled="!networkOnline"');
	});

	it("lets the two labelled buttons split the row once it has wrapped", () => {
		// The phone gets the field on its own line; the buttons underneath
		// then take half the width each instead of huddling at the left.
		const phone = /@media\s*\(max-width:\s*599\.98px\)/.exec(customerStyles);
		expect(phone).not.toBeNull();
		const phoneRules = blockBody(customerStyles, (phone as RegExpExecArray).index);
		expect(declaration(phoneRules, ".customer-quick-actions", "width")).toBe("100%");
		expect(declaration(phoneRules, ".customer-action-btn", "flex")).toBe("1 1 0");
	});
});

describe("catalog rate-info trigger on touch", () => {
	it("reaches the 44px target the coarse pointer needs", () => {
		for (const property of ["width", "height", "min-width"]) {
			expect(
				pxOf(declaration(rateInfoTouch, ".item-rate-info-trigger", property)),
			).toBe(44);
		}
	});

	it("pays for that target with negative margin, not with layout space", () => {
		// A bare 44px box grew every catalog list row from 48px to 60px and
		// pushed ItemCard's secondary price out of its fixed slot. Bleeding
		// the extra size outside the layout box keeps the hit area at 44px
		// while contributing exactly what the fine-pointer rule does.
		const margin = declaration(rateInfoTouch, ".item-rate-info-trigger", "margin");
		expect(margin).toMatch(/^-/);

		const box = pxOf(declaration(rateInfoTouch, ".item-rate-info-trigger", "width"));
		const base = pxOf(declaration(rateInfoStyles, ".item-rate-info-trigger", "width"));
		expect(box - 2 * pxOf(margin)).toBe(base);
	});

	it("is measured against the row it actually sits in", () => {
		// The rule above is sized against these two numbers; if the catalog
		// row or its cell padding changes, the margin has to be revisited.
		expect(pxOf(declaration(catalogRowStyles, ".posa-catalog-row", "min-height"))).toBe(48);
		expect(pxOf(declaration(catalogRowStyles, ".posa-catalog-cell", "padding"))).toBe(8);
	});
});
