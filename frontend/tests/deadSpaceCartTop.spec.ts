// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The band between the customer strip and the cart's first row.
 *
 * Owner, 2026-08-22, on a register with five lines and the catalogue drawer
 * anchored open: *"still a lot of wasted space."* One of the two regions marked
 * was this one — roughly 60–80px of chrome before a cashier could see what they
 * had just scanned, with a half-height strip sitting above the column header
 * that read as a cut-off table row.
 *
 * It was not a sticky-header offset. `.invoice-items-bar` was a row of its own,
 * inside the items card and below the `Sale details` row, built to carry the
 * artboard's count ("6 líneas · 9 piezas"). The count moved to the summary,
 * where `Main.dc.html` actually draws it; the strip stayed for its last tenant,
 * the cart filter, whose `margin-left: auto` put a lone icon in the Actions
 * column of a table-width band directly above the header. It rendered only with
 * `items.length`, which is why every empty-cart screenshot in
 * `docs/design-evidence/` shows a clean header and the owner's did not.
 *
 * This file pins the height rather than describing it: the elements in the
 * chain, and every fixed inset any of them declares. Source-scanned because
 * `Invoice.vue` cannot be imported under vitest — it reaches its stores through
 * `.js` specifiers that only resolve in the vite pipeline (build plan §10) —
 * which is how `salePanelDensity.spec.ts` and `invoiceCompactSaleDetails.spec.ts`
 * already pin this panel.
 */

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const INVOICE = "../src/posapp/components/pos/Invoice.vue";
const TABLE_CSS = "../src/posapp/components/pos/invoice/items-table-styles.css";

const source = () => read(INVOICE);
const template = () => {
	const body = source();
	return body.slice(0, body.indexOf("</template>"));
};
const styles = () => source().slice(source().lastIndexOf("<style"));

const stripComments = (value: string) =>
	value.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet with every `@media { … }` block removed, braces balanced. */
const withoutMediaBlocks = (css: string): string => {
	let out = "";
	let index = 0;
	while (index < css.length) {
		const at = css.indexOf("@media", index);
		if (at === -1) return out + css.slice(index);
		out += css.slice(index, at);
		let depth = 0;
		let cursor = css.indexOf("{", at);
		for (; cursor < css.length; cursor += 1) {
			if (css[cursor] === "{") depth += 1;
			else if (css[cursor] === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		index = cursor + 1;
	}
	return out;
};

/**
 * Body of the top-level rule whose selector is exactly `selector`.
 *
 * Media blocks are excised first, and that is not tidiness: several of these
 * selectors are RESTATED inside `@media (max-width: 768px)` above their own
 * base rule, so a naive first-match reads the phone's numbers and reports the
 * desktop chain as 280px of chrome that is not there.
 */
const rule = (css: string, selector: string): string => {
	const flat = withoutMediaBlocks(stripComments(css)).replace(/\s+/g, " ");
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		if (match[1]?.trim() === selector) return match[2] ?? "";
	}
	throw new Error(`no rule for ${selector}`);
};

/** Declared value of `property` in a rule body, or 0 when it declares none. */
const px = (body: string, property: string): number => {
	const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
	if (!found) return 0;
	const value = found[1]!.trim();
	if (value === "0" || value === "0px" || value === "none") return 0;
	const number = /^(-?[\d.]+)px$/.exec(value);
	if (!number) throw new Error(`${property} is not a plain px value: ${value}`);
	return Number(number[1]);
};

/**
 * The DESKTOP chain, top to bottom, from the customer strip to the scrollport.
 * `.invoice-sections` is the flex column all three siblings sit in; the rest
 * are those siblings and the scrollport itself.
 */
const CHAIN = [
	".invoice-sections",
	".invoice-config-sections, .invoice-config-sections__body",
	".invoice-items-bar",
	".invoice-items-card",
	".items-table-wrapper",
] as const;

describe("nothing stands between the customer strip and the column header", () => {
	it("renders ONE control strip above the cart, not two", () => {
		const marks = template().match(/class="invoice-items-bar"/g) ?? [];
		expect(
			marks.length,
			"a second strip here is the ~28px half-row the owner marked",
		).toBe(1);
	});

	it("puts that strip beside the disclosure, not inside the items card", () => {
		const body = stripComments(template());
		const strip = body.indexOf('class="invoice-items-bar"');
		const toggle = body.indexOf('class="invoice-details-toggle"');
		const card = body.indexOf('class="invoice-items-card"');

		expect(strip).toBeGreaterThan(-1);
		// The strip must OPEN before the disclosure button it now hosts, and the
		// whole pair must be above the items card — a strip that drifts back
		// inside the card is a row of its own again.
		expect(toggle).toBeGreaterThan(strip);
		expect(card).toBeGreaterThan(toggle);
	});

	it("keeps the cart filter reachable from that one row", () => {
		const body = stripComments(template());
		const strip = body.indexOf('class="invoice-items-bar"');
		const filter = body.indexOf('data-testid="cart-filter-toggle"');
		const card = body.indexOf('class="invoice-items-card"');

		expect(filter, "the filter must not be deleted, only re-homed").toBeGreaterThan(strip);
		expect(filter, "and it must ride in the row that was already on screen").toBeLessThan(card);
	});

	it("leaves the scrollport's only unconditional child the table itself", () => {
		const body = stripComments(template());
		const wrapper = body.indexOf('class="items-table-wrapper"');
		const table = body.indexOf("<ItemsTable", wrapper);
		const between = body.slice(body.indexOf(">", wrapper) + 1, table);

		// The toolbar is the one thing allowed in here and it is gated closed;
		// anything ungated renders above the header and scrolls with the rows,
		// which is a ghost row by construction.
		expect(between).toContain('v-if="itemsToolbarOpen"');
		const ungated = between.replace(/<InvoiceItemsActionToolbar[\s\S]*?\/>/g, "").trim();
		expect(ungated, "no element may sit above the column header").toBe("");
	});

	it("spends no fixed height in the chain except the disclosure's own row", () => {
		// The measurement, stated once. Reintroducing ANY of the insets this
		// change removed — the strip's 24px floor, the scrollport's 2px top —
		// fails here by name rather than by a screenshot six weeks later.
		const css = styles();
		const insets = CHAIN.map((selector) => {
			const body = rule(css, selector);
			return {
				selector,
				total: px(body, "margin-top") + px(body, "padding-top") + px(body, "min-height"),
			};
		});

		const strip = insets.find((entry) => entry.selector === ".invoice-items-bar")!;
		expect(strip.total, "the one row that may claim height is the disclosure's").toBe(30);

		const rest = insets.filter((entry) => entry.selector !== ".invoice-items-bar");
		expect(
			rest.map((entry) => `${entry.selector.split(",")[0]}=${entry.total}`),
			"every other link in the chain contributes zero",
		).toEqual([".invoice-sections=0", ".invoice-config-sections=0", ".invoice-items-card=0", ".items-table-wrapper=0"]);
	});

	it("keeps the column header STATIC — it scrolls away with the lines", () => {
		// It was `position: sticky` and the owner asked for static (08-24): the
		// column names are learned in a day, and a bar floating over the lines
		// while the cart scrolls earns its keep never. Static also removes the
		// offset trap the old assertion policed — there is no `top` to drift.
		const header = rule(read(TABLE_CSS), ".posa-cart-table th");
		expect(header).not.toMatch(/position:\s*sticky/);
	});

	it("tames the cart card's shadow so it stops hazing over its own header", () => {
		// `items-table-styles.css` gives the table `box-shadow: 0 12px 24px`,
		// whose 24px blur paints a soft table-width band above the top border —
		// the other half of what reads as a clipped row up there. The shared
		// sheet is not this panel's to edit, so the correction is scoped.
		const scoped = rule(styles(), ":deep(.items-table-wrapper .posa-cart-table)");
		const blur = /box-shadow:\s*0\s+(\d+)px\s+(\d+)px/.exec(scoped);
		expect(blur, "the cart card must state its own shadow").toBeTruthy();
		expect(Number(blur![1]), "offset").toBeLessThanOrEqual(2);
		expect(Number(blur![2]), "blur").toBeLessThanOrEqual(4);
	});
});

describe("the reclaimed height goes to the cart, and the chain still holds", () => {
	it("leaves the cart the single elastic sibling (59c5fe1ad)", () => {
		const card = rule(styles(), ".invoice-items-card");
		expect(card, "the cart absorbs what the chrome gave back").toContain("flex: 1 1 auto");
		expect(card, "and must still be allowed to shrink").toContain("min-height: 0");
	});

	it("keeps the control strip out of the competition for that height", () => {
		expect(rule(styles(), ".invoice-items-bar")).toContain("flex: 0 0 auto");
	});

	it("keeps the cart the only scrollport in this column", () => {
		// Media blocks excised, not sliced off: `.items-table-wrapper` is
		// declared BELOW the 768px block in this stylesheet, so a slice at the
		// first `@media` drops the very rule under test and passes vacuously.
		// The compact breakpoints hand the scroll back to the document on
		// purpose (59c5fe1ad) and are covered by their own specs.
		const scrollers = withoutMediaBlocks(stripComments(styles())).match(
			/overflow(?:-y)?:\s*(?:auto|scroll)/g,
		) ?? [];
		expect(scrollers, "one scroller, and it is the cart").toEqual(["overflow-y: auto"]);
		expect(rule(styles(), ".items-table-wrapper")).toContain("overflow-y: auto");
	});

	it("does not let the guessed height come back", () => {
		expect(
			stripComments(source()),
			"`var(--container-height)` is the 58-74vh viewport guess 59c5fe1ad removed",
		).not.toContain("var(--container-height)");
	});
});
