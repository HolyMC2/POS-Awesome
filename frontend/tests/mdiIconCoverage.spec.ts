import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { aliases as vuetifyMdiAliases } from "vuetify/iconsets/mdi";

import { KNOWN_MISSING_ICONS } from "../src/posapp/plugins/icons";
import { mdiIconPaths } from "../src/posapp/plugins/icons/mdiIconPaths";

// The app no longer ships the @mdi/font webfont, so an icon only renders if its
// path is in `mdiIconPaths`. A missing entry is invisible at runtime — the icon
// just draws nothing — which is exactly the failure a font-to-SVG swap invites
// months later when someone adds `mdi-whatever` to a template. This test
// re-derives the inventory from source so that mistake fails here instead.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

// Keep in sync with the generator that writes mdiIconPaths.ts
const SCAN_EXTENSIONS = [".vue", ".ts", ".js"];
const ICON_TOKEN = /(?<![\w-])mdi-[a-z0-9]+(?:-[a-z0-9]+)*/g;
// The generated map lists every name; scanning it would make this test
// self-satisfying.
const SCAN_EXCLUDE = path.join(SRC, "posapp/plugins/icons");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (full === SCAN_EXCLUDE) continue;
		if (entry.isDirectory()) collectSourceFiles(full, out);
		else if (SCAN_EXTENSIONS.includes(path.extname(full))) out.push(full);
	}
	return out;
}

function collectIconReferences(): Map<string, string[]> {
	const refs = new Map<string, string[]>();
	for (const file of collectSourceFiles(SRC)) {
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, index) => {
				for (const match of line.matchAll(ICON_TOKEN)) {
					const where = `${path.relative(SRC, file)}:${index + 1}`;
					refs.set(match[0], [...(refs.get(match[0]) ?? []), where]);
				}
			});
	}
	return refs;
}

describe("mdi icon coverage", () => {
	const references = collectIconReferences();

	it("finds icon references to check", () => {
		// Guards the scanner itself: a broken glob or regex would otherwise
		// make every assertion below pass vacuously.
		expect(references.size).toBeGreaterThan(100);
	});

	it("has a path for every mdi- icon referenced in src", () => {
		const unmapped = [...references.entries()]
			.filter(([icon]) => !(icon in mdiIconPaths))
			.filter(([icon]) => !(KNOWN_MISSING_ICONS as readonly string[]).includes(icon))
			.map(([icon, where]) => `${icon} (${where.join(", ")})`);

		expect(
			unmapped,
			"Icons referenced in src with no entry in mdiIconPaths.ts — they would " +
				"render blank. Add the @mdi/js path for each.",
		).toEqual([]);
	});

	it("has a path for every icon Vuetify's own components resolve through aliases", () => {
		// $dropdown, $checkboxOn, $sortAsc … resolve to `mdi-*` names and go
		// through the same set. A Vuetify upgrade that adds an alias would
		// otherwise blank out a built-in control with no reference in our src.
		const aliasTargets = [
			...new Set(Object.values(vuetifyMdiAliases).filter((v): v is string => typeof v === "string")),
		];
		const unmapped = aliasTargets.filter((icon) => !(icon in mdiIconPaths));

		expect(unmapped, "Vuetify alias targets missing from mdiIconPaths.ts").toEqual([]);
		expect(aliasTargets.length).toBeGreaterThan(50);
	});

	it("maps every name to a non-empty SVG path", () => {
		const bad = Object.entries(mdiIconPaths)
			.filter(([, d]) => typeof d !== "string" || d.trim() === "")
			.map(([icon]) => icon);

		expect(bad, "Entries resolving to an empty path render an empty <path d>").toEqual([]);
	});

	it("does not carry paths for icons nothing references", () => {
		// The whole point of the swap is shipping only what is used; an entry
		// left behind after its last template reference disappeared is dead
		// weight in the bundle.
		const aliasTargets = new Set(
			Object.values(vuetifyMdiAliases).filter((v): v is string => typeof v === "string"),
		);
		const orphans = Object.keys(mdiIconPaths).filter(
			(icon) => !references.has(icon) && !aliasTargets.has(icon),
		);

		expect(orphans, "Unreferenced entries in mdiIconPaths.ts — regenerate the map").toEqual([]);
	});

	it("quarantines nothing — a blank icon is a bug to fix, not a state to record", () => {
		// Three references (mdi-cart-search, mdi-link-wrench,
		// mdi-receipt-text-multiple) named glyphs that never existed in MDI, so
		// they drew nothing under the webfont too. They were repointed at real
		// icons rather than parked here. Looping over the list instead of
		// asserting it is empty would pass vacuously and let a future blank icon
		// be silenced by adding a line — which is the thing worth preventing.
		expect(
			KNOWN_MISSING_ICONS,
			"Quarantining an icon hides it from the coverage check above. Fix the " +
				"call site to reference a glyph that exists instead.",
		).toEqual([]);
	});

	it("resolves every quarantined name that does exist after all", () => {
		// Guard for a repopulated list: an entry that @mdi/js actually provides
		// is a stale exemption and should go back through the generated map.
		for (const icon of KNOWN_MISSING_ICONS) {
			expect(mdiIconPaths, `${icon} exists now — drop it from KNOWN_MISSING_ICONS`).not.toHaveProperty(
				icon,
			);
		}
	});
});
