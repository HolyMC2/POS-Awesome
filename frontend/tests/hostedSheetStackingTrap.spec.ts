// LAYOUT-F3: `.destination-host` sets `isolation: isolate` (added to keep a
// hosted contained overlay's z-index from escaping over the drawer). That also
// caps `position: fixed` descendants, so the two z-30 bottom sheets — chosen to
// beat the dock (z-20) — would paint BELOW it if ever mounted inside a hosted
// flow. Safe today (they mount in MovilShell/Pos, outside the host). This pins
// the coupling so a refactor that hosts a picker meets the documented note.
import { describe, expect, it } from "vitest";
import hostSrc from "../src/posapp/components/pos/shell/destinations/DestinationHost.vue?raw";
import lineSrc from "../src/posapp/components/pos/mobile/line/MovilLineSheet.vue?raw";
import lotSrc from "../src/posapp/components/pos/items/lot/LotPicker.vue?raw";

describe("the hosted-sheet stacking trap is documented at both ends", () => {
	it("the host isolates on purpose", () => {
		expect(hostSrc).toMatch(/isolation:\s*isolate/);
	});
	it("each z-30 fixed sheet names the isolation coupling and the Teleport escape", () => {
		for (const src of [lineSrc, lotSrc]) {
			expect(src).toMatch(/z-index:\s*30/);
			expect(src).toMatch(/isolation: isolate[\s\S]*Teleport to="body"[\s\S]*LAYOUT-F3/);
		}
	});
});
