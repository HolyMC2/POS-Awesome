/**
 * Group changes on a limit-search profile must ASK THE SERVER.
 *
 * `posa_use_limit_search = 1` means the catalogue is never mass-loaded: the
 * in-memory `items` array holds only the last server page. `filterByGroup`'s
 * legacy tail — "just filter current items" — therefore showed a near-empty
 * grid for any group that page did not contain. Reproduced live on
 * doco-mirror 2026-08-24: picking «Audio» (47 items server-side) rendered
 * "No items found" beside four visible Bocinas, and only a full reload
 * (which refetches with the group already set) showed the group.
 *
 * Pinned at source level, the same way cobroSurface.spec.ts pins the shell:
 * the store's IndexedDB seams make a mounted-store test a mock tower, and a
 * rule that lives in the mocks is not enforced.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync(
	resolve(__dirname, "../src/posapp/stores/itemsStore.ts"),
	"utf8",
);

describe("filterByGroup on a limit-search profile", () => {
	it("routes the group change to a forced server read, not the local slice", () => {
		expect(storeSource).toMatch(
			/const filterByGroup = async \(group: string\) => \{[\s\S]{0,1400}else if \(limitSearchEnabled\.value\) \{[\s\S]{0,900}loadItems\(\{ forceServer: true, groupFilter: group \}\)/,
		);
	});

	it("keeps the local filter only for the non-limit-search fallback", () => {
		// The local tail must stay BEHIND the limit-search branch — reordering
		// them re-opens the empty-grid hole this spec exists for.
		const body = /const filterByGroup = async[\s\S]{0,2000}?\n\t\};/.exec(storeSource)?.[0] ?? "";
		const limitBranch = body.indexOf("limitSearchEnabled.value");
		const localTail = body.indexOf("filterItemsByGroup(items.value, group)");
		expect(limitBranch).toBeGreaterThan(-1);
		expect(localTail).toBeGreaterThan(limitBranch);
	});
});
