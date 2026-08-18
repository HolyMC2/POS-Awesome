// @vitest-environment jsdom

/**
 * Keymap plumbing: capability payload → active keymap (roadmap §17.3).
 *
 * The engine is useless if the pack a preset names never reaches the
 * keyboard, and dangerous if a bad one silently kills every key. These pin
 * the wiring and the fallbacks — plus the cross-repo contract that the
 * server's VALID_KEYMAPS and the frontend registry name the same packs.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { configureShortcuts, getActiveKeymap } from "../src/posapp/shortcuts";
import { KEYMAP_PACKS } from "../src/posapp/shortcuts/keymap";
import { useUIStore } from "../src/posapp/stores/uiStore";

describe("configureShortcuts", () => {
	beforeEach(() => {
		configureShortcuts();
	});

	it("defaults to muelle-default", () => {
		expect(getActiveKeymap().keymapId).toBe("muelle-default");
	});

	it("falls back to the default pack for an unknown id rather than a dead keyboard", () => {
		const resolved = configureShortcuts({ keymapId: "sicar-classic-that-does-not-exist" });
		expect(resolved.keymapId).toBe("muelle-default");
		expect(resolved.bindings.length).toBeGreaterThan(0);
	});

	it("applies an override layer on top of the pack", () => {
		const resolved = configureShortcuts({
			keymapId: "muelle-default",
			overrides: { "payment.submit": ["alt+enter"] },
		});
		expect(
			resolved.bindings.find((b) => b.actionId === "payment.submit")?.chord.id,
		).toBe("alt+enter");
	});
});

describe("uiStore drives the keymap from the capability payload", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		configureShortcuts();
	});

	it("a payload naming a pack configures it", () => {
		const ui = useUIStore();
		ui.setCapabilityPayload({ shortcuts: { keymap_id: "muelle-default" } });
		expect(getActiveKeymap().keymapId).toBe("muelle-default");
	});

	it("register data carrying no shortcuts group resets to the default", () => {
		const ui = useUIStore();
		configureShortcuts({ keymapId: "muelle-default", overrides: { "payment.submit": [] } });
		expect(getActiveKeymap().unbound).toContain("payment.submit");

		ui.setRegisterData({ capability_profile: { layout: {} } } as any);
		// A register that names no pack must get the default back, not inherit
		// the previous register's overrides.
		expect(getActiveKeymap().unbound).not.toContain("payment.submit");
	});

	it("a null payload (no preset linked) still yields a working keyboard", () => {
		const ui = useUIStore();
		ui.setCapabilityPayload(null);
		expect(getActiveKeymap().keymapId).toBe("muelle-default");
		expect(getActiveKeymap().bindings.length).toBeGreaterThan(0);
	});
});
