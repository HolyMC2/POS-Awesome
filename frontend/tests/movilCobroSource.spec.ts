// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The source half of the phone's payment screen — the guarantees a mounted
 * test cannot make.
 *
 * Two of them are negatives ("no accent fill outside the primary action", "no
 * second denomination table"), and only a scan can prove a negative; the third
 * is touch-target size, which jsdom has no layout engine to measure. Node
 * environment on purpose: `node:fs` named imports do not interop under jsdom
 * (build plan §10).
 */

const PAY = resolve(__dirname, "../src/posapp/components/pos/mobile/pay");
const read = (file: string) => readFileSync(resolve(PAY, file), "utf8");

const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

/** Every `<style>` block of an SFC, comments removed. */
const stylesOf = (file: string) =>
	stripComments(
		[...read(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n"),
	);

/**
 * Flat `selector { body }` pairs. An at-rule wrapper is skipped rather than
 * kept — the body pattern refuses a nested brace, so the scan walks past
 * `@media (…) {` and finds the rule inside it on its own. That is what the
 * touch-target scan wants (every branch of the value, wherever it is
 * declared); `coarseBlock` below is how a rule is checked IN a given at-rule.
 */
const rules = (css: string) =>
	[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
		selector: match[1].trim(),
		body: match[2],
	}));

/** Body of the brace-matched block opened at `start`, header included. */
const blockFrom = (css: string, start: number) => {
	let depth = 0;
	for (let index = css.indexOf("{", start); index < css.length; index += 1) {
		if (css[index] === "{") depth += 1;
		if (css[index] === "}") {
			depth -= 1;
			if (depth === 0) return css.slice(start, index + 1);
		}
	}
	throw new Error(`unterminated block at offset ${start}`);
};

const coarseBlock = (file: string) => {
	const css = stylesOf(file);
	const start = css.indexOf("@media (pointer: coarse)");
	expect(start, `${file} has no pointer:coarse block`).toBeGreaterThan(-1);
	return blockFrom(css, start);
};

const declarations = (body: string, property: RegExp) =>
	body
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => property.test(declaration));

/** Every px number in a declaration, so `max(52px, var(--x, 44px))` yields both. */
const pxValues = (declaration: string) =>
	[...declaration.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));

describe("every target on the most-tapped surface in the product", () => {
	// A keypad is fourteen targets and this screen runs on phones only, so the
	// §5 minimum is not a nicety here — it is the difference between a sale and
	// a mis-key with a customer watching.
	const interactive = /\.pay-keypad__key|\.movil-cobro__tender|\.movil-cobro__primary/;

	const sized = ["PayKeypad.vue", "MovilCobroView.vue"].flatMap((file) =>
		rules(stylesOf(file))
			.filter((rule) => interactive.test(rule.selector))
			.flatMap((rule) =>
				declarations(rule.body, /^min-height\s*:/).map((declaration) => ({
					where: `${file} → ${rule.selector}`,
					declaration,
				})),
			),
	);

	it("has sized rules to check at all", () => {
		// A scan over zero rules passes vacuously, which is the quiet way this
		// kind of guarantee stops guarding anything.
		expect(sized.length).toBeGreaterThanOrEqual(3);
	});

	it("clears 44px on every interactive rule, in every branch of the value", () => {
		for (const { where, declaration } of sized) {
			const values = pxValues(declaration);
			expect(values.length, `${where}: no px value to check in "${declaration}"`).toBeGreaterThan(0);
			for (const value of values) {
				expect(value, `${where}: ${declaration}`).toBeGreaterThanOrEqual(44);
			}
		}
	});

	it("grows the keys on a coarse pointer rather than tightening the gaps", () => {
		const coarse = rules(coarseBlock("PayKeypad.vue")).find((rule) =>
			rule.selector.includes(".pay-keypad__key"),
		);
		expect(coarse, "the coarse block does not resize the keys").toBeDefined();
		expect(pxValues(declarations(coarse!.body, /^min-height\s*:/)[0] ?? "")).toEqual([52]);
	});
});

describe("one saturated accent, on COBRAR Y CERRAR", () => {
	/** The accent in every spelling that reaches a stylesheet (§17.7). */
	const ACCENT = [/var\(\s*--reg-accent\s*[,)]/, /var\(\s*--pos-primary\s*[,)]/, /#0097a7/i, /#00838f/i];

	const fills = (file: string) =>
		rules(stylesOf(file)).flatMap((rule) =>
			declarations(rule.body, /^background(-color)?\s*:/).map((declaration) => ({
				selector: rule.selector,
				declaration,
			})),
		);

	it("fills nothing but the primary action with the brand accent", () => {
		const offenders = ["PayKeypad.vue", "ChangeToHand.vue", "MovilCobroView.vue"].flatMap((file) =>
			fills(file)
				.filter(({ declaration }) => ACCENT.some((pattern) => pattern.test(declaration)))
				.filter(({ selector }) => !/__primary\b/.test(selector))
				.map(({ selector, declaration }) => `${file} → ${selector} { ${declaration} }`),
		);

		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("spends it exactly once, and on the button that takes the money", () => {
		const accented = fills("MovilCobroView.vue").filter(({ declaration }) =>
			ACCENT.some((pattern) => pattern.test(declaration)),
		);
		expect(accented).toHaveLength(1);
		expect(accented[0].selector).toBe(".movil-cobro__primary");
	});

	it("drops the accent when disabled rather than fading it", () => {
		const disabled = rules(stylesOf("MovilCobroView.vue")).find(
			(rule) => rule.selector === ".movil-cobro__primary:disabled",
		);
		expect(disabled).toBeDefined();
		for (const declaration of declarations(disabled!.body, /^background(-color)?\s*:/)) {
			expect(ACCENT.some((pattern) => pattern.test(declaration))).toBe(false);
		}
	});

	it("keeps green and amber off the primary action — state is not emphasis", () => {
		const STATE = [/--reg-tone-positive/, /--reg-tone-warning/, /#157a48/i, /#8a5a0d/i];
		for (const { selector, declaration } of fills("MovilCobroView.vue")) {
			if (!/__primary\b/.test(selector)) continue;
			expect(STATE.some((pattern) => pattern.test(declaration)), declaration).toBe(false);
		}
	});
});

describe("the drawer's denominations are read, not restated", () => {
	const changeSource = read("changeBreakdown.ts");

	it("imports the corte's table", () => {
		expect(changeSource).toContain('from "../../closing/denominations"');
		expect(changeSource).toContain("denominationsFor");
	});

	it("declares no face values of its own", () => {
		// A second table is the failure mode: the day somebody adds the $200
		// note to one list, the corte and the change drawer disagree about what
		// this shop holds.
		const code = stripComments(changeSource);
		expect(code).not.toMatch(/\[\s*\d[\d_]*\s*,\s*\d/);
		expect(code).not.toContain("minorPerMajor:");
	});

	it("keeps the major↔minor boundary in one module", () => {
		// `payTotals` converts through `majorToMinor` / `minorToMajor` rather
		// than dividing by a hundred wherever it happens to need major units.
		const totals = stripComments(read("payTotals.ts")).replace(/\/\/.*$/gm, "");
		expect(totals).toContain("majorToMinor");
		expect(totals).toContain("minorToMajor");
		expect(totals).not.toMatch(/\/\s*100\b/);
	});
});

describe("the screen stays off the money path and off the layout path", () => {
	const components = ["PayKeypad.vue", "ChangeToHand.vue", "MovilCobroView.vue"];

	it("never forces layout, because §6 budgets payment-open at 150 ms p95", () => {
		for (const file of components) {
			const source = stripComments(read(file)).replace(/\/\/.*$/gm, "");
			for (const forbidden of [
				"getBoundingClientRect",
				"offsetWidth",
				"offsetHeight",
				"clientWidth",
				"clientHeight",
				"getComputedStyle",
			]) {
				expect(source, `${file} must not force layout via ${forbidden}`).not.toContain(forbidden);
			}
		}
	});

	it("imports nothing from the payment path it is not allowed to change", () => {
		// The bound this task was given: the screen renders the register's own
		// arithmetic and emits intents. Reaching into `Payments.vue`, the
		// stores or the submission utilities would be how a view quietly
		// becomes a second money path.
		for (const file of [...components, "changeBreakdown.ts", "payTotals.ts", "keypadEntry.ts"]) {
			const source = read(file);
			expect(source, file).not.toMatch(/from\s+"[^"]*Payments\.vue"/);
			expect(source, file).not.toMatch(/from\s+"[^"]*paymentInitialization"/);
			expect(source, file).not.toMatch(/from\s+"[^"]*stores\//);
		}
	});

	it("renders the pad from the shared layout rather than a second copy", () => {
		expect(read("PayKeypad.vue")).toContain("KEYPAD_LAYOUT");
	});
});
