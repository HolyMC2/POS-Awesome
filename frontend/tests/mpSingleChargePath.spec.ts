// @vitest-environment node
//
// Money invariant: a MercadoPago Point terminal charge (createPointOrder) may
// be triggered from EXACTLY ONE place — the sale finalize gate
// (useMpPointSaleGate). A second independent trigger double-charges the card:
// the standalone "Cobrar con terminal MP" button (MPPointDialog.vue) charged on
// click, its result fed nothing, and the gate then charged again at close once
// the first charge had finished. That button was removed; this pins it out.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			walk(full, out);
		} else if (/\.(ts|vue|js)$/.test(entry) && !/\.spec\./.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe("MercadoPago Point charges exactly once, from the sale gate", () => {
	it("has no createPointOrder call site other than useMpPointSaleGate", () => {
		const callers: string[] = [];
		for (const file of walk(SRC)) {
			const text = readFileSync(file, "utf8");
			// A CALL — `createPointOrder(` — excluding the export definition in
			// the service module (mp_point.ts).
			if (
				/createPointOrder\s*\(/.test(text) &&
				!/export function createPointOrder/.test(text)
			) {
				callers.push(path.relative(SRC, file).replace(/\\/g, "/"));
			}
		}
		expect(callers.sort()).toEqual([
			"posapp/composables/pos/payments/useMpPointSaleGate.ts",
		]);
	});

	it("no longer ships the standalone MPPointDialog charge button", () => {
		const dialog = path.join(SRC, "posapp/components/pos_pay/MPPointDialog.vue");
		let exists = true;
		try {
			statSync(dialog);
		} catch {
			exists = false;
		}
		expect(exists).toBe(false);
	});
});
