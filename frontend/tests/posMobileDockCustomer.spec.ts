import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pos.vue is not importable under vitest (its `.js` store specifiers only
// resolve to the `.ts` sources inside the vite build), so the dock contract is
// pinned at source level like tests/posShellDrafts.spec.ts does.
const source = readFileSync(
	resolve("src/posapp/components/pos/shell/Pos.vue"),
	"utf8",
);

const between = (start: string, end: string) => {
	const from = source.indexOf(start);
	const to = source.indexOf(end, from);
	expect(from).toBeGreaterThan(-1);
	expect(to).toBeGreaterThan(from);
	return source.slice(from, to);
};

describe("mobile dock customer chip", () => {
	it("shows the active customer in the dock summary", () => {
		const summary = between(
			'class="mobile-dock__summary"',
			'class="mobile-dock__tabs"',
		);
		expect(summary).toContain('class="mobile-dock__customer"');
		expect(summary).toContain("{{ dockCustomerLabel }}");
	});

	it("jumps to the cart's customer card when tapped", () => {
		expect(source).toMatch(
			/class="mobile-dock__customer"[\s\S]{0,400}@click="jumpToCustomer"/,
		);
		// The shell asks the invoice panel over the bus — it must not reach
		// into the component instance (VERTICAL_PROFILES_PLAN.md C1).
		expect(source).toMatch(
			/const jumpToCustomer = \(\) => \{[\s\S]*?showInvoicePanel\(\)[\s\S]*?emit\("open_customer_details"\)/,
		);
	});

	it("rides in the flexible totals column so it never displaces the discount field", () => {
		const totals = between(
			'class="mobile-dock__totals"',
			'class="mobile-dock__field"',
		);
		expect(totals).toContain('class="mobile-dock__customer"');
		// The field keeps its own slot and its existing <360px hide rule.
		expect(source).toMatch(
			/@media \(max-width: 360px\) \{\s*\.mobile-dock__field \{\s*display: none;/,
		);
	});

	it("falls back through customer name, id, then a neutral label", () => {
		expect(source).toMatch(
			/dockCustomerLabel = computed\([\s\S]*?customer_name \|\| info\.name \|\| selectedCustomer\.value \|\| __\("No customer"\)/,
		);
	});

	it("truncates instead of pushing the dock wider", () => {
		const chipRule = source.slice(
			source.indexOf(".mobile-dock__customer-name {"),
		);
		expect(chipRule.slice(0, chipRule.indexOf("}"))).toContain(
			"text-overflow: ellipsis",
		);
	});
});

describe("mobile dock tab badges", () => {
	it("badges Offers and Coupons from the same store counts the toolbar uses", () => {
		expect(source).toContain(
			"offersCount, couponsCount } = storeToRefs(uiStore)",
		);

		const offersTab = between(
			"@click=\"setSelectorView('offers')\"",
			"mdi-tag-outline",
		);
		expect(offersTab).toContain('v-if="offersCount"');
		expect(offersTab).toContain("mobile-dock__pill");

		const couponsTab = between(
			"@click=\"setSelectorView('coupons')\"",
			"mdi-ticket-percent-outline",
		);
		expect(couponsTab).toContain('v-if="couponsCount"');
		expect(couponsTab).toContain("mobile-dock__pill");
	});

	it("keeps the cart badge untouched", () => {
		expect(source).toMatch(
			/<span v-if="itemsCount" class="mobile-dock__pill">\{\{ itemsCount \}\}<\/span>/,
		);
	});
});

describe("dock height publication", () => {
	it("publishes the measured dock height for teleported overlays", () => {
		expect(source).toMatch(
			/publishDockHeight = \(height\) => \{[\s\S]*?setProperty\("--pos-dock-height", `\$\{height\}px`\)/,
		);
		expect(source).toMatch(
			/bottomDockHeight\.value = 0;\s*publishDockHeight\(0\);/,
		);
	});

	it("resets the published height when the shell unmounts", () => {
		const teardown = between("onBeforeUnmount(() => {", "stopQzPrewarm();");
		expect(teardown).toContain("publishDockHeight(0)");
	});
});
