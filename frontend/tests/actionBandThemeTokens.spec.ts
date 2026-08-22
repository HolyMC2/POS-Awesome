// @vitest-environment node

/**
 * The register shell must follow theme.css's dark palette (A1, wave 3).
 *
 * A1's `a11yShellDarkMode.spec.ts` proves the ABSENCE of literal colour, which
 * is the defect it found. This spec guards the two things that absence does
 * not by itself buy: that the tokens actually RESOLVE to different values per
 * theme, and that the band's label clears AA in both.
 *
 * Both halves matter because they fail silently in opposite directions. A
 * component can be free of literals and still be wrong if every token it uses
 * is defined once; and a token can flip correctly and still be illegible.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/posapp/styles");
const tokens = readFileSync(resolve(STYLES, "register-tokens.css"), "utf8");

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
	const h = hex.replace("#", "");
	const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
	return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
	const [la, lb] = [luminance(a), luminance(b)];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The dark block, isolated, so a light-block value cannot satisfy a dark assertion. */
function darkBlock(): string {
	const start = tokens.indexOf('[data-theme="dark"],');
	expect(start, "register-tokens.css has no dark selector block").toBeGreaterThan(-1);
	return tokens.slice(start);
}

describe("register tokens flip with the theme", () => {
	it("covers every selector theme.css uses, including `automatic`", () => {
		// A register that follows only [data-theme="dark"] looks correct until a
		// tenant on `automatic` opens it after sunset.
		for (const selector of [
			'[data-theme="dark"]',
			'[data-theme-mode="dark"]',
			".v-theme--dark",
			"prefers-color-scheme: dark",
			'[data-theme-mode="automatic"]',
		]) {
			expect(tokens, `register-tokens.css never matches ${selector}`).toContain(selector);
		}
	});

	it.each([
		"--reg-tone-positive-bg",
		"--reg-tone-positive-number",
		"--reg-tone-warning-bg",
		"--reg-tone-warning-number",
		"--reg-tone-neutral-divider",
		"--reg-scrim",
	])("%s is redefined for dark, not left at its light value", (token) => {
		const dark = darkBlock();
		expect(dark, `${token} never appears in the dark block`).toContain(`${token}:`);
	});

	it("the band label clears AA in BOTH themes", () => {
		// The fix was to forward --pos-text-muted rather than pick a new
		// literal: #667085 light, #b0b8c4 dark. The old literal #8b93a0
		// measured 3.10:1 on white — a 10.5px uppercase label needs 4.5:1.
		expect(tokens).toMatch(/--reg-tone-neutral-label:\s*var\(--pos-text-muted/);
		expect(contrast("#667085", "#ffffff")).toBeGreaterThanOrEqual(4.5);
		expect(contrast("#b0b8c4", "#121212")).toBeGreaterThanOrEqual(4.5);
		// The value it replaced must not come back.
		expect(contrast("#8b93a0", "#ffffff")).toBeLessThan(4.5);
	});

	it("every dark tone pair clears AA", () => {
		const pairs: Array<[string, string, string]> = [
			["#a5d6a7", "#1e3323", "positive label"],
			["#81c784", "#1e3323", "positive number"],
			["#ffd54f", "#3a2b10", "warning label and number"],
			["#ffe08a", "#3a2b10", "overlay title"],
			["#ffb74d", "#1e1e1e", "overlay wait heading"],
			["#7fe9ff", "#003344", "drawer active chip"],
		];
		for (const [fg, bg, what] of pairs) {
			expect(contrast(fg, bg), `${what}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("keeps the canvas's light tones — the artboards are the reference (§17.7)", () => {
		for (const value of ["#f4fbf7", "#157a48", "#fdf9f0", "#8a5a0d"]) {
			expect(tokens, `light tone ${value} was changed`).toContain(value);
		}
	});
});
