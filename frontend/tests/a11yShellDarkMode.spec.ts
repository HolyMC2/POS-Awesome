// @vitest-environment node

/**
 * A1 (wave 3) — DEMONSTRATING SPEC. Expected to FAIL until the finding is
 * fixed; it proves a defect rather than guarding a guarantee.
 *
 * FINDING: the register shell is not theme-aware. `theme.css` ships a full
 * dark palette — `[data-theme="dark"]`, `.v-theme--dark` and a
 * `prefers-color-scheme: dark` block all redefine `--pos-*` — and the rest of
 * the POS follows it. Three of the four new shell components do not: they
 * paint with literal hex, so in dark mode the register's PRIMARY NAVIGATION
 * renders as a light column beside a `#121212` shell.
 *
 * `ActionBand.vue` is the counter-example and shows the fix is cheap: it
 * declares no literal colour at all, forwarding `--pos-bg-primary`,
 * `--pos-text-primary` and `--pos-primary` through `--reg-*`. Because it does,
 * its neutral tone and its accent flip correctly and measure well in both
 * themes (accent in dark is `#000000` on `#00d4ff` = 11.86:1).
 *
 * The band is only PARTLY safe, though: `register-tokens.css` hard-codes the
 * positive and warning tone palettes (`#f4fbf7`, `#fdf9f0`, `#eceff3`), so a
 * change-due or shortfall band renders as a near-white slab inside a dark
 * register. Internal contrast within the tint still passes — this is a
 * consistency defect, not a legibility one.
 *
 * Scope note: this asserts only that a colour resolves through a custom
 * property, not which one. A token that happens to be light in both themes is
 * still a deliberate choice a reader can find; a literal is not.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHELL = resolve(dirname(fileURLToPath(import.meta.url)), "../src/posapp/components/pos/shell");

const COMPONENTS = [
	"rail/RegisterRail.vue",
	"band/ActionBand.vue",
	"drawer/CatalogDrawer.vue",
	"mobile/MobileOfflineOverlay.vue",
] as const;

/** `color:`, `background:` etc. carrying a literal hex with no `var()` in the value. */
const COLOUR_DECL = /(?:^|[\s;{])(color|background|background-color|border-color)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)/g;

function literalColours(source: string): string[] {
	const out: string[] = [];
	for (const match of source.matchAll(COLOUR_DECL)) {
		const value = match[2] ?? "";
		if (value.includes("var(")) continue; // resolves through a token; flips with the theme
		out.push(`${match[1]}: ${value.trim()}`);
	}
	return out;
}

describe("A1 — the register shell follows the dark theme", () => {
	it.each(COMPONENTS)("%s paints through tokens, not literal hex", (file) => {
		const source = readFileSync(resolve(SHELL, file), "utf8");
		const literals = literalColours(source);
		expect(
			literals,
			`${file} declares ${literals.length} literal colour(s) that cannot follow ` +
				`theme.css's dark palette:\n  ${literals.slice(0, 8).join("\n  ")}` +
				(literals.length > 8 ? `\n  …and ${literals.length - 8} more` : ""),
		).toEqual([]);
	});

	it("register-tokens.css defines its tone palettes for both themes", () => {
		const tokens = readFileSync(
			resolve(SHELL, "../../../styles/register-tokens.css"),
			"utf8",
		);
		const hasDarkBlock =
			/\[data-theme=["']dark["']\]/.test(tokens) ||
			/\.v-theme--dark/.test(tokens) ||
			/prefers-color-scheme:\s*dark/.test(tokens);

		expect(
			hasDarkBlock,
			"register-tokens.css has no dark block, so --reg-tone-positive-* and " +
				"--reg-tone-warning-* stay near-white; a change-due band renders as a " +
				"light slab inside a #121212 register",
		).toBe(true);
	});
});
