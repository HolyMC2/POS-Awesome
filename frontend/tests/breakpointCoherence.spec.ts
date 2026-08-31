// Single source of truth for the responsive boundaries (systemic S3 / LAYOUT-F2).
// The register partitions width with a strict `< N` in JS, so a CSS `@media
// (max-width: Npx)` on the SAME boundary must use `N - 0.02` — otherwise it also
// fires at exactly N (iPad portrait = 768, an exactly-600px window) and the CSS
// disagrees with the JS at that width. This guards both halves: the composables
// read BREAKPOINTS, and no component CSS uses a canonical integer boundary.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { BREAKPOINTS, CSS_MAX } from "../src/posapp/constants/breakpoints";
import responsiveSrc from "../src/posapp/composables/core/useResponsive.ts?raw";
import dialogSrc from "../src/posapp/composables/core/useDialogFullscreen.ts?raw";

const SRC = resolve(__dirname, "../src/posapp");
const vueFiles = () => {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const n of readdirSync(dir)) {
			const full = resolve(dir, n);
			if (statSync(full).isDirectory()) walk(full);
			else if (n.endsWith(".vue") || (n.endsWith(".css") && !n.endsWith(".vue.css"))) out.push(full);
		}
	};
	walk(SRC);
	return out;
};

describe("the register's breakpoints come from one source", () => {
	it("holds the expected canonical values", () => {
		expect(BREAKPOINTS).toEqual({ phone: 768, compact: 1100, dialogFullscreen: 600 });
		expect(CSS_MAX.phone).toBe(767.98);
		expect(CSS_MAX.compact).toBe(1099.98);
		expect(CSS_MAX.dialogFullscreen).toBe(599.98);
	});

	it("the composables read BREAKPOINTS, not raw numbers", () => {
		expect(responsiveSrc).toMatch(/isPhone = computed\(\(\) => windowWidth\.value < BREAKPOINTS\.phone\)/);
		expect(responsiveSrc).toMatch(/windowWidth\.value < BREAKPOINTS\.compact/);
		expect(responsiveSrc).toMatch(/windowWidth\.value < BREAKPOINTS\.dialogFullscreen/);
		expect(dialogSrc).toMatch(/DIALOG_FULLSCREEN_BREAKPOINT = BREAKPOINTS\.dialogFullscreen/);
	});

	it("no component CSS uses a canonical integer max-width (must be the .98 form)", () => {
		const bad = /max-width:\s*(768|767|600|599|1100)px/;
		const offenders: string[] = [];
		for (const f of vueFiles()) {
			const s = readFileSync(f, "utf8");
			const m = bad.exec(s);
			if (m) offenders.push(`${f.replace(SRC, "")}: max-width: ${m[1]}px`);
		}
		expect(offenders, "these must use the .98 boundary form:\n" + offenders.join("\n")).toEqual([]);
	});
});
