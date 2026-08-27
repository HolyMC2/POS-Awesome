import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for the ONE duplicated predicate in this change.
 *
 * `InvoiceSummary` has to know whether the shell's `ActionBand` is mounted, and
 * no prop carries that down — the summary hangs off `Invoice.vue`, and telling
 * it would mean editing `Pos.vue`. So `bandLaneOwnership.ts` restates
 * `railVisible`'s condition, and this file exists so the restatement cannot
 * quietly stop matching.
 *
 * Node env on purpose: `node:fs` named imports do not interop under jsdom, the
 * same reason `cartActionBarLayout.spec.ts` is node.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("bandLaneOwnership tracks Pos.vue's railVisible", () => {
	it("both are expressed by leanVerticalLayout and the 1100px step", () => {
		const shell = read("../src/posapp/components/pos/shell/Pos.vue");
		const predicate = read("../src/posapp/components/pos/invoice/bandLaneOwnership.ts");

		// The shell's chain: railVisible ← useCompactPosSwitcher ← these two.
		expect(shell).toMatch(/railVisible\s*=\s*computed\(\(\)\s*=>\s*!useCompactPosSwitcher/);
		expect(shell).toMatch(/useCompactPosSwitcher\s*=\s*computed\([\s\S]{0,160}leanVerticalLayout/);
		expect(shell).toMatch(/useCompactPosSwitcher\s*=\s*computed\([\s\S]{0,160}1100/);

		// The summary's restatement must use the same two inputs and the same
		// step. If someone moves the breakpoint in one file only, this fails
		// here rather than as two totals on a cashier's screen.
		expect(predicate).toContain("leanVerticalLayout");
		expect(predicate).toContain("1100");
	});

	it("the band is shown under the same condition it is yielded to", () => {
		const shell = read("../src/posapp/components/pos/shell/Pos.vue");
		// A band shown on a condition LOOSER than railVisible would appear
		// where the summary has not yielded, which is the defect in reverse.
		// v-show, NEVER v-if: the summaries `<Teleport defer>` into the band's
		// lanes while staying mounted themselves, and the parent-first patch
		// order means a v-if would destroy those targets before the teleports
		// can stand down — the resize-crossing crash of 2026-08-26.
		expect(shell).toMatch(/<ActionBand[\s\S]{0,700}v-show="railVisible"/);
		expect(shell).not.toMatch(/<ActionBand[\s\S]{0,700}v-if="railVisible"/);
	});
});
