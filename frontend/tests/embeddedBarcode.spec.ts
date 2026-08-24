import { describe, expect, it } from "vitest";

import {
	EMBEDDED_PREFIX_MAX,
	EMBEDDED_PREFIX_MIN,
	ean13CheckDigit,
	embeddedLookupCodes,
	embeddedTemplateFor,
	isEmbeddedCandidate,
	parseEmbeddedBarcode,
	qtyFromEmbeddedLabel,
	readEmbeddedScheme,
	type EmbeddedParsed,
} from "../src/posapp/utils/embeddedBarcode";

/**
 * The vectors below are hand-computed and asserted as literals on purpose. A
 * suite that built its labels with `ean13CheckDigit` would agree with the
 * parser about a wrong checksum as happily as about a right one, and the whole
 * reason this module refuses loudly is that a mis-parse here is a mis-charge.
 *
 *   2001234003124  prefix 20 · item 01234 · 00312 · check 4
 *   2001234049924  prefix 20 · item 01234 · 04992 · check 4
 *   2001234000000  the zero-valued template for item 01234
 */
const WEIGHT_LABEL = "2001234003124";
const PRICE_LABEL = "2001234049924";
const TEMPLATE = "2001234000000";

const parsed = (result: ReturnType<typeof parseEmbeddedBarcode>): EmbeddedParsed => {
	if (result.kind !== "parsed") throw new Error(`expected a parse, got ${result.kind}`);
	return result;
};

describe("check digit", () => {
	it("matches hand-computed EAN-13 vectors", () => {
		expect(ean13CheckDigit("200123400312")).toBe("4");
		expect(ean13CheckDigit("200123404992")).toBe("4");
		expect(ean13CheckDigit("200123400000")).toBe("0");
		expect(ean13CheckDigit("250009900475")).toBe("3");
		expect(ean13CheckDigit("219999912345")).toBe("1");
	});

	it("answers empty for anything that is not twelve digits", () => {
		expect(ean13CheckDigit("")).toBe("");
		expect(ean13CheckDigit("20012340031")).toBe("");
		expect(ean13CheckDigit("2001234003124")).toBe("");
		expect(ean13CheckDigit("20012340031X")).toBe("");
	});
});

describe("scheme configuration", () => {
	it("accepts only the two the register knows how to read", () => {
		expect(readEmbeddedScheme("weight")).toBe("weight");
		expect(readEmbeddedScheme("price")).toBe("price");
		expect(readEmbeddedScheme("WEIGHT")).toBe("weight");
		expect(readEmbeddedScheme(" price ")).toBe("price");
	});

	it("reads anything else as off", () => {
		expect(readEmbeddedScheme("")).toBeNull();
		expect(readEmbeddedScheme(null)).toBeNull();
		expect(readEmbeddedScheme(undefined)).toBeNull();
		expect(readEmbeddedScheme("peso")).toBeNull();
		expect(readEmbeddedScheme(1)).toBeNull();
	});
});

describe("embedded WEIGHT labels", () => {
	it("reads the golden flow's 0.312 kg", () => {
		const result = parsed(parseEmbeddedBarcode(WEIGHT_LABEL, "weight"));

		expect(result.scheme).toBe("weight");
		expect(result.prefix).toBe("20");
		expect(result.shortCode).toBe("01234");
		expect(result.weight).toBe(0.312);
		expect(result.importe).toBeNull();
		expect(result.template).toBe(TEMPLATE);
		expect(result.raw).toBe(WEIGHT_LABEL);
	});

	it("reads grams as three decimals of a kilogram", () => {
		expect(parsed(parseEmbeddedBarcode("2500099004753", "weight")).weight).toBe(0.475);
		expect(parsed(parseEmbeddedBarcode("2199999123451", "weight")).weight).toBe(12.345);
		expect(parsed(parseEmbeddedBarcode("2001234000123", "weight")).weight).toBe(0.012);
		expect(parsed(parseEmbeddedBarcode("2001234999991", "weight")).weight).toBe(99.999);
	});

	it("accepts both ends of the restricted-circulation range", () => {
		expect(parsed(parseEmbeddedBarcode("2001234003124", "weight")).prefix).toBe("20");
		expect(parsed(parseEmbeddedBarcode("2500099004753", "weight")).prefix).toBe("25");
		expect(EMBEDDED_PREFIX_MIN).toBe(20);
		expect(EMBEDDED_PREFIX_MAX).toBe(25);
	});
});

describe("embedded PRICE labels", () => {
	it("reads the golden flow's $49.92", () => {
		const result = parsed(parseEmbeddedBarcode(PRICE_LABEL, "price"));

		expect(result.scheme).toBe("price");
		expect(result.shortCode).toBe("01234");
		expect(result.importe).toBe(49.92);
		expect(result.weight).toBeNull();
		expect(result.template).toBe(TEMPLATE);
	});

	it("reads centavos as two decimals of a peso", () => {
		expect(parsed(parseEmbeddedBarcode("2199999123451", "price")).importe).toBe(123.45);
		expect(parsed(parseEmbeddedBarcode("2500099004753", "price")).importe).toBe(4.75);
	});

	it("reads the SAME digits differently under the other scheme", () => {
		// Which is the entire reason the scheme is register configuration and
		// never sniffed: 0.312 kg and $3.12 are the same five digits.
		const asWeight = parsed(parseEmbeddedBarcode(WEIGHT_LABEL, "weight"));
		const asPrice = parsed(parseEmbeddedBarcode(WEIGHT_LABEL, "price"));

		expect(asWeight.weight).toBe(0.312);
		expect(asPrice.importe).toBe(3.12);
	});
});

describe("codes that are not scale labels", () => {
	it("falls through when the register declares no scheme", () => {
		expect(parseEmbeddedBarcode(WEIGHT_LABEL, null)).toEqual({
			kind: "not_embedded",
			raw: WEIGHT_LABEL,
			why: "no_scheme",
		});
	});

	it("falls through on an ordinary retail prefix", () => {
		// 7501234567890 — a Mexican GS1 prefix, the common case.
		expect(parseEmbeddedBarcode("7501234567890", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "prefix",
		});
		expect(parseEmbeddedBarcode("1901234003128", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "prefix",
		});
		expect(parseEmbeddedBarcode("2601234003126", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "prefix",
		});
	});

	it("falls through on a length that is not EAN-13", () => {
		// A 12-digit UPC-A beginning 20 is an ordinary code, not a short label.
		expect(parseEmbeddedBarcode("200123400312", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "length",
		});
		expect(parseEmbeddedBarcode("20012340031245", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "length",
		});
		expect(parseEmbeddedBarcode("20012340", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "length",
		});
	});

	it("falls through on anything with a non-digit in it", () => {
		expect(parseEmbeddedBarcode("ITEM-01234", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "not_numeric",
		});
		expect(parseEmbeddedBarcode("200123400312X", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "not_numeric",
		});
		expect(parseEmbeddedBarcode("", "weight")).toMatchObject({
			kind: "not_embedded",
			why: "not_numeric",
		});
		expect(parseEmbeddedBarcode(null, "weight")).toMatchObject({
			kind: "not_embedded",
			why: "not_numeric",
		});
	});

	it("trims the whitespace a scanner wedge appends", () => {
		expect(parsed(parseEmbeddedBarcode(` ${WEIGHT_LABEL}\r\n`, "weight")).weight).toBe(0.312);
	});
});

describe("corrupt labels refuse loudly", () => {
	it("refuses a label whose check digit does not hold", () => {
		const result = parseEmbeddedBarcode("2001234003129", "weight");

		expect(result).toEqual({
			kind: "invalid",
			raw: "2001234003129",
			reason: "check_digit",
			detail: "9≠4",
		});
	});

	it("refuses every single-digit corruption of a good label", () => {
		// A partial read that drops or misreads one bar is the realistic
		// failure, and it must never resolve to a nearby item.
		let refused = 0;
		for (let position = 0; position < WEIGHT_LABEL.length; position += 1) {
			for (let digit = 0; digit <= 9; digit += 1) {
				const mutated =
					WEIGHT_LABEL.slice(0, position) + String(digit) + WEIGHT_LABEL.slice(position + 1);
				if (mutated === WEIGHT_LABEL) continue;

				const result = parseEmbeddedBarcode(mutated, "weight");
				if (position < 2) {
					// A changed prefix leaves the 20–25 family — an ordinary
					// barcode, or another label that must pass its own check.
					expect(["not_embedded", "invalid", "parsed"]).toContain(result.kind);
					continue;
				}
				expect(result.kind).not.toBe("parsed");
				if (result.kind === "invalid") refused += 1;
			}
		}
		// Mod-10 catches every single-digit substitution, so all 99 of the
		// non-prefix mutations must land in `invalid`.
		expect(refused).toBe(99);
	});

	it("refuses a label that reports no measurement at all", () => {
		expect(parseEmbeddedBarcode(TEMPLATE, "weight")).toEqual({
			kind: "invalid",
			raw: TEMPLATE,
			reason: "empty_value",
			detail: "00000",
		});
		expect(parseEmbeddedBarcode(TEMPLATE, "price")).toMatchObject({
			kind: "invalid",
			reason: "empty_value",
		});
	});

	it("refuses a label that names no item", () => {
		// A well-formed label whose item segment is all zeros points at nothing;
		// the short code is what every lookup below keys on.
		expect(parseEmbeddedBarcode("2000000003122", "weight")).toEqual({
			kind: "invalid",
			raw: "2000000003122",
			reason: "empty_short_code",
			detail: "00000",
		});
	});

	it("checks the item segment before the measurement", () => {
		// Both segments empty: the operator is told the label names no item,
		// which is the fault they can act on.
		expect(parseEmbeddedBarcode(embeddedTemplateFor("20", "00000"), "weight")).toMatchObject({
			reason: "empty_short_code",
		});
	});
});

describe("resolving the item behind a label", () => {
	it("builds the zero-valued template a shop registers on the Item", () => {
		expect(embeddedTemplateFor("20", "01234")).toBe(TEMPLATE);
		expect(embeddedTemplateFor("25", "00099")).toBe("2500099000007");
		expect(embeddedTemplateFor("21", "99999")).toBe("2199999000004");
	});

	it("offers the exact label, then the template, then the short code", () => {
		expect(embeddedLookupCodes(parsed(parseEmbeddedBarcode(WEIGHT_LABEL, "weight")))).toEqual([
			WEIGHT_LABEL,
			TEMPLATE,
			"01234",
		]);
	});

	it("never offers the same code twice", () => {
		const codes = embeddedLookupCodes(parsed(parseEmbeddedBarcode(PRICE_LABEL, "price")));
		expect(new Set(codes).size).toBe(codes.length);
	});
});

describe("the quantity a label puts on the line", () => {
	const weightLabel = parsed(parseEmbeddedBarcode(WEIGHT_LABEL, "weight"));
	const priceLabel = parsed(parseEmbeddedBarcode(PRICE_LABEL, "price"));

	it("takes a weight label at its word", () => {
		expect(qtyFromEmbeddedLabel({ parsed: weightLabel })).toEqual({
			ok: true,
			qty: 0.312,
			asked: null,
			charged: null,
			rounded: false,
		});
	});

	it("floors a weight label onto a coarser register and says so", () => {
		expect(qtyFromEmbeddedLabel({ parsed: weightLabel, qtyPrecision: 2 })).toEqual({
			ok: true,
			qty: 0.31,
			asked: null,
			charged: null,
			rounded: true,
		});
	});

	it("derives a price label's qty by the customer-favour rule", () => {
		// $49.92 of ham at $160/kg is 0.312 kg, charging exactly $49.92.
		expect(qtyFromEmbeddedLabel({ parsed: priceLabel, rate: 160 })).toEqual({
			ok: true,
			qty: 0.312,
			asked: 49.92,
			charged: 49.92,
			rounded: false,
		});
	});

	it("never lets a price label charge more than it says", () => {
		const result = qtyFromEmbeddedLabel({ parsed: priceLabel, rate: 37.77 });
		if (!result.ok) throw new Error("expected a qty");
		expect(result.charged).toBeLessThanOrEqual(49.92);
	});

	it("does NOT reprice the item from the label", () => {
		// The fork's legacy scale path assigned an embedded price to the line's
		// rate; a $49.92 label on $160/kg ham would have sold one kilo for
		// $49.92. The result here carries a qty and no rate at all.
		const result = qtyFromEmbeddedLabel({ parsed: priceLabel, rate: 160 });
		expect(result).not.toHaveProperty("rate");
	});

	it("refuses a price label on an item with no rate", () => {
		expect(qtyFromEmbeddedLabel({ parsed: priceLabel })).toEqual({ ok: false, reason: "no_rate" });
		expect(qtyFromEmbeddedLabel({ parsed: priceLabel, rate: 0 })).toEqual({
			ok: false,
			reason: "no_rate",
		});
	});

	it("refuses a measurement the register cannot hold", () => {
		const tiny = parsed(parseEmbeddedBarcode("2001234000123", "weight"));
		expect(qtyFromEmbeddedLabel({ parsed: tiny, qtyPrecision: 1 })).toEqual({
			ok: false,
			reason: "below_minimum_qty",
		});
		expect(qtyFromEmbeddedLabel({ parsed: priceLabel, rate: 1000000 })).toEqual({
			ok: false,
			reason: "below_minimum_qty",
		});
	});
});

describe("candidate detection", () => {
	it("recognises the shape without needing the scheme or the check digit", () => {
		expect(isEmbeddedCandidate(WEIGHT_LABEL)).toBe(true);
		expect(isEmbeddedCandidate("2001234003129")).toBe(true);
		expect(isEmbeddedCandidate("2500099004753")).toBe(true);
	});

	it("rejects everything the parser would call not_embedded", () => {
		expect(isEmbeddedCandidate("7501234567890")).toBe(false);
		expect(isEmbeddedCandidate("200123400312")).toBe(false);
		expect(isEmbeddedCandidate("ITEM-01234")).toBe(false);
		expect(isEmbeddedCandidate("")).toBe(false);
		expect(isEmbeddedCandidate(null)).toBe(false);
		expect(isEmbeddedCandidate(undefined)).toBe(false);
	});
});
