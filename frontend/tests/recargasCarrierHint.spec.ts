/**
 * Which company a number belongs to — and, mostly, refusing to say.
 *
 * This is the single most expensive decision on the Recargas screen. A recharge
 * that reaches TAECEL is charged whether it works or not, and a wrong company
 * does not bounce: it credits somebody else's phone on a network the customer
 * does not use, out of the shop's own pouch. So every assertion here is really
 * the same assertion — that the resolver would rather ask than be confidently
 * wrong — and the mutation block at the end proves those assertions actually
 * KILL the failure they are written against, rather than passing by luck.
 */
import { describe, expect, it } from "vitest";

import {
	MX_CARRIER_RANGES,
	hintIsAuthoritative,
	normaliseMsisdn,
	resolveCarrierHint,
	type CarrierHint,
	type CarrierHintOptions,
} from "../src/posapp/components/pos/recargas/carrierHint";

const TELCEL_NUMBER = "5528416390";
const historyOf = (...pairs: Array<[string, string]>) =>
	pairs.map(([referencia, saldo_carrier]) => ({ referencia, saldo_carrier }));

describe("the number is normalised before anything reads it", () => {
	it("keeps ten digits whatever punctuation they arrive with", () => {
		expect(normaliseMsisdn("55 2841 6390")).toBe(TELCEL_NUMBER);
		expect(normaliseMsisdn("(55) 2841-6390")).toBe(TELCEL_NUMBER);
	});

	it("strips the international dressing, including the retired mobile 1", () => {
		// All three spellings still arrive — from a contact list, off a printed
		// receipt, and from a customer reading their own number aloud.
		expect(normaliseMsisdn("+52 55 2841 6390")).toBe(TELCEL_NUMBER);
		expect(normaliseMsisdn("+521 55 2841 6390")).toBe(TELCEL_NUMBER);
		expect(normaliseMsisdn("1 55 2841 6390")).toBe(TELCEL_NUMBER);
	});

	it("leaves an unrecognised length alone rather than inventing a rule", () => {
		// A CFE account is also a `referencia`. Trimming digits off one to make it
		// look like a phone is how a service payment goes to the wrong contract.
		expect(normaliseMsisdn("123456789012345")).toBe("123456789012345");
	});
});

describe("the shipped table is empty, deliberately", () => {
	it("ships no Mexican prefix ranges at all", () => {
		// Full portability since 2019: the IFT plan records who OWNED a range,
		// not who serves the line today. A plausible-looking seed table would be
		// a feature that looks like it works and mis-sends money at a rate
		// nobody measured. See carrierHint.ts for the whole argument.
		expect(MX_CARRIER_RANGES).toHaveLength(0);
	});

	it("therefore asks for every complete number, with no history to go on", () => {
		expect(resolveCarrierHint(TELCEL_NUMBER)).toEqual({ kind: "ask", reason: "no-source" });
	});
});

describe("what it does with a number", () => {
	it("says nothing about an empty field", () => {
		expect(resolveCarrierHint("")).toEqual({ kind: "ask", reason: "empty" });
	});

	it("asks the operator to keep typing while the number is short", () => {
		expect(resolveCarrierHint("552841")).toEqual({ kind: "ask", reason: "incomplete" });
	});

	it("refuses an over-long number rather than truncating it to ten", () => {
		expect(resolveCarrierHint("55284163901234")).toEqual({ kind: "ask", reason: "incomplete" });
	});

	it("suggests the company this shop already recharged this number on", () => {
		const hint = resolveCarrierHint(TELCEL_NUMBER, {
			history: historyOf([TELCEL_NUMBER, "Telcel"], ["5511110000", "Bait"]),
		});
		expect(hint).toEqual({ kind: "suggested", carrier: "Telcel", source: "history" });
	});

	it("matches history through the international spellings too", () => {
		const hint = resolveCarrierHint("+52 55 2841 6390", {
			history: historyOf(["55 2841 6390", "Telcel"]),
		});
		expect(hint).toEqual({ kind: "suggested", carrier: "Telcel", source: "history" });
	});

	it("asks when our own record names two companies for one number", () => {
		// The line was ported, or somebody keyed the wrong company once. Either
		// way the ledger disagrees with itself and has stopped being evidence.
		const hint = resolveCarrierHint(TELCEL_NUMBER, {
			history: historyOf([TELCEL_NUMBER, "Telcel"], [TELCEL_NUMBER, "AT&T"]),
		});
		expect(hint).toEqual({ kind: "ask", reason: "conflict" });
	});

	it("asks when a range table and the ledger disagree", () => {
		const hint = resolveCarrierHint(TELCEL_NUMBER, {
			history: historyOf([TELCEL_NUMBER, "Bait"]),
			ranges: [{ prefix: "55", carrier: "Telcel" }],
		});
		expect(hint).toEqual({ kind: "ask", reason: "conflict" });
	});

	it("prefers the longest matching prefix, not the first one written", () => {
		const hint = resolveCarrierHint(TELCEL_NUMBER, {
			ranges: [
				{ prefix: "55", carrier: "Telcel" },
				{ prefix: "5528", carrier: "Unefon" },
			],
		});
		expect(hint).toEqual({ kind: "suggested", carrier: "Unefon", source: "range" });
	});

	it("never treats a suggestion as a choice", () => {
		// The chip is pre-highlighted; the operator's tap is what chooses. This
		// is asserted rather than commented because "suggested" reads like
		// "selected" to the next person who wires this up.
		expect(hintIsAuthoritative()).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* Mutation test                                                               */
/* -------------------------------------------------------------------------- */

type Resolver = (raw: unknown, options?: CarrierHintOptions) => CarrierHint;

/**
 * The contract, as a function of the implementation.
 *
 * Every one of these is a way of arriving at a company we do not actually know,
 * which is the failure that sends money to the wrong network. Running them
 * against deliberately broken resolvers below is what proves they would catch
 * it — a test that cannot fail is not protection, and on this path the
 * difference is the owner's money.
 */
const fallbackContract = (resolve: Resolver): void => {
	// An unrecognised number resolves to ASK. Not to a default company.
	const unknown = resolve(TELCEL_NUMBER, { history: [], ranges: [] });
	if (unknown.kind !== "ask" || unknown.reason !== "no-source") {
		throw new Error(`unknown number did not ask: ${JSON.stringify(unknown)}`);
	}
	// A half-typed number is never resolved, however suggestive its prefix.
	const partial = resolve("5528", { ranges: [{ prefix: "5528", carrier: "Unefon" }] });
	if (partial.kind !== "ask" || partial.reason !== "incomplete") {
		throw new Error(`partial number resolved: ${JSON.stringify(partial)}`);
	}
	// Two sources, two answers, no winner.
	const conflicting = resolve(TELCEL_NUMBER, {
		history: historyOf([TELCEL_NUMBER, "Telcel"], [TELCEL_NUMBER, "AT&T"]),
	});
	if (conflicting.kind !== "ask" || conflicting.reason !== "conflict") {
		throw new Error(`conflict was resolved: ${JSON.stringify(conflicting)}`);
	}
	// The most specific range wins, so a broad area code cannot shadow a block.
	const nested = resolve(TELCEL_NUMBER, {
		ranges: [
			{ prefix: "55", carrier: "Telcel" },
			{ prefix: "5528", carrier: "Unefon" },
		],
	});
	if (nested.kind !== "suggested" || nested.carrier !== "Unefon") {
		throw new Error(`shortest prefix won: ${JSON.stringify(nested)}`);
	}
};

/** Each mutant is the smallest edit that would ship a wrong company. */
const MUTANTS: ReadonlyArray<readonly [string, Resolver]> = [
	[
		"falls back to a default carrier when nothing recognises the number",
		(raw, options) => {
			const real = resolveCarrierHint(raw, options);
			return real.kind === "ask" && real.reason === "no-source"
				? { kind: "suggested", carrier: "Telcel", source: "range" }
				: real;
		},
	],
	[
		"resolves a partial number as soon as a prefix matches",
		(raw, options) => {
			const digits = normaliseMsisdn(raw);
			const real = resolveCarrierHint(raw, options);
			if (real.kind === "ask" && real.reason === "incomplete") {
				return resolveCarrierHint(raw, { ...options, nationalDigits: digits.length });
			}
			return real;
		},
	],
	[
		"breaks a history conflict by taking the first company it saw",
		(raw, options) => {
			const real = resolveCarrierHint(raw, options);
			if (real.kind === "ask" && real.reason === "conflict") {
				const first = (options?.history ?? []).find(
					(row) => normaliseMsisdn(row.referencia) === normaliseMsisdn(raw),
				);
				return { kind: "suggested", carrier: String(first?.saldo_carrier), source: "history" };
			}
			return real;
		},
	],
	[
		"takes the first matching prefix instead of the longest",
		(raw, options) => {
			const digits = normaliseMsisdn(raw);
			const first = (options?.ranges ?? []).find((entry) => digits.startsWith(entry.prefix));
			if (digits.length === 10 && first && !(options?.history ?? []).length) {
				return { kind: "suggested", carrier: first.carrier, source: "range" };
			}
			return resolveCarrierHint(raw, options);
		},
	],
];

describe("mutation — the fallback assertions kill the failure they are written against", () => {
	it("the real resolver satisfies the contract", () => {
		expect(() => fallbackContract(resolveCarrierHint)).not.toThrow();
	});

	it.each(MUTANTS)("catches a resolver that %s", (_name, mutant) => {
		expect(() => fallbackContract(mutant)).toThrow();
	});
});
