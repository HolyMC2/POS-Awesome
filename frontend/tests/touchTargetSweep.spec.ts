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
const pxOf = (value: string | undefined) => {
	const found = /(\d+(?:\.\d+)?)px/.exec(value ?? "");
	if (!found) throw new Error(`no px length in ${String(value)}`);
	return Number(found[1]);
};

/**
 * Width floor the LAST rule in the sheet declares for a column at phone
 * width — later rule wins between equal-specificity duplicates, which is
 * how the touch overrides are layered onto the breakpoint budget.
 */
const phoneColumnFloor = (css: string, columnKey: string) => {
	const pattern = new RegExp(
		`breakpoint-xs[^{}]*data-column-key="${columnKey}"[^{}]*\\{([^{}]*)\\}`,
		"g",
	);
	const bodies = [...css.matchAll(pattern)].map((match) => match[1]);
	if (bodies.length === 0) throw new Error(`no phone rule for ${columnKey}`);
	const last = bodies[bodies.length - 1] as string;
	return pxOf(/width\s*:\s*([^;]+)/.exec(last)?.[1]);
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

const cartTouch = coarseRules(cartCss);
const themeTouch = coarseRules(themeCss);
const customerTouch = coarseRules(customerStyles);
const purchaseTouch = coarseRules(purchaseStyles);

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
		const column = pxOf(declaration(cartTouch, 'data-column-key="uom"', "width"));
		const gutter = pxOf(
			declaration(cartTouch, 'data-column-key="uom"', "padding-left"),
		);
		const arrow = pxOf(declaration(cartTouch, ".uom-arrow", "width"));
		const gap = pxOf(declaration(cartTouch, ".uom-editor", "gap"));
		const READABLE_UNIT = 20;

		expect(column - 2 * gutter).toBeGreaterThanOrEqual(
			2 * arrow + 2 * gap + READABLE_UNIT,
		);
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
		expect(keysAt(600)).toContain("uom");
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

	it("fits both buttons inside their phone-width columns", () => {
		const gutter = pxOf(
			declaration(cartTouch, 'data-column-key="actions"', "padding-left"),
		);
		const deleteWidth = pxOf(
			declaration(cartTouch, ".posa-cart-table__delete-btn", "width"),
		);
		const expandWidth = pxOf(
			declaration(cartTouch, ".posa-cart-table__expand-btn", "width"),
		);

		expect(deleteWidth + 2 * gutter).toBeLessThanOrEqual(
			phoneColumnFloor(cartCss, "actions"),
		);
		expect(expandWidth + 2 * gutter).toBeLessThanOrEqual(
			phoneColumnFloor(cartCss, "data-table-expand"),
		);
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

describe("customer field icons on touch", () => {
	it("carries the class the touch floor actually targets", () => {
		const tagged = customerMarkup.match(/posa-customer-icon/g) ?? [];
		expect(tagged).toHaveLength(3);
		expect(customerSource).toMatch(
			/class="icon-button posa-customer-icon[^"]*"[\s\S]*?@click\.stop="edit_customer"/,
		);
		expect(customerSource).toMatch(
			/class="icon-button posa-customer-icon[^"]*"[\s\S]*?@click\.stop="reload_customers"/,
		);
		expect(customerSource).toMatch(
			/class="icon-button posa-customer-icon[^"]*"[\s\S]*?@click\.stop="new_customer"/,
		);
	});

	it("is inside the theme's 44px floor and tap-delay list", () => {
		const floor = declaration(themeTouch, ".posa-customer-icon", "min-height");
		expect(pxOf(floor)).toBe(44);
		expect(pxOf(declaration(themeTouch, ".posa-customer-icon", "min-width"))).toBe(44);
		expect(themeCss).toMatch(
			/\.posapp \.posa-customer-icon,[\s\S]{0,120}\{[^}]*touch-action:\s*manipulation/,
		);
	});

	it("spaces reload from its neighbours once the boxes are full size", () => {
		// First occurrence is the mouse-width rule, declared above the
		// coarse block it is overridden in.
		const base = pxOf(declaration(customerStyles, ".customer-icon-gap", "margin-left"));
		const touch = pxOf(declaration(customerTouch, ".customer-icon-gap", "margin-left"));

		expect(touch).toBeGreaterThanOrEqual(8);
		expect(touch).toBeGreaterThan(base);
	});
});
