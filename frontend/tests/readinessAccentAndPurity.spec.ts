/**
 * Two properties of the Apertura surfaces that only a SOURCE scan can prove
 * (build plan §12 A, roadmap §17.7).
 *
 * 1. **One accent.** `OpeningReadiness.vue` renders ten rows of state beside a
 *    dialog whose submit button owns the screen's single saturated colour. A
 *    mounted assertion cannot prove this — scoped styles never reach
 *    `wrapper.html()` — so this reads the file, exactly as
 *    `tests/singleAccent.spec.ts` does for the shell.
 *
 * 2. **The verdict module stays pure.** `openingReadiness.ts` is the half with
 *    money behind it, and its whole value is that it can be tested on plain
 *    objects. One `import { useUIStore }` and that stops being true, quietly,
 *    on the day somebody needs "just one" store value.
 *
 * No jsdom — this reads real files, which is why it is its own spec (build
 * plan §10: `node:fs` named imports do not interop under jsdom).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHIFT = resolve(__dirname, "../src/posapp/components/pos/shift");

const read = (file: string) => readFileSync(resolve(SHIFT, file), "utf8");

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The saturated accent in every spelling that can reach a stylesheet — the
 * token, what it forwards to, and the raw hexes behind both themes. Copied
 * from `tests/singleAccent.spec.ts` rather than imported: that suite owns the
 * shell's list and this one owns Apertura's, and a shared constant would let a
 * relaxation there silently relax this.
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

describe("the readiness panel spends no accent", () => {
	const styles = (() => {
		const source = read("OpeningReadiness.vue");
		const block = source.match(/<style[^>]*>([\s\S]*?)<\/style>/);
		return stripComments(block?.[1] ?? "");
	})();

	it("has a stylesheet to scan, so this suite cannot pass vacuously", () => {
		expect(styles.trim().length).toBeGreaterThan(200);
	});

	it("paints no saturated accent on a verified check", () => {
		for (const pattern of ACCENT_PATTERNS) {
			expect(styles, `accent ${pattern} reached the readiness panel`).not.toMatch(pattern);
		}
	});

	it("paints its states from forwarded tokens, so dark mode follows for free", () => {
		for (const token of [
			"--reg-tone-positive",
			"--reg-tone-warning",
			"--pos-error",
			"--reg-text-primary",
		]) {
			expect(styles).toContain(token);
		}
	});
});

describe("the verdict module stays pure", () => {
	const source = read("openingReadiness.ts");

	it("imports nothing at all", () => {
		// Not "imports no Vue" — imports NOTHING. The module is types and
		// functions over plain objects, and the day it needs an import is the
		// day somebody should have to justify it here.
		expect(stripComments(source)).not.toMatch(/^\s*import\s/m);
	});

	it("reaches for no global the tests would have to stub", () => {
		const body = stripComments(source);
		// Matched as USES, not as substrings: `documentFormats` is one of the ten
		// check ids and a bare `.includes("document")` fails on the id itself —
		// a false positive that would teach the next person to delete this test.
		const globals = [/\bfrappe\b/, /\bwindow\./, /\blocalStorage\b/, /\bdocument\./, /__\(/];
		for (const global of globals) {
			expect(body, `${global} reached the verdict module`).not.toMatch(global);
		}
	});

	it("does not format, so it never needs the tenant's currency or precision", () => {
		const body = stripComments(source);
		expect(body).not.toContain("toLocaleString");
		expect(body).not.toContain("Intl.");
	});
});
