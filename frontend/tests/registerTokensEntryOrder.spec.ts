// @vitest-environment node
/**
 * `register-tokens.css` must be imported, and imported AFTER `theme.css`.
 *
 * Both halves are silent when broken, which is why they are pinned. The band
 * component carries token fallbacks (`var(--reg-band-height, 134px)`) so an
 * unwired build still renders a plausible register — meaning a missing import
 * costs the density and the tone palette with nothing visibly failing. And
 * `--reg-accent` FORWARDS `--pos-primary`; a forward evaluated before its
 * source exists resolves to nothing, so import order is load-bearing rather
 * than stylistic.
 *
 * Source-scanned rather than mounted: the guarantee is about the entry file's
 * import order, and no amount of mounting can observe that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = readFileSync(resolve(root, "src/posapp/posapp.ts"), "utf8");
const tokens = readFileSync(resolve(root, "src/posapp/styles/register-tokens.css"), "utf8");

describe("register token wiring", () => {
	it("imports register-tokens.css from the posapp entry", () => {
		expect(entry).toMatch(/import\s+["']\.\/styles\/register-tokens\.css["']/);
	});

	it("imports it after theme.css, because --reg-accent forwards --pos-primary", () => {
		const themeAt = entry.indexOf('"./styles/theme.css"');
		const tokensAt = entry.indexOf('"./styles/register-tokens.css"');
		expect(themeAt).toBeGreaterThan(-1);
		expect(tokensAt).toBeGreaterThan(themeAt);
	});

	it("forwards --pos-primary and never --pos-accent", () => {
		// theme.css's --pos-accent is orange #ff6b35. Forwarding it would put a
		// second saturated colour on the register and break the one-accent
		// invariant that makes the raised density safe (§17.7).
		//
		// Comments are stripped first: the file NAMES --pos-accent in a warning
		// about this exact trap, and a scan that cannot tell a declaration from
		// prose would fail on the documentation of the rule it is enforcing.
		const declarations = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(declarations).toMatch(/--reg-accent:\s*var\(\s*--pos-primary/);
		expect(declarations).not.toMatch(/--pos-accent/);
	});
});
