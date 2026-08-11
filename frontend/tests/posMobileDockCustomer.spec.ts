import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The shell's markup and its dock wiring are pinned at source level like
// tests/posShellDrafts.spec.ts does — cheaper than mounting the whole POS for
// a template contract. tests/posShellDockTabs.spec.ts mounts it for real.
const source = readFileSync(
	resolve("src/posapp/components/pos/shell/Pos.vue"),
	"utf8",
);
// The per-tab defs live in viewContracts.ts so the map is bound to DockTabId
// at compile time (Pos.vue's script block is plain JS).
const contracts = readFileSync(
	resolve("src/posapp/vertical/viewContracts.ts"),
	"utf8",
);

const slice = (text: string, start: string, end: string) => {
	const from = text.indexOf(start);
	const to = text.indexOf(end, from);
	expect(from).toBeGreaterThan(-1);
	expect(to).toBeGreaterThan(from);
	return text.slice(from, to);
};

const between = (start: string, end: string) => slice(source, start, end);

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

	it("rides in the totals column beside the collapsed discount toggle", () => {
		const totals = between(
			'class="mobile-dock__totals"',
			'class="mobile-dock__discount-toggle"',
		);
		expect(totals).toContain('class="mobile-dock__customer"');
		// The always-on 190px discount field is gone — the toggle expands
		// a full-width row on demand instead of squeezing the summary.
		expect(source).not.toContain('class="mobile-dock__field"');
		expect(source).toContain('class="mobile-dock__discount-row"');
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

		// …and the shell hands both to the def builder, so the counts the
		// toolbar shows are the counts the dock badges.
		const build = between("buildDockTabDefs({", "});");
		expect(build).toContain("offersCount");
		expect(build).toContain("couponsCount");
		expect(build).toContain("itemsCount");

		// Tabs now render from the profile-driven dock_tabs list; the badge
		// counts come from the per-tab defs.
		const offersDef = slice(contracts, "offers: {", 'isActive: () => ctx.activeView.value === "offers"');
		expect(offersDef).toContain("badge: () => ctx.offersCount.value");
		expect(offersDef).toContain("badgeSm: true");

		const couponsDef = slice(
			contracts,
			"coupons: {",
			'isActive: () => ctx.activeView.value === "coupons"',
		);
		expect(couponsDef).toContain("badge: () => ctx.couponsCount.value");
	});

	it("renders one shared pill element driven by tab.badge()", () => {
		// Single data-driven pill instead of per-tab hardcoded spans.
		expect(source).toContain('v-if="tab.badge && tab.badge()"');
		expect(contracts).toContain("cart: {");
		expect(contracts).toContain("badge: () => ctx.itemsCount.value");
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
