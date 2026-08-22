/**
 * The band's geometry, read off its own stylesheet (roadmap §17.7).
 *
 * Node environment, no jsdom: this reads real files, and under the jsdom
 * environment `node:fs`/`node:url` named exports do not interop here — the
 * reason tests/cartActionBarLayout.spec.ts is a node spec too. The DOM-count
 * half of the invariant lives in tests/actionBand.spec.ts, which needs jsdom.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BAND_VUE = fileURLToPath(
	new URL("../src/posapp/components/pos/shell/band/ActionBand.vue", import.meta.url),
);

const scopedCss = readFileSync(BAND_VUE, "utf8")
	.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1]
	?.replace(/\/\*[\s\S]*?\*\//g, "") ?? "";

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

const ruleFor = (selector: string, css = scopedCss) => {
	const index = css.indexOf(`\n${selector} {`);
	expect(index, `missing rule for ${selector}`).toBeGreaterThan(-1);
	return blockBody(css, index);
};

describe("band geometry matches the artboards", () => {
	const band = ruleFor(".action-band");
	const number = ruleFor(".action-band__number");
	const primary = ruleFor(".action-band__primary");

	it("declares its geometry through tokens, with the artboard value as fallback", () => {
		// The fallbacks matter: the band must render correctly before the lead
		// wires register-tokens.css into the entry, or an unwired build shows
		// a blank lane where the total belongs.
		expect(band).toMatch(/var\(--reg-band-height,\s*134px\)/);
		expect(number).toMatch(/var\(--reg-band-number-size,\s*60px\)/);
	});

	it("the CARD is 134px and the NUMBER is 60px — not the other way round", () => {
		// Worth pinning explicitly: §17.7's "same 60 px, same lane" reads like
		// a band height, and it is not. Every artboard draws the band card at
		// height:134px with a font-size:60px figure inside it, and the
		// discarded direction C is described as dropping "el total de 60 px a
		// 34 px", which only parses as type.
		expect(band).toMatch(/height:\s*var\(--reg-band-height[,)]/);
		expect(number).toMatch(/font-size:\s*var\(--reg-band-number-size[,)]/);
	});

	it("the band never shrinks — it is the one lane that must not move", () => {
		expect(band).toMatch(/flex:\s*none/);
	});

	it("the figure is tabular, so digits do not reflow as the total changes", () => {
		const source = readFileSync(BAND_VUE, "utf8");
		expect(source).toMatch(/class="action-band__number reg-mono"/);
	});

	it("the number never wraps", () => {
		expect(number).toMatch(/white-space:\s*nowrap/);
	});

	it("the action clears the 44px touch floor even before its own height", () => {
		expect(primary).toMatch(/min-height:\s*var\(--reg-touch-min[,)]/);
		expect(primary).toMatch(/height:\s*var\(--reg-band-action-height[,)]/);
	});

	it("the action is reachable by keyboard with a visible ring", () => {
		expect(scopedCss).toMatch(/\.action-band__primary:focus-visible/);
	});

	it("gives up the fixed height below the 1100px two-column boundary", () => {
		// A 134px band on an 844px phone is a sixth of the screen.
		const phone = scopedCss.slice(scopedCss.indexOf("@media (max-width: 1099px)"));
		expect(phone).toMatch(/height:\s*auto/);
		expect(phone).toMatch(/font-size:\s*34px/);
	});
});
