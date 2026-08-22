// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The source half of the phone's sale screen — the guarantees that are about
 * the whole tree rather than about one render, and which therefore only a scan
 * can prove: no literal colour (so dark mode follows), the accent on the
 * primary and nowhere else, a 44 px floor under a thumb, and Spanish for every
 * string.
 *
 * Node environment on purpose: `node:fs` named imports do not interop under
 * jsdom (build plan §10), and that trap has already cost this repo time twice.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE SHARED SCANS DO NOT REACH HERE.
 * `singleAccent.spec.ts` walks `components/pos/shell/**`;
 * `registerShellTranslations.spec.ts` lists directories by hand and its own
 * comment records that the list has gone stale five times, once per surface
 * that moved. `components/pos/mobile/**` is new and is in neither. Widening
 * both is in this task's report; until then the guarantee lives here rather
 * than nowhere.
 */

const SRC = resolve(__dirname, "../src/posapp");
const SALE = resolve(SRC, "components/pos/mobile/sale");
const ES_CSV = resolve(__dirname, "../../posawesome/translations/es.csv");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = resolve(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});

const files = walk(SALE).filter((file) => /\.(vue|ts)$/.test(file));
const vueFiles = files.filter((file) => file.endsWith(".vue"));

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const scopedStyles = (file: string) =>
	stripComments(/<style scoped>([\s\S]*?)<\/style>/.exec(readFileSync(file, "utf8"))?.[1] ?? "");

const template = (file: string) =>
	/<template>([\s\S]*?)<\/template>/.exec(readFileSync(file, "utf8"))?.[1] ?? "";

/**
 * The file with every comment removed.
 *
 * Load-bearing, and found the hard way: the assertions below are about what the
 * code DOES, and both of them first failed against this file's own prose — the
 * header explains why it must not touch `useScannerInput`, and the totals card
 * explains why it must not recompute `subtotal + tax`. A scan that reads the
 * warning as the offence punishes writing the warning down.
 */
const codeOf = (file: string) =>
	readFileSync(file, "utf8")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

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

/** Every `@media (<query>)` body in a stylesheet, concatenated. */
const mediaBodies = (css: string, query: RegExp) => {
	const bodies: string[] = [];
	const opener = new RegExp(query.source, "g");
	let match: RegExpExecArray | null;
	while ((match = opener.exec(css)) !== null) bodies.push(blockBody(css, match.index));
	return bodies.join("\n");
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

describe("the phone's sale screen has surfaces to scan", () => {
	it("finds the files it claims to", () => {
		// A scan over zero files passes everything below vacuously — the quiet
		// way this kind of guarantee stops guarding anything.
		expect(vueFiles.length).toBeGreaterThanOrEqual(4);
		expect(files.some((f) => f.endsWith("mobileSaleLines.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("mobileSaleAction.ts"))).toBe(true);
	});
});

describe("nothing here paints with a literal colour", () => {
	it("routes every colour through a token, with the artboard value as the fallback", () => {
		// The register's primary navigation once rendered as a light column
		// beside a #121212 shell (wave 3, A1) for exactly this reason, and the
		// phone is the surface most likely to be read after dark. A hex is
		// allowed only as the second argument of `var()`, which is what makes
		// the component correct before register-tokens.css is wired in AND
		// correct in dark mode once it is.
		const offenders: string[] = [];
		for (const file of vueFiles) {
			const bare = scopedStyles(file)
				// Drop the whole `var(--token, fallback)` form, fallback included.
				.replace(/var\(\s*--[\w-]+\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, "");
			for (const hex of bare.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
				offenders.push(`${file.replace(SRC, "…")} → ${hex}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("the accent appears on the primary action and nowhere else", () => {
	/** Every spelling the saturated brand accent can reach a stylesheet in. */
	const ACCENT = [
		/var\(\s*--reg-accent\s*[,)]/,
		/var\(\s*--reg-accent-pressed\s*[,)]/,
		/var\(\s*--pos-primary\s*[,)]/,
		/var\(\s*--pos-primary-variant\s*[,)]/,
		/#0097a7/i,
		/#00838f/i,
		/#00d4ff/i,
		/#ff6b35/i,
	];
	const STATE = [/#f0dcae/i, /#8a5a0d/i, /#fdf9f0/i, /#cdead8/i, /#1b5e20/i, /#f4fbf7/i];

	const fills = (body: string) =>
		body
			.split(";")
			.map((d) => d.trim())
			.filter((d) => /^background(-color)?\s*:/.test(d));

	const allRules = vueFiles.flatMap((file) =>
		parseRules(scopedStyles(file)).map((rule) => ({ ...rule, file })),
	);

	it("has accented rules at all — the screen does have a primary", () => {
		const accented = allRules.filter((rule) =>
			fills(rule.body).some((d) => ACCENT.some((p) => p.test(d))),
		);
		expect(accented.length).toBeGreaterThan(0);
		for (const rule of accented) {
			expect(rule.selector, `accent fill outside the primary: ${rule.selector}`).toMatch(
				/^\.movil-totals__primary\b/,
			);
		}
	});

	it("never fills a non-primary element with the accent", () => {
		const offenders = allRules
			.filter((rule) => !/__primary\b/.test(rule.selector))
			.filter((rule) => fills(rule.body).some((d) => ACCENT.some((p) => p.test(d))))
			.map((rule) => `${rule.file.replace(SRC, "…")} → ${rule.selector}`);
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("never lets a state colour become the button's fill", () => {
		// The inverse leak: tinting the button amber for low stock would move
		// the accent with the state. Amber and green are STATE here — the combo
		// edge, the low-stock subtitle, the wallet accrual — and all three are
		// borders or captions, never fills on an action.
		const offenders = allRules
			.filter((rule) => /__primary\b/.test(rule.selector))
			.filter((rule) => fills(rule.body).some((d) => STATE.some((p) => p.test(d))))
			.map((rule) => `${rule.file.replace(SRC, "…")} → ${rule.selector}`);
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("drops the accent when the primary is disabled rather than fading it", () => {
		// A 60%-opacity teal still reads as the one thing to press.
		const totals = scopedStyles(resolve(SALE, "MobileSaleTotals.vue"));
		const disabled = parseRules(totals).find(
			(rule) => rule.selector === ".movil-totals__primary:disabled",
		);
		expect(disabled).toBeDefined();
		for (const fill of fills((disabled as Rule).body)) {
			expect(ACCENT.some((p) => p.test(fill))).toBe(false);
		}
	});
});

describe("a thumb can hit everything on this screen", () => {
	/**
	 * Every control the screen draws, pinned as a set. A seventh button added
	 * later fails HERE rather than shipping with a 30 px target — the sweep
	 * that has to be re-run by hand is the sweep nobody re-runs.
	 */
	const buttonClasses = vueFiles.flatMap((file) =>
		[...template(file).matchAll(/<button[\s\S]*?>/g)].flatMap((tag) =>
			[...tag[0].matchAll(/\sclass="([^"]+)"/g)].map((cls) => cls[1].split(/\s+/)[0]),
		),
	);

	it("draws exactly the two controls this screen owns", () => {
		expect([...new Set(buttonClasses)].sort()).toEqual([
			"movil-line",
			"movil-totals__primary",
		]);
	});

	it("gives the primary its floor without needing a pointer query", () => {
		// 54px is the artboard's own height and already past 44, so this control
		// is the same size for a mouse and a thumb.
		const totals = scopedStyles(resolve(SALE, "MobileSaleTotals.vue"));
		expect(pxOf(declaration(totals, ".movil-totals__primary", "min-height"))).toBeGreaterThanOrEqual(
			44,
		);
	});

	it("lifts a cart row to 44px on a coarse pointer AND on a narrow window", () => {
		// Two queries, not one. A narrow window on a laptop gets this layout
		// too, and a tablet with a stylus reports `pointer: fine` while its
		// owner still taps with a thumb.
		const line = scopedStyles(resolve(SALE, "MobileCartLine.vue"));
		for (const query of [/@media\s*\(pointer:\s*coarse\)/, /@media\s*\(max-width:\s*480px\)/]) {
			const body = mediaBodies(line, query);
			expect(body, `no ${String(query)} block`).not.toBe("");
			expect(pxOf(declaration(body, ".movil-line", "min-height"))).toBeGreaterThanOrEqual(44);
		}
	});

	it("gives the teleported scan field a floor too, on its contents", () => {
		// The field is somebody else's component arriving through a teleport;
		// a floor on the wrapper alone would leave a 36px input inside a 44px
		// box, with only the box tappable.
		const header = scopedStyles(resolve(SALE, "MobileSaleHeader.vue"));
		for (const query of [/@media\s*\(pointer:\s*coarse\)/, /@media\s*\(max-width:\s*480px\)/]) {
			const body = mediaBodies(header, query);
			expect(pxOf(declaration(body, ":deep(input)", "min-height"))).toBeGreaterThanOrEqual(44);
		}
	});
});

describe("the screen builds no second scanner", () => {
	it("declares no input of its own, and never touches the wedge", () => {
		// `useScannerInput` attaches to the DOCUMENT behind a
		// `document._scannerAttached` singleton. A second scan field on the sale
		// screen counts every barcode twice, or — depending on mount order —
		// kills the shop's gun outright.
		for (const file of files) {
			expect(template(file), `${file} declares an <input>`).not.toMatch(/<input\b/);
			expect(codeOf(file), `${file} reaches for the scanner`).not.toContain("useScannerInput");
		}
	});
});

describe("every string this screen authors has Spanish", () => {
	/** Minimal two-column CSV read, matching `registerShellTranslations.spec.ts`. */
	const translated = (() => {
		const sources = new Set<string>();
		for (const row of readFileSync(ES_CSV, "utf8").split(/\r?\n/)) {
			if (!row.trim()) continue;
			if (row.startsWith('"')) {
				const end = row.indexOf('",');
				if (end === -1) continue;
				sources.add(row.slice(1, end).replace(/""/g, '"'));
			} else {
				const comma = row.indexOf(",");
				if (comma === -1) continue;
				sources.add(row.slice(0, comma));
			}
		}
		return sources;
	})();

	/**
	 * `__("…")` plus the compact-label table's values, which are translation
	 * keys that never appear inside a `__(` call — the same indirection that
	 * left `shortcuts/actions.ts`'s entire cheat sheet untranslated.
	 */
	const extract = (text: string) => {
		const out: string[] = [];
		for (const pattern of [
			/__\(\s*"((?:[^"\\]|\\.)*)"/g,
			/__\(\s*'((?:[^'\\]|\\.)*)'/g,
			/"[\w.]+"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
		]) {
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(text)) !== null) {
				if (match[1] && match[1].trim()) out.push(match[1]);
			}
		}
		return out;
	};

	it("finds strings to check", () => {
		const all = files.flatMap((file) => extract(readFileSync(file, "utf8")));
		expect(all.length).toBeGreaterThanOrEqual(8);
		expect(all).toContain("Charge");
	});

	it("has a Spanish row for every one of them", () => {
		const missing = new Map<string, string[]>();
		for (const file of files) {
			for (const value of extract(readFileSync(file, "utf8"))) {
				if (translated.has(value)) continue;
				const short = file.slice(file.indexOf("posapp/") + 7);
				missing.set(value, [...(missing.get(value) ?? []), short]);
			}
		}
		const report = [...missing.entries()]
			.map(([value, where]) => `  "${value}"  ← ${[...new Set(where)].join(", ")}`)
			.join("\n");
		expect(missing.size, `untranslated strings:\n${report}`).toBe(0);
	});
});

describe("the sale screen reuses rather than re-derives", () => {
	it("takes its line model from the payment screen's, and its stock rule from the cart's", () => {
		// Two answers to "what is a combo" or "which amount is authoritative"
		// is worse than one answer in the wrong place.
		const lines = readFileSync(resolve(SALE, "mobileSaleLines.ts"), "utf8");
		expect(lines).toContain('from "../../payments/saleSummary"');
		expect(lines).toContain('from "../../invoice/cartLineStock"');
	});

	it("takes its number and its action from bandState, and computes neither", () => {
		const totals = codeOf(resolve(SALE, "MobileSaleTotals.vue"));
		expect(totals).toContain("composables/pos/shell/bandState");
		// A card that re-added subtotal and tax would be a second opinion on
		// what the customer pays.
		expect(totals).not.toMatch(/subtotal\s*\+\s*tax/);
	});

	it("takes the app bar from the shipped status line, in its compact mode", () => {
		const header = readFileSync(resolve(SALE, "MobileSaleHeader.vue"), "utf8");
		expect(header).toContain("resolveRegisterStatusLine");
		expect(header).toMatch(/compact:\s*true/);
	});

	it("takes the phone's height budget from the catalogue's, not a second guess", () => {
		const screen = readFileSync(resolve(SALE, "MobileSaleScreen.vue"), "utf8");
		expect(screen).toContain("useItemsSelectorPanelSizing");
	});
});
