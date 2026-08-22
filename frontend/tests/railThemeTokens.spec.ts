// @vitest-environment node

/**
 * The rail paints through tokens, never through literal hex.
 *
 * `theme.css` ships a full dark palette — `[data-theme="dark"]`,
 * `.v-theme--dark` and a `prefers-color-scheme` block all redefine `--pos-*` —
 * and the rest of the POS follows it. The rail did not: nine literal colour
 * declarations meant the register's PRIMARY NAVIGATION rendered as a light
 * column beside a `#121212` shell (A1, wave 3).
 *
 * This is a source scan rather than a mount, for the same reason
 * `singleAccent.spec.ts` is: the guarantee is that no such declaration EXISTS.
 * A mounted assertion can only prove that the paths it happened to render are
 * clean, and the dark theme is precisely the path nobody renders in a test.
 *
 * Scope note, inherited from A1: this asserts that a colour resolves through a
 * custom property, not WHICH one. A token that happens to be light in both
 * themes is still a deliberate choice a reader can find; a literal is not.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIL = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/posapp/components/pos/shell/rail/RegisterRail.vue",
);

const source = () => readFileSync(RAIL, "utf8");

/** `color:`, `background:` etc. carrying a literal hex with no `var()`. */
const COLOUR_DECL =
	/(?:^|[\s;{])(color|background|background-color|border|border-right|border-color|outline)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)/g;

function literalColours(text: string): string[] {
	const out: string[] = [];
	for (const match of text.matchAll(COLOUR_DECL)) {
		const value = match[2] ?? "";
		if (value.includes("var(")) continue;
		out.push(`${match[1]}: ${value.trim()}`);
	}
	return out;
}

describe("the rail follows the theme", () => {
	it("declares no literal colour outside a var() fallback", () => {
		const literals = literalColours(source());
		expect(
			literals,
			`RegisterRail.vue declares ${literals.length} literal colour(s) that ` +
				`cannot follow theme.css's dark palette:\n  ${literals.join("\n  ")}`,
		).toEqual([]);
	});

	it("supplies a dark counterpart for every rail-specific token it invents", () => {
		const text = source();

		// Names the component defines its own light value for. Anything
		// forwarded straight from `--pos-*` needs no counterpart — theme.css
		// already flips those.
		const invented = [...text.matchAll(/var\((--reg-rail-[a-z-]+)/g)].map((m) => m[1]!);
		const unique = [...new Set(invented)];
		expect(unique.length, "expected the rail to define some rail-specific tokens").toBeGreaterThan(0);

		const darkBlock = text.slice(text.indexOf("---- dark"));
		expect(darkBlock.length, "the component has no dark block").toBeGreaterThan(0);

		// Amber is STATE and does NOT flip: a badge that changed hue between
		// themes would teach the cashier two vocabularies for one signal.
		const themeConstant = new Set(["--reg-rail-badge-bg", "--reg-rail-badge-fg"]);

		const missing = unique.filter(
			(token) => !themeConstant.has(token) && !darkBlock.includes(`${token}:`),
		);
		expect(
			missing,
			`these rail tokens have a light value but no dark counterpart, so they ` +
				`stay light inside a dark register: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("keeps the closed-shift state off `opacity`", () => {
		// Two reasons, and the second is the load-bearing one: opacity stacked
		// with the per-item disabled colour to render the whole navigation at
		// 1.66:1, AND it dimmed the focus ring that the keyboard-reachability
		// fix depends on being visible.
		const text = source();
		const disabledRule = text.slice(
			text.indexOf(".register-rail--disabled"),
			text.indexOf(".register-rail__group"),
		);
		expect(
			/opacity\s*:/.test(disabledRule),
			"`.register-rail--disabled` must not use opacity — it dims the focus " +
				"ring and crushes the label's contrast",
		).toBe(false);
	});

	it("styles unavailable items by aria-disabled, not by :disabled", () => {
		const text = source();
		expect(
			text.includes('.register-rail__item[aria-disabled="true"]'),
			"the disabled style must hang off aria-disabled; a `:disabled` " +
				"selector implies the native attribute is back",
		).toBe(true);
		expect(
			/\.register-rail__item:disabled/.test(text),
			"`:disabled` styling means the native attribute returned, which " +
				"removes the rail from the tab order",
		).toBe(false);
	});
});
