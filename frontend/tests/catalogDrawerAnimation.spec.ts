/**
 * The cajón's performance contract, source-scanned (roadmap §6, §17.7).
 *
 * "Snappy" is a budget, not an adjective. A drawer that animates `width` or
 * `left` costs a layout + paint on every frame of every open, on the ordinary
 * Android hardware §6 budgets for — and it does it silently, because it still
 * looks correct. So the guarantee is stated as "no such declaration exists"
 * and checked against the file, not against a rendered frame: a future edit
 * that reaches for `width` fails here instead of quietly costing frames.
 *
 * No jsdom: this reads real files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DRAWER = resolve(
	__dirname,
	"../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue",
);
const SOURCE = readFileSync(DRAWER, "utf8");

const STYLE_BLOCK = SOURCE.slice(SOURCE.indexOf("<style"), SOURCE.lastIndexOf("</style>"));

/** Everything a compositor cannot do on its own — animating any of these reflows. */
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

function splitTopLevel(value: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of value) {
		if (char === "(") {
			depth += 1;
		} else if (char === ")") {
			depth -= 1;
		}
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

/**
 * Every `transition` shorthand/longhand value in the stylesheet, normalised to
 * the property names it names.
 */
function transitionedProperties(css: string): string[] {
	const declarations = [...css.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)[;}]/g)].map(
		(match) => match[1]!,
	);

	const properties: string[] = [];
	for (const declaration of declarations) {
		// Split on commas at paren depth 0 only. `var(--x, 180ms)` and
		// `cubic-bezier(.2, 0, 0, 1)` both carry commas that do NOT separate
		// transitions, and a naive split reads "180ms)" as a property name.
		for (const segment of splitTopLevel(declaration)) {
			const first = segment.trim().split(/\s+/)[0];
			if (first && first !== "none") {
				properties.push(first);
			}
		}
	}
	return properties;
}

describe("the drawer animates on the compositor or not at all", () => {
	it("transitions only transform and opacity", () => {
		const properties = transitionedProperties(STYLE_BLOCK);
		expect(properties.length).toBeGreaterThan(0);

		for (const property of properties) {
			expect(
				["transform", "opacity"],
				`transition on "${property}" would reflow every frame — animate transform/opacity instead`,
			).toContain(property);
		}
	});

	it("never names a layout property in a transition", () => {
		const properties = transitionedProperties(STYLE_BLOCK);
		for (const layoutProperty of LAYOUT_PROPERTIES) {
			expect(properties, `"${layoutProperty}" must never be transitioned`).not.toContain(
				layoutProperty,
			);
		}
	});

	it("uses `all` nowhere, since `all` silently includes the layout properties", () => {
		expect(transitionedProperties(STYLE_BLOCK)).not.toContain("all");
	});

	it("honours prefers-reduced-motion", () => {
		expect(STYLE_BLOCK).toContain("prefers-reduced-motion");
		const reducedBlock = STYLE_BLOCK.slice(STYLE_BLOCK.indexOf("prefers-reduced-motion"));
		expect(reducedBlock).toContain("transition: none");
	});

	it("keeps the overlay out of the band's way by staying in the row, not the viewport", () => {
		// `position: fixed` would put the drawer over the total band, and the
		// artboard is explicit that "the drawer never reaches it".
		expect(STYLE_BLOCK).not.toMatch(/position:\s*fixed/);
		expect(STYLE_BLOCK).toMatch(/\.catalog-drawer-layer--overlay\s*\{[^}]*position:\s*absolute/);
	});
});

describe("the drawer hosts the selector rather than re-implementing it", () => {
	it("slots its body instead of importing ItemsSelector", () => {
		// ItemsSelector owns the search, the virtual scroller and the height
		// chain from commit 59c5fe1ad. A second copy of any of that would drift.
		// Scanned as "does not IMPORT or RENDER it" rather than "never mentions
		// it" — the header comment names it on purpose, and that is documentation.
		expect(SOURCE).not.toMatch(/import\s+[^;]*ItemsSelector/);
		expect(SOURCE).not.toMatch(/<ItemsSelector/);
		expect(SOURCE).toMatch(/<slot\s*><\/slot>/);
	});

	it("declares no item, cart or catalogue fetching of its own", () => {
		for (const forbidden of ["itemService", "get_items", "add_item", "invoiceStore"]) {
			expect(SOURCE, `the drawer is a frame; it must not reference ${forbidden}`).not.toContain(
				forbidden,
			);
		}
	});
});
