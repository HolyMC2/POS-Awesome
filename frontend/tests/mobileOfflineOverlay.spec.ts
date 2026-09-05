// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import MobileOfflineOverlay from "../src/posapp/components/pos/shell/mobile/MobileOfflineOverlay.vue";
import {
	OFFLINE_SURFACES,
	surfacesThatNeedSignal,
	surfacesThatWorkOffline,
} from "../src/posapp/components/pos/shell/mobile/offlineSurfaceManifest";

const mountOverlay = (props: Record<string, unknown> = {}) =>
	mount(MobileOfflineOverlay, {
		props: { visible: true, ...props },
		global: { plugins: [createVuetify()] },
	});

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("offline is a state, not a destination", () => {
	it("marks itself an overlay so a test can prove the dock survived", () => {
		const wrapper = mountOverlay();
		const root = wrapper.get('[data-testid="offline-overlay"]');

		expect(root.attributes("data-offline-scope")).toBe("overlay");
	});

	it("is not a dialog — it never traps focus or blocks the dock", () => {
		// The cashier must be able to tap Carrito while reading this. A focus
		// trap or `aria-modal` would make offline behave like a seventh
		// destination, which is exactly what the design refuses.
		const wrapper = mountOverlay();
		const root = wrapper.get('[data-testid="offline-overlay"]');

		expect(root.attributes("aria-modal")).toBeUndefined();
		expect(root.attributes("role")).toBe("status");
		expect(root.attributes("inert")).toBeUndefined();
	});

	it("announces politely instead of stealing focus mid-keystroke", () => {
		const wrapper = mountOverlay();

		expect(wrapper.get('[data-testid="offline-overlay"]').attributes("aria-live")).toBe(
			"polite",
		);
	});

	it("stops short of the dock rather than covering it", () => {
		const wrapper = mountOverlay({ dockHeight: 96 });

		expect(wrapper.get('[data-testid="offline-overlay"]').attributes("style")).toContain(
			"bottom: 96px",
		);
	});

	it("renders nothing at all when the register is online", () => {
		const wrapper = mountOverlay({ visible: false });

		expect(wrapper.find('[data-testid="offline-overlay"]').exists()).toBe(false);
	});
});

describe("the sheet folds out of the way so the sale can go on", () => {
	// Live drill 2026-09-04: the sheet stayed over the catalogue for the whole
	// outage — «You can: Charge and print» on a screen where no card could be
	// tapped. The sheet is for the moment the signal drops; the strip is for
	// the sale that goes on.
	it("opens as the full sheet, with a way to continue selling", () => {
		const wrapper = mountOverlay();
		expect(wrapper.get('[data-testid="offline-overlay"]').attributes("data-offline-collapsed")).toBe(
			"false",
		);
		expect(wrapper.find('[data-testid="offline-overlay-continue"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="offline-overlay-strip"]').exists()).toBe(false);
	});

	it("folds into a strip that keeps the count and the amount, and stops catching taps", async () => {
		const wrapper = mountOverlay({ pendingCount: 23, queuedAmountLabel: "$9,013.00" });
		await wrapper.get('[data-testid="offline-overlay-continue"]').trigger("click");

		const root = wrapper.get('[data-testid="offline-overlay"]');
		expect(root.attributes("data-offline-collapsed")).toBe("true");
		expect(root.classes()).toContain("mobile-offline-overlay--collapsed");
		const strip = wrapper.get('[data-testid="offline-overlay-strip"]');
		expect(strip.text()).toContain("23");
		expect(strip.text()).toContain("$9,013.00");
		// The reference columns are gone with the sheet; the strip is all that
		// is left over the screen.
		expect(wrapper.find(".mobile-offline-overlay__split").exists()).toBe(false);
		expect(wrapper.find('[data-testid="offline-overlay-continue"]').exists()).toBe(false);
	});

	it("tapping the strip reopens the details", async () => {
		const wrapper = mountOverlay();
		await wrapper.get('[data-testid="offline-overlay-continue"]').trigger("click");
		await wrapper.get('[data-testid="offline-overlay-strip"]').trigger("click");
		expect(wrapper.get('[data-testid="offline-overlay"]').attributes("data-offline-collapsed")).toBe(
			"false",
		);
	});

	it("a new outage opens the full sheet again", async () => {
		const wrapper = mountOverlay();
		await wrapper.get('[data-testid="offline-overlay-continue"]').trigger("click");
		await wrapper.setProps({ visible: false });
		await wrapper.setProps({ visible: true });
		expect(wrapper.get('[data-testid="offline-overlay"]').attributes("data-offline-collapsed")).toBe(
			"false",
		);
	});
});

describe("the one number that matters offline", () => {
	it("shows what has been taken but not yet banked", () => {
		const wrapper = mountOverlay({
			pendingCount: 23,
			queuedAmountLabel: "$9,013.00",
		});

		expect(wrapper.text()).toContain("$9,013.00");
		expect(wrapper.text()).toContain("23");
	});

	it("says ticket, not tickets, when there is exactly one", () => {
		const wrapper = mountOverlay({ pendingCount: 1, queuedAmountLabel: "$200.00" });

		expect(wrapper.text()).toContain("ticket");
		expect(wrapper.text()).not.toContain("tickets");
	});

	it("hides the elapsed block rather than showing an empty one", () => {
		const wrapper = mountOverlay({ offlineSinceLabel: "" });

		expect(wrapper.find(".mobile-offline-overlay__since").exists()).toBe(false);
	});

	it("shows how long the signal has been gone when the shell knows", () => {
		const wrapper = mountOverlay({ offlineSinceLabel: "1 h 47 m" });

		expect(wrapper.get(".mobile-offline-overlay__since-value").text()).toBe("1 h 47 m");
	});
});

describe("the offline surface manifest", () => {
	it("splits every declared surface into exactly one column", () => {
		const works = surfacesThatWorkOffline();
		const waits = surfacesThatNeedSignal();

		expect(works.length + waits.length).toBe(OFFLINE_SURFACES.length);
		expect(works.some((s) => waits.includes(s))).toBe(false);
	});

	it("declares an availability for every surface — §7 allows no silence", () => {
		for (const surface of OFFLINE_SURFACES) {
			expect(
				["available", "queued", "cached-read-only", "blocked"],
				`${surface.id} has no valid availability`,
			).toContain(surface.availability);
		}
	});

	it("blocks exactly the three round trips that have no local answer", () => {
		// Timbrado goes to the PAC, airtime is bought from the carrier in real
		// time, WhatsApp needs the network. Queueing any of them would promise
		// the customer something the register cannot deliver.
		expect(surfacesThatNeedSignal().map((s) => s.id)).toEqual([
			"cfdi",
			"recharges",
			"whatsapp",
		]);
	});

	it("keeps selling and printing available — the register's whole point", () => {
		const checkout = OFFLINE_SURFACES.find((s) => s.id === "checkout");

		expect(checkout?.availability).toBe("queued");
	});

	it("publishes each surface's availability to the DOM for the evidence lane", () => {
		const wrapper = mountOverlay();
		const cfdi = wrapper.get('[data-offline-surface="cfdi"]');

		expect(cfdi.attributes("data-offline-availability")).toBe("blocked");
	});
});
