/**
 * Sale-panel density (docs/POS-RIEL-Y-CAJON-BUILD.md; owner feedback 2026-08-22:
 * "still a lot of wasted space").
 *
 * `Main.dc.html` goes scan bar → customer strip → column header row. Ours went
 * scan bar → "Customer Details" card → "Delivery Charges" card → "Invoice
 * Items" card carrying its OWN search field → table, spending roughly 300px
 * before a cart line could appear on the screen whose entire argument is
 * density.
 *
 * These assertions exist because that height creeps back one card at a time,
 * and each addition looks individually reasonable. Source-scanned rather than
 * mounted: `Invoice.vue` cannot be imported under jsdom without dragging the
 * whole POS stack in, which is why the repo already scans it this way
 * (`showInvoicePanelWiring`, `posShellDrafts`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const invoice = () =>
	readFileSync(
		fileURLToPath(new URL("../src/posapp/components/pos/Invoice.vue", import.meta.url)),
		"utf8",
	);

const template = () => {
	const source = invoice();
	return source.slice(0, source.indexOf("</template>"));
};

/**
 * The part of the panel a cashier sees WITHOUT opening anything — from the top
 * of the template to the disclosure body. This is the region density is
 * measured in; what lives inside `Sale details` costs no permanent height and
 * is deliberately out of scope.
 */
const alwaysVisible = () => {
	const t = template();
	return t.slice(0, t.indexOf('id="invoice-sale-details"'));
};

/**
 * Comments explain what was REMOVED and therefore name it. Scanning them finds
 * the very string the comment exists to warn about — the same trap the token
 * file's accent scan had to strip for.
 */
const withoutComments = (source: string) =>
	source
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("the sale panel opens on the cart, not on configuration", () => {
	it("renders the customer as a strip, not a card", () => {
		const t = template();
		expect(t, "CustomerStrip must be rendered").toContain("<CustomerStrip");
		// The heading itself survives INSIDE the disclosure, where it labels a
		// section rather than occupying the panel. What must not survive is it
		// being visible before anyone asks for it.
		expect(
			alwaysVisible(),
			'"Customer Details" must not render above the fold — the strip replaced it',
		).not.toContain('__("Customer Details")');
		expect(t, "but the section must still exist inside Sale details").toContain(
			'__("Customer Details")',
		);
	});

	it("collapses the config disclosure at EVERY width", () => {
		const t = template();
		// The regression this guards: the toggle used to be `v-if
		// ="isCompactInvoice"` and the body `v-show="!isCompactInvoice || …"`,
		// so desktop rendered four config cards permanently expanded.
		expect(t, "the body must open only when asked").toContain('v-show="saleDetailsOpen"');
		expect(
			t,
			"the body must NOT re-acquire an isCompactInvoice escape hatch",
		).not.toContain('v-show="!isCompactInvoice || saleDetailsOpen"');
		expect(t, "the toggle must exist at every width").not.toContain(
			'v-if="isCompactInvoice"\n\t\t\t\t\t\t\ttype="button"',
		);
	});

	it("shows exactly one search input in the sale view", () => {
		const t = template();
		// The cart filter is real and stays reachable, but it may not sit open
		// beside the scan bar: two visible search fields and an operator cannot
		// tell which one a scan lands in. That is a correctness problem wearing
		// a layout problem's clothes.
		const toolbar = t.slice(t.indexOf("<InvoiceItemsActionToolbar"));
		expect(toolbar.slice(0, 200), "the cart filter must be gated").toContain(
			'v-if="itemsToolbarOpen"',
		);
		expect(t, "and reachable from the count strip").toContain('data-testid="cart-filter-toggle"');
	});

	it("drops the card chrome around the cart", () => {
		const t = template();
		expect(t, 'the "Invoice Items" heading must be gone').not.toContain('__("Invoice Items")');
		expect(
			t,
			"the items card must not carry .invoice-section-card chrome",
		).not.toContain("invoice-section-card invoice-items-card");
	});

	it("keeps every relocated capability reachable", () => {
		const t = template();
		// Moved behind the disclosure, NOT deleted. A density pass that removes
		// a capability is a feature deletion wearing a redesign's clothes.
		for (const marker of [
			"<InvoiceCustomerSection",
			"<DeliveryCharges",
			"<PostingDateRow",
			"<MultiCurrencyRow",
			"<InvoiceItemsActionToolbar",
		]) {
			expect(t, `${marker} must still be rendered somewhere`).toContain(marker);
		}
	});
});

describe("the single-scrollport height chain survives (59c5fe1ad)", () => {
	it("leaves the items card the one elastic sibling", () => {
		const source = invoice();
		const block = source.slice(source.indexOf(".invoice-items-card {"));
		const rule = block.slice(0, block.indexOf("}"));
		expect(rule, "must still take the leftover space").toContain("flex: 1 1 auto");
		// The load-bearing half: flex items default to `min-height: auto` and
		// refuse to shrink below content, which is how a "just add overflow"
		// fix nests a second scrollport instead of removing one.
		expect(rule, "must still be allowed to shrink").toContain("min-height: 0");
	});

	it("keeps the chrome above the cart non-elastic", () => {
		const source = invoice();
		for (const selector of [".invoice-config-sections,", ".invoice-items-bar {"]) {
			const block = source.slice(source.indexOf(selector));
			const rule = block.slice(0, block.indexOf("}"));
			expect(rule, `${selector} must not compete with the cart for height`).toContain(
				"flex: 0 0 auto",
			);
		}
	});

	it("does not reintroduce a guessed height", () => {
		const source = invoice();
		// `var(--container-height)` is the 58-74vh viewport guess 59c5fe1ad
		// removed. Its return is the bug's return.
		expect(
			withoutComments(source),
			"no viewport-fraction height may come back",
		).not.toContain("var(--container-height)");
	});
});
