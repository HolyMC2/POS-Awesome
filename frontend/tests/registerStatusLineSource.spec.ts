/**
 * Source-level guarantees for the register status line.
 *
 * Separate file, node environment, for the reason the plan's §10 records:
 * `node:fs` / `node:url` named imports do not interop under the jsdom
 * environment — `fileURLToPath` comes back undefined. The behavioural half
 * lives in `registerStatusLine.spec.ts`, which mounts and therefore needs
 * jsdom. Splitting them is the repo's existing pattern (see
 * `cartActionBarLayout.spec.ts`).
 *
 * Do NOT write the environment pragma's literal spelling anywhere in this
 * file, not even inside a comment explaining it: vitest scans the whole source
 * for that token and will switch this file to jsdom, reintroducing exactly the
 * failure the comment is describing. Learned the direct way.
 *
 * Both assertions here are negative guarantees — "no such declaration exists" —
 * and a negative can only be proven by scanning, never by mounting.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = (relativePath: string) =>
	fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url));

/** Block and line comments, so a scan tests the code and not its explanation. */
const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const component = readFileSync(
	sourcePath("posapp/components/navbar/RegisterStatusLine.vue"),
	"utf8",
);
const style = component.slice(component.indexOf("<style"));

describe("the strip follows the theme", () => {
	it("declares no literal colour", () => {
		// A1's audit found three shell components painting with literal hex, so
		// that in dark mode the register's own navigation rendered as a light
		// column. Every colour here resolves through a `--pos-*` token, which
		// is what makes the strip flip with the theme for free.
		const literals = [...style.matchAll(/:\s*(#[0-9a-fA-F]{3,8})\s*[;!]/g)].map(
			(m) => m[1],
		);
		expect(literals).toEqual([]);
	});

	it("spends no accent — status is state, never emphasis", () => {
		// Invariant 2: the screen's one saturated colour belongs to the primary
		// action. The strip's tones come from the theme's own state pairs, and
		// `--pos-primary` must not appear here at all.
		expect(style).not.toContain("--pos-primary");
		expect(style).toContain("--pos-button-success-bg");
		expect(style).toContain("--pos-button-warning-bg");
	});
});

describe("the strip costs the app bar no height", () => {
	it("is a flex child of the existing 56px row, not a new row", () => {
		// It REPLACES the icons that already sat on that row. If it ever
		// declares its own height the bar grows and the register loses a strip
		// of cart to a status line, which would invert the point of the change.
		const rootStart = style.indexOf(".register-status-line {");
		expect(rootStart).toBeGreaterThan(-1);
		const rootBlock = style.slice(rootStart, style.indexOf("}", rootStart));
		expect(rootBlock).not.toMatch(/\bheight\s*:/);
		expect(rootBlock).not.toMatch(/\bmin-height\s*:/);
		expect(rootBlock).not.toMatch(/\bpadding(-block)?\s*:/);
		expect(rootBlock).toContain("align-items: center");
	});

	it("lets the identity ellipse rather than push the chips off the end", () => {
		// `min-width: 0` is the load-bearing half — a flex item defaults to
		// `min-width: auto` and refuses to shrink below its content, so a long
		// profile name would shove the connection chip out of the bar.
		expect(style).toMatch(/\.register-status-line\s*\{[^}]*min-width:\s*0/);
		expect(style).toMatch(/\.register-status-line__identity\s*\{[^}]*min-width:\s*0/);
	});
});

describe("derivation stays out of the template", () => {
	const module = readFileSync(
		sourcePath("posapp/components/navbar/registerStatusLine.ts"),
		"utf8",
	);

	it("keeps the pure module free of Vue, stores and i18n", () => {
		// The synced guard has to be reasonable about without mounting a
		// register, and testable without a pinia.
		//
		// Scan the CODE, not the prose. This module names `useOnlineStatus`
		// and `__()` in doc comments to say where its inputs come from and who
		// is expected to translate its output — a naive match would forbid the
		// documentation rather than the dependency. `cartActionBarLayout.spec`
		// strips comments for the same reason.
		const code = stripComments(module);
		const imports = [...code.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map(
			(m) => m[1],
		);
		expect(imports).not.toContain("vue");
		expect(imports.filter((path) => /stores|composables/.test(path ?? ""))).toEqual([]);
		expect(code).not.toMatch(/\b__\(/);
	});

	it("computes the synced claim in the module, not in the markup", () => {
		// If the guard ever moves into a `v-if`, the next person editing the
		// markup can delete it without knowing what it was protecting.
		expect(module).toContain("Online · synced");
		expect(component).not.toContain("Online · synced");
	});
});
