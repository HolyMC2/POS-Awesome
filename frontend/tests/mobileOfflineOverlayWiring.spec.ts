// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The phone's offline layer shows one number: what the shop has taken but
 * not banked. Pos.vue used to pass a literal 0 and "" for it — the strip read
 * «0 tickets» over a queue holding the day's sales (live drill 2026-09-04).
 * The figures have to come from the write queue, through the same seam the
 * queue view uses. A source pin, because the shell is a 3k-line options
 * component that no unit harness mounts.
 */
describe("the shell feeds the offline layer real figures", () => {
	const shell = readFileSync(
		fileURLToPath(new URL("../src/posapp/components/pos/shell/Pos.vue", import.meta.url)),
		"utf8",
	);

	it("reads the count and the amount from the offline queue, not from constants", () => {
		expect(shell).toContain("useOfflineQueue()");
		expect(shell).toMatch(/queuedInvoiceCount = computed\(/);
		expect(shell).toMatch(/queuedAmountLabel = computed\(/);
		expect(shell).not.toMatch(/queuedInvoiceCount = ref\(0\)/);
		expect(shell).not.toMatch(/queuedAmountLabel = ref\(""\)/);
	});

	it("refreshes the figures when the pending count or the connection moves", () => {
		expect(shell).toMatch(/syncStore\.pendingInvoicesCount,\s*isOnline\.value/);
		expect(shell).toContain("offlineQueue.refresh()");
	});
});
