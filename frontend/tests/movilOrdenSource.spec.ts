/**
 * Guarantees about the service-order screen that only a source scan can make.
 *
 * Three of them are negatives — "no such declaration exists" — and a mounted
 * assertion can only ever prove that one render did not do it today. Same
 * reasoning as `singleAccent.spec.ts` and `priceCheckReadOnly.spec.ts`.
 *
 * WHY THIS FILE EXISTS AT ALL: `singleAccent.spec.ts` walks
 * `components/pos/shell/**`, and this screen lives under
 * `components/pos/mobile/orders/**`. The invariant it enforces is a property
 * of the register, not of a directory, so the same rule is applied here until
 * the lead widens that scan (reported).
 *
 * Node env — `node:fs` named imports do not interop under jsdom (build plan
 * §10).
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(__dirname, "../src/posapp/components/pos/mobile/orders");
const MODULE = resolve(DIR, "serviceOrderLines.ts");

/** Every SFC in the screen's own directory, so a fourth one added next month
 *  inherits these guarantees instead of quietly escaping them. */
const SFCS = readdirSync(DIR)
	.filter((entry) => entry.endsWith(".vue"))
	.map((entry) => ({ name: entry, source: readFileSync(resolve(DIR, entry), "utf8") }));

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const stylesOf = (source: string) =>
	stripComments(
		[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n"),
	);

const templateOf = (source: string) => source.slice(0, source.indexOf("<script"));

const styles = SFCS.map((sfc) => stylesOf(sfc.source)).join("\n");
const template = SFCS.map((sfc) => templateOf(sfc.source)).join("\n");

/** Flat `selector { body }` pairs, at-rules unwrapped — as singleAccent does. */
const rules = (css: string): { selector: string; body: string }[] => {
	const found: { selector: string; body: string }[] = [];
	let depth = 0;
	let start = 0;
	let selectorStart = 0;
	for (let i = 0; i < css.length; i += 1) {
		const char = css[i];
		if (char === "{") {
			if (depth === 0) {
				const selector = css.slice(selectorStart, i).trim();
				if (selector.startsWith("@")) {
					let d = 0;
					for (let j = i; j < css.length; j += 1) {
						if (css[j] === "{") d += 1;
						else if (css[j] === "}") {
							d -= 1;
							if (d === 0) {
								found.push(...rules(css.slice(i + 1, j)));
								i = j;
								selectorStart = j + 1;
								break;
							}
						}
					}
					continue;
				}
				start = i + 1;
			}
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				found.push({
					selector: css.slice(selectorStart, start - 1).trim(),
					body: css.slice(start, i),
				});
				selectorStart = i + 1;
			}
		}
	}
	return found;
};

/** Every block guarded by `@media (pointer: coarse)`, bodies only. */
const coarseBlocks = (css: string): string[] => {
	const out: string[] = [];
	let at = css.indexOf("@media (pointer: coarse)");
	while (at >= 0) {
		const open = css.indexOf("{", at);
		let depth = 0;
		for (let i = open; i < css.length; i += 1) {
			if (css[i] === "{") depth += 1;
			else if (css[i] === "}") {
				depth -= 1;
				if (depth === 0) {
					out.push(css.slice(open + 1, i));
					at = css.indexOf("@media (pointer: coarse)", i);
					break;
				}
			}
		}
		if (depth !== 0) break;
	}
	return out;
};

const coarseBlock = coarseBlocks(styles).join("\n");

const ACCENT_PATTERNS = [
	/var\(\s*--reg-accent\s*[,)]/,
	/var\(\s*--reg-accent-pressed\s*[,)]/,
	/var\(\s*--pos-primary\s*[,)]/,
	/var\(\s*--pos-primary-variant\s*[,)]/,
	/#0097a7/i,
	/#00838f/i,
];

const fillDeclarations = (body: string) =>
	body
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => /^background(-color)?\s*:/.test(declaration));

describe("one accent, on the one primary", () => {
	it("scans every SFC in the screen's directory", () => {
		// A scan over zero files passes vacuously, which is the quiet way this
		// kind of guarantee stops guarding anything.
		expect(SFCS.map((sfc) => sfc.name).sort()).toEqual([
			"MovilOrdenView.vue",
			"ServiceOrderBalance.vue",
			"ServiceOrderLineList.vue",
		]);
	});

	it("has styles to scan at all", () => {
		// A scan over an empty string passes vacuously, which is the quiet way
		// this kind of guarantee stops guarding anything.
		expect(styles.length).toBeGreaterThan(500);
		expect(rules(styles).length).toBeGreaterThan(20);
	});

	it("fills nothing but COBRAR Y ENTREGAR with the brand accent", () => {
		const offenders: string[] = [];
		for (const rule of rules(styles)) {
			for (const declaration of fillDeclarations(rule.body)) {
				if (!ACCENT_PATTERNS.some((pattern) => pattern.test(declaration))) continue;
				if (/__primary\b/.test(rule.selector)) continue;
				offenders.push(`${rule.selector} { ${declaration} }`);
			}
		}

		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("spends the accent at least once — on the primary", () => {
		const primary = rules(styles).find((rule) => rule.selector === ".movil-orden__primary");

		expect(primary).toBeDefined();
		expect(
			fillDeclarations(primary!.body).some((declaration) =>
				ACCENT_PATTERNS.some((pattern) => pattern.test(declaration)),
			),
		).toBe(true);
	});

	it("drops the accent when disabled rather than fading it", () => {
		// A translucent accent is still the loudest thing on the screen, so a
		// disabled primary would keep drawing the eye to the one control that
		// cannot be pressed. Same rule ActionBand.vue follows.
		const disabled = rules(styles).find(
			(rule) => rule.selector === ".movil-orden__primary:disabled",
		);

		expect(disabled).toBeDefined();
		for (const declaration of fillDeclarations(disabled!.body)) {
			expect(ACCENT_PATTERNS.some((pattern) => pattern.test(declaration))).toBe(false);
		}
	});
});

describe("thumb targets under a coarse pointer", () => {
	it("declares a coarse-pointer block at all", () => {
		expect(coarseBlocks(styles).length).toBeGreaterThan(0);
	});

	it("lifts the finder and the primary to the 44 px floor (WCAG 2.5.5)", () => {
		for (const selector of [
			".movil-orden__finder",
			".movil-orden__finder-input",
			".movil-orden__primary",
		]) {
			expect(coarseBlock, `${selector} has no coarse-pointer floor`).toContain(selector);
		}
		for (const rule of rules(coarseBlock)) {
			expect(rule.body, `${rule.selector} sets no min-height`).toMatch(/min-height:/);
			expect(rule.body, `${rule.selector} floors below 44 px`).toMatch(/44px|54px/);
		}
	});
});

describe("the raw device id has nowhere to appear", () => {
	it("is never named in the template", () => {
		// The mask is a type, not a template convention: `ServiceOrderView`
		// has no raw field, and this scan is what stops one being added and
		// then bound to a title attribute six months from now.
		expect(template).not.toMatch(/device_id\b/);
		// The distinct names, not their order or count — the point is that no
		// FOURTH one exists, not how many times the three are bound.
		const named = [...new Set(template.match(/deviceId\w*/g) ?? [])].sort();
		expect(named).toEqual(["deviceIdLabelKey", "deviceIdMasked", "deviceIdTail"]);
	});

	it("is consumed in exactly one module, which returns a mask", () => {
		const module = readFileSync(MODULE, "utf8");

		expect(module).toContain("deviceIdMasked: maskDeviceId(payload.device_id)");
		// `ServiceOrderView` is the component's whole vocabulary; a raw field
		// on it would make every later template discipline optional.
		const view = module.slice(
			module.indexOf("export interface ServiceOrderView"),
			module.indexOf("export const toServiceOrderView"),
		);
		expect(view.length).toBeGreaterThan(100);
		expect(view).not.toMatch(/\bdeviceId\s*:/);
		expect(view).not.toMatch(/device_id/);
	});
});
