/**
 * Server ↔ frontend keymap vocabulary contract (roadmap §17.3).
 *
 * The capability profile validates `keymap_id` against a server-side list;
 * the SPA resolves packs from its own registry. Two lists, one vocabulary —
 * so a pack added on one side and forgotten on the other fails here rather
 * than at a counter, where it would look like "the manager saved it and the
 * keys did not change". No jsdom: this reads real files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { KEYMAP_PACKS } from "../src/posapp/shortcuts/keymap";

describe("server ↔ frontend keymap vocabulary contract", () => {
	it("VALID_KEYMAPS names exactly the packs the SPA ships", () => {
		const controller = readFileSync(
			resolve(
				__dirname,
				"../../posawesome/posawesome/doctype/pos_capability_profile/pos_capability_profile.py",
			),
			"utf8",
		);
		const match = controller.match(/VALID_KEYMAPS = \(([^)]*)\)/);
		expect(match, "VALID_KEYMAPS not found in the capability profile controller").toBeTruthy();
		const serverPacks = [...match![1].matchAll(/"([^"]*)"/g)]
			.map((m) => m[1])
			.filter(Boolean)
			.sort();
		expect(serverPacks).toEqual(Object.keys(KEYMAP_PACKS).sort());
	});
});
