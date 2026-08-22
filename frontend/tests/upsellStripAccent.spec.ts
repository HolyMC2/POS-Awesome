/**
 * The up-sell strip spends NO accent (§17.7 invariant 2).
 *
 * `singleAccent.spec.ts` scans `components/pos/shell`, which is where the one
 * saturated colour legitimately lives — on the band's PAY. The strip sits
 * outside that tree and is exactly the kind of surface that erodes the
 * invariant: four tiles competing for the eye, each with an obvious excuse to
 * be "highlighted". A combo's saving is STATE, not emphasis; the add glyph
 * rides the pale `--ac-soft` wash the canvas uses freely and never the
 * saturated fill.
 *
 * Source-scanned rather than mounted, for the reason that spec gives: the
 * guarantee is "no such declaration exists", and only a scan proves a
 * negative. A mounted assertion proves one render did not do it today.
 *
 * No jsdom — this reads real files.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STRIP = resolve(__dirname, "../src/posapp/components/pos/combos/ComboSuggestionStrip.vue");

/**
 * The SATURATED accent in every spelling that reaches a stylesheet. Copied
 * from `singleAccent.spec.ts` rather than imported, because that file exports
 * nothing and reaching into a spec would couple two suites that must be able
 * to fail independently. The pale derivative `#e0f7fa` / `--ac-soft` is
 * deliberately absent: it is a wash, and the canvas uses it on the tender
 * chips and on this strip's add glyph.
 */
const ACCENT_PATTERNS = [
	/var\(\s*--reg-accent\s*[,)]/,
	/var\(\s*--reg-accent-pressed\s*[,)]/,
	/var\(\s*--pos-primary\s*[,)]/,
	/var\(\s*--pos-primary-variant\s*[,)]/,
	/#0097a7/i,
	/#00838f/i,
	/#00d4ff/i,
	/#00a0cc/i,
	/#ff6b35/i,
];

const source = readFileSync(STRIP, "utf8");
const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
	.map((match) => match[1] ?? "")
	.join("\n")
	.replace(/\/\*[\s\S]*?\*\//g, "");

const declarations = (css: string, property: RegExp) =>
	css
		.split(/[;{}]/)
		.map((d) => d.trim())
		.filter((d) => property.test(d));

describe("the up-sell strip carries no saturated accent", () => {
	it("has a stylesheet to scan at all", () => {
		// A scan over an empty string passes vacuously — the quiet way this
		// kind of guarantee stops guarding anything. The style block moving to
		// a sibling `.css` file must fail here, not silently pass.
		expect(styles.length).toBeGreaterThan(200);
		expect(styles).toContain(".upsell__tile");
	});

	it("fills nothing with the brand accent", () => {
		const offenders = declarations(styles, /^background(-color)?\s*:/).filter((d) =>
			ACCENT_PATTERNS.some((pattern) => pattern.test(d)),
		);
		expect(
			offenders,
			`the accent is a fill reserved for the band's primary action:\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("does not borrow the accent for a border or a shadow either", () => {
		// The invariant is about one saturated colour competing for the eye. A
		// 2px accent outline on the leading tile would compete just as hard as
		// a fill, and would read as "this one is the action".
		const offenders = declarations(styles, /^(border|outline|box-shadow)/).filter((d) =>
			ACCENT_PATTERNS.some((pattern) => pattern.test(d)),
		);
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("keeps the saving as a figure colour, never as a tile fill", () => {
		// Green is STATE. Tinting the whole tile with it would move the accent
		// onto whichever combo happens to save the most.
		const savingRule = styles.match(/\.upsell__saving\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(savingRule).toMatch(/color\s*:/);
		expect(savingRule).not.toMatch(/^background/m);
	});
});
