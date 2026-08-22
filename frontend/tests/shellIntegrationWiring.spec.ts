import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The shell's half of Riel y Cajón (roadmap §17.7, docs/POS-RIEL-Y-CAJON-BUILD.md).
 *
 * Wave 1 built the rail, the drawer, the band, the destination host and the
 * mobile overlay as standalone modules, each with its own tests. Every one of
 * them passes whether or not the shell ever mounts it — which is exactly the
 * failure this file guards: a register with a perfect, unmounted rail.
 *
 * Source-level, and therefore in its own file: `Pos.vue` cannot be imported
 * under jsdom without dragging the whole POS stack in, so the repo already
 * scans it this way (`showInvoicePanelWiring`, `changeDueWiring`,
 * `posMobileDockCustomer`, `posShellDrafts`). The behavioural half lives in
 * shellIntegrationShell.spec.ts.
 */

const shell = () =>
	readFileSync(
		fileURLToPath(new URL("../src/posapp/components/pos/shell/Pos.vue", import.meta.url)),
		"utf8",
	);

describe("the shell mounts what wave 1 built", () => {
	it.each([
		["RegisterRail", "./rail/RegisterRail.vue"],
		["CatalogDrawer", "./drawer/CatalogDrawer.vue"],
		["ActionBand", "./band/ActionBand.vue"],
		["DestinationHost", "./destinations/DestinationHost.vue"],
		["MobileOfflineOverlay", "./mobile/MobileOfflineOverlay.vue"],
		["ComboSuggestionStrip", "../combos/ComboSuggestionStrip.vue"],
	])("imports and renders %s", (component, path) => {
		const source = shell();
		expect(source, `${component} must be imported from ${path}`).toContain(
			`import ${component} from "${path}"`,
		);
		expect(source, `${component} must be registered as a component`).toMatch(
			new RegExp(`components:\\s*\\{[\\s\\S]*?\\b${component}\\b`),
		);
		expect(source, `<${component} must appear in the template`).toContain(`<${component}`);
	});

	it("mounts exactly one band", () => {
		// The invariant is "one number, one action". `bandState.ts` guarantees
		// only one CAN be produced; a pure function cannot stop a second band
		// being mounted, and this can.
		expect(shell().match(/<ActionBand\b/g) ?? []).toHaveLength(1);
	});

	/**
	 * The scanner bug, pinned.
	 *
	 * `useScannerInput` attaches the keyboard wedge to the DOCUMENT behind a
	 * `document._scannerAttached` singleton. Unmounting `ItemsSelector` detaches
	 * it; remounting it races the flag — on close, a new instance mounting before
	 * the old one unmounts sees the flag still set and returns early, and then
	 * the old one clears it. The shop's barcode gun stops working and nothing on
	 * screen says so.
	 *
	 * These assertions are worth more than they look: the defect is invisible in
	 * every test that does not have a scanner in the room, and invisible on
	 * screen to whoever ships it.
	 */
	it("mounts exactly one ItemsSelector", () => {
		expect(shell().match(/:is="ItemsView"/g) ?? []).toHaveLength(1);
	});

	it("never puts ItemsView behind a v-if", () => {
		const source = shell();
		const start = source.indexOf(':is="ItemsView"');
		expect(start).toBeGreaterThan(-1);
		const tag = source.slice(source.lastIndexOf("<component", start), source.indexOf("/>", start));
		expect(tag, "ItemsView must not carry a v-if — unmounting it kills the scanner").not.toMatch(
			/\bv-if\b/,
		);
		expect(tag).toContain('header-target="#register-scan-bar"');
		expect(tag).toContain(':show-catalog="catalogDrawer.isOpen.value"');
	});

	it("keeps drawer state out of every v-if", () => {
		// Anything the drawer toggle flips must never gate a `v-if`, or the
		// subtree holding the scanner unmounts on open/close. Checked against the
		// state's every spelling rather than one variable name, so renaming a
		// computed cannot quietly retire this guard.
		const template = shell().slice(0, shell().indexOf("</template>"));
		const conditionals = template.match(/v-if="[^"]*"/g) ?? [];
		const drawerState = /catalogDrawer\.|catalogInDrawer|drawerAnchoredOpen|catalogGridVisible/;
		expect(conditionals.filter((c) => drawerState.test(c))).toEqual([]);
	});

	it("provides #persistent unconditionally", () => {
		// The wrapper inside CatalogDrawer is `v-if="$slots.persistent"`, which is
		// static per call site: a parent that toggled whether it PASSES the slot
		// would re-create the remount this whole arrangement prevents.
		const source = shell();
		expect(source).toContain("<template #persistent>");
		const tpl = source.slice(source.indexOf("<template #persistent"));
		expect(tpl.slice(0, tpl.indexOf(">") + 1)).not.toMatch(/\bv-(if|else)\b/);
	});

	it("mounts CatalogDrawer unconditionally", () => {
		const source = shell();
		const tag = source.slice(source.indexOf("<CatalogDrawer"), source.indexOf(">", source.indexOf("<CatalogDrawer")));
		expect(tag, "a v-if on the drawer defeats the persistent slot").not.toMatch(/\bv-if\b/);
	});

	it("takes the @opened hook rather than guessing a timeout", () => {
		// A virtualised grid measures zero height while `display: none`; this is
		// the moment the drawer names for re-measuring, and a `setTimeout` here
		// would be a guess that breaks on a slow device.
		const source = shell();
		expect(source).toContain('@opened="onDrawerOpened"');
		expect(source).toContain("const onDrawerOpened =");
	});

	it("puts the drawer inside the row, where an anchored panel can sit beside the cart", () => {
		// Anchored presentation is "a plain flex sibling of the cart, inside the
		// content row". Below the row it would stack under the cart, because the
		// content wrapper is a flex COLUMN.
		const source = shell();
		const rowStart = source.indexOf('class="ma-0 dynamic-main-row"');
		const rowEnd = source.indexOf("</v-row>", rowStart);
		expect(source.indexOf("<CatalogDrawer")).toBeGreaterThan(rowStart);
		expect(source.indexOf("<CatalogDrawer")).toBeLessThan(rowEnd);
	});

	it("gives the row a positioning context for the overlay", () => {
		// The overlay is `position: absolute`, never `fixed`, so the band stays
		// reachable — which is only true with a positioned ancestor here.
		// Matched across every `.dynamic-main-row {` block, not just the first —
		// the first one in the file is the viewport-lock rule inside the
		// >=1100px media query, and the overlay must be contained at every width.
		const blocks = [...shell().matchAll(/\.dynamic-main-row\s*\{([^}]*)\}/g)].map((m) => m[1]);
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks.some((b) => /position:\s*relative/.test(b))).toBe(true);
	});

	it("lets the cart shrink only while an anchored drawer is open", () => {
		// `cols="12"` is `flex: 0 0 100%` and cannot shrink; without the modifier
		// the row overflows by exactly the drawer's width. Closed, the cart keeps
		// the whole row — the density argument for direction E.
		const source = shell();
		expect(source).toContain("'dynamic-main-row--with-drawer': drawerAnchoredOpen");
		expect(source).toContain(".dynamic-main-row--with-drawer .dynamic-col--invoice");
	});


	it("gives the drawer overlay a positioned ancestor", () => {
		// The overlay is `position: absolute` so the band below stays visible.
		// Without this the drawer escapes to the viewport and covers the one
		// number that matters.
		const content = shell().slice(shell().indexOf(".register-shell__content"));
		expect(content.slice(0, 600)).toContain("position: relative");
	});
});

describe("the shell keeps one answer to 'where am I'", () => {
	it.each(["open_destination", "toggle_catalog_drawer"])(
		"listens for %s and releases it on unmount",
		(event) => {
			const source = shell();
			expect(source, `Pos.vue must listen for "${event}"`).toMatch(
				new RegExp(`eventBus\\.on\\("${event}"`),
			);
			expect(source, `Pos.vue must stop listening for "${event}"`).toMatch(
				new RegExp(`eventBus\\.off\\("${event}"`),
			);
		},
	);

	it("routes the rail through the destination router, not a second state", () => {
		const source = shell();
		expect(source).toContain("useDestinationRouting");
		// The rail's navigate callback and the bus handler must both go through
		// `activate` — two writers to one ref is the whole point.
		expect(source.match(/destinationRouting\.activate\(/g) ?? []).not.toHaveLength(0);
	});
});

describe("the dock", () => {
	it("wires the serviceOrder badge count", () => {
		// `DockTabContext` declares it required, but Pos.vue's script is plain
		// JS: an unwired shell sails past vue-tsc and only fails at the counter,
		// on the one preset that names the tab.
		expect(shell()).toContain("serviceOrderOpenCount,");
	});

	it("stamps a testid on every tab from the tab's own id", () => {
		// Derived, never hand-listed: a seventh tab must not need a seventh edit
		// here or in the evidence lane.
		expect(shell()).toContain(`:data-testid="'dock-' + tab.id"`);
		expect(shell()).toContain('data-testid="mobile-dock"');
	});

	it("dims what needs signal instead of removing it", () => {
		expect(shell()).toContain("isDockTabDimmedOffline(tab, isOnline)");
	});
});
