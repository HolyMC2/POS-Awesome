import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Invoice.vue cannot be imported under vitest today — it reaches its stores
// through `.js` specifiers that only resolve to the `.ts` sources in the vite
// build pipeline — so the compact-cart contract is pinned at source level,
// the same way tests/posShellDrafts.spec.ts pins the shell's drafts rail.
const source = readFileSync(
	resolve("src/posapp/components/pos/Invoice.vue"),
	"utf8",
);

const styleBlock = source.slice(source.lastIndexOf("<style"));
const compactMediaBlock = (() => {
	const start = styleBlock.indexOf("@media (max-width: 767.98px)");
	expect(start).toBeGreaterThan(-1);
	// Walk to the matching close brace of the media query.
	let depth = 0;
	for (
		let index = styleBlock.indexOf("{", start);
		index < styleBlock.length;
		index += 1
	) {
		if (styleBlock[index] === "{") depth += 1;
		if (styleBlock[index] === "}") {
			depth -= 1;
			if (depth === 0) return styleBlock.slice(start, index + 1);
		}
	}
	throw new Error("unterminated @media (max-width: 767.98px) block");
})();

const ruleFor = (block: string, selector: string) => {
	const start = block.indexOf(`${selector} {`);
	expect(start).toBeGreaterThan(-1);
	return block.slice(start, block.indexOf("}", start));
};

describe("Invoice compact sale details", () => {
	it("wraps both config grids in one disclosure section", () => {
		const wrapper = source.indexOf('class="invoice-config-sections"');
		const body = source.indexOf('class="invoice-config-sections__body"');
		const topGrid = source.indexOf('class="invoice-top-grid"');
		const metaGrid = source.indexOf('class="invoice-meta-grid"');
		const itemsCard = source.indexOf("invoice-items-card");

		expect(wrapper).toBeGreaterThan(-1);
		expect(body).toBeGreaterThan(wrapper);
		expect(topGrid).toBeGreaterThan(body);
		expect(metaGrid).toBeGreaterThan(topGrid);
		expect(itemsCard).toBeGreaterThan(metaGrid);
	});

	it("hoists the items table above the config cards only on phones", () => {
		expect(ruleFor(compactMediaBlock, ".invoice-items-card")).toContain(
			"order: -1",
		);
		// Desktop keeps the source order: the hoist exists nowhere else.
		expect(styleBlock.replace(compactMediaBlock, "")).not.toContain(
			"order: -1",
		);
	});

	it("keeps desktop spacing by re-creating the gap the grids used to inherit", () => {
		const wrapperRule = ruleFor(
			styleBlock,
			".invoice-config-sections__body",
		);
		expect(wrapperRule).toContain("flex-direction: column");
		expect(wrapperRule).toContain("gap: var(--dynamic-sm)");
	});

	// CHANGED 2026-08-22. The toggle used to be phones-only (`v-if
	// ="isCompactInvoice"`) and desktop rendered four config cards permanently
	// expanded — roughly 300px above the cart on the screen whose entire
	// argument is density. The disclosure is now the way in at EVERY width.
	it("renders the toggle at every width and starts collapsed", () => {
		expect(source).toMatch(
			/class="invoice-details-toggle"[\s\S]{0,400}@click="toggleSaleDetails\(\)"/,
		);
		const toggle = source.slice(
			source.indexOf('class="invoice-details-toggle"') - 200,
			source.indexOf('class="invoice-details-toggle"'),
		);
		expect(
			toggle,
			"the toggle must no longer be gated on the compact breakpoint",
		).not.toContain('v-if="isCompactInvoice"');
		expect(source).toContain("saleDetailsOpen: false,");
	});

	// The visibility half changed with the density pass; the MOUNTING half did
	// not, and it is the half that matters. `v-show` keeps the customer
	// autocomplete, the delivery selector and the currency row alive while
	// collapsed, so half-entered state survives a close/open. `v-if` would
	// discard it, and the operator would blame the register.
	it("keeps the config cards mounted while collapsed", () => {
		expect(source).toContain('v-show="saleDetailsOpen"');
		expect(
			source,
			"v-if would unmount the config cards and lose in-progress input",
		).not.toContain('v-if="saleDetailsOpen"');
	});

	it("wires the disclosure for assistive tech", () => {
		expect(source).toContain('aria-controls="invoice-sale-details"');
		expect(source).toContain('id="invoice-sale-details"');
		expect(source).toContain(
			":aria-expanded=\"saleDetailsOpen ? 'true' : 'false'\"",
		);
	});

	it("exposes an entry point that opens the disclosure on the customer card", () => {
		expect(source).toMatch(
			/openCustomerDetails\(\)\s*\{[\s\S]*?this\.toggleSaleDetails\(true\)[\s\S]*?customerCard/,
		);
		expect(source).toContain('ref="customerCard"');
	});

	it("labels the collapsed row with the active customer", () => {
		expect(source).toMatch(
			/saleCustomerLabel\(\)\s*\{[\s\S]*?customer_name[\s\S]*?__\("No customer"\)/,
		);
	});
});
