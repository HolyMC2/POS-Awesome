/**
 * Every operator-facing string in the register shell has Spanish, as a build
 * failure rather than a promise (docs/POS-RIEL-Y-CAJON-BUILD.md §7).
 *
 * These tenants run in Spanish. A missing row in `es.csv` does not throw and
 * does not warn — Frappe's `__()` silently returns the English source, so an
 * untranslated string ships to a Mexican counter looking exactly like a
 * deliberate choice. Nothing catches that except a scan, which is why this
 * exists and why it reads real files rather than mounting anything (the same
 * reasoning as tests/singleAccent.spec.ts and tests/priceCheckReadOnly.spec.ts:
 * the guarantee is about the whole source tree, not about one render).
 *
 * Scope is the wave's own surfaces plus `shortcuts/actions.ts`. It is
 * deliberately NOT the whole repo: a great deal of older POSAwesome has never
 * been translated, and a suite that fails on 400 inherited strings gets
 * skipped within a week. Widen the list when a surface is brought up to
 * standard, never by lowering the bar here.
 *
 * No jsdom — this reads real files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../..");
const SRC = resolve(__dirname, "../src/posapp");
const ES_CSV = resolve(REPO, "posawesome/translations/es.csv");

/**
 * Directories whose strings this suite guarantees. Every entry is a surface
 * built for the Riel y Cajón wave, so all of it starts life translated.
 */
const SCANNED_DIRS = [
	"components/pos/shell/rail",
	"components/pos/shell/drawer",
	"components/pos/shell/band",
	"components/pos/shell/destinations",
	"components/pos/shell/mobile",
	"components/pos/combos",
	"composables/pos/shell",
	"composables/pos/combos",
	// `items/` joined the list once the scan bar became a first-class register
	// surface — it is teleported onto the sale screen, so its strings are read
	// on every sale. Same argument that put `shortcuts/actions.ts` in
	// SCANNED_FILES after the entire cheat sheet turned out to be untranslated:
	// a directory outside the scan ships English silently.
	"components/pos/items",
	"composables/pos/items",
];

/**
 * `shortcuts/actions.ts` holds ENGLISH source labels on purpose — the module
 * stays import-free of the i18n global so it can be reasoned about in tests
 * and on the server later, and the cheat sheet wraps them in `__()` at render.
 * That indirection is exactly why it needs scanning: nothing in the file looks
 * like a translatable string, and the whole set had in fact never been
 * translated until this wave.
 */
const SCANNED_FILES = ["shortcuts/actions.ts"];

/**
 * Keys that carry a translatable value. `labelKey` and `hint` are the
 * registries' way of naming a string without importing `__()`; `label` is
 * `actions.ts`'s.
 */
const KEYED = /(?:labelKey|label|hint)\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * `__("…")` and the injected `t("…")`. DestinationHost.vue takes its
 * translator as a prop rather than reaching for the global, so a scan that
 * only looked for `__(` would have missed every refusal message on it — the
 * strings an operator sees precisely when something has gone wrong.
 */
const CALLED = [
	/__\(\s*"((?:[^"\\]|\\.)*)"/g,
	/__\(\s*'((?:[^'\\]|\\.)*)'/g,
	/(?<![\w.])(?:props\.)?t\(\s*"((?:[^"\\]|\\.)*)"/g,
];

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((entry) => {
		const full = resolve(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
}

function sourceFiles(): string[] {
	const fromDirs = SCANNED_DIRS.flatMap((d) => walk(resolve(SRC, d)));
	const fromFiles = SCANNED_FILES.map((f) => resolve(SRC, f)).filter(existsSync);
	return [...fromDirs, ...fromFiles].filter((f) => /\.(vue|ts)$/.test(f));
}

function extract(text: string): string[] {
	const out: string[] = [];
	for (const pattern of [KEYED, ...CALLED]) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			const value = match[1];
			if (value && value.trim()) out.push(value);
		}
	}
	return out;
}

/**
 * Minimal CSV read: two columns, values may be quoted when they contain a
 * comma. Deliberately not a dependency — this suite must keep working if the
 * translation pipeline changes shape around it.
 */
function translatedSources(): Set<string> {
	const rows = readFileSync(ES_CSV, "utf8").split(/\r?\n/);
	const sources = new Set<string>();
	for (const row of rows) {
		if (!row.trim()) continue;
		let source: string;
		if (row.startsWith('"')) {
			const end = row.indexOf('",');
			if (end === -1) continue;
			source = row.slice(1, end).replace(/""/g, '"');
		} else {
			const comma = row.indexOf(",");
			if (comma === -1) continue;
			source = row.slice(0, comma);
		}
		sources.add(source);
	}
	return sources;
}

describe("register shell translations", () => {
	const files = sourceFiles();
	const translated = translatedSources();

	it("scans the surfaces it claims to", () => {
		// A scan that silently found nothing would pass every other assertion
		// here forever. Pin the shape so a moved directory fails loudly.
		expect(files.length).toBeGreaterThanOrEqual(15);
		expect(files.some((f) => f.endsWith("actions.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("bandState.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("DestinationHost.vue"))).toBe(true);
	});

	it("every operator-facing string has a Spanish row", () => {
		const missing = new Map<string, string[]>();
		for (const file of files) {
			for (const value of extract(readFileSync(file, "utf8"))) {
				if (translated.has(value)) continue;
				const short = file.slice(file.indexOf("posapp/") + 7);
				missing.set(value, [...(missing.get(value) ?? []), short]);
			}
		}
		const report = [...missing.entries()]
			.map(([value, where]) => `  "${value}"  ← ${[...new Set(where)].join(", ")}`)
			.join("\n");
		expect(missing.size, `untranslated strings:\n${report}`).toBe(0);
	});

	it("placeholders survive translation", () => {
		// A Spanish sentence reorders its clauses, and a translator dropping
		// `{0}` produces a band that reads "Total a cobrar ·" with no number.
		const rows = readFileSync(ES_CSV, "utf8").split(/\r?\n/);
		const broken: string[] = [];
		for (const file of files) {
			for (const value of extract(readFileSync(file, "utf8"))) {
				const wanted = value.match(/\{\d\}/g);
				if (!wanted) continue;
				const row = rows.find((r) => r.startsWith(value + ",") || r.startsWith(`"${value}"`));
				if (!row) continue;
				for (const token of new Set(wanted)) {
					if (!row.slice(value.length).includes(token)) broken.push(`${value} → missing ${token}`);
				}
			}
		}
		expect(broken, broken.join("\n")).toEqual([]);
	});
});
