/**
 * "One accent" as a build failure, not a review note (roadmap §17.7).
 *
 * The canvas raised the register's density twice and stayed readable for one
 * reason: exactly ONE saturated colour per screen, on the primary button.
 * Amber and green are STATE — a shortfall, a change due — and never emphasis.
 * Lose that and the density becomes noise, which is the failure mode this
 * suite exists to prevent.
 *
 * Source-scanned rather than mounted, for the same reason
 * tests/priceCheckReadOnly.spec.ts is: the guarantee is "no such declaration
 * exists", and only a scan can prove a negative. A mounted assertion proves
 * one render did not do it today.
 *
 * No jsdom — this reads real files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src/posapp");
const SHELL = resolve(SRC, "components/pos/shell");
const TOKENS = resolve(SRC, "styles/register-tokens.css");

/**
 * The SATURATED brand accent, in every spelling it can reach a stylesheet:
 * the token, what the token forwards to, and the raw hexes behind those in
 * both themes. Hard-coding the hexes matters — a component that writes
 * `#0097a7` directly bypasses the token layer, and the §17.4 brand layer
 * with it.
 *
 * The pale derivatives are deliberately NOT here. `--pos-primary-container`
 * / `--reg-accent-soft` (#e0f7fa) is a wash, and the canvas uses it freely —
 * the tender chips on Main and Recargas are exactly that. The invariant is
 * about one SATURATED colour competing for the eye, not about banning the
 * hue. Matching them would have failed BarcodePrinting.vue's quantity pill,
 * which is not an emphasis leak.
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
	/#ff6b35/i, // theme.css's legacy orange `--pos-accent`; also emphasis.
];

/** Amber and green: allowed as surface, caption and figure — never as fill. */
const STATE_PATTERNS = [/#f0dcae/i, /#8a5a0d/i, /#fdf9f0/i, /#cdead8/i, /#157a48/i, /#f4fbf7/i];

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const walk = (dir: string): string[] => {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (entry.endsWith(".vue") || entry.endsWith(".css")) out.push(full);
	}
	return out;
};

interface Rule {
	selector: string;
	body: string;
}

/** Flat list of `selector { body }` pairs; nested at-rules are unwrapped. */
const rules = (css: string): Rule[] => {
	const found: Rule[] = [];
	let depth = 0;
	let start = 0;
	let selectorStart = 0;
	for (let i = 0; i < css.length; i += 1) {
		const char = css[i];
		if (char === "{") {
			if (depth === 0) {
				const selector = css.slice(selectorStart, i).trim();
				if (selector.startsWith("@")) {
					// at-rule: recurse into its block rather than treating the
					// whole media query as one selector.
					const open = i;
					let d = 0;
					for (let j = open; j < css.length; j += 1) {
						if (css[j] === "{") d += 1;
						else if (css[j] === "}") {
							d -= 1;
							if (d === 0) {
								found.push(...rules(css.slice(open + 1, j)));
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
				found.push({ selector: css.slice(selectorStart, start - 1).trim(), body: css.slice(start, i) });
				selectorStart = i + 1;
			}
		}
	}
	return found;
};

/** Every `<style>` block in an SFC, or the whole file for a .css. */
const stylesOf = (file: string) => {
	const source = readFileSync(file, "utf8");
	if (file.endsWith(".css")) return stripComments(source);
	return stripComments(
		[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
	);
};

const fillDeclarations = (body: string) =>
	body
		.split(";")
		.map((d) => d.trim())
		.filter((d) => /^background(-color)?\s*:/.test(d));

const isPrimaryAction = (selector: string) =>
	/__primary\b/.test(selector) || /band-primary/.test(selector);

const shellFiles = walk(SHELL);

describe("the accent appears on the primary action and nowhere else", () => {
	it("has shell surfaces to scan at all", () => {
		// A scan over zero files passes vacuously, which is the quiet way this
		// kind of guarantee stops guarding anything.
		expect(shellFiles.length).toBeGreaterThan(0);
	});

	it("no shell surface fills a non-primary element with the brand accent", () => {
		const offenders: string[] = [];
		for (const file of shellFiles) {
			for (const rule of rules(stylesOf(file))) {
				if (isPrimaryAction(rule.selector)) continue;
				for (const declaration of fillDeclarations(rule.body)) {
					if (ACCENT_PATTERNS.some((pattern) => pattern.test(declaration))) {
						offenders.push(`${file.replace(SRC, "…")} → ${rule.selector} { ${declaration} }`);
					}
				}
			}
		}
		expect(
			offenders,
			`the accent is a fill reserved for the primary action:\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("state colours never become a fill on an action", () => {
		// The inverse leak: tinting the BUTTON green when change is due would
		// move the accent with the state, which is the same invariant read
		// from the other side.
		const offenders: string[] = [];
		for (const file of shellFiles) {
			for (const rule of rules(stylesOf(file))) {
				if (!isPrimaryAction(rule.selector)) continue;
				for (const declaration of fillDeclarations(rule.body)) {
					if (STATE_PATTERNS.some((pattern) => pattern.test(declaration))) {
						offenders.push(`${file.replace(SRC, "…")} → ${rule.selector} { ${declaration} }`);
					}
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("the band spends its one accent exactly once", () => {
	const bandCss = stylesOf(resolve(SHELL, "band/ActionBand.vue"));

	it("only the primary button carries an accent fill", () => {
		const accented = rules(bandCss).filter((rule) =>
			fillDeclarations(rule.body).some((d) => ACCENT_PATTERNS.some((p) => p.test(d))),
		);
		expect(accented.length).toBeGreaterThan(0);
		for (const rule of accented) {
			// `:active` is the same control under the finger, not a second
			// accent — so the rule is "every accented selector IS the primary
			// button", not "there is exactly one such rule".
			expect(rule.selector, `accent fill outside the primary action: ${rule.selector}`).toMatch(
				/^\.action-band__primary\b/,
			);
		}
	});

	it("no tone modifier reaches the button", () => {
		for (const rule of rules(bandCss)) {
			if (!/action-band--/.test(rule.selector)) continue;
			expect(rule.selector, `tone must not restyle the action: ${rule.selector}`).not.toMatch(
				/__primary/,
			);
		}
	});

	it("disabled drops the accent rather than fading it", () => {
		const disabled = rules(bandCss).find((r) => r.selector === ".action-band__primary:disabled");
		expect(disabled).toBeDefined();
		for (const declaration of fillDeclarations(disabled!.body)) {
			expect(ACCENT_PATTERNS.some((p) => p.test(declaration))).toBe(false);
		}
	});
});

describe("the token layer keeps the accent brandable", () => {
	const tokens = stripComments(readFileSync(TOKENS, "utf8"));

	it("forwards --pos-primary instead of hard-coding the teal", () => {
		// A literal hex here would freeze the accent past dark mode and past
		// the §17.4 brand layer, which is the whole reason the token exists.
		expect(tokens).toMatch(/--reg-accent:\s*var\(--pos-primary/);
	});

	it("never routes the accent through theme.css's orange --pos-accent", () => {
		// A real trap: the name matches, the colour does not.
		expect(tokens).not.toMatch(/--reg-accent[^;]*var\(--pos-accent\b/);
	});

	it("states the band geometry the artboards use", () => {
		expect(tokens).toMatch(/--reg-band-height:\s*134px/);
		expect(tokens).toMatch(/--reg-band-number-size:\s*60px/);
	});
});

describe("the band stays off the layout-reading path", () => {
	it("never measures the DOM, because §6 budgets payment-open at 150 ms p95", () => {
		const source = readFileSync(resolve(SHELL, "band/ActionBand.vue"), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");
		for (const forbidden of [
			"getBoundingClientRect",
			"offsetWidth",
			"offsetHeight",
			"clientWidth",
			"clientHeight",
			"getComputedStyle",
		]) {
			expect(source, `band must not force layout via ${forbidden}`).not.toContain(forbidden);
		}
	});
});
