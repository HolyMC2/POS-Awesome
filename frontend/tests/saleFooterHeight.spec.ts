// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The footer's height budget, and the mechanism that keeps it.
 *
 * This strip was cut from ~200px to ~38px earlier in the programme, after the
 * owner said *"still a lot of wasted space and the giant ass action buttons
 * dont look good."* Reordering to the artboard is exactly the kind of change
 * that spends that back one line at a time: chips, then money, then tender is
 * three stacked rows where the old two-column grid had two.
 *
 * It does not, and the reason is structural rather than a magic number: the
 * tender takes the END of the money row instead of a row of its own, which is
 * also where `Main.dc.html` draws it (the column immediately left of PAGAR, not
 * a band above the totals). The chips then get the full card width and stop
 * wrapping onto the second line they wrapped onto inside a 5/12 column, which
 * is where the reclaimed height actually comes from.
 *
 * Node environment: `node:fs` named imports do not interop under jsdom (build
 * plan §10), and jsdom does not apply `<style scoped>` anyway, so the two
 * properties that decide the height are read from the source.
 */

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const SUMMARY = "../src/posapp/components/pos/invoice/InvoiceSummary.vue";

const scopedStyles = (relative: string) =>
	(/<style scoped>([\s\S]*?)<\/style>/.exec(read(relative))?.[1] ?? "").replace(
		/\/\*[\s\S]*?\*\//g,
		"",
	);

const template = () => /<template>([\s\S]*?)<\/template>/.exec(read(SUMMARY))?.[1] ?? "";

/** Body of the top-level rule whose selector is exactly `selector`. */
const rule = (css: string, selector: string): string => {
	const flat = css.replace(/\s+/g, " ");
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		if (match[1]?.trim() === selector) return match[2] ?? "";
	}
	throw new Error(`no rule for ${selector}`);
};

const styles = scopedStyles(SUMMARY);

describe("the reorder does not spend the height back", () => {
	it("gives the tender the money row's end rather than a line of its own", () => {
		// The strip's markup must be INSIDE `.summary-money-row`. Asserted on the
		// template because it is a nesting fact, and nesting is what decides
		// whether this footer is two lines or three.
		const row = /<div[^>]*class="summary-money-row"[\s\S]*?\n\t\t<\/div>/.exec(template())?.[0];
		expect(row, "the money row is no longer a single template block").toBeTruthy();
		expect(row).toContain('data-testid="tender-strip"');
		expect(row).toContain('data-testid="summary-breakdown"');
	});

	it("lays that row out on one line, wrapping only when it must", () => {
		const row = rule(styles, ".summary-money-row");
		expect(row).toMatch(/display:\s*flex/);
		expect(row).toMatch(/flex-wrap:\s*wrap/);
		// Column would stack the tender under the money and add back the line
		// this arrangement exists to avoid.
		expect(row).not.toMatch(/flex-direction:\s*column/);
	});

	it("keeps the card out of the scroll chain", () => {
		// `59c5fe1ad`: the cart is the ONLY elastic sibling on the desktop
		// register. A grow, a height or an overflow on this card — or on the row
		// this change added — nests a second scrollport inside the one surface
		// that must never scroll out of reach.
		expect(rule(styles, ".sticky-summary-card")).toMatch(/flex:\s*0 0 auto/);

		const row = rule(styles, ".summary-money-row");
		expect(row).not.toMatch(/overflow/);
		expect(row).not.toMatch(/(?:^|;)\s*height:/);
	});

	it("pins no element in the footer to a height", () => {
		// A `height` is how a strip becomes a panel again, and how the card stops
		// being able to shrink when a row wraps. `min-height` is deliberately NOT
		// caught here: it is the 44px coarse-pointer floor on the chips, which
		// sizes a control rather than the footer.
		const fixed = styles.match(/(?:^|;|\{)\s*height\s*:[^;}]+/g) ?? [];
		expect(fixed).toEqual([]);
	});
});

describe("the two-column grid is gone", () => {
	it("stacks the footer instead of splitting it beside the money", () => {
		// The chips used to live in a 5/12 `v-col` beside the totals, which is
		// what forced "Cancel Sale" onto a second line at 1440px. Same reasoning
		// as tests/accentSalePathDensity.spec.ts pins for the strip itself: a
		// returning `v-row`/`v-col` here means the grid is regrowing.
		const body = template();
		expect(body).not.toContain("<v-row");
		expect(body).not.toContain("<v-col");
	});

	it("mounts the action strip once per lane state, never twice at once", () => {
		// It appears twice in source — above the money where the band carries
		// PAGAR, below it where this strip carries PAY — and the two `v-if`s are
		// complements. Both rendering at once would be two counts lines and, on a
		// phone, two PAY buttons.
		const body = template();
		expect(body).toContain('v-if="bandOwnsSaleLane"');
		expect(body).toContain('v-if="!bandOwnsSaleLane"');
		expect((body.match(/<InvoiceActionButtons/g) ?? []).length).toBe(2);
	});
});
