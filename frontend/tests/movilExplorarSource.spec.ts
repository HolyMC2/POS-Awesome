/**
 * Properties of the browse screen that only a source scan can prove.
 *
 * Three of the constraints on this surface are NEGATIVE — "there is no such
 * thing here" — and a mounted assertion can only ever show that one render did
 * not do it today:
 *
 *   1. No second keyboard target. `useScannerInput` attaches the barcode wedge
 *      to the DOCUMENT and `preventDefault()`s the keys it maps, and
 *      `ItemsSelector` owns the one input it writes into. A text field added to
 *      this screen would fight both, on the surface a shop scans from all day.
 *   2. No saturated accent as a fill. `singleAccent.spec.ts` enforces this
 *      across `components/pos/shell/**` and does not walk this directory —
 *      the build plan's log records that coverage hole. This is the same rule,
 *      applied where the grid of cards would make a second accent loudest.
 *   3. Every colour through a token, so the screen follows theme.css into dark
 *      mode instead of staying light beside it.
 *
 * Node environment: `node:fs` named imports do not interop under jsdom (build
 * plan §10), which is why this is a separate file from `movilExplorarScreen`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BROWSE = resolve(__dirname, "../src/posapp/components/pos/mobile/browse");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = resolve(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});

const FILES = walk(BROWSE);
const VUE_FILES = FILES.filter((file) => file.endsWith(".vue"));

const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

const styleOf = (file: string) =>
	stripComments(
		[...readFileSync(file, "utf8").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
			.map((match) => match[1] ?? "")
			.join("\n"),
	);

const templateOf = (file: string) =>
	stripComments(
		[...readFileSync(file, "utf8").matchAll(/<template>([\s\S]*?)<\/template>/g)]
			.map((match) => match[1] ?? "")
			.join("\n"),
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

const coarseBlocks = (css: string) => {
	const bodies: string[] = [];
	const opener = /@media\s*\(pointer:\s*coarse\)/g;
	let match: RegExpExecArray | null;
	while ((match = opener.exec(css)) !== null) bodies.push(blockBody(css, match.index));
	return bodies.join("\n");
};

interface Rule {
	selector: string;
	body: string;
}

/** Flat `selector { body }` pairs; at-rules are recursed into, not treated as selectors. */
const rules = (css: string): Rule[] => {
	const found: Rule[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(css)) !== null) {
		const selector = (match[1] ?? "").replace(/\s+/g, " ").trim();
		if (selector.startsWith("@")) continue;
		found.push({ selector, body: (match[2] ?? "").trim() });
	}
	return found;
};

const declarations = (body: string) =>
	body
		.split(";")
		.map((declaration) => declaration.trim())
		.filter(Boolean);

/** Copied verbatim from `singleAccent.spec.ts`, deliberately — one definition of "the accent". */
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

describe("the scan has something to scan", () => {
	it("finds the screen's files", () => {
		// A walk over zero files passes every assertion below vacuously, which
		// is the quiet way this kind of guarantee stops guarding anything.
		expect(VUE_FILES.length).toBeGreaterThanOrEqual(2);
		expect(FILES.filter((file) => file.endsWith(".ts")).length).toBeGreaterThanOrEqual(2);
	});
});

describe("the screen owns no keyboard target", () => {
	it.each(VUE_FILES)("%s renders no field the wedge could fight", (file) => {
		const template = templateOf(file);

		expect(template).not.toMatch(/<input\b/i);
		expect(template).not.toMatch(/<textarea\b/i);
		expect(template).not.toMatch(/<v-text-field\b/i);
		expect(template).not.toMatch(/contenteditable/i);
	});

	it("routes the search row back to the register instead", () => {
		// The positive half of the same rule: there IS a search affordance, and
		// it delegates rather than duplicating.
		const screen = readFileSync(resolve(BROWSE, "MobileBrowseScreen.vue"), "utf8");

		expect(screen).toContain('emit(\'search\')');
	});
});

describe("no card spends the register's one accent", () => {
	it.each(VUE_FILES)("%s never fills an element with the saturated accent", (file) => {
		const offenders: string[] = [];
		for (const rule of rules(styleOf(file))) {
			for (const declaration of declarations(rule.body)) {
				if (!/^background(-color)?\s*:/.test(declaration)) continue;
				if (ACCENT_PATTERNS.some((pattern) => pattern.test(declaration))) {
					offenders.push(`${rule.selector} { ${declaration} }`);
				}
			}
		}

		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("uses the pale wash for the add affordance, which is not the invariant", () => {
		// Stated so a future sweep that widens ACCENT_PATTERNS to the pale
		// derivatives knows this was a decision, not an oversight: `--ac-soft`
		// is what the artboard itself draws here.
		expect(styleOf(resolve(BROWSE, "MobileBrowseCard.vue"))).toContain(
			"var(--reg-accent-soft",
		);
	});
});

describe("every colour goes through a token", () => {
	it.each(VUE_FILES)("%s paints with no bare hex", (file) => {
		const offenders: string[] = [];
		for (const rule of rules(styleOf(file))) {
			for (const declaration of declarations(rule.body)) {
				if (!/#[0-9a-f]{3,8}\b/i.test(declaration)) continue;
				// A hex is fine as a `var()` FALLBACK — it is what renders only
				// when the token layer is missing. A hex on its own cannot
				// follow theme.css into dark mode.
				if (!/var\(\s*--/.test(declaration)) offenders.push(`${rule.selector} { ${declaration} }`);
			}
		}

		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("a coarse pointer gets a 44px target", () => {
	const coarse = coarseBlocks(styleOf(resolve(BROWSE, "MobileBrowseScreen.vue")));

	it("has a coarse block at all", () => {
		expect(coarse.length).toBeGreaterThan(0);
	});

	it("grows the filter chips to the touch floor", () => {
		const chip = rules(coarse).find((rule) => /__chip--filter::after/.test(rule.selector));

		expect(chip, "no coarse rule expands the filter chip's hit area").toBeTruthy();
		expect(chip?.body).toMatch(/height:\s*var\(--reg-touch-min,\s*44px\)/);
	});

	it("grows them vertically only, so a tap cannot land on the wrong filter", () => {
		// Horizontal growth would overlap the neighbouring chip's box and
		// silently change what the cashier is looking at.
		const chip = rules(coarse).find((rule) => /__chip--filter::after/.test(rule.selector));

		expect(chip?.body).toMatch(/left:\s*0/);
		expect(chip?.body).toMatch(/right:\s*0/);
	});

	it("holds the search row at the floor", () => {
		const search = rules(coarse).find((rule) => /__search\b/.test(rule.selector));

		expect(search?.body).toMatch(/min-height:\s*var\(--reg-touch-min,\s*44px\)/);
	});

	it("holds the card at the floor", () => {
		const cardCoarse = coarseBlocks(styleOf(resolve(BROWSE, "MobileBrowseCard.vue")));
		const card = rules(cardCoarse).find((rule) => /\.mbrowse-card\b/.test(rule.selector));

		expect(card?.body).toMatch(/min-height:\s*var\(--reg-touch-min,\s*44px\)/);
	});
});
