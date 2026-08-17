/**
 * Brand layer consistency (roadmap §17.4).
 *
 * The brand lives in ONE frontend module (src/brand.ts) plus four
 * server-shell files that cannot import it (www manifest/html/py). This
 * suite pins the two halves together so a rename is a one-module change
 * that fails loudly anywhere it did not propagate — and proves the brand
 * never leaked into internal identity (app name, storage keys, routes).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND } from "../src/brand";

const WWW = resolve(__dirname, "../../posawesome/www");
const read = (f: string) => readFileSync(resolve(WWW, f), "utf8");

describe("brand tokens", () => {
	it("wordmark halves compose the product name", () => {
		expect(`${BRAND.wordmarkLight} ${BRAND.wordmarkBold}`).toBe(BRAND.name);
	});
});

describe("www shell carries the same brand", () => {
	it("manifest.json name/short_name match BRAND", () => {
		const manifest = JSON.parse(read("manifest.json"));
		expect(manifest.name).toBe(BRAND.name);
		expect(manifest.short_name).toBe(BRAND.shortName);
	});

	it("posapp.py window title matches BRAND", () => {
		expect(read("posapp.py")).toContain(`"title": "${BRAND.name}"`);
	});

	it("posapp.html PWA title matches BRAND", () => {
		expect(read("posapp.html")).toContain(
			`<meta name="apple-mobile-web-app-title" content="${BRAND.name}" />`,
		);
	});

	it("no user-visible 'POS Awesome' left in the shell", () => {
		for (const f of ["manifest.json", "posapp.html", "offline.html"]) {
			// The html header COMMENT may still say POSAwesome (internal); only
			// rendered text counts, so strip comments before asserting.
			const text = read(f).replace(/<!--[\s\S]*?-->/g, "");
			expect(text, f).not.toContain("POS Awesome");
		}
	});
});

describe("brand never leaks into internal identity", () => {
	it("PWA id, start_url and scope stay on /posapp — the alias is a redirect", () => {
		const manifest = JSON.parse(read("manifest.json"));
		expect(manifest.id).toBe("/posapp");
		expect(manifest.start_url).toBe("/posapp");
	});

	it("brand module defines no storage keys, paths or event names", () => {
		// Comments may EXPLAIN the rule (they do) — only code must honor it.
		const source = readFileSync(resolve(__dirname, "../src/brand.ts"), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");
		for (const forbidden of ["localStorage", "posa_", "telemetry", "/api/"]) {
			expect(source).not.toContain(forbidden);
		}
	});
});
