// LAYOUT-F4: the soft keyboard changes only the visual viewport on many engines
// and fires no window resize, so --viewport-height stayed frozen and the dock
// sat behind the keyboard. Fix: the interactive-widget meta + driving the height
// from visualViewport with its own listeners. Source-pinned.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import responsiveSrc from "../src/posapp/composables/core/useResponsive.ts?raw";

const html = readFileSync(resolve(__dirname, "../../posawesome/www/posapp.html"), "utf8");

describe("the layout reacts to the soft keyboard", () => {
	it("declares interactive-widget=resizes-content on the viewport meta", () => {
		expect(html).toMatch(/name="viewport"[^>]*interactive-widget=resizes-content/);
	});
	it("drives the height from visualViewport and listens to it", () => {
		expect(responsiveSrc).toMatch(/window\.visualViewport[\s\S]*Math\.round\(vv\.height\)/);
		expect(responsiveSrc).toMatch(/window\.visualViewport\?\.addEventListener\("resize"/);
		expect(responsiveSrc).toMatch(/window\.visualViewport\?\.removeEventListener\("resize"/);
	});
});
