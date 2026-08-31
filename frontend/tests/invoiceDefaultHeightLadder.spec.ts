// @vitest-environment jsdom
// LAYOUT-F5: the invoice panel's "responsive" default read --container-height
// off documentElement, where it is never set, so it always fell through to a
// flat 68vh. It now falls back to the same height ladder getMaxInvoiceHeightPx
// uses, so the default tracks the viewport.
import { describe, expect, it, beforeEach } from "vitest";
import { useInvoiceUI } from "../src/posapp/composables/pos/invoice/useInvoiceUI";

describe("the invoice default height follows the viewport ladder", () => {
	beforeEach(() => {
		// ensure the CSS var is absent (jsdom documentElement has none)
		document.documentElement.style.removeProperty("--container-height");
	});
	const heightAt = (h: number) => {
		Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
		const ui = useInvoiceUI() as any;
		return ui.getDefaultInvoiceHeight();
	};
	it("is 58vh on a short viewport, 64 mid, 72 tall — never a flat 68", () => {
		expect(heightAt(700)).toBe("58vh");
		expect(heightAt(900)).toBe("64vh");
		expect(heightAt(1080)).toBe("72vh");
	});
});
