/**
 * ONE motion system, source-scanned (native-feel round 2, owner 2026-08-30:
 * «snappy, with animations, solid, polished»).
 *
 * Before this round every surface picked its own numbers — the cajón eased at
 * 180ms on `cubic-bezier(0.2, 0, 0, 1)`, the dock tab at `0.1s ease`, the item
 * card at `0.2s cubic-bezier(0.4, 0, 0.2, 1)`, the theme layer at
 * `0.02s linear`. None of them was wrong on its own, and together they were
 * the reason the register moved like four different products. So the rule is
 * stated as a property of the FILES rather than of a rendered frame: a
 * duration in this app comes from a token, and a token is the only place a
 * duration may be written down.
 *
 * Scanned, not rendered, for the reason `catalogDrawerAnimation.spec.ts` and
 * `compactPanelSwitchInstant.spec.ts` are: a frame budget blown by a
 * stylesheet still LOOKS right in a test, and a duration typed by hand looks
 * right forever.
 *
 * No jsdom: this reads real files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src/posapp");
const read = (relative: string) => readFileSync(resolve(SRC, relative), "utf8");

const TOKENS_FILE = "styles/register-tokens.css";
const TOKENS = read(TOKENS_FILE);

/** CSS comments carry example durations on purpose; they are documentation. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet of a file, whether it is a `.css` or an SFC. */
const styleOf = (relative: string): string => {
	const source = read(relative);
	if (relative.endsWith(".css")) return stripComments(source);
	return stripComments(
		[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "").join("\n"),
	);
};

/**
 * Every file that authored or adopted motion in this round. The claim for all
 * of them is the same: no literal duration.
 */
const TOKENISED = [
	"styles/register-tokens.css",
	"styles/shimmer.css",
	"components/pos/shell/movil/MovilShell.vue",
	"components/pos/mobile/line/MovilLineSheet.vue",
	"components/pos/items/lot/LotPicker.vue",
	"components/pos/shell/drawer/CatalogDrawer.vue",
	"components/pos/shell/band/ActionBand.vue",
	"components/pos/shell/Pos.vue",
	"components/pos/items/ItemCard.vue",
	"components/pos/mobile/browse/MobileBrowseCard.vue",
	"components/pos/mobile/pay/PayKeypad.vue",
	"components/pos/payments/cobro/CobroMethodRows.vue",
	"components/pos/invoice/InvoiceActionButtons.vue",
	"components/pos/invoice/ParkedOrdersList.vue",
];

/**
 * The subset whose motion is ENTIRELY this round's. They may animate nothing
 * but `transform` and `opacity` — the two things a compositor can do without
 * asking layout or paint for help.
 *
 * `Pos.vue`, `ItemCard.vue` and `ParkedOrdersList.vue` are absent on purpose:
 * each carries an older colour or shadow transition that predates this round,
 * and rewriting their property lists would be a redesign wearing a motion
 * pass's clothes. `compactPanelSwitchInstant.spec.ts` already holds Pos.vue to
 * a compositor-safe list of its own.
 */
const COMPOSITOR_ONLY = [
	"components/pos/shell/movil/MovilShell.vue",
	"components/pos/mobile/line/MovilLineSheet.vue",
	"components/pos/items/lot/LotPicker.vue",
	"components/pos/shell/drawer/CatalogDrawer.vue",
	"components/pos/shell/band/ActionBand.vue",
	"components/pos/mobile/browse/MobileBrowseCard.vue",
	"components/pos/mobile/pay/PayKeypad.vue",
	"components/pos/payments/cobro/CobroMethodRows.vue",
	"components/pos/invoice/InvoiceActionButtons.vue",
];

/**
 * Files where `will-change` must sit inside a class that is only on the
 * element WHILE something moves. A permanent `will-change` is a permanent
 * compositor layer, and the phone pays for it in memory whether or not
 * anything is animating.
 *
 * `CatalogDrawer.vue` and `ItemCard.vue` are absent: both carry a resting
 * `will-change` from before this round. The drawer is one element and can
 * afford it; the card is a GRID of them and cannot, which is recorded as a
 * finding rather than fixed here — removing it would change how a tuned
 * scroller behaves and belongs to whoever owns that scroll.
 */
const WILL_CHANGE_SCOPED = [
	"styles/register-tokens.css",
	"components/pos/shell/movil/MovilShell.vue",
	"components/pos/mobile/line/MovilLineSheet.vue",
	"components/pos/items/lot/LotPicker.vue",
];

/** Split on commas at paren depth 0 — `cubic-bezier(.2, .8, .2, 1)` has its own. */
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

/** Every `transition`/`animation` value in a stylesheet, shorthand or longhand. */
function motionDeclarations(css: string): string[] {
	return [
		...css.matchAll(/(?:transition|animation)(?:-property|-duration|-timing-function)?\s*:\s*([^;}]+)[;}]/g),
	].map((match) => (match[1] ?? "").trim());
}

/** The property names a `transition` value names. */
function transitionedProperties(css: string): string[] {
	const declarations = [...css.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)[;}]/g)].map(
		(match) => match[1] ?? "",
	);
	const properties: string[] = [];
	for (const declaration of declarations) {
		for (const segment of splitTopLevel(declaration)) {
			const first = segment.trim().split(/\s+/)[0];
			if (first && first !== "none") properties.push(first);
		}
	}
	return properties;
}

/** Body of the brace-matched block whose `{` follows `from`. */
function blockBody(css: string, from: number): string {
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
}

/** Flat `selector { body }` pairs; at-rules are recursed into, not treated as selectors. */
function rules(css: string): { selector: string; body: string }[] {
	const found: { selector: string; body: string }[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(css)) !== null) {
		const selector = (match[1] ?? "").replace(/\s+/g, " ").trim();
		if (selector.startsWith("@")) continue;
		found.push({ selector, body: (match[2] ?? "").trim() });
	}
	return found;
}

const TOKEN_NAMES = [
	"--motion-fast",
	"--motion-base",
	"--motion-slow",
	"--ease-out",
	"--ease-in-out",
	"--ease-emphasized",
	"--press-scale",
];

describe("the tokens are declared where the register can actually see them", () => {
	const base = stripComments(TOKENS);
	const declaring = rules(base).filter((rule) => /--motion-fast\s*:/.test(rule.body));

	it("puts them on `.posapp, :root`, not on a bare `:root`", () => {
		// The band tokens above them learned this the hard way and say so in
		// the file: a bare `:root` rule is SHADOWED wherever `.posapp` matches,
		// because `.posapp` is a class and `:root` is one element selector.
		// A motion token defined only on `:root` would resolve to nothing
		// inside the register — every transition silently instant.
		// Two rules declare it — the definition and the reduced-motion
		// override — and BOTH have to carry the compound selector, or the
		// override would be the one that resolves to nothing.
		expect(declaring.length).toBe(2);
		expect(declaring.map((rule) => rule.selector)).toEqual([".posapp, :root", ".posapp, :root"]);
	});

	it("declares every token this round's CSS reads", () => {
		for (const token of TOKEN_NAMES) {
			expect(base, `${token} is never declared`).toMatch(
				new RegExp(`${token}\\s*:\\s*[^;]+;`),
			);
		}
	});

	it("gives the three durations real values, fast < base < slow", () => {
		const durationOf = (token: string) =>
			Number(new RegExp(`${token}:\\s*(\\d+)ms`).exec(base)?.[1]);

		const fast = durationOf("--motion-fast");
		const base_ = durationOf("--motion-base");
		const slow = durationOf("--motion-slow");

		expect(fast).toBeGreaterThan(0);
		expect(fast).toBeLessThan(base_);
		expect(base_).toBeLessThan(slow);
	});

	it("keeps `--motion-fast` inside the shell's own 150ms ceiling", () => {
		// `compactPanelSwitchInstant.spec.ts` holds every animation in Pos.vue
		// under 150ms by reading the number out of the declaration. Now that
		// the dock tab's duration is `var(--motion-fast)` that scanner finds
		// nothing to measure — so the ceiling is asserted on the token, here,
		// rather than quietly lapsing.
		const fast = Number(/--motion-fast:\s*(\d+)ms/.exec(base)?.[1]);
		expect(fast).toBeLessThanOrEqual(150);
	});

	it("derives the shimmer from `--motion-slow` instead of inventing a fourth number", () => {
		expect(base).toMatch(/--motion-shimmer:\s*calc\(var\(--motion-slow\)\s*\*\s*4\)/);
	});
});

describe("reduced motion is answered once, for the whole register", () => {
	const base = stripComments(TOKENS);

	it("zeroes the durations in a single `prefers-reduced-motion` block", () => {
		const opener = /@media\s*\(prefers-reduced-motion:\s*reduce\)/g;
		const offsets = [...base.matchAll(opener)].map((match) => match.index ?? -1);
		expect(offsets.length, "one answer, or the register has two opinions").toBe(1);

		const body = blockBody(base, offsets[0]!);
		expect(body.replace(/\s+/g, " ")).toContain(".posapp, :root {");
		for (const token of ["--motion-fast", "--motion-base", "--motion-slow"]) {
			expect(body).toMatch(new RegExp(`${token}:\\s*0ms`));
		}
	});

	it("states it AFTER the definitions, which is the only reason it wins", () => {
		// A media query adds no specificity. `.posapp, :root` inside one ties
		// with `.posapp, :root` outside, and source order breaks the tie.
		const definition = base.indexOf("--motion-fast: 120ms");
		const reduction = base.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
		expect(definition).toBeGreaterThan(-1);
		expect(reduction).toBeGreaterThan(definition);
	});
});

describe("no file this round touched writes a duration by hand", () => {
	it.each(TOKENISED)("%s takes every duration from a token", (relative) => {
		const offenders: string[] = [];
		for (const declaration of motionDeclarations(styleOf(relative))) {
			// `0s`/`120ms` anywhere in a transition or animation value — including
			// inside a `var()` FALLBACK, which is how a duplicate number gets to
			// live on after the token that replaced it.
			if (/\d*\.?\d+m?s\b/.test(declaration)) offenders.push(declaration);
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it.each(TOKENISED)("%s reaches for `var(--motion-…)` where it animates at all", (relative) => {
		const declarations = motionDeclarations(styleOf(relative)).filter(
			(declaration) => !/^none\b/.test(declaration) && !declaration.startsWith("none"),
		);
		for (const declaration of declarations) {
			// A `transition-timing-function`/`animation-name` longhand names no
			// duration; only the ones that could have carried one are checked.
			if (!/\b(transform|opacity|color|background-color|border-color|box-shadow)\b/.test(declaration))
				continue;
			expect(declaration, `${relative}: "${declaration}"`).toMatch(/var\(--motion-/);
		}
	});
});

describe("the surfaces this round animates run on the compositor or not at all", () => {
	const LAYOUT_PROPERTIES = [
		"width",
		"height",
		"top",
		"left",
		"right",
		"bottom",
		"margin",
		"padding",
		"inset",
		"flex",
		"grid",
		"font-size",
	];

	it.each(COMPOSITOR_ONLY)("%s transitions only transform and opacity", (relative) => {
		const properties = transitionedProperties(styleOf(relative));
		expect(properties.length, `${relative} animates nothing at all`).toBeGreaterThan(0);
		for (const property of properties) {
			expect(
				["transform", "opacity"],
				`${relative}: a transition on "${property}" reflows or repaints every frame`,
			).toContain(property);
		}
	});

	it.each(COMPOSITOR_ONLY)("%s never says `all`, nor a layout property", (relative) => {
		const properties = transitionedProperties(styleOf(relative));
		expect(properties).not.toContain("all");
		for (const layoutProperty of LAYOUT_PROPERTIES) {
			expect(properties, `${relative} transitions "${layoutProperty}"`).not.toContain(
				layoutProperty,
			);
		}
	});
});

describe("will-change is held for as long as something is moving, and no longer", () => {
	it.each(WILL_CHANGE_SCOPED)("%s declares it only inside an active class", (relative) => {
		const offenders: string[] = [];
		for (const rule of rules(styleOf(relative))) {
			if (!/will-change\s*:/.test(rule.body)) continue;
			// Vue strips `-enter-active`/`-leave-active` the moment a transition
			// settles, and `useValueBump`'s class is on the element for one
			// animation. Anything else is a compositor layer nobody takes back.
			if (!/-enter-active|-leave-active|reg-bump/.test(rule.selector)) {
				offenders.push(`${relative}: ${rule.selector}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("every surface a finger lands on answers it", () => {
	// The register's pressables, and the file each one is written in. A press
	// that changes nothing on screen is read as a press that did not land —
	// which on a POS means the cashier taps it again.
	const PRESSABLE: [string, string][] = [
		["components/pos/items/ItemCard.vue", ".card-item-card:active"],
		["components/pos/mobile/browse/MobileBrowseCard.vue", ".mbrowse-card:active"],
		["components/pos/invoice/InvoiceActionButtons.vue", ".pos-action-strip__chip:active"],
		["components/pos/payments/cobro/CobroMethodRows.vue", ".cobro-methods__row:active"],
		["components/pos/shell/Pos.vue", ".mobile-dock__tab:active"],
		["components/pos/items/lot/LotPicker.vue", ".lot-row--tap:active"],
		["components/pos/mobile/pay/PayKeypad.vue", ".pay-keypad__key:active"],
		["components/pos/shell/band/ActionBand.vue", ".action-band__primary:active"],
		["components/pos/mobile/line/MovilLineSheet.vue", ".movil-line-sheet__step:active"],
	];

	it.each(PRESSABLE)("%s presses %s", (relative, selector) => {
		const css = styleOf(relative);
		expect(css, `${selector} has no pressed state`).toContain(selector);
	});

	it.each(PRESSABLE)("%s spends the one press scale on %s", (relative) => {
		// A per-surface scale is how "pressed" ends up meaning four different
		// amounts on one screen. The dock tab used to shrink 4%, everything
		// else nothing at all.
		expect(styleOf(relative)).toContain("scale(var(--press-scale");
	});
});

describe("the sheets travel, and the scrim only fades", () => {
	const SHEETS: [string, string, string][] = [
		[
			"components/pos/mobile/line/MovilLineSheet.vue",
			".movil-sheet-enter-from .movil-line-sheet__panel",
			".movil-sheet-enter-from .movil-line-sheet__scrim",
		],
		[
			"components/pos/items/lot/LotPicker.vue",
			".lot-sheet-enter-from .lot-picker__panel",
			".lot-sheet-enter-from .lot-picker__scrim",
		],
	];

	it.each(SHEETS)("%s starts its panel a full height below", (relative, panelSelector) => {
		const css = styleOf(relative);
		expect(css).toContain(panelSelector);
		const rule = rules(css).find((entry) => entry.selector.includes(panelSelector));
		expect(rule?.body).toContain("translateY(100%)");
	});

	it.each(SHEETS)("%s fades its scrim rather than moving it", (relative, _panel, scrim) => {
		const rule = rules(styleOf(relative)).find((entry) => entry.selector.includes(scrim));
		expect(rule?.body).toMatch(/opacity:\s*0/);
	});

	it.each(SHEETS)("%s rides the emphasized curve on the panel", (relative) => {
		expect(styleOf(relative)).toMatch(
			/transition:\s*transform\s+var\(--motion-slow\)\s+var\(--ease-emphasized\)/,
		);
	});
});

describe("the dock tab cross-fades where the panels may not", () => {
	const shell = read("components/pos/shell/movil/MovilShell.vue");

	it("wraps the phone's screens, which are chrome, not the shell's panels", () => {
		// `compactPanelSwitchInstant.spec.ts` pins `.dynamic-container`,
		// `.dynamic-col` and `.dynamic-main-row` as unanimated: those ARE the
		// panel switch, and a transition on them is the switch running slowly.
		// The phone's four screens are v-if'd chrome this shell owns.
		expect(shell).toContain('<Transition name="movil-screen" mode="out-in">');
	});

	it("slides 8px and fades, and nothing else", () => {
		const css = styleOf("components/pos/shell/movil/MovilShell.vue");
		expect(css).toMatch(/\.movil-screen-enter-from\s*\{[^}]*transform:\s*translateY\(8px\)/);
		expect(css).toMatch(/\.movil-screen-leave-to\s*\{[^}]*transform:\s*translateY\(-8px\)/);
	});

	it("answers the tap before it settles the new screen", () => {
		const css = styleOf("components/pos/shell/movil/MovilShell.vue");
		const enter = rules(css).find((rule) => rule.selector === ".movil-screen-enter-active");
		const leave = rules(css).find((rule) => rule.selector === ".movil-screen-leave-active");
		expect(enter?.body).toContain("var(--motion-base)");
		expect(leave?.body).toContain("var(--motion-fast)");
	});
});

describe("the value bump's two keyframes exist and are identical", () => {
	// `totalBump.spec.ts` owns the composable's behaviour but runs under jsdom,
	// where a `?raw` import of a `.css` file resolves to an empty string —
	// vitest stubs CSS. So the stylesheet half of that contract is asserted
	// here, in the suite that already reads real files.
	const base = stripComments(TOKENS);
	const CLASSES = ["reg-bump-a", "reg-bump-b"];

	it("gives each class its own animation name", () => {
		// The ping-pong is the entire retrigger mechanism: a CSS animation
		// restarts when `animation-name` changes and at no other time. One
		// shared name would mean the first add pulses and no add after it does.
		for (const className of CLASSES) {
			expect(base).toMatch(new RegExp(`\\.${className}\\s*\\{[^}]*animation-name:\\s*${className}`));
			expect(base).toMatch(new RegExp(`@keyframes\\s+${className}\\s*\\{`));
		}
	});

	it("runs both on the shared duration and curve, and grows 4%", () => {
		expect(base).toMatch(/animation-duration:\s*var\(--motion-base\)/);
		expect(base).toMatch(/animation-timing-function:\s*var\(--ease-out\)/);
		// Identical, or the two names would animate differently and the bump
		// would flicker between two shapes.
		expect(base.match(/transform:\s*scale\(1\.04\)/g) ?? []).toHaveLength(CLASSES.length);
		expect(base.match(/transform:\s*scale\(1\)/g) ?? []).toHaveLength(CLASSES.length);
	});
});

describe("the cajón stops keeping its own vocabulary", () => {
	const css = styleOf("components/pos/shell/drawer/CatalogDrawer.vue");

	it("keeps the composable as the GATE and the token as the fallback", () => {
		// `--catalog-drawer-duration` is 0 for anchored, 0 for inline and 0
		// under reduced motion — the JS is what decides whether the drawer
		// animates at all, and replacing it with a bare token would make an
		// anchored drawer ease its way across the cart.
		expect(css).toMatch(
			/transform var\(--catalog-drawer-duration, var\(--motion-base\)\) var\(--ease-out\)/,
		);
	});

	it("agrees with the JS that drives it", () => {
		const composable = read("composables/pos/shell/useCatalogDrawer.ts");
		expect(composable).toContain("export const CATALOG_DRAWER_OPEN_MS = 200;");
		expect(composable).toContain("export const CATALOG_DRAWER_CLOSE_MS = 120;");

		const tokens = stripComments(TOKENS);
		expect(/--motion-base:\s*(\d+)ms/.exec(tokens)?.[1]).toBe("200");
		expect(/--motion-fast:\s*(\d+)ms/.exec(tokens)?.[1]).toBe("120");
	});
});
