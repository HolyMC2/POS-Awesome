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
	it("each dock-beating fixed sheet names the isolation coupling and the Teleport escape", () => {
		// The line sheet holds 30. The lot picker rides ONE above it (31): the
		// sheet's serial / batch row opens the picker OVER the sheet, and the
		// sheet sits later in Pos.vue's DOM, so an equal z-index would paint
		// the picker underneath the surface that summoned it. Both are capped
		// by `isolation: isolate` exactly the same way — the coupling this
		// file pins is unchanged by the value.
		for (const [src, z] of [
			[lineSrc, 30],
			[lotSrc, 31],
		] as const) {
			expect(src).toMatch(new RegExp(`z-index:\\s*${z}`));
			expect(src).toMatch(/isolation: isolate[\s\S]*Teleport to="body"[\s\S]*LAYOUT-F3/);
		}
	});
});
