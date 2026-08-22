// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { OFFLINE_SURFACES } from "../src/posapp/components/pos/shell/mobile/offlineSurfaceManifest";

/**
 * The properties of the phone's offline surface that only a scan can prove,
 * because each of them is a NEGATIVE: no accent fill, no hardcoded capability
 * list, no second drain, no total computed a second way.
 *
 * Mounted assertions prove one render did not do it today; these prove no such
 * declaration exists. Same reason `singleAccent.spec.ts` and
 * `offlineQueueSource.spec.ts` are scans. Node environment on purpose —
 * `node:fs` named imports do not interop under jsdom (build plan §10).
 */

const DIR = resolve(__dirname, "../src/posapp/components/pos/mobile/offline");

const files = () =>
	readdirSync(DIR)
		.map((entry) => resolve(DIR, entry))
		.filter((full) => statSync(full).isFile());

const read = (name: string) => readFileSync(resolve(DIR, name), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the brace-matched block whose `{` follows `from`. */
const blockBody = (css: string, from: number) => {
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
};

const rules = (css: string) => {
	const flat = css.replace(/\s+/g, " ");
	const out: Array<{ selector: string; body: string }> = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		out.push({ selector: match[1].trim(), body: match[2].trim() });
	}
	return out;
};

const declaration = (css: string, fragment: string, property: string) => {
	for (const rule of rules(css)) {
		if (!rule.selector.includes(fragment)) continue;
		const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule.body);
		if (found) return found[1]!.trim();
	}
	return undefined;
};

const pxOf = (value: string | undefined) => {
	const found = /(\d+(?:\.\d+)?)px/.exec(value ?? "");
	if (!found) throw new Error(`no px length in ${String(value)}`);
	return Number(found[1]);
};

describe("Reintentar is reachable with a thumb", () => {
	const view = stripComments(read("MovilOfflineView.vue"));

	it("clears 44 px before any media query is consulted", () => {
		// The floor, not the target: this is the only control on the screen and
		// it is pressed by someone who is already anxious about their money.
		expect(pxOf(declaration(view, ".movil-offline__retry", "min-height"))).toBeGreaterThanOrEqual(
			44,
		);
	});

	it("grows rather than shrinks on a coarse pointer", () => {
		const opener = /@media\s*\(pointer:\s*coarse\)/.exec(view);
		expect(opener, "the phone surface must state a coarse-pointer target").not.toBeNull();

		const coarse = blockBody(view, opener!.index);
		expect(pxOf(declaration(coarse, ".movil-offline__retry", "min-height"))).toBeGreaterThanOrEqual(
			44,
		);
	});
});

/**
 * The SATURATED brand accent in every spelling that reaches a stylesheet —
 * the same list `singleAccent.spec.ts` keeps for `components/pos/shell/**`,
 * which does not walk this directory. Amber and green are STATE here: `espera`
 * spends no accent, and the phone's one saturated colour stays on the dock's
 * primary action.
 */
const ACCENT_PATTERNS = [
	/var\(\s*--reg-accent\s*[,)]/,
	/var\(\s*--reg-accent-pressed\s*[,)]/,
	/var\(\s*--pos-primary\s*[,)]/,
	/var\(\s*--pos-primary-variant\s*[,)]/,
	/#0097a7/i,
	/#00838f/i,
	/#00d4ff/i,
	/#00a0cc/i,
	/#ff6b35/i,
];

const FILL_PROPERTIES = /(?:^|;)\s*(background|background-color|border-color|box-shadow)\s*:\s*([^;]+)/g;

describe("the offline surface spends no accent", () => {
	it("fills nothing with the brand colour", () => {
		const offenders: string[] = [];
		for (const file of files()) {
			if (!file.endsWith(".vue")) continue;
			const css = stripComments(readFileSync(file, "utf8"));
			for (const rule of rules(css)) {
				FILL_PROPERTIES.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = FILL_PROPERTIES.exec(rule.body)) !== null) {
					if (ACCENT_PATTERNS.some((pattern) => pattern.test(match![2]!))) {
						offenders.push(`${file.split("/").pop()} → ${rule.selector}: ${match[2]}`);
					}
				}
			}
		}
		expect(
			offenders,
			`amber is STATE on this screen; the accent belongs to the dock's primary action:\n${offenders.join("\n")}`,
		).toEqual([]);
	});
});

describe("the capability columns are the manifest, not a copy of it", () => {
	const capabilities = read("MovilOfflineCapabilities.vue");

	it("imports the audited manifest", () => {
		expect(capabilities).toContain("offlineSurfaceManifest");
		expect(capabilities).toContain("mobileCapabilityColumns");
	});

	it("writes none of the manifest's labels into the template", () => {
		// §8 R4 audited these values and found three of ten wrong. A second copy
		// here would be a fourth, and it would keep reassuring a cashier long
		// after the module behind the claim changed.
		const hardcoded = OFFLINE_SURFACES.filter(
			(surface) =>
				capabilities.includes(`"${surface.labelKey}"`) ||
				capabilities.includes(`>${surface.labelKey}<`),
		);
		expect(hardcoded.map((surface) => surface.labelKey)).toEqual([]);
	});

	it("names no surface id either — the split is on availability", () => {
		const hardcoded = OFFLINE_SURFACES.filter((surface) =>
			new RegExp(`["'\`]${surface.id}["'\`]`).test(capabilities),
		);
		expect(hardcoded.map((surface) => surface.id)).toEqual([]);
	});
});

describe("the money held is summed once, by the module that owns the queue", () => {
	it("delegates the total to `summariseHeldSales`", () => {
		expect(read("movilOfflineModel.ts")).toContain("summariseHeldSales");
	});

	it("adds up no amounts of its own anywhere on this surface", () => {
		// The one figure this screen exists to state correctly. A second
		// summation here — over a different filter, or over the rows the phone
		// happens to draw — is how the number on the banner and the list under
		// it start disagreeing.
		for (const file of files()) {
			const source = stripComments(readFileSync(file, "utf8"));
			expect(source, `${file} re-derives money`).not.toMatch(/reduce\s*\(/);
			expect(source).not.toContain("grand_total");
		}
	});
});

describe("Reintentar is not a second drain path", () => {
	it("goes through the composable that dispatches the existing drain", () => {
		const surface = read("MovilOfflineSurface.vue");
		expect(surface).toContain("useOfflineQueue");
	});

	it("reaches the server from nowhere on this surface", () => {
		// `src/offline/writeQueue.ts` owns enqueue, claim, mark, retry and
		// delete. A submit issued from a view bypasses the lease and the
		// idempotency bookkeeping, and the failure — a sale billed twice — is
		// silent.
		for (const file of files()) {
			const source = stripComments(readFileSync(file, "utf8"));
			for (const forbidden of [
				"frappe.call",
				"syncOfflineInvoices",
				"submitInvoice",
				"enqueue",
				"markSynced",
			]) {
				expect(source, `${file} contains ${forbidden}`).not.toContain(forbidden);
			}
		}
	});
});

describe("three treatments of one state, each saying which it is", () => {
	it("declares a scope no other offline surface claims", () => {
		const mine = read("MovilOfflineView.vue");
		const overlay = readFileSync(
			resolve(__dirname, "../src/posapp/components/pos/shell/mobile/MobileOfflineOverlay.vue"),
			"utf8",
		);
		const desktop = readFileSync(
			resolve(__dirname, "../src/posapp/components/pos/offline/OfflineQueueView.vue"),
			"utf8",
		);

		expect(mine).toContain('data-offline-scope="mobile-surface"');
		expect(overlay).toContain('data-offline-scope="overlay"');
		expect(desktop).toContain('data-offline-scope="surface"');
	});

	it("renders neither of the other two rather than wrapping one", () => {
		// The phone's full surface is a THIRD thing. The overlay is deliberately
		// `role="status"` over the current tab so the dock stays live; folding
		// this screen into it would take the cashier off what they were doing,
		// and mounting both at once would state the capability columns twice.
		// (Both are NAMED in this file's comments, which is the point — the
		// distinction is written down. What must not happen is an import.)
		for (const file of files()) {
			const source = readFileSync(file, "utf8");
			expect(source).not.toMatch(/import\s+MobileOfflineOverlay/);
			expect(source).not.toMatch(/import\s+OfflineQueueView/);
			expect(source).not.toContain("<MobileOfflineOverlay");
			expect(source).not.toContain("<OfflineQueueView");
		}
	});
});
