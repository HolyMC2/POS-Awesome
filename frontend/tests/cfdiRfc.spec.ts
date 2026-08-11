import { describe, expect, it } from "vitest";

import {
	isGenericRfc,
	isValidRfc,
	normalizeRfc,
	rfcCheckDigit,
	rfcKind,
	validateRfc,
} from "../src/posapp/utils/rfc";

describe("RFC validator (TS port of emc rfc.py)", () => {
	it("normalizes case, whitespace and hyphens", () => {
		expect(normalizeRfc(" gode-561231 gr8 ")).toBe("GODE561231GR8");
		expect(normalizeRfc(null)).toBe("");
	});

	it("classifies persona física / moral by length", () => {
		expect(rfcKind("GODE561231GR8")).toBe("PF");
		expect(rfcKind("SAT970701NN3")).toBe("PM");
		expect(rfcKind("SHORT")).toBeNull();
	});

	it("accepts the SAT reference RFCs (checksum verified)", () => {
		// Same reference values the Python module documents.
		expect(isValidRfc("GODE561231GR8")).toBe(true);
		expect(isValidRfc("SAT970701NN3")).toBe(true);
	});

	it("computes the check digit like the Python implementation", () => {
		expect(rfcCheckDigit("GODE561231GR")).toBe("8");
		expect(rfcCheckDigit("SAT970701NN")).toBe("3");
	});

	it("rejects a transposed RFC via the checksum, with the expected-digit hint", () => {
		const issues = validateRfc("GODE561231G8R");
		expect(issues.some((issue) => issue.code === "RFC-003")).toBe(true);
	});

	it("rejects malformed shapes and impossible embedded dates", () => {
		expect(validateRfc("NOT-AN-RFC")[0]?.code).toBe("RFC-001");
		expect(validateRfc("")[0]?.code).toBe("RFC-001");
		// month 13 cannot exist
		const badDate = validateRfc("GODE561331GR8");
		expect(badDate.some((issue) => issue.code === "RFC-002")).toBe(true);
	});

	it("treats generic RFCs as valid without a checksum", () => {
		expect(isGenericRfc("XAXX010101000")).toBe(true);
		expect(isGenericRfc("XEXX010101000")).toBe(true);
		expect(isValidRfc("XAXX010101000")).toBe(true);
	});
});
