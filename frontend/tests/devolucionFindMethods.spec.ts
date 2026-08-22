import { describe, expect, it } from "vitest";

import {
	RETURN_FIND_METHODS,
	chordsForAction,
	defaultFindMethod,
	describeFindMethods,
	isReturnFindMethodId,
} from "../src/posapp/components/pos/flows/returns/findMethods";
import { MUELLE_DEFAULT } from "../src/posapp/shortcuts/keymap";
import { resolveKeymap } from "../src/posapp/shortcuts/engine";
import { SHORTCUT_ACTIONS } from "../src/posapp/shortcuts/actions";

const ALL = { serialIdentity: true, noReceiptReturns: true };
const NONE = { serialIdentity: false, noReceiptReturns: false };
const active = () => resolveKeymap(MUELLE_DEFAULT);

describe("which ways of finding a sale this register offers", () => {
	it("offers all five when the preset and the profile allow them", () => {
		expect(describeFindMethods(ALL, active()).map((m) => m.id)).toEqual([
			"ticket",
			"item",
			"customer",
			"serial",
			"noReceipt",
		]);
	});

	it("drops the IMEI search on a giro that does not track serials", () => {
		// §4.2: what the giro does not use does not appear. A carnicería gets
		// four ways, not five with one greyed out (R3).
		const ids = describeFindMethods({ ...ALL, serialIdentity: false }, active()).map((m) => m.id);
		expect(ids).not.toContain("serial");
		expect(ids).toContain("ticket");
	});

	it("drops the no-ticket path when the profile does not allow it", () => {
		const ids = describeFindMethods({ ...ALL, noReceiptReturns: false }, active()).map((m) => m.id);
		expect(ids).not.toContain("noReceipt");
	});

	it("keeps the ungated ways on a register that grants nothing", () => {
		expect(describeFindMethods(NONE, active()).map((m) => m.id)).toEqual([
			"ticket",
			"item",
			"customer",
		]);
	});

	it("opens on a search, never on the supervised path", () => {
		// Landing on "sin ticket" would put the exception in front of the
		// cashier before the ordinary route.
		expect(defaultFindMethod(ALL)).toBe("ticket");
		expect(defaultFindMethod(NONE)).toBe("ticket");
	});

	it("narrows a foreign string to a method id", () => {
		expect(isReturnFindMethodId("serial")).toBe(true);
		expect(isReturnFindMethodId("por-serie")).toBe(false);
		expect(isReturnFindMethodId(null)).toBe(false);
	});
});

describe("chips come from the keymap, not from the artboard", () => {
	it("draws no chip on any way, because the default pack binds none of them", () => {
		// R8, restated for this screen: the artboard prints F1–F4 and
		// `MUELLE_DEFAULT` binds none of those to a return search. A chip here
		// would teach a cashier a key that does nothing.
		for (const method of describeFindMethods(ALL, active())) {
			expect(method.chords, `${method.id} drew a chip for an unbound action`).toEqual([]);
		}
	});

	it("keeps F4 out of it — that key already switches employee", () => {
		// The mock draws F4 on "Por serie o IMEI". F4 has meant
		// `employee.switch` since before the shortcuts engine existed, and the
		// pack's whole contract is that trained fingers keep working (R8).
		expect(MUELLE_DEFAULT.bindings["employee.switch"]).toEqual(["f4"]);
		const f4Owners = active()
			.bindings.filter((binding) => binding.chord.id === "f4")
			.map((binding) => binding.actionId);
		expect(f4Owners).toEqual(["employee.switch"]);
	});

	it("registers no invented action id", () => {
		// railDestinations.ts's rule, applied here: an unbound method is legal,
		// an id the registry does not know is not — the cheat sheet and
		// conflict detection both resolve against that registry.
		const known = new Set(SHORTCUT_ACTIONS.map((action) => action.id));
		for (const method of RETURN_FIND_METHODS) {
			if (method.shortcutActionId !== null) {
				expect(known.has(method.shortcutActionId), method.shortcutActionId).toBe(true);
			}
		}
	});

	it("renders the chord the moment an action IS bound", () => {
		// The seam the lead's three-file change lands on: this module needs no
		// edit beyond filling in the id.
		expect(chordsForAction("returns.open", active())).toEqual(["Alt + 8"]);
		expect(chordsForAction("payment.open", active())).toEqual(["Alt + D", "Alt + Page Up"]);
	});

	it("refuses to draw a chip for an id the registry never heard of", () => {
		expect(chordsForAction("returns.findByTicket", active())).toEqual([]);
		expect(chordsForAction(null, active())).toEqual([]);
		expect(chordsForAction("returns.open", null)).toEqual([]);
	});
});

describe("every method points at the code that answers it", () => {
	it("names a data source, so the claim can be re-read", () => {
		for (const method of RETURN_FIND_METHODS) {
			expect(method.dataSource, method.id).toBeTruthy();
		}
	});

	it("marks the no-ticket path as supervised rather than as a fifth search", () => {
		const noReceipt = RETURN_FIND_METHODS.find((m) => m.id === "noReceipt");
		expect(noReceipt?.kind).toBe("supervised");
		expect(RETURN_FIND_METHODS.filter((m) => m.kind === "search")).toHaveLength(4);
	});
});
