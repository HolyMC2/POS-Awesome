import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The connectivity prober must never be a lazy chunk.
 *
 * `useNetworkLifecycle` loaded `core/useNetwork` with a dynamic import the
 * first time the shell needed to probe the server — which, on a register
 * that booted with a live socket, is the moment the socket dies. Offline,
 * the chunk fetch failed, the chunk-recovery handler reloaded the register
 * mid-outage, and the prober never ran (demo-abarrotes.lab drill,
 * 2026-09-04). The code that decides whether we are offline cannot depend
 * on the network; pin the import shape so it cannot drift back.
 */
const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");

describe("network prober is bundled eagerly", () => {
	it("useNetworkLifecycle imports core/useNetwork statically, never with import()", () => {
		const source = read("posapp/composables/runtime/useNetworkLifecycle.ts");
		expect(source).not.toMatch(/import\(\s*["'][^"']*core\/useNetwork["']\s*\)/);
		expect(source).toMatch(/^import\s*\{[^}]*\}\s*from\s*["']\.\.\/core\/useNetwork["'];/m);
	});

	it("nothing else lazy-loads the prober either", () => {
		const offenders = [
			"posapp/composables/core/useAppResume.ts",
			"posapp/components/pos/offline/useOfflineQueue.ts",
			"posapp/layouts/DefaultLayout.vue",
		].filter((rel) => /import\(\s*["'][^"']*core\/useNetwork["']\s*\)/.test(read(rel)));
		expect(offenders).toEqual([]);
	});
});
