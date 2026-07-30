import { describe, expect, it } from "vitest";

import { buildSelfTestSlipHtml } from "../src/posapp/utils/printSelfTestSlip";

describe("buildSelfTestSlipHtml", () => {
	it("stamps the slip so it cannot be confused with an earlier test", () => {
		const at = new Date("2026-07-30T12:34:00.000Z");
		const html = buildSelfTestSlipHtml({ printer: "Counter Printer", at });

		expect(html).toContain("PRINT TEST");
		expect(html).toContain("Counter Printer");
		expect(html).toContain(at.toLocaleString());
	});

	it("pins the paper width the same way real receipts do", () => {
		const html = buildSelfTestSlipHtml({ widthMm: 58 });

		// A slip rendered on a different viewport would not prove anything
		// about the receipts that follow it.
		expect(html).toContain("@page { size: 58mm auto; margin: 0; }");
		expect(html).toContain("width: 58mm");
	});

	it("defaults to 80mm", () => {
		expect(buildSelfTestSlipHtml()).toContain("size: 80mm auto");
	});

	it("escapes printer and terminal names instead of injecting markup", () => {
		const html = buildSelfTestSlipHtml({
			printer: '<script>alert("x")</script>',
			terminalLabel: "Till & Co",
		});

		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("Till &amp; Co");
	});

	it("omits the terminal line when there is no profile name", () => {
		expect(buildSelfTestSlipHtml({ printer: "P1" })).not.toContain("Terminal");
	});

	it("renders a dash rather than a blank when no printer is known", () => {
		expect(buildSelfTestSlipHtml()).toContain("Printer: -");
	});

	it("routes every visible string through the caller's translator", () => {
		const html = buildSelfTestSlipHtml({
			translate: (value: string) => `es::${value}`,
		});

		expect(html).toContain("es::PRINT TEST");
		expect(html).toContain("es::If you can read this, printing works.");
	});
});
