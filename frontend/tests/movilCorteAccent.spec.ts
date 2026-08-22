import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two invariants, source-scanned over the mobile corte.
 *
 * `tests/singleAccent.spec.ts` proves the same negative — "no such declaration
 * exists" — but its `SHELL` constant walks `components/pos/shell/**` only, and
 * this screen lives under `components/pos/mobile/**`. A scan that does not
 * reach a directory is not guarding it, and the register has already been bitten
 * by scan scope drifting behind the tree (HEAD: "the fifth stale scan scope").
 * Reported to the lead as a scope to widen; guarded here meanwhile, because a
 * gap that is only written down is a gap.
 *
 * Node environment, not jsdom: this reads real files and `node:fs` named
 * imports do not interop under the jsdom transform (build plan §10).
 */

const MOBILE_CLOSING = resolve(
	__dirname,
	"../src/posapp/components/pos/mobile/closing",
);

/** Same spellings tests/singleAccent.spec.ts matches, for the same reason:
 *  the token, what it forwards to, and the raw hexes behind both themes. */
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

/** Amber and green: surface, caption and figure — never a fill on the action. */
const STATE_PATTERNS = [/#f0dcae/i, /#8a5a0d/i, /#fdf9f0/i, /#cdead8/i, /#157a48/i, /#f4fbf7/i];

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const walk = (dir: string): string[] => {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (entry.endsWith(".vue") || entry.endsWith(".css")) out.push(full);
	}
	return out;
};

interface Rule {
	selector: string;
	body: string;
}

/** Flat `selector { body }` pairs; at-rule blocks are unwrapped, not skipped. */
const rules = (css: string): Rule[] => {
	const found: Rule[] = [];
	const flat = stripComments(css);
	let depth = 0;
	let bodyStart = 0;
	let selectorStart = 0;

	for (let i = 0; i < flat.length; i += 1) {
		const char = flat[i];
		if (char === "{") {
			if (depth === 0) {
				const selector = flat.slice(selectorStart, i).trim();
				if (selector.startsWith("@")) {
					let inner = 0;
					for (let j = i; j < flat.length; j += 1) {
						if (flat[j] === "{") inner += 1;
						else if (flat[j] === "}") {
							inner -= 1;
							if (inner === 0) {
								found.push(...rules(flat.slice(i + 1, j)));
								i = j;
								selectorStart = j + 1;
								break;
							}
						}
					}
					continue;
				}
				bodyStart = i + 1;
			}
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				found.push({
					selector: flat.slice(selectorStart, bodyStart - 1).trim(),
					body: flat.slice(bodyStart, i),
				});
				selectorStart = i + 1;
			}
		}
	}
	return found;
};

const stylesOf = (file: string) => {
	const source = readFileSync(file, "utf8");
	if (file.endsWith(".css")) return source;
	return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
};

const fillDeclarations = (body: string) =>
	body
		.split(";")
		.map((d) => d.trim())
		.filter((d) => /^background(-color)?\s*:/.test(d));

/** Same shape singleAccent.spec.ts recognises, so widening its scope needs no
 *  rename here: the sanctioned accent lives on a `__primary` selector. */
const isPrimaryAction = (selector: string) => /__primary\b/.test(selector);

const files = walk(MOBILE_CLOSING);

describe("the mobile corte spends one accent, on CERRAR TURNO", () => {
	it("has files to scan at all", () => {
		// A scan over zero files passes vacuously, which is the quiet way this
		// kind of guarantee stops guarding anything.
		expect(files.length).toBeGreaterThan(0);
	});

	it("fills nothing but the primary with the brand accent", () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const rule of rules(stylesOf(file))) {
				if (isPrimaryAction(rule.selector)) continue;
				for (const declaration of fillDeclarations(rule.body)) {
					if (ACCENT_PATTERNS.some((pattern) => pattern.test(declaration))) {
						offenders.push(`${file} → ${rule.selector} { ${declaration} }`);
					}
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("never tints the action with a state colour", () => {
		// The inverse leak. An amber CERRAR TURNO beside an amber difference is
		// how a cashier learns that colour is decoration.
		const offenders: string[] = [];
		for (const file of files) {
			for (const rule of rules(stylesOf(file))) {
				if (!isPrimaryAction(rule.selector)) continue;
				for (const declaration of fillDeclarations(rule.body)) {
					if (STATE_PATTERNS.some((pattern) => pattern.test(declaration))) {
						offenders.push(`${file} → ${rule.selector} { ${declaration} }`);
					}
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("spends the accent exactly once, and drops it when disabled", () => {
		const screen = stylesOf(resolve(MOBILE_CLOSING, "MovilCorte.vue"));
		const accented = rules(screen).filter((rule) =>
			fillDeclarations(rule.body).some((d) => ACCENT_PATTERNS.some((p) => p.test(d))),
		);

		expect(accented.length).toBe(1);
		expect(accented[0]!.selector).toBe(".movil-corte__primary");

		const disabled = rules(screen).find((r) => r.selector === ".movil-corte__primary:disabled");
		expect(disabled, "a disabled primary must be defined, not left to opacity").toBeDefined();
		for (const declaration of fillDeclarations(disabled!.body)) {
			// Dropped, not faded: a translucent teal is still teal.
			expect(ACCENT_PATTERNS.some((p) => p.test(declaration))).toBe(false);
		}
	});
});

describe("a ten-row count is twenty targets, and a phone is a coarse pointer", () => {
	const screen = stylesOf(resolve(MOBILE_CLOSING, "MovilCorte.vue"));

	/** Bodies of every `@media (pointer: coarse)` block, concatenated. */
	const coarse = (() => {
		const bodies: string[] = [];
		const opener = /@media\s*\(pointer:\s*coarse\)/g;
		let match: RegExpExecArray | null;
		const flat = stripComments(screen);
		while ((match = opener.exec(flat)) !== null) {
			const open = flat.indexOf("{", match.index);
			let depth = 0;
			for (let i = open; i < flat.length; i += 1) {
				if (flat[i] === "{") depth += 1;
				else if (flat[i] === "}") {
					depth -= 1;
					if (depth === 0) {
						bodies.push(flat.slice(open + 1, i));
						break;
					}
				}
			}
		}
		return bodies.join("\n");
	})();

	it("widens the stepper to the touch minimum on a phone", () => {
		// `DenominationRow` draws them 34px wide — right for the tablet the
		// desktop corte runs on, twenty under-sized targets on a 390px phone.
		expect(coarse).toMatch(/\.denom-row__step\)?\s*\{[^}]*width:\s*var\(--reg-touch-min/);
		expect(coarse).toMatch(/\.denom-row__count\)?\s*\{[^}]*min-height:\s*var\(--reg-touch-min/);
	});

	it("brings the manual-override link up to it as well", () => {
		// The one escape hatch out of the count. A 4px-padded text button is not
		// reachable with a thumb, and unreachable is indistinguishable from absent.
		expect(coarse).toMatch(/\.drawer-count__override\)?\s*\{[^}]*min-height:\s*var\(--reg-touch-min/);
	});

	it("sizes the note field and the primary above the minimum at every pointer", () => {
		const note = stylesOf(resolve(MOBILE_CLOSING, "DifferenceNote.vue"));
		expect(
			rules(note).find((r) => r.selector === ".corte-note__field")?.body,
		).toMatch(/min-height:\s*var\(--reg-touch-min/);

		const primary = rules(screen).find((r) => r.selector === ".movil-corte__primary")?.body ?? "";
		const height = /min-height:\s*(\d+)px/.exec(primary);
		expect(height, "the primary must state its own height").not.toBeNull();
		expect(Number(height![1])).toBeGreaterThanOrEqual(44);
	});
});
