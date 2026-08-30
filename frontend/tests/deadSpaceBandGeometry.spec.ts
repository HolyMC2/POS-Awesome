// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The band lane's arithmetic — does its content actually cover the lane?
 *
 * `deadSpaceBandLane.spec.ts` proves the figures land in the band. This proves
 * they FILL it, which is the thing the owner marked, and it proves the two
 * ways the fix could have cheated did not happen: the 60px figure was not
 * enlarged and PAGAR was not widened (§17.7 invariants,
 * `actionBandLayout.spec.ts`), nor was the spacer capped to drag PAY in from
 * the right edge.
 *
 * Every number below is READ from the stylesheets, not restated here, so a
 * later change to a column width is measured rather than assumed. Node
 * environment: `node:fs` named imports do not interop under jsdom (build plan
 * §10), and jsdom applies no `<style scoped>` anyway.
 */

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const BAND = "../src/posapp/components/pos/shell/band/ActionBand.vue";
const SUMMARY = "../src/posapp/components/pos/invoice/InvoiceSummary.vue";

const scoped = (relative: string) =>
	(/<style scoped>([\s\S]*?)<\/style>/.exec(read(relative))?.[1] ?? "").replace(
		/\/\*[\s\S]*?\*\//g,
		"",
	);

const rule = (css: string, selector: string): string => {
	const flat = css.replace(/\s+/g, " ");
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		if (match[1]?.trim() === selector) return match[2] ?? "";
	}
	throw new Error(`no rule for ${selector}`);
};

/**
 * The px fallback carried by `var(--token, …)`, or a bare `Npx`, resolved at
 * viewport `w`. `min(430px, 30vw)` is resolved rather than skipped because it
 * is the declaration that keeps the 1100px boundary working — reading only its
 * first term would report a lane 130px fuller than the one a 1280px counter
 * actually gets.
 */
const px = (body: string, property: string, w = 1440): number => {
	const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
	expect(found, `${property} is not declared`).toBeTruthy();
	let value = found![1]!.trim();
	const token = /var\([^,]+,\s*([\s\S]+)\)\s*$/.exec(value);
	if (token) value = token[1]!.trim();

	const min = /^min\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)vw\s*\)$/.exec(value);
	if (min) return Math.min(Number(min[1]), (Number(min[2]) / 100) * w);

	const plain = /(-?[\d.]+)px/.exec(value);
	expect(plain, `${property} carries no px value: ${value}`).toBeTruthy();
	return Number(plain![1]);
};

const bandCss = scoped(BAND);
const summaryCss = scoped(SUMMARY);

/** R2, build plan §8: the rail is 96px. */
const RAIL = 96;
/** `.dynamic-padding` in Invoice.vue's column, at the 1440×900 base scale. */
const COLUMN_PAD_X = 16;

const laneWidths = (w: number) => {
	const band = rule(bandCss, ".action-band");
	const gap = px(band, "gap");
	const padX = px(band, "padding");
	const figure = px(rule(bandCss, ".action-band__figure"), "min-width", w);
	const divider = px(rule(bandCss, ".action-band__divider"), "width");
	const breakdown = px(rule(summaryCss, ".action-band .summary-breakdown"), "width");

	const tender = rule(summaryCss, ".action-band .tender-strip");
	const column = Number(
		/var\(--reg-band-tender-col,\s*(\d+)px\)/.exec(tender)?.[1] ??
			expect.fail("the tender lane declares no column width"),
	);
	const tenderGap = px(tender, "gap");

	const primary = rule(bandCss, ".action-band__primary");
	// The button's own label sits on top of this, so the residual computed from
	// it is an UPPER bound — the real lane is fuller than the number below.
	const primaryFloor = px(primary, "padding") * 2 + px(primary, "gap");

	return {
		gap,
		padX,
		border: 2,
		blocks: [figure, divider, breakdown, divider, column * 2 + tenderGap, primaryFloor],
	};
};

/** Fraction of the band's inner width that nothing occupies, at viewport `w`. */
const residualFraction = (w: number): number => {
	const { gap, padX, border, blocks } = laneWidths(w);
	const inner = w - RAIL - COLUMN_PAD_X * 2 - padX * 2 - border;
	const content = blocks.reduce((sum, block) => sum + block, 0) + gap * (blocks.length - 1);
	return (inner - content) / inner;
};

describe("the band reads as a band, not as an empty lane", () => {
	// Before this change the band held the figure and PAY and nothing else, and
	// the same arithmetic gives ~0.68 at 1440 — the "roughly a thousand pixels
	// of nothing" the owner marked. The bar is a ratchet on that number, so a
	// later change that empties a column again is measured, not argued about.
	it.each([1440, 1280])("covers the lane at %ipx", (width) => {
		const residual = residualFraction(width);
		expect(residual, `residual at ${width} was ${(residual * 100).toFixed(1)}%`).toBeLessThanOrEqual(
			0.3,
		);
		expect(residual, "a negative residual means the lane overflows and PAY is pushed off").toBeGreaterThan(
			0,
		);
	});

	it("keeps PAY anchored to the right edge", () => {
		// The rejected alternative: cap the spacer so the figure and the button
		// group up. `Main.dc.html` right-anchors PAGAR behind a `flex: 1` spacer,
		// and capping would have moved the emptiness rather than removed it.
		const spacer = rule(bandCss, ".action-band__spacer");
		expect(spacer.trim()).toMatch(/^flex:\s*1\s*;?$/);
		expect(spacer, "a capped spacer unpins PAY from the right edge").not.toMatch(/max-width/);
	});

	it("did not buy the coverage with a bigger number or a wider button", () => {
		// §17.7's two survivors. `actionBandLayout.spec.ts` sizes them; this
		// states that closing the void was not allowed to spend either.
		expect(rule(bandCss, ".action-band__number")).toMatch(
			/font-size:\s*var\(--reg-band-number-size,\s*60px\)/,
		);
		expect(rule(bandCss, ".action-band"), "the band is still 134px").toMatch(
			/height:\s*var\(--reg-band-height,\s*134px\)/,
		);
		expect(rule(bandCss, ".action-band__primary"), "the button takes no width").not.toMatch(
			/(?:^|;)\s*width\s*:/,
		);
	});
});

describe("an unfilled lane costs nothing", () => {
	it("generates no box, so it contributes neither width nor a gap", () => {
		// `display: contents` is the load-bearing half. A plain empty <div> is
		// still a flex item: two of them would add two of the band's 22px gaps
		// to a register that has nothing to put in either lane.
		expect(rule(bandCss, ".action-band__lane")).toMatch(/display:\s*contents/);
	});

	it("yields to a slot, so ClosingDialog keeps its own breakdown column", () => {
		const markup = read(BAND);
		expect(markup).toMatch(/v-if="\$slots\.breakdown"/);
		expect(markup).toMatch(/v-else class="action-band__lane" data-band-lane="breakdown"/);
		expect(markup).toMatch(/v-if="\$slots\.context"/);
		expect(markup).toMatch(/v-else class="action-band__lane" data-band-lane="context"/);
	});
});

describe("the wiring that gets the figures there", () => {
	// Without this the void comes back silently: `deadSpaceBandLane.spec.ts`
	// mounts the summary with the targets IN HAND, so it stays green while
	// `Invoice.vue` stops passing them. Dropping the two attributes was the
	// mutation that proved the gap.
	it("has Invoice.vue point the summary at both of the band's lanes", () => {
		const invoice = read("../src/posapp/components/pos/Invoice.vue");
		const mount = invoice.slice(invoice.indexOf("<InvoiceSummary"));
		const props = mount.slice(0, mount.indexOf("/>"));

		for (const [prop, lane] of [
			["band-breakdown-target", "breakdown"],
			["band-context-target", "context"],
		]) {
			const selector = new RegExp(`${prop}="\\[data-band-lane='${lane}'\\]"`);
			expect(props, `${prop} must name the lane the band renders`).toMatch(selector);
			// The other end of the same string. An attribute selector rather than
			// an id because `ClosingDialog` mounts a band of its own, and an id
			// would be a uniqueness claim across two surfaces.
			expect(read(BAND)).toContain(`data-band-lane="${lane}"`);
		}
	});
});

describe("the breakdown column stays single-line (live find 08-30)", () => {
	it("declares flex-wrap: nowrap beside its column direction", () => {
		// The base strip wraps. A WRAPPED column container stretches items to
		// the LINE's cross-size — the widest pair's max-content — so the es-MX
		// IVA label made every pair ~289px inside a ~200px column and painted
		// the money over the method chips (measured live at 1144px). The
		// ellipsis machinery on the pairs only engages when stretch means the
		// COLUMN's own width, i.e. when the column is one line.
		const breakdown = rule(summaryCss, ".action-band .summary-breakdown");
		expect(breakdown).toContain("flex-direction: column");
		expect(breakdown).toContain("flex-wrap: nowrap");
	});
});
