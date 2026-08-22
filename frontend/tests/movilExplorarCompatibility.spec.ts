/**
 * The `Compatible` chip on `MovilExplorar` — and the mutants that must die.
 *
 * Everything else on this screen is information. This one chip is a CLAIM: it
 * tells a cashier that the cases in front of them fit the phone the customer is
 * holding, and the cashier repeats it out loud. The failure mode worth spending
 * a test budget on is not "the chip is missing" — that is visible in a second —
 * it is "the chip is there and shows the whole accessory wall", which looks
 * exactly like working software right up until someone gets home with a case
 * for the wrong phone.
 *
 * So the second half of this file is a mutation harness rather than a comment
 * saying the code was mutation-tested once. Each mutant is a plausible way to
 * write this wrong; the contract that the real implementation passes is re-run
 * against every one of them, and the suite fails if any mutant survives. A
 * contract no mutant can break is a contract that is not checking anything.
 *
 * No jsdom: none of this touches a DOM.
 */
import { describe, expect, it } from "vitest";

import type { ComboOffer } from "../src/posapp/composables/pos/combos/comboCatalog";
import {
	COMPATIBLE_FILTER_ID,
	applyCompatibilityFilter,
	offersCompatibleFilter,
	resolveCompatibilityScope,
	type CompatibilityInput,
	type CompatibilityScope,
} from "../src/posapp/components/pos/mobile/browse/browseCompatibility";

const HONOR_X8A = "IPN-HONOR-X8A";
const HONOR_70 = "IPN-HONOR-70";

/**
 * `ComboComponent` does not declare `is_stock_item`, but `api/combos.py`
 * sends it per component and `comboAvailability.ts` reads it — that is how
 * `Instalación` avoids capping a combo at zero. The cast keeps the fixtures
 * honest to the wire payload without editing a file this task does not own.
 * REPORTED to the lead.
 */
const component = (
	item_code: string,
	item_name: string,
	rate: number,
	actual_qty: number,
	is_stock_item = 1,
) => ({ item_code, item_name, qty: 1, rate, actual_qty, is_stock_item }) as ComboOffer["components"][number];

const comboX8A: ComboOffer = {
	item_code: "COMBO-X8A",
	item_name: "Combo Protección Honor X8A",
	rate: 289,
	targets: [HONOR_X8A],
	components: [
		component("IPN002611", "Anillo Case Honor X8A Rojo", 200, 8),
		component("IPN003290", "Mica 9D Honor X8A", 149, 31),
		component("SRV-INST", "Instalación", 0, 0, 0),
	],
};

const combo70: ComboOffer = {
	item_code: "COMBO-70",
	item_name: "Combo Protección Honor 70",
	rate: 269,
	targets: [HONOR_70],
	components: [component("IPN002587", "Anillo Case Honor 70 Gris", 200, 2)],
};

/** No `targets` — "fits anything", which is not the same claim as "fits this". */
const comboUniversal: ComboOffer = {
	item_code: "COMBO-CARGA",
	item_name: "Combo Carga Rápida",
	rate: 349,
	targets: [],
	components: [component("IPN009001", "Cargador 33W", 299, 12)],
};

const ALL_COMBOS = [comboX8A, combo70, comboUniversal];

const scopeFor = (over: CompatibilityInput = {}) =>
	resolveCompatibilityScope({ combos: ALL_COMBOS, cart: [HONOR_X8A], ...over });

describe("whether the register may claim compatibility at all", () => {
	it("says nothing when no combo targets anything", () => {
		// The whole feature rests on `POS Combo`'s `targets`. A tenant that has
		// authored none gets no chip — not a chip over an unfiltered catalogue.
		const scope = resolveCompatibilityScope({ combos: [comboUniversal], cart: [HONOR_X8A] });

		expect(scope.supported).toBe(false);
		expect(scope.reason).toBe("no-device");
		expect(offersCompatibleFilter(scope)).toBe(false);
	});

	it("says nothing when the ticket holds no device anyone authored for", () => {
		const scope = scopeFor({ cart: ["IPN002611", "IPN003290"] });

		expect(scope.supported).toBe(false);
		expect(scope.reason).toBe("no-device");
	});

	it("says nothing about an explicitly named device with no combos behind it", () => {
		// The service-order path, when it lands. Naming the phone on the bench
		// is not the same as knowing what fits it, and the gate is the same one.
		const scope = scopeFor({ cart: [], deviceItemCode: "IPN-PIXEL-9" });

		expect(scope.supported).toBe(false);
		expect(scope.reason).toBe("no-authored-targets");
	});

	it("claims only once a merchant record says what fits the device", () => {
		const scope = scopeFor();

		expect(scope.supported).toBe(true);
		expect(scope.reason).toBe("targeted");
		expect(scope.deviceItemCode).toBe(HONOR_X8A);
		expect(offersCompatibleFilter(scope)).toBe(true);
	});
});

describe("what the compatible set contains", () => {
	it("holds the targeting combo and every part it names", () => {
		const scope = scopeFor();

		expect([...scope.codes].sort()).toEqual(
			["COMBO-X8A", "IPN002611", "IPN003290", "SRV-INST"].sort(),
		);
	});

	it("excludes a universal combo, which promises no device in particular", () => {
		// The failure this guards: a register whose combos are all universal
		// would otherwise show every one of them under a chip that says these
		// were chosen for the phone in the customer's hand.
		const scope = scopeFor();

		expect(scope.codes.has("COMBO-CARGA")).toBe(false);
		expect(scope.codes.has("IPN009001")).toBe(false);
	});

	it("excludes another device's accessories", () => {
		const scope = scopeFor();

		expect(scope.codes.has("COMBO-70")).toBe(false);
		expect(scope.codes.has("IPN002587")).toBe(false);
	});

	it("excludes the device itself — it is not an accessory for itself", () => {
		const selfTargeting: ComboOffer = {
			...comboX8A,
			components: [...comboX8A.components, component(HONOR_X8A, "Honor X8A", 4299, 3)],
		};
		const scope = resolveCompatibilityScope({ combos: [selfTargeting], cart: [HONOR_X8A] });

		expect(scope.codes.has(HONOR_X8A)).toBe(false);
	});

	it("records which combo put each code in the set", () => {
		// Provenance is what makes a wrong entry a merchant data error someone
		// can find, rather than an inference nobody can audit.
		const scope = scopeFor();

		expect(scope.provenance.get("COMBO-X8A")).toEqual({ via: "combo", combo: "COMBO-X8A" });
		expect(scope.provenance.get("IPN002611")).toEqual({
			via: "combo-component",
			combo: "COMBO-X8A",
		});
	});
});

describe("which device the claim is about", () => {
	it("takes the last targeted device on the ticket", () => {
		// The cashier is working the item they just scanned. A claim about a
		// phone sold three lines ago is about the wrong customer's hand.
		const scope = scopeFor({ cart: [HONOR_X8A, "IPN002611", HONOR_70] });

		expect(scope.deviceItemCode).toBe(HONOR_70);
		expect([...scope.codes].sort()).toEqual(["COMBO-70", "IPN002587"].sort());
	});

	it("accepts lines as well as bare codes", () => {
		const scope = scopeFor({ cart: [{ item_code: HONOR_X8A }, { item_code: "IPN002611" }] });

		expect(scope.deviceItemCode).toBe(HONOR_X8A);
	});

	it("never matches a half-built line against a blank target", () => {
		const blankTarget: ComboOffer = { ...comboX8A, targets: ["", "  "] };
		const scope = resolveCompatibilityScope({
			combos: [blankTarget],
			cart: [{ item_code: "" }, { item_code: undefined }],
		});

		expect(scope.supported).toBe(false);
	});

	it("names the device for the footer, falling back to its code", () => {
		expect(scopeFor({ deviceNames: { [HONOR_X8A]: "Honor X8A" } }).deviceName).toBe("Honor X8A");
		expect(scopeFor().deviceName).toBe(HONOR_X8A);
	});

	it("prefers an explicitly named device over the ticket", () => {
		const scope = scopeFor({ cart: [HONOR_X8A], deviceItemCode: HONOR_70 });

		expect(scope.deviceItemCode).toBe(HONOR_70);
	});
});

describe("the filter itself", () => {
	const CATALOGUE = [
		{ item_code: "COMBO-X8A" },
		{ item_code: "IPN002611" },
		{ item_code: "IPN002587" },
		{ item_code: "IPN009001" },
		{ item_code: HONOR_X8A },
	];

	it("keeps only what the scope says fits", () => {
		expect(applyCompatibilityFilter(CATALOGUE, scopeFor()).map((i) => i.item_code)).toEqual([
			"COMBO-X8A",
			"IPN002611",
		]);
	});

	it("returns NOTHING for an unsupported scope, never the whole catalogue", () => {
		// This is the property the mutants below exist to attack.
		const scope = resolveCompatibilityScope({ combos: [], cart: [] });

		expect(applyCompatibilityFilter(CATALOGUE, scope)).toEqual([]);
	});

	it("returns nothing when handed no scope at all", () => {
		expect(applyCompatibilityFilter(CATALOGUE, null)).toEqual([]);
		expect(applyCompatibilityFilter(CATALOGUE, undefined)).toEqual([]);
	});

	it("exports a filter id distinct from any category id", () => {
		// The chip composes WITH a category chip rather than replacing it, so
		// the two id spaces must not collide.
		expect(COMPATIBLE_FILTER_ID).toBe("compatible");
	});
});

/* ------------------------------------------------------------------ *
 * Mutation harness
 * ------------------------------------------------------------------ */

type Filter = <T extends { item_code?: unknown }>(
	_items: readonly T[],
	_scope: CompatibilityScope | null | undefined,
) => T[];

type Resolver = (_input?: CompatibilityInput) => CompatibilityScope;

const CATALOGUE = [
	{ item_code: "COMBO-X8A" },
	{ item_code: "COMBO-70" },
	{ item_code: "COMBO-CARGA" },
	{ item_code: "IPN002611" },
	{ item_code: "IPN002587" },
	{ item_code: "IPN009001" },
	{ item_code: HONOR_X8A },
];

/**
 * The properties a compatible filter must have, evaluated against whichever
 * implementation it is handed. Returns the violations rather than asserting,
 * so the same function can be used both to pass the real code and to KILL a
 * mutant — an assertion helper could only do the first.
 */
const violations = (resolve: Resolver, filter: Filter): string[] => {
	const failures: string[] = [];
	const check = (name: string, ok: boolean) => {
		if (!ok) failures.push(name);
	};

	const supported = resolve({ combos: ALL_COMBOS, cart: [HONOR_X8A] });
	const noDevice = resolve({ combos: ALL_COMBOS, cart: ["IPN002611"] });
	const noTargets = resolve({ combos: [comboUniversal], cart: [HONOR_X8A] });

	// 1. An unsupported scope must never widen into the whole catalogue. This
	//    is the customer-facing one: a full grid under a Compatible chip.
	check("unsupported scope yields nothing", filter(CATALOGUE, noDevice).length === 0);
	check("no authored targets yields nothing", filter(CATALOGUE, noTargets).length === 0);

	// 2. A supported scope must be strictly narrower than the catalogue, or
	//    the chip is decoration.
	const kept = filter(CATALOGUE, supported);
	check("supported scope narrows", kept.length > 0 && kept.length < CATALOGUE.length);

	// 3. It must not leak another device's accessories …
	const codes = new Set(kept.map((item) => String(item.item_code)));
	check("no other device's combo", !codes.has("COMBO-70"));
	check("no other device's accessory", !codes.has("IPN002587"));

	// 4. … nor a universal combo, which was authored for nothing in particular.
	check("no universal combo", !codes.has("COMBO-CARGA"));

	// 5. … nor the device itself.
	check("not the device itself", !codes.has(HONOR_X8A));

	// 6. And the chip must only be offered when the claim can be made.
	check("chip gated on support", offersCompatibleFilter(noDevice) === false);
	check("chip offered when targeted", offersCompatibleFilter(supported) === true);

	return failures;
};

/**
 * Each mutant is one plausible way to get this wrong. Names describe the BUG,
 * not the code change, because the bug is what a reviewer has to recognise.
 */
const MUTANTS: { name: string; resolve: Resolver; filter: Filter }[] = [
	{
		name: "an unsupported scope falls back to the whole catalogue",
		resolve: resolveCompatibilityScope,
		filter: ((items, scope) =>
			scope?.supported
				? items.filter((item: any) => scope.codes.has(String(item?.item_code ?? "")))
				: [...items]) as Filter,
	},
	{
		name: "the support gate is dropped and an empty set matches everything",
		resolve: resolveCompatibilityScope,
		filter: ((items, scope) =>
			scope && scope.codes.size
				? items.filter((item: any) => scope.codes.has(String(item?.item_code ?? "")))
				: [...items]) as Filter,
	},
	{
		name: "universal combos count as targeting the device",
		resolve: ((input = {}) => {
			const base = resolveCompatibilityScope(input);
			const codes = new Set(base.codes);
			for (const combo of input.combos ?? []) {
				if ((combo.targets ?? []).length) continue;
				codes.add(combo.item_code);
				for (const part of combo.components ?? []) codes.add(part.item_code);
			}
			return { ...base, supported: true, codes };
		}) as Resolver,
		filter: applyCompatibilityFilter as Filter,
	},
	{
		name: "any device on the ticket is treated as supported",
		resolve: ((input = {}) => ({
			...resolveCompatibilityScope(input),
			supported: (input.cart ?? []).length > 0,
		})) as Resolver,
		filter: applyCompatibilityFilter as Filter,
	},
	{
		name: "the set is built from every combo rather than the targeting ones",
		resolve: ((input = {}) => {
			const base = resolveCompatibilityScope(input);
			const codes = new Set<string>();
			for (const combo of input.combos ?? []) {
				codes.add(combo.item_code);
				for (const part of combo.components ?? []) codes.add(part.item_code);
			}
			return { ...base, supported: true, codes };
		}) as Resolver,
		filter: applyCompatibilityFilter as Filter,
	},
];

describe("mutation — the contract has to kill each of these", () => {
	it("the shipped implementation satisfies the contract", () => {
		expect(violations(resolveCompatibilityScope, applyCompatibilityFilter as Filter)).toEqual([]);
	});

	it.each(MUTANTS)("kills: $name", ({ resolve, filter }) => {
		const failures = violations(resolve, filter);

		// A mutant that survives means the checks above describe nothing.
		expect(failures.length).toBeGreaterThan(0);
	});

	it("has mutants to run at all", () => {
		// A table that quietly emptied would make `it.each` pass vacuously.
		expect(MUTANTS.length).toBeGreaterThanOrEqual(5);
	});
});
