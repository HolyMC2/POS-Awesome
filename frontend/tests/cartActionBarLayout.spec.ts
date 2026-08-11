import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = (relativePath: string) =>
	fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url));

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const scopedStyles = (relativePath: string) =>
	stripComments(
		/<style scoped>([\s\S]*?)<\/style>/.exec(
			readFileSync(sourcePath(relativePath), "utf8"),
		)?.[1] ?? "",
	);

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

/** The body of every `@media (max-width: <px>)` block in a stylesheet. */
const mediaBands = (css: string) => {
	const bands: { width: number; body: string }[] = [];
	const opener = /@media\s*\(max-width:\s*(\d+)px\)/g;
	let match: RegExpExecArray | null;
	while ((match = opener.exec(css)) !== null) {
		bands.push({ width: Number(match[1]), body: blockBody(css, match.index) });
	}
	return bands;
};

interface Rule {
	selector: string;
	body: string;
}

const parseRules = (block: string): Rule[] => {
	const flat = block.replace(/\s+/g, " ");
	const rules: Rule[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		rules.push({ selector: match[1].trim(), body: match[2].trim() });
	}
	return rules;
};

/** Raw value of `property` on the first rule whose selector contains `fragment`. */
const declaration = (block: string, fragment: string, property: string) => {
	for (const rule of parseRules(block)) {
		if (!rule.selector.includes(fragment)) continue;
		const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule.body);
		if (found) return found[1].trim();
	}
	return undefined;
};

const pxOf = (value: string | undefined) => {
	const found = /(\d+(?:\.\d+)?)px/.exec(value ?? "");
	if (!found) throw new Error(`no px length in ${String(value)}`);
	return Number(found[1]);
};

const actionStyles = scopedStyles("posapp/components/pos/invoice/InvoiceActionButtons.vue");
const invoiceStyles = scopedStyles("posapp/components/pos/Invoice.vue");
const summaryStyles = scopedStyles("posapp/components/pos/invoice/InvoiceSummary.vue");
const shellStyles = scopedStyles("posapp/components/pos/shell/Pos.vue");

describe("PAY keeps a readable label on the phone", () => {
	it("pins a foreground wherever it pins a background", () => {
		// The gradient is only half the button. On phones `secondaryVariant` is
		// `tonal`, and Vuetify routes a non-elevated variant's `color` prop to the
		// TEXT (lib/composables/variant.js: ['elevated','flat'].includes(variant)
		// ? 'background' : 'text'), so color="success" emitted green letters on
		// the green gradient — measured contrast 1.0, the label vanished.
		expect(declaration(actionStyles, ".pay-btn", "background")).toMatch(/linear-gradient/);
		const foreground = declaration(actionStyles, ".pay-btn", "color");
		expect(foreground).toBeDefined();
		expect(foreground).toContain("!important");
	});

	it("paints the label itself, not only the button box", () => {
		// Vuetify puts the text in `.v-btn__content`; a rule on the root alone
		// loses to the generated `.text-success { color: … !important }` that
		// lands on the same element.
		const colourRule = parseRules(actionStyles).find(
			(rule) => rule.selector.includes(".pay-btn") && /(?:^|;)\s*color\s*:/.test(rule.body),
		);
		expect(colourRule?.selector).toContain(".v-btn__content");
		// `:deep()` is required — the content span carries VBtn's scope id, not
		// InvoiceActionButtons'.
		expect(colourRule?.selector).toContain(":deep(");
	});

	it("uses white, the same on-success the desktop variant already renders", () => {
		// plugins/vuetify.ts sets `on-success: #ffffff` in both themes, so the
		// elevated (desktop) PAY has always been white on this gradient. The
		// phone now matches instead of inventing a colour.
		expect(declaration(actionStyles, ".pay-btn", "color")).toMatch(/#fff|#ffffff|white/i);
	});
});

describe("action grid touch targets", () => {
	it("never shrinks PAY below 48px on any phone band", () => {
		for (const band of mediaBands(actionStyles)) {
			const value = declaration(band.body, ".pay-btn", "min-height");
			if (value === undefined) continue;
			expect(pxOf(value), `@media (max-width: ${band.width}px)`).toBeGreaterThanOrEqual(48);
		}
	});

	it("keeps every secondary action on the 44px coarse-pointer floor", () => {
		// Same floor theme.css enforces for the cart controls
		// (tests/touchTargetSweep.spec.ts). The desktop base rule is allowed to
		// be denser — it is a mouse target.
		for (const band of mediaBands(actionStyles)) {
			const value = declaration(band.body, ".summary-btn", "min-height");
			if (value === undefined) continue;
			expect(pxOf(value), `@media (max-width: ${band.width}px)`).toBeGreaterThanOrEqual(44);
		}
	});
});

describe("bottom-dock clearance is reserved exactly once", () => {
	const reservations = (css: string) =>
		parseRules(css).filter((rule) => /var\(--bottom-safe-space/.test(rule.body));

	it("lives on the POS root, the element inside whatever scrolls", () => {
		// Pos.vue's `.dynamic-container` is the one reservation that measurably
		// applies (137px at 630px, 136px at 900px). Both its bands must keep it.
		expect(declaration(shellStyles, ".dynamic-container", "padding-bottom")).toContain(
			"var(--bottom-safe-space)",
		);
		const phoneBand = mediaBands(shellStyles).find((band) => band.width === 768);
		expect(
			declaration(phoneBand?.body ?? "", ".dynamic-container", "padding-bottom"),
		).toContain("var(--bottom-safe-space)");
	});

	it("is not re-declared on elements a Vuetify spacing utility zeroes out", () => {
		// Invoice.vue's shell root is `class="pa-0 invoice-shell"` and the summary
		// card is `class="cards sticky-summary-card mb-0 …"`. Vuetify ships
		// `.pa-0 { padding: 0px !important }` and `.mb-0 { margin-bottom: 0px
		// !important }`, which beat any plain declaration here — both reservations
		// measured 0px in the browser before they were removed. A replacement
		// would have to be `!important`, and would then stack a second ~135px gap
		// under the action grid on top of the root's.
		expect(reservations(invoiceStyles)).toHaveLength(0);
		expect(reservations(summaryStyles)).toHaveLength(0);
	});
});
