/**
 * State stays READABLE on the five surfaces the rail promoted from dialogs to
 * destinations (docs/POS-RIEL-Y-CAJON-BUILD.md §2, roadmap §17.7 invariant 2).
 *
 * ## What moved out of this file
 *
 * This suite used to count state-coloured action fills on five named files,
 * because `singleAccent.spec.ts` walked `components/pos/shell/**` and could
 * not see them. Two partial scans watching different corners is the same
 * hand-kept-scope failure in two places, so the counting moved into
 * `singleAccent.spec.ts`, which now walks `src/posapp` whole and covers these
 * five along with everything else. Its allowlist carries the two documented
 * survivors — `OfflineInvoices.vue`'s "Eliminar definitivamente" and
 * `CashMovementHistory.vue`'s row Delete, both irreversible acts where red is
 * a safety affordance — so they remain a decision on the record.
 *
 * ## What stays here, and why a scan cannot take it
 *
 * The invariant permits colour as STATE. It does not permit colour as the
 * ONLY carrier of state: a colourblind operator must still be able to READ
 * the status. That is a property of the pairing between a colour and a label,
 * and no fill-counting scan can express it — a status chip that quietly lost
 * its text would keep passing every accent check in the tree while becoming
 * unreadable to the operator it matters most to.
 *
 * Source-scanned, not mounted, for the reason `singleAccent.spec.ts` gives:
 * the guarantee is "no such declaration exists", and only a scan proves a
 * negative. No jsdom — this reads real files.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = resolve(__dirname, "../src/posapp/components");

/** The five surfaces the rail now reaches, by the operator's name for them. */
const DESTINATIONS: Record<string, string> = {
	Facturas: "pos/flows/InvoiceManagement.vue",
	"Facturas offline": "OfflineInvoices.vue",
	Devolución: "pos/flows/Returns.vue",
	"Movimientos de caja": "pos/cash/CashMovementHistory.vue",
	Corte: "pos/shell/ClosingDialog.vue",
};

describe("the rail's five destinations are all still there", () => {
	it.each(Object.entries(DESTINATIONS))("%s exists at %s", (_name, path) => {
		// A path typo would silently pass every assertion below, and a
		// destination that moved without this list moving is a surface nobody
		// is checking any more.
		const file = resolve(COMPONENTS, path);
		expect(existsSync(file)).toBe(true);
		expect(readFileSync(file, "utf8").length).toBeGreaterThan(0);
	});
});

describe("state stays readable without colour", () => {
	it("the movements status chip pairs its colour with a text label", () => {
		const source = readFileSync(resolve(COMPONENTS, DESTINATIONS["Movimientos de caja"]), "utf8");
		expect(source).toMatch(/:color="statusColor\(item\.docstatus\)"/);
		expect(source).toMatch(/statusLabel\(item\.docstatus\)/);
		expect(source).toMatch(/function statusLabel/);
	});

	it("keeps the offline pending-count chip, which is state and not emphasis", () => {
		const source = readFileSync(resolve(COMPONENTS, DESTINATIONS["Movimientos de caja"]), "utf8");
		expect(source).toMatch(/pendingOfflineCount > 0/);
	});

	it("the invoice status chips print the status they are colouring", () => {
		// `InvoiceManagement.vue` is the surface an earlier pass flagged as
		// holding three "fills" — a warning chip, an error chip and a status
		// chip. Measured, it holds no state-coloured BUTTON fill at all: every
		// one of them is a `v-chip` whose colour sits beside the word it means.
		// That is the permitted use, and this pins the pairing so it cannot
		// decay into colour alone.
		const source = readFileSync(resolve(COMPONENTS, DESTINATIONS.Facturas), "utf8");
		expect(source).toMatch(/:color="statusColor\(item\.status\)"/);
		expect(source).toMatch(/__\(item\.status \|\| "Draft"\)/);
		expect(source).toMatch(/repairStateLabel\(changeAllocationRepairState\(/);
	});
});
