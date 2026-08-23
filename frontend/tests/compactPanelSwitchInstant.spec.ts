/**
 * One speed for every dock destination (roadmap §6, §17.7).
 *
 * The compact shell shows one panel at a time and switches by flipping
 * `v-show` on siblings, so a dock tap costs one repaint. What made it read as
 * a flicker was the chrome around it: the shell container carried
 * `all 0.3s ease` and the columns `padding 0.3s ease`, and `all` silently
 * covers every layout property — so the padding and the safe-space eased for
 * 300ms after the panel underneath had already swapped.
 *
 * "Snappy" is a budget, not an adjective, so it is stated as a property of the
 * file: no declaration in the shell's stylesheet may animate anything a
 * compositor cannot do on its own, and nothing may outlast 150ms. Scanned
 * rather than rendered, for the same reason `catalogDrawerAnimation.spec.ts`
 * is — a frame budget blown by a stylesheet still LOOKS right in a test.
 *
 * No jsdom: this reads real files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHELL = resolve(__dirname, "../src/posapp/components/pos/shell/Pos.vue");
const SOURCE = readFileSync(SHELL, "utf8");
const STYLE_BLOCK = SOURCE.slice(SOURCE.indexOf("<style"), SOURCE.lastIndexOf("</style>"));

/**
 * What a dock switch is allowed to animate. `transform` and `opacity` are the
 * compositor's; colour is a paint the panel swap does not wait on. Every
 * layout property is absent on purpose — animating one reflows per frame, and
 * `all` is absent because it includes them without saying so.
 */
const COMPOSITOR_SAFE = ["transform", "opacity", "color", "background-color"];

/** The uniform ceiling — a tab that takes longer than this is the slow tab. */
const MAX_DURATION_MS = 150;

interface Transitioned {
	property: string;
	durationMs: number | null;
}

/** Split on commas at paren depth 0 — `cubic-bezier(.4, 0, .2, 1)` carries its own. */
function splitTopLevel(value: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of value) {
		if (char === "(") depth += 1;
		else if (char === ")") depth -= 1;
		if (char === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

const durationOf = (segment: string): number | null => {
	const match = segment.match(/(\d*\.?\d+)(ms|s)\b/);
	if (!match) return null;
	const value = Number(match[1]);
	return match[2] === "s" ? value * 1000 : value;
};

function transitions(css: string): Transitioned[] {
	const declarations = [...css.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)[;}]/g)].map(
		(match) => match[1]!,
	);
	const out: Transitioned[] = [];
	for (const declaration of declarations) {
		for (const segment of splitTopLevel(declaration)) {
			const property = segment.trim().split(/\s+/)[0];
			if (!property || property === "none") continue;
			out.push({ property, durationMs: durationOf(segment) });
		}
	}
	return out;
}

describe("the shell switches panels at one speed", () => {
	it("animates nothing a compositor cannot do on its own", () => {
		const found = transitions(STYLE_BLOCK);
		// A scan that found nothing would pass forever; the dock tab's own
		// colour change is the floor.
		expect(found.length).toBeGreaterThan(0);

		for (const { property } of found) {
			expect(
				COMPOSITOR_SAFE,
				`transition on "${property}" reflows or repaints the panel switch — the dock flips, it does not animate`,
			).toContain(property);
		}
	});

	it("never says `all`, which includes the layout properties without naming them", () => {
		// This is the exact declaration that made every compact panel change
		// ease its padding for 300ms behind an already-swapped panel.
		expect(transitions(STYLE_BLOCK).map((t) => t.property)).not.toContain("all");
	});

	it("keeps every animation inside the 150ms ceiling", () => {
		for (const { property, durationMs } of transitions(STYLE_BLOCK)) {
			if (durationMs === null) continue;
			expect(
				durationMs,
				`"${property}" runs ${durationMs}ms — longer than the dock's other tabs take`,
			).toBeLessThanOrEqual(MAX_DURATION_MS);
		}
	});

	it("leaves the panels themselves entirely unanimated", () => {
		// The container and the columns ARE the panel switch. A transition on
		// either is the switch itself running slowly, whatever it names.
		for (const selector of [".dynamic-container", ".dynamic-col", ".dynamic-main-row"]) {
			const start = STYLE_BLOCK.indexOf(`${selector} {`);
			expect(start, `${selector} is gone from the shell's stylesheet`).toBeGreaterThan(-1);
			const rule = STYLE_BLOCK.slice(start, STYLE_BLOCK.indexOf("}", start));
			expect(rule, `${selector} animates the panel switch`).not.toMatch(/transition\s*:/);
		}
	});
});

describe("the catalogue is one of those panels", () => {
	it("is handed the shell's own compact answer rather than re-deriving it", () => {
		// If the drawer decided compactness from the viewport it would present
		// as an overlay on a wide lean-vertical register, and Browse would be
		// the one dock tab that animates.
		expect(SOURCE).toMatch(/useCatalogDrawer\(\{[\s\S]{0,400}compact:\s*useCompactPosSwitcher/);
	});
});
