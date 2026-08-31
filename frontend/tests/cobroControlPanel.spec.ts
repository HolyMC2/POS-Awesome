/**
 * Cobro is ONE control panel — the mandate, as a build failure.
 *
 * Owner, 2026-08-23, on the hosted payment screen: «still wrong, why so many
 * scrolls? it has to feel like one coherent ops control panel, uniform and
 * everything correctly positioned and sized». The round before had answered
 * "the screen is too tall" with a scrollport per column, and the screenshot
 * showed what that costs: an amount field clipped in half, the numpad's
 * «4 5 6» row cut through the middle, and a third scrollbar to reach the
 * payment methods.
 *
 * So the property is stated here rather than left to a reviewer's eye:
 *
 *   1. NOTHING in the Cobro columns scrolls except the ticket's line list.
 *   2. The panel is bounded by its box and ONE region gives — the pad.
 *   3. A method is ONE LINE, whatever it is called.
 *
 * ## Why a source scan, and why the file list is derived
 *
 * Only a scan can prove a negative ("no such declaration exists"), which is
 * the same reasoning `singleAccent.spec.ts` and `registerShellTranslations`
 * give. And the file list is FOLLOWED from the imports rather than written
 * down: a hand-kept list of "the files Cobro mounts" is the scope that goes
 * stale six times over in this repo's history, and a component added to a
 * column tomorrow has to be in scope the moment it is added.
 *
 * No jsdom — this reads real files, and jsdom shims `node:fs`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src/posapp");
const PAYMENTS = resolve(SRC, "components/pos/Payments.vue");

const read = (file: string) => readFileSync(file, "utf8");
const key = (file: string) => relative(SRC, file).split("\\").join("/");

/**
 * Every `.vue` reachable from a starting file by relative import, followed
 * transitively. Bare specifiers (`vue`, `pinia`) and `.ts` modules are not
 * followed: this scan is about what the columns DRAW.
 */
const componentGraph = (entries: readonly string[]): string[] => {
	const seen = new Set<string>();
	const queue = [...entries];
	while (queue.length) {
		const file = queue.shift()!;
		if (seen.has(file) || !existsSync(file)) continue;
		seen.add(file);
		for (const match of read(file).matchAll(/from\s+"(\.[^"]+\.vue)"/g)) {
			queue.push(resolve(dirname(file), match[1]));
		}
	}
	return [...seen];
};

/** The three columns, from the components `Payments.vue` mounts under cobro. */
const COBRO_ROOTS = [
	"components/pos/payments/cobro/CobroTenderPad.vue",
	"components/pos/payments/cobro/CobroMethodRows.vue",
	"components/pos/payments/cobro/CobroTotalsFooter.vue",
	"components/pos/payments/cobro/CobroOnClose.vue",
	"components/pos/payments/cobro/CobroChangeCard.vue",
	// Column one's ticket card. Not under `cobro/` because the dialog and the
	// phone sheet draw it too — which is exactly why it is followed rather
	// than assumed.
	"components/pos/payments/PaymentSaleSummary.vue",
].map((path) => resolve(SRC, path));

const COBRO_FILES = componentGraph(COBRO_ROOTS);

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
	file: string;
	selector: string;
	body: string;
}

/** Flat `selector { body }` pairs; at-rule blocks are unwrapped, not treated
 *  as one selector. */
const rulesIn = (css: string, file: string): Rule[] => {
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
					let d = 0;
					for (let j = i; j < css.length; j += 1) {
						if (css[j] === "{") d += 1;
						else if (css[j] === "}") {
							d -= 1;
							if (d === 0) {
								found.push(...rulesIn(css.slice(i + 1, j), file));
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
				found.push({
					file,
					selector: css.slice(selectorStart, start - 1).trim(),
					body: css.slice(start, i),
				});
				selectorStart = i + 1;
			}
		}
	}
	return found;
};

const stylesOf = (file: string) =>
	stripComments(
		[...read(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
	);

const rulesOf = (file: string) => rulesIn(stylesOf(file), file);

/**
 * A declaration that makes an element a SCROLLPORT. `overflow: hidden` is
 * clipping and `text-overflow: ellipsis` is neither, so the property name is
 * matched exactly and only scrolling values count.
 */
const scrollports = (rules: readonly Rule[]) =>
	rules.filter(({ body }) =>
		body
			.split(";")
			.map((declaration) => declaration.trim())
			.some((declaration) => /^overflow(-[xy])?\s*:\s*(auto|scroll)\b/.test(declaration)),
	);

describe("nothing in the Cobro columns scrolls except the ticket's lines", () => {
	it("follows the columns rather than a list somebody remembered", () => {
		// A scan over the six roots alone would miss `ChangeToHand` and
		// `PayKeypad`, which are where the outcome column and the pad actually
		// live — and those are the two the previous round bounded wrongly.
		const reached = COBRO_FILES.map(key);
		for (const path of [
			"components/pos/mobile/pay/ChangeToHand.vue",
			"components/pos/mobile/pay/PayKeypad.vue",
		]) {
			expect(reached, `${path} is outside the walk`).toContain(path);
		}
		expect(COBRO_FILES.length).toBeGreaterThanOrEqual(7);
	});

	it("declares exactly one scrollport across all of them", () => {
		const found = COBRO_FILES.flatMap((file) => scrollports(rulesOf(file))).map(
			(rule) => `${key(rule.file)} ${rule.selector}`,
		);
		// The ticket's line list, and nothing else. A fifty-line ticket has no
		// other honest answer; every other region on this surface is sized to
		// its content or gives its slack to the pad.
		expect(found).toEqual(["components/pos/payments/PaymentSaleSummary.vue .pay-summary__lines"]);
	});

	it("gives no Cobro section a scrollport in the shell's own stylesheet", () => {
		// The GRID and its sections. `.payment-scroll--*` is the surface, which
		// the next case takes: the defect being pinned here is a COLUMN that
		// scrolls inside its cell.
		const sections = rulesOf(PAYMENTS).filter((rule) =>
			rule.selector.includes("payment-sections--cobro"),
		);
		expect(sections.length, "the cobro block vanished from Payments.vue").toBeGreaterThan(5);
		expect(
			scrollports(sections).map((rule) => rule.selector),
			"a column that scrolls inside its cell is the round-two defect",
		).toEqual([]);
	});

	it("keeps the surface itself unscrolled until the tail unfolds", () => {
		const byName = (selector: string) =>
			rulesOf(PAYMENTS).find((rule) => rule.selector === selector)?.body ?? "";
		expect(byName(".payment-scroll--cobro")).toMatch(/overflow:\s*hidden/);
		// `--flow` is the disclosure open: ONE scrollport for the whole surface,
		// never one per column, and only while the cashier asked for the fields
		// behind it. The band lives in the shell, outside this box.
		expect(byName(".payment-scroll--flow")).toMatch(/overflow-y:\s*auto/);
		expect(read(PAYMENTS)).toContain("'payment-scroll--flow': cobroMode && cobroDetailsExpanded");
	});
});

describe("the pad is the region that gives", () => {
	const pad = resolve(SRC, "components/pos/payments/cobro/CobroTenderPad.vue");

	it("fills the height its column was given", () => {
		const rules = rulesOf(pad);
		const card = rules.find((rule) => rule.selector === ".cobro-pad")?.body ?? "";
		expect(card, "the card must not grow past its cell").toMatch(/min-height:\s*0/);
		// `flex`, never `height: 100%`: a percentage height resolves against the
		// section and ignores the `Al cerrar` caption beside it, which makes the
		// card exactly one caption taller than the cell it sits in.
		expect(card).toMatch(/flex:\s*1 1 auto/);
		expect(card).not.toMatch(/height:\s*100%/);

		const stretch = rules.find((rule) => rule.selector === ".cobro-pad__pad")?.body ?? "";
		expect(stretch).toMatch(/flex:\s*1 1 auto/);
		expect(stretch).toMatch(/min-height:\s*0/);
	});

	it("hands the slack to the keys instead of to a scrollbar", () => {
		const rules = rulesOf(pad);
		const grid =
			rules.find((rule) => rule.selector.includes(".pay-keypad__grid"))?.body ?? "";
		// `1fr` rows with NO FLOOR. A floor is a promise the column cannot keep
		// — a register with four tenders has less room than one with two, and
		// the moment the floor exceeds what is left the bottom row of keys
		// disappears inside an `overflow: hidden` box.
		expect(grid).toMatch(/grid-auto-rows:\s*minmax\(0,\s*1fr\)/);
		expect(grid).toMatch(/flex:\s*1 1 auto/);

		const keyRule = rules.find((rule) => rule.selector.includes(".pay-keypad__key"))?.body ?? "";
		expect(keyRule).toMatch(/height:\s*100%/);
		expect(
			keyRule,
			"the phone's 44px floor would stop the grid sharing its height",
		).toMatch(/min-height:\s*0/);
	});

	it("leaves the phone's keypad exactly as it was", () => {
		// The elasticity is `:deep()` from the Cobro card, so `PayKeypad` itself
		// keeps the 44px touch minimum every other screen relies on.
		const keypad = resolve(SRC, "components/pos/mobile/pay/PayKeypad.vue");
		const key = rulesOf(keypad).find((rule) => rule.selector === ".pay-keypad__key")?.body ?? "";
		expect(key).toMatch(/min-height:\s*var\(--reg-touch-min, 44px\)/);
	});
});

describe("a method is one line", () => {
	const methods = resolve(SRC, "components/pos/payments/cobro/CobroMethodRows.vue");
	const source = () => read(methods);

	it("gives the row a fixed height, so a longer name cannot grow the column", () => {
		const row = rulesOf(methods).find((rule) => rule.selector === ".cobro-methods__row")?.body ?? "";
		expect(row).toMatch(/display:\s*flex/);
		expect(row).toMatch(/height:\s*var\(--reg-touch-min, 44px\)/);
		expect(row, "a column direction is a card again").not.toMatch(/flex-direction:\s*column/);
		// The name truncates rather than wrapping — the row is the thing that
		// must not change height.
		const name = rulesOf(methods).find((rule) => rule.selector === ".cobro-methods__name")?.body ?? "";
		expect(name).toMatch(/white-space:\s*nowrap/);
		expect(name).toMatch(/text-overflow:\s*ellipsis/);
	});

	it("draws one row per configured method and no card chrome", () => {
		expect(source()).toMatch(/v-for="payment in rows"[\s\S]{0,200}class="cobro-methods__row"/);
		// The eyebrow, the h4 and the full-width button carrying the method's
		// own name a second time are what made the card a card.
		expect(source()).not.toContain("payment-method-card");
		expect(source()).not.toContain("<h4");
	});

	it("is ONE ROW of chips, and tightens only when the SCREEN is short", () => {
		// 2026-08-30. The stacked list was three 44px lines inside a card with
		// a heading — ~190px of the one column that also holds the numpad, and
		// on Marco's iPad (1195×741) the gift block under it ran off the bottom
		// of the surface. `Cobro.dc.html` draws `Forma de pago` as a ROW; this
		// is that row.
		const list = rulesOf(methods).find((rule) => rule.selector === ".cobro-methods__list")?.body ?? "";
		expect(list).toMatch(/display:\s*flex/);
		expect(list).toMatch(/flex-wrap:\s*wrap/);
		expect(list, "a stacked grid is the card list again").not.toMatch(/grid-template-columns/);

		// A HEIGHT query, and the assertion is that it is a height query: a
		// width query here would abbreviate `Transferencia` on a wide screen
		// that had all the room in the world. What the short-screen rule
		// tightens changed with the row; that it is a height rule did not.
		const style = stylesOf(methods);
		const media = /@media \(max-height: (\d+)px\)\s*\{([\s\S]*?)\n\}/.exec(style);
		expect(media, "no short-screen rule").not.toBeNull();
		expect(Number(media![1])).toBeLessThan(900);
		expect(media![2]).toMatch(/\.cobro-methods__(list|pick)/);
		expect(style).not.toMatch(/@media \(max-width[^)]*\)\s*\{[\s\S]*?\.cobro-methods/);
	});

	it("opens Cobro on a BUTTON, so the tablet keyboard stays down", () => {
		// Owner, 2026-08-30: «it opened the keyboard, which breaks the
		// numberpad we have on the center for touch screens».
		// `focusFirstPaymentTarget` focuses the first `payment-amount` OR
		// `payment-action` inside the payment root when the surface opens —
		// with an amount `<input>` on every method row that was a text field,
		// and iPadOS raised its keyboard over the pad the register had just
		// drawn. A chip is a `payment-action`: focusing it moves the ring and
		// nothing else, and the amount is keyed on the pad.
		expect(source()).toContain('data-pos-keyboard-target="payment-action"');
		expect(source(), "an amount input here is the keyboard defect").not.toContain(
			'data-pos-keyboard-target="payment-amount"',
		);
		// Comments stripped: this file EXPLAINS the input it no longer draws,
		// and the explanation is the reason the rule survives the next round.
		const markup = source()
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(markup, "no text field on the chip row at all").not.toMatch(/<input/);
		expect(read(PAYMENTS)).toContain(
			"\"[data-pos-keyboard-target='payment-amount'], [data-pos-keyboard-target='payment-action']\"",
		);
	});

	it("emits nothing `PaymentMethods` does not already emit", () => {
		// A new event here would be a new seam on the money path. The list is
		// read off the card's own `defineEmits` so the two cannot drift.
		const cardEmits = /defineEmits\(\[([\s\S]*?)\]\)/.exec(
			read(resolve(SRC, "components/pos/payments/PaymentMethods.vue")),
		);
		const rowEmits = /defineEmits\(\[([\s\S]*?)\]\)/.exec(source());
		expect(cardEmits && rowEmits).toBeTruthy();
		const names = (block: string) => [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
		expect(names(rowEmits![1])).toEqual(names(cardEmits![1]));
	});
});

describe("the panel is one grid, uniform across its columns", () => {
	it("places every section it renders, so none is auto-placed", () => {
		const css = stylesOf(PAYMENTS);
		for (const area of [
			"readiness",
			"summary",
			"tender",
			"methods",
			"paper",
			"tip",
			"adjustments",
			"settlement",
			"meta",
		]) {
			expect(css, `nothing assigns grid-area: ${area} under --cobro`).toMatch(
				new RegExp(`\\.payment-sections--cobro[^{]*\\{\\s*grid-area: ${area};`),
			);
		}
	});

	it("reads WHY · HOW · PAPER in both the folded and the unfolded shape", () => {
		const areasOf = (selector: string) => {
			const body = rulesOf(PAYMENTS).find((rule) => rule.selector === selector)?.body ?? "";
			return (/grid-template-areas:([\s\S]*?);/.exec(body)?.[1] ?? "")
				.split("\n")
				.map((row) => row.replace(/"/g, "").trim())
				.filter(Boolean);
		};
		for (const selector of [".payment-sections--cobro", ".payment-sections--cobro-lean"]) {
			const areas = areasOf(selector);
			expect(areas[0], selector).toBe("readiness readiness readiness");
			// Column two is two stacked cards — the tender CHIPS, then the pad
			// they aim — while the ticket and the outcome span both. That order
			// flipped on 2026-08-30: `Cobro.dc.html` puts `Forma de pago` above
			// `Recibido en efectivo`, because a cashier picks the tender and
			// then counts it, and the surface read it backwards.
			expect(areas[1], selector).toBe("summary methods paper");
			expect(areas[2], selector).toBe("summary tender paper");
		}
	});

	it("animates nothing a compositor cannot do on its own", () => {
		// The same budget `compactPanelSwitchInstant.spec.ts` holds over the
		// shell: a panel that eases its layout for 300ms reads as a flicker.
		//
		// `transition: all` is banned across every file this surface draws,
		// because `all` covers layout without saying so. The 150ms CEILING is
		// held over the Cobro components and the cobro-scoped rules only —
		// `.payment-disclosure`'s 180ms hover fade is shared with the phone
		// sheet, predates this work and is a paint, so tightening it would
		// change a path this round promised not to touch.
		const cobroRules = [
			...COBRO_FILES.flatMap(rulesOf),
			...rulesOf(PAYMENTS).filter((rule) => rule.selector.includes("--cobro")),
		];
		for (const file of [PAYMENTS, ...COBRO_FILES]) {
			for (const rule of rulesOf(file)) {
				expect(rule.body, `${key(file)} ${rule.selector}`).not.toMatch(/transition:\s*all\b/);
			}
		}
		for (const rule of cobroRules) {
			for (const match of rule.body.matchAll(/(\d+(?:\.\d+)?)(m?s)\b/g)) {
				const ms = match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
				expect(ms, `${key(rule.file)} ${rule.selector}`).toBeLessThanOrEqual(150);
			}
		}
	});
});
