import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * §17.7 invariant 2 on the tender strip: exactly one saturated accent per
 * screen, and it belongs to the primary button.
 *
 * A SELECTED chip is state, and state is carried by tint, outline and weight —
 * never by a saturated fill. `Main.dc.html` proves the point by construction:
 * it contains exactly two buttons, one `#fff` and one `var(--ac)`, and paints
 * its lit tender chip with the pale `--ac-soft` wash instead.
 *
 * Source-scanned rather than mounted, for the reason `singleAccent.spec.ts`
 * gives: the guarantee is "no such declaration exists", and only a scan can
 * prove a negative. That suite walks `components/pos/shell/**` and so does not
 * reach this file (`tests/auditAccentCoverage.spec.ts` records that hole); this
 * one closes it for the row it adds.
 *
 * No jsdom — this reads real files (build plan §10).
 */

const SUMMARY = fileURLToPath(
	new URL("../src/posapp/components/pos/invoice/InvoiceSummary.vue", import.meta.url),
);

const source = readFileSync(SUMMARY, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const styles = stripComments(
	[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
);
const template = /<template>([\s\S]*?)<\/template>/.exec(source)?.[1] ?? "";

interface Rule {
	selector: string;
	body: string;
}

/** Flat `selector { body }` pairs; at-rule bodies are unwrapped, not skipped. */
const rules = (css: string): Rule[] => {
	const flat = css.replace(/@media[^{]*\{/g, "").replace(/\s+/g, " ");
	const found: Rule[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		found.push({ selector: match[1].trim(), body: match[2].trim() });
	}
	return found;
};

const tenderRules = rules(styles).filter((rule) => rule.selector.includes("tender-strip"));

const fillDeclarations = (body: string) =>
	body
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => /^background(-color|-image)?\s*:/.test(declaration));

/** The saturated accent in every spelling that can reach a stylesheet. */
const SATURATED_ACCENT = [
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

describe("no chip carries a saturated fill", () => {
	it("has chip rules to scan at all", () => {
		// A scan over zero rules passes vacuously, which is the quiet way a
		// guarantee stops guarding anything.
		expect(tenderRules.length).toBeGreaterThan(0);
	});

	it("paints no tender chip — selected or not — with the brand accent", () => {
		const offenders: string[] = [];
		for (const rule of tenderRules) {
			for (const declaration of fillDeclarations(rule.body)) {
				if (SATURATED_ACCENT.some((pattern) => pattern.test(declaration))) {
					offenders.push(`${rule.selector} { ${declaration} }`);
				}
			}
		}
		expect(
			offenders,
			`the one saturated accent on this screen belongs to PAY:\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("reaches for no Vuetify colour prop on the strip", () => {
		// `tests/auditAccentCoverage.spec.ts` records InvoiceSummary at ZERO
		// saturated `color="…"` props. Vuetify routes `color` to the background
		// for elevated/flat variants, which is exactly how eight secondary
		// buttons became eight fills above the band. Native buttons here.
		const strip = /<div\s+v-if="tenderChips\.length"[\s\S]*?<\/div>/.exec(template)?.[0] ?? "";
		expect(strip).not.toBe("");
		expect(strip).not.toMatch(/color="/);
		expect(strip).toContain("<button");
	});
});

describe("selected is state, and state is still visible", () => {
	const armed = tenderRules.find((rule) => rule.selector.includes("--armed"));

	it("carries the selection on the pale accent pair the canvas uses", () => {
		// Both halves, and both through tokens: `--reg-accent-soft` is
		// #e0f7fa light / #003344 dark and `--reg-on-accent-soft` is #00646f /
		// #7fe9ff, so the register does not need a second palette after sunset.
		expect(armed?.body).toMatch(/background:\s*var\(--reg-accent-soft/);
		expect(armed?.body).toMatch(/color:\s*var\(--reg-on-accent-soft/);
	});

	it("does not rest on colour alone", () => {
		// A2/A1's rule: colour is never the only carrier. Weight and a border
		// say "selected" to a cashier who cannot separate the two teals, and
		// `aria-pressed` says it to a screen reader.
		expect(armed?.body).toMatch(/font-weight:/);
		expect(armed?.body).toMatch(/border-color:/);
		expect(template).toContain("aria-pressed");
	});

	it("keeps the unselected chip neutral", () => {
		const base = tenderRules.find(
			(rule) => rule.selector.includes("tender-strip__chip") && !rule.selector.includes("--armed") && !rule.selector.includes(":"),
		);
		expect(base?.body).toMatch(/background:\s*var\(--pos-surface-variant/);
	});
});

describe("the strip is a row, not a panel", () => {
	it("stays on one line and never becomes a scrollport of its own", () => {
		const strip = tenderRules.find((rule) => rule.selector.trim() === ".tender-strip");
		expect(strip?.body).toMatch(/display:\s*flex/);
		// `59c5fe1ad`: the cart is the ONLY elastic sibling on the desktop
		// register. A height, a flex-grow or an overflow here would nest a
		// second scrollport inside the card that must stay `flex: 0 0 auto`.
		expect(strip?.body).not.toMatch(/overflow/);
		expect(strip?.body).not.toMatch(/(?:^|;)\s*height:/);
		expect(strip?.body).not.toMatch(/flex:\s*1/);
	});

	it("meets the 44px floor wherever the pointer is coarse", () => {
		// A counter terminal is a touch screen at desktop width; 28px is a fine
		// mouse target and far below the floor theme.css enforces everywhere
		// else (tests/touchTargetSweep.spec.ts).
		const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? "";
		expect(coarse).toContain("tender-strip__chip");
		expect(coarse).toMatch(/min-height:\s*44px/);
	});
});
