import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Source guards for the dialogs that cannot be mounted in the jsdom spec:
// ItemsTable needs ~25 props and its whole cart subtree, while Returns and
// SalesOrders import "…Store.js" paths that vitest's resolver cannot follow
// (their SFC scripts are plain JS, so Vite's .js→.ts fallback skips them).
// Node env — the jsdom resolver used by dialogFullscreenXs.spec.ts has no
// node:fs.
const sourceOf = (path: string) => readFileSync(resolve(path), "utf8");

describe("cart item detail dialog", () => {
	it("binds its geometry through useDialogFullscreen", () => {
		const source = sourceOf(
			"src/posapp/components/pos/invoice/ItemsTable.vue",
		);

		expect(source).toContain(
			'<v-dialog v-model="detailDialogOpen" v-bind="detailDialogProps"',
		);
		expect(source).toContain("useDialogFullscreen({ maxWidth: 820 })");
		expect(source).not.toContain(
			'v-model="detailDialogOpen" max-width="820"',
		);
	});
});

describe("flows sheets that cannot be mounted", () => {
	const sheets = [
		{
			label: "Returns",
			path: "src/posapp/components/pos/flows/Returns.vue",
			width: 'width: "min(1120px, 96vw)"',
			maxWidth: 'maxWidth: "1120px"',
			legacyFlag: ':fullscreen="isCompactReturns"',
		},
		{
			label: "Sales Orders",
			path: "src/posapp/components/pos/flows/SalesOrders.vue",
			width: 'width: "min(980px, 96vw)"',
			maxWidth: 'maxWidth: "980px"',
			legacyFlag: ':fullscreen="isCompactOrders"',
		},
	];

	sheets.forEach(({ label, path, width, maxWidth, legacyFlag }) => {
		it(`${label} routes its geometry through useDialogFullscreen`, () => {
			const source = sourceOf(path);

			expect(source).toContain('v-bind="dialogProps"');
			expect(source).toContain("breakpoint: 1100");
			expect(source).toContain(width);
			expect(source).toContain(maxWidth);
			// The bug was :width surviving alongside :fullscreen on the dialog.
			expect(source).not.toContain(legacyFlag);
			expect(source).not.toContain(":width=");
		});
	});
});
