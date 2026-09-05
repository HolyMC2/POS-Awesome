// @vitest-environment jsdom

/**
 * Shortcuts engine (roadmap §17.3).
 *
 * The first block is the one that matters most: a PARITY table of every chord
 * POSAwesome shipped before the engine existed, asserting each still resolves
 * to the behavior it always had. A cashier's fingers are the contract; this
 * table is how a keymap refactor proves it did not break them.
 */

import RowSource from "../src/posapp/components/pos/invoice/CartItemRow.vue?raw";
import { describe, expect, it } from "vitest";

import { SHORTCUT_ACTIONS, actionScope, getAction } from "../src/posapp/shortcuts/actions";
import {
	describeKeymap,
	formatChord,
	parseChord,
	resolveKeymap,
	resolveShortcutAction,
} from "../src/posapp/shortcuts/engine";
import { MUELLE_DEFAULT } from "../src/posapp/shortcuts/keymap";
import { INVOICE_SHORTCUT_EFFECTS } from "../src/posapp/components/pos/invoice/invoiceShortcuts";

const resolved = resolveKeymap(MUELLE_DEFAULT);

const alt = (key: string, code?: string) =>
	new KeyboardEvent("keydown", { key, code: code || key, altKey: true });
const bare = (key: string, code?: string) =>
	new KeyboardEvent("keydown", { key, code: code || key });

/** Every binding the pre-engine if-chain implemented, verbatim. */
const LEGACY_PARITY: Array<[string, KeyboardEvent, string]> = [
	["Alt+1 (number row)", alt("1", "Digit1"), "invoice.showInvoicePanel"],
	["Alt+1 (numpad)", alt("1", "Numpad1"), "invoice.showInvoicePanel"],
	["Alt+2", alt("2", "Digit2"), "invoice.cancelDialog"],
	["Alt+3", alt("3", "Digit3"), "items.focusSearch"],
	["Alt+4", alt("4", "Digit4"), "items.selectTop"],
	["Alt+5", alt("5", "Digit5"), "customer.focusSearch"],
	["Alt+6", alt("6", "Digit6"), "customer.selectFirst"],
	["Alt+7", alt("7", "Digit7"), "orders.openDrafts"],
	["Alt+8", alt("8", "Digit8"), "returns.open"],
	["Alt+9", alt("9", "Digit9"), "invoice.focusDeliveryCharges"],
	["Alt+backquote", alt("`", "Backquote"), "invoice.focusPostingDate"],
	["Alt+PageUp", alt("PageUp"), "payment.open"],
	["Alt+Home", alt("Home"), "app.goToDesk"],
	["Alt+Q", alt("q", "KeyQ"), "cart.focusQty"],
	["Alt+A", alt("a", "KeyA"), "invoice.focusAdditionalDiscount"],
	["Alt+U", alt("u", "KeyU"), "cart.focusUom"],
	["Alt+R", alt("r", "KeyR"), "cart.focusRate"],
	["Alt+E", alt("e", "KeyE"), "cart.removeFirstItem"],
	["Alt+F", alt("f", "KeyF"), "items.focusToolbarSearch"],
	["Alt+L", alt("l", "KeyL"), "invoice.openDrafts"],
	["Alt+M", alt("m", "KeyM"), "items.toggleSettings"],
	["Alt+S", alt("s", "KeyS"), "invoice.saveAndClear"],
	["Alt+D", alt("d", "KeyD"), "payment.open"],
	["Alt+X", alt("x", "KeyX"), "payment.submit"],
	["Alt+P", alt("p", "KeyP"), "payment.submitAndPrint"],
	["F4", bare("F4"), "employee.switch"],
	["F6", bare("F6"), "customer.new"],
	["F7", bare("F7"), "shift.details"],
	["F8", bare("F8"), "app.lockScreen"],
];

describe("legacy binding parity", () => {
	it.each(LEGACY_PARITY)("%s still triggers its action", (_label, event, actionId) => {
		expect(resolveShortcutAction(event, resolved)).toBe(actionId);
	});

	it("binds the legacy chords and nothing unaccounted for", () => {
		// Every chord in the shipped pack must be declared as either inherited
		// or deliberately added. A new binding that skips this list fails here
		// rather than surprising a cashier who leans on the same key.
		const LEGACY_CHORD_IDS = [
			"alt+1", "alt+2", "alt+3", "alt+4", "alt+5", "alt+6", "alt+7", "alt+8",
			"alt+9", "alt+backquote", "alt+pageup", "alt+home", "alt+q", "alt+a",
			"alt+u", "alt+r", "alt+e", "alt+f", "alt+l", "alt+m", "alt+s", "alt+d",
			"alt+x", "alt+p", "f4", "f6", "f7", "f8",
		];
		const ENGINE_ADDED_CHORDS = [
			"alt+h", // cheat sheet — discoverability shipped with the engine
			"alt+c", // price checker (§17.2)
		];
		// Riel y Cajón (§17.7) promoted six dialogs to rail destinations, and a
		// destination the rail can reach must be reachable from the keyboard
		// too. Mnemonics follow the operator's Spanish word — gasto, orden,
		// tiempo aire — because that is the word in the cashier's head.
		// Deliberately NOT F4: the artboard draws an F4 chip on the catalogue,
		// but F4 has meant `employee.switch` since before the engine, and this
		// pack's contract is that trained fingers keep working.
		const RAIL_DESTINATION_CHORDS = [
			"alt+g", // cash movement (gasto)
			"alt+i", // invoices
			"alt+o", // service orders (orden)
			"alt+t", // recharges (tiempo aire)
			"alt+b", // catalogue drawer
			"f9", // close shift — joins f7 details / f8 lock
		];
		// Cotizaciones (docs/DOCUMENTOS_GOLDEN_FLOW.md). Same rule as the rail
		// chords: the mnemonic follows the operator's word, cotización — and c,
		// o and t are already spent on the price check, the orden and the tiempo
		// aire, so it falls to the remaining letter in the word.
		const DOCUMENT_CHORDS = [
			"alt+z", // save the cart as a quotation
		];
		// The keyboard-driven register (2026-09-05, keymap v5). Two global
		// chords and the ROW scope: bare keys that only a focused cart line
		// answers (`ShortcutScope`), so they never reach the document
		// listener and a `p` typed in the search box stays a p.
		const KEYBOARD_REGISTER_CHORDS = [
			"alt+arrowdown", // jump to the cart lines
			"alt+w", // line discount (d = cobrar, e = quitar primera)
			"arrowup", "arrowdown", "plus", "minus", "numpadadd", "numpadsubtract",
			"q", "p", "d", "s", "enter", "delete", "escape",
		];
		const boundChords = [...new Set(resolved.bindings.map((b) => b.chord.id))].sort();
		expect(boundChords).toEqual(
			[
				...LEGACY_CHORD_IDS,
				...ENGINE_ADDED_CHORDS,
				...RAIL_DESTINATION_CHORDS,
				...DOCUMENT_CHORDS,
				...KEYBOARD_REGISTER_CHORDS,
			].sort(),
		);
	});

	it("uses key OR code, so a layout that reports only one still works", () => {
		// Spanish layout: `key` carries the letter, `code` is US-physical.
		expect(resolveShortcutAction(alt("q", "KeyZ"), resolved)).toBe("cart.focusQty");
		// Dead/absent key value: `code` alone must still resolve.
		expect(resolveShortcutAction(alt("", "KeyQ"), resolved)).toBe("cart.focusQty");
	});
});

describe("inherited modifier quirks are preserved, and now visible", () => {
	it("Alt+Shift+digit still fires the Alt binding (shift unchecked)", () => {
		const event = new KeyboardEvent("keydown", {
			key: "1",
			code: "Digit1",
			altKey: true,
			shiftKey: true,
		});
		expect(resolveShortcutAction(event, resolved)).toBe("invoice.showInvoicePanel");
	});

	it("Ctrl+Alt+digit does NOT fire — Ctrl is refused", () => {
		const event = new KeyboardEvent("keydown", {
			key: "1",
			code: "Digit1",
			altKey: true,
			ctrlKey: true,
		});
		expect(resolveShortcutAction(event, resolved)).toBeNull();
	});

	it("a bare digit without Alt does nothing", () => {
		expect(resolveShortcutAction(bare("1", "Digit1"), resolved)).toBeNull();
	});

	it("F-keys ignore modifiers (inherited), so Alt+F4 reaches F4's action", () => {
		expect(resolveShortcutAction(alt("F4"), resolved)).toBe("employee.switch");
	});
});

describe("keymap integrity", () => {
	it("the default pack has no conflicts and no packaging errors", () => {
		expect(resolved.conflicts).toEqual([]);
		expect(resolved.errors).toEqual([]);
	});

	it("every action in the registry is bound", () => {
		expect(resolved.unbound).toEqual([]);
	});

	it("every binding names a registered action", () => {
		for (const binding of resolved.bindings) {
			expect(getAction(binding.actionId), binding.actionId).toBeTruthy();
		}
	});

	it("action ids are unique", () => {
		const ids = SHORTCUT_ACTIONS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("one action may own several chords", () => {
		const payOpen = resolved.bindings.filter((b) => b.actionId === "payment.open");
		expect(payOpen.map((b) => b.chord.id).sort()).toEqual(["alt+d", "alt+pageup"]);
	});

	it("detects a conflict when two actions claim one chord", () => {
		const clashing = resolveKeymap({
			...MUELLE_DEFAULT,
			bindings: { ...MUELLE_DEFAULT.bindings, "returns.open": ["alt+x"] },
		});
		expect(clashing.conflicts).toEqual([
			{ chordId: "alt+x", actionIds: ["payment.submit", "returns.open"] },
		]);
	});
});

describe("chord parsing", () => {
	it("normalizes modifier order into a canonical id", () => {
		expect(parseChord("Alt+1").id).toBe("alt+1");
		expect(parseChord("alt+ctrl+q").id).toBe("ctrl+alt+q");
	});

	it("rejects garbage rather than silently binding nothing", () => {
		expect(() => parseChord("")).toThrow();
		expect(() => parseChord("alt+")).toThrow();
		expect(() => parseChord("alt")).toThrow();
		expect(() => parseChord("hyper+q")).toThrow();
	});

	it("formats chords for humans", () => {
		expect(formatChord(parseChord("alt+1"))).toBe("Alt + 1");
		expect(formatChord(parseChord("alt+pageup"))).toBe("Alt + Page Up");
		expect(formatChord(parseChord("alt+backquote"))).toBe("Alt + `");
		expect(formatChord(parseChord("f4"))).toBe("F4");
	});
});

describe("override layer", () => {
	it("replaces an action's chords wholesale", () => {
		const custom = resolveKeymap(MUELLE_DEFAULT, { "payment.submit": ["alt+enter"] });
		expect(resolveShortcutAction(alt("x", "KeyX"), custom)).toBeNull();
		expect(resolveShortcutAction(alt("Enter"), custom)).toBe("payment.submit");
	});

	it("can unbind an action with an empty list", () => {
		const custom = resolveKeymap(MUELLE_DEFAULT, { "payment.submit": [] });
		expect(resolveShortcutAction(alt("x", "KeyX"), custom)).toBeNull();
		expect(custom.unbound).toContain("payment.submit");
	});

	it("reports an override naming an unknown action instead of dropping it", () => {
		const custom = resolveKeymap(MUELLE_DEFAULT, { "payment.teleport": ["alt+t"] });
		expect(custom.errors).toContain("override names unknown action: payment.teleport");
	});

	it("reports a malformed chord instead of a dead key", () => {
		const custom = resolveKeymap(MUELLE_DEFAULT, { "payment.submit": ["alt+"] });
		expect(custom.errors.some((e) => e.startsWith("payment.submit:"))).toBe(true);
	});
});

describe("cheat sheet", () => {
	const sections = describeKeymap(resolved);

	it("groups in the declared category order", () => {
		expect(sections.map((s) => s.category)).toEqual([
			"navigation",
			"cart",
			"lines",
			"customer",
			"payment",
			"documents",
			"app",
		]);
	});

	it("shows every chord an action owns", () => {
		const payment = sections.find((s) => s.category === "payment");
		const open = payment?.entries.find((e) => e.actionId === "payment.open");
		expect(open?.chords).toEqual(["Alt + D", "Alt + Page Up"]);
	});

	it("omits unbound actions rather than lying about them", () => {
		const custom = resolveKeymap(MUELLE_DEFAULT, { "returns.open": [] });
		const ids = describeKeymap(custom).flatMap((s) => s.entries.map((e) => e.actionId));
		expect(ids).not.toContain("returns.open");
	});
});

describe("effects cover the invoice surface", () => {
	it("every bound action the invoice owns has an effect", () => {
		// The cheat-sheet action is the invoice surface's own; everything else
		// bound in the default pack must be implemented here too, or the key
		// would be advertised and do nothing.
		// Row-scoped actions are the CART LINE's (CartItemRow.onRowKeydown),
		// not the invoice's: the document listener never dispatches them.
		for (const binding of resolved.bindings) {
			if (actionScope(binding.actionId) === "row") continue;
			expect(
				INVOICE_SHORTCUT_EFFECTS[binding.actionId],
				`no effect for ${binding.actionId}`,
			).toBeTypeOf("function");
		}
	});

	it("the cart line answers every row-scoped action", () => {
		const rowIds = SHORTCUT_ACTIONS.filter((a) => a.scope === "row").map((a) => a.id);
		for (const id of rowIds) {
			expect(RowSource, `CartItemRow does not handle ${id}`).toContain(`case "${id}":`);
		}
	});
});
