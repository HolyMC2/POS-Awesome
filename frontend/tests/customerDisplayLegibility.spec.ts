// @vitest-environment node

/**
 * The legibility and theme choices on the customer-facing screen, asserted
 * from the source rather than from a render — a `clamp()` has no computed
 * value in jsdom, and the guarantee is about the scale the file DECLARES.
 *
 * Node environment on purpose: `node:fs` named imports do not interop under
 * jsdom (build plan §10), which has already cost this repo time twice.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src/posapp");
const DISPLAY = resolve(SRC, "components/customer_display/CustomerDisplay.vue");
const LAYOUT = resolve(SRC, "layouts/CustomerDisplayLayout.vue");
const TOKENS = resolve(SRC, "styles/register-tokens.css");

const read = (file: string) => readFileSync(file, "utf8");

/**
 * `--cd-size-x: clamp(a, b, c)` → `{ min, preferred, max }` in px. The middle
 * term is a viewport unit, so it is compared at a stated width; 1440 is the
 * canvas's own artboard width and the size the register is drawn at.
 */
const ARTBOARD_WIDTH = 1440;

const scale = (() => {
	const source = read(DISPLAY);
	const out = new Map<string, { min: number; preferred: number; max: number }>();
	const pattern = /--cd-size-([a-z-]+):\s*clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)/g;
	for (const match of source.matchAll(pattern)) {
		out.set(match[1]!, {
			min: Number(match[2]),
			preferred: (Number(match[3]) / 100) * ARTBOARD_WIDTH,
			max: Number(match[4]),
		});
	}
	return out;
})();

/** Largest first. This IS the hierarchy the screen claims to have. */
const ORDER = ["total", "hero-name", "hero-figure", "line", "caption"] as const;

describe("the type scale is a hierarchy, not five sizes", () => {
	it("declares every step it is asserted on", () => {
		expect([...scale.keys()].sort()).toEqual([...ORDER].sort());
	});

	it.each(["min", "preferred", "max"] as const)(
		"stays strictly descending at the %s of the clamp",
		(position) => {
			const sizes = ORDER.map((name) => ({ name, value: scale.get(name)![position] }));
			for (let i = 1; i < sizes.length; i += 1) {
				expect(
					sizes[i - 1]!.value,
					`--cd-size-${sizes[i - 1]!.name} (${sizes[i - 1]!.value}) must stay above ` +
						`--cd-size-${sizes[i]!.name} (${sizes[i]!.value}) at the ${position} of the ` +
						`clamp, or the screen has a different hierarchy at some viewport than ` +
						`the one it was designed with`,
				).toBeGreaterThan(sizes[i]!.value);
			}
		},
	);

	it("puts the total well above the register band's own figure", () => {
		// The band's 60px is read at a cashier's arm's length. This screen is
		// read from one to two metres, so the total has to clear it by a wide
		// margin or the customer is squinting at the one number they came for.
		const band = /--reg-band-number-size:\s*(\d+)px/.exec(read(TOKENS));
		expect(band, "register-tokens.css no longer declares --reg-band-number-size").not.toBeNull();
		const bandSize = Number(band![1]);
		expect(scale.get("total")!.max).toBeGreaterThan(bandSize * 2);
		expect(scale.get("total")!.preferred).toBeGreaterThan(bandSize);
	});

	it("never lets a cart line fall to cashier-screen density", () => {
		// The four-column table this replaced rendered rows down to 14px. At
		// this viewing distance that is not a small font, it is an absent one.
		expect(scale.get("line")!.min).toBeGreaterThanOrEqual(16);
	});

	it("uses the scale everywhere it sets a font size", () => {
		// A hard-coded `font-size: 22px` in the same stylesheet would sit
		// outside every assertion above.
		const style = /<style scoped>([\s\S]*)<\/style>/.exec(read(DISPLAY))![1]!;
		const literals = [...style.matchAll(/font-size:\s*([^;]+);/g)]
			.map((m) => m[1]!.trim())
			.filter((value) => !value.includes("var(--cd-size-"));
		expect(literals, `font sizes outside the declared scale: ${literals.join(", ")}`).toEqual([]);
	});
});

/** `color:`, `background:` etc. carrying a literal hex with no `var()` — the
 *  same rule `tests/a11yShellDarkMode.spec.ts` applies to the shell. */
const COLOUR_DECL = /(?:^|[\s;{])(color|background|background-color|border-color)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)/g;

const literalColours = (source: string) => {
	const out: string[] = [];
	for (const match of source.matchAll(COLOUR_DECL)) {
		const value = match[2] ?? "";
		if (value.includes("var(")) continue;
		out.push(`${match[1]}: ${value.trim()}`);
	}
	return out;
};

describe("the display follows the theme", () => {
	it.each([
		["components/customer_display/CustomerDisplay.vue", DISPLAY],
		["layouts/CustomerDisplayLayout.vue", LAYOUT],
	])("%s paints through tokens, not literal hex", (name, file) => {
		const literals = literalColours(read(file));
		expect(
			literals,
			`${name} declares ${literals.length} literal colour(s) that cannot follow ` +
				`theme.css's dark palette:\n  ${literals.join("\n  ")}`,
		).toEqual([]);
	});

	it("reaches for the register's tokens rather than a second palette", () => {
		const style = read(DISPLAY);
		expect(style).toContain("var(--reg-text-primary");
		expect(style).toContain("var(--reg-surface");
	});
});

describe("the display spends no accent", () => {
	// Invariant 2 gives each screen one saturated colour, on the primary
	// action. This screen has no actions — nobody touches it — so there is
	// nothing for that colour to mark, and a second thing competing with the
	// total is exactly what the invariant exists to prevent.
	const ACCENT = [
		/var\(\s*--reg-accent/,
		/var\(\s*--pos-primary\s*[,)]/,
		/var\(\s*--pos-primary-variant\s*[,)]/,
		/var\(\s*--pos-accent\s*[,)]/,
		/#0097a7/i,
		/#00838f/i,
		/#00d4ff/i,
		/#ff6b35/i,
	];

	it("names no accent anywhere in the component", () => {
		const source = read(DISPLAY);
		const hits = ACCENT.filter((pattern) => pattern.test(source)).map(String);
		expect(
			hits,
			`the customer display has no primary action to mark; a saturated colour ` +
				`here only competes with the total:\n  ${hits.join("\n  ")}`,
		).toEqual([]);
	});

	it("keeps the layout's brand tint a wash, not a fill", () => {
		// The layout's radial `color-mix(... --pos-primary 22% ...)` is the one
		// brand presence on this screen and singleAccent.spec.ts's wash rule
		// caps it at 25%. Above that it stops being a tint.
		const source = read(LAYOUT);
		for (const match of source.matchAll(/--pos-primary\s*\)\s*(\d{1,3})%/g)) {
			expect(Number(match[1]), "a wash above 25% is just the brand colour").toBeLessThanOrEqual(25);
		}
	});
});
