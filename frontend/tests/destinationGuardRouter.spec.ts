// @vitest-environment jsdom
/**
 * The URL half of the capability gate (roadmap §17.7).
 *
 * `useDestinationRouting` already tests the DECISION as a pure function. This
 * file tests the INSTALLATION — that `router/index.ts` actually asks, and that
 * the two ways an installed guard goes wrong are closed:
 *
 *  1. asking before the register has booted, which refuses everything because
 *     `shiftOpen` reads false on a register that has merely not answered yet;
 *  2. redirecting `/pos` to `/pos`, which loops the router forever, because
 *     `/pos` is itself the `sale` destination and `sale` is gated on the shift
 *     like everything else.
 *
 * Neither is hypothetical: (1) breaks a cold-boot deep link into
 * `/cash-movement`, which works today, and (2) hangs the app on any register
 * with no shift open — the state every register is in at 8am.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { setActivePinia } from "pinia";

import { pinia } from "../src/posapp/stores";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { resolveDestinationRedirect } from "../src/posapp/router/index";

const booted = (over: { shift?: unknown; profile?: Record<string, unknown> } = {}) => {
	const ui = useUIStore(pinia);
	// `capabilityPayload` is what marks the register as having answered.
	ui.capabilityPayload = { name: "test-preset" };
	ui.posOpeningShift = "shift" in over ? over.shift : { name: "POSA-OS-TEST" };
	ui.posProfile = (over.profile ?? {}) as never;
	return ui;
};

describe("destination guard, as the router installs it", () => {
	beforeEach(() => {
		setActivePinia(pinia);
		const ui = useUIStore(pinia);
		ui.capabilityPayload = null;
		ui.posOpeningShift = null;
		ui.posProfile = null;
		(window as unknown as { serverOnline?: boolean }).serverOnline = true;
	});

	it("asks nothing before the register has booted", () => {
		// No capability payload and no shift: the preset has not arrived, so
		// there is no question to ask. A cold-boot deep link must survive.
		expect(resolveDestinationRedirect("/cash-movement")).toBeNull();
		expect(resolveDestinationRedirect("/closing")).toBeNull();
	});

	it("lets a path that is not a destination alone", () => {
		booted();
		expect(resolveDestinationRedirect("/reports")).toBeNull();
		expect(resolveDestinationRedirect("/barcode")).toBeNull();
	});

	it("never redirects a path to itself, so a closed shift cannot loop", () => {
		// `/pos` is the `sale` destination and `sale` is shift-gated, so the
		// raw guard refuses it and names `/pos` as the fallback. Following that
		// would re-enter the guard on the same path forever.
		booted({ shift: null });
		expect(resolveDestinationRedirect("/pos")).toBeNull();
	});

	it("sends a gated destination back to the sale", () => {
		// Booted, shift open, but the preset grants nothing — so a destination
		// with a capability or profile-flag gate is not configured on here.
		booted();
		const gatedPaths = ["/floor"];
		for (const path of gatedPaths) {
			expect(resolveDestinationRedirect(path)).toBe("/pos");
		}
	});

	it("opens a gated destination once its capability is granted", () => {
		booted();
		const ui = useUIStore(pinia);
		ui.capabilityPayload = { name: "restaurante-mesas", capabilities: ["tables"] };
		expect(resolveDestinationRedirect("/floor")).toBeNull();
	});

	it("ignores the query string when matching a destination", () => {
		booted();
		expect(resolveDestinationRedirect("/floor?table=4")).toBe("/pos");
	});

	it("degrades to allowing rather than stranding the cashier when the gate throws", () => {
		booted();
		// A store that throws is the shape of a boot half-done. A blank router
		// is a worse outcome than an ungated URL, so the guard swallows and
		// allows. `posOpeningShift` is the read to break because
		// `buildActivationContext` reaches for it unconditionally — a
		// capability-gated path never calls `hasProfileFlag` at all, so
		// breaking THAT would have tested nothing while looking like it did.
		const ui = useUIStore(pinia);
		Object.defineProperty(ui, "posOpeningShift", {
			get() {
				throw new Error("store exploded mid-boot");
			},
			configurable: true,
		});
		expect(resolveDestinationRedirect("/floor")).toBeNull();
	});
});
