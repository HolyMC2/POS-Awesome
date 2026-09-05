import { describe, expect, it } from "vitest";

import {
	CATEGORY_ORDER,
	MUELLE_DEFAULT,
	SHORTCUT_ACTIONS,
	actionScope,
	describeKeymap,
	resolveKeymap,
	resolveRowShortcutAction,
	resolveShortcutAction,
} from "../src/posapp/shortcuts";
import { isSearchFieldPrimedForScan } from "../src/posapp/utils/keyboardScan";
import { parseQtyPrefix, stripQtyPrefix } from "../src/posapp/utils/searchQtyPrefix";
import RowSource from "../src/posapp/components/pos/invoice/CartItemRow.vue?raw";
import SelectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import SearchSource from "../src/posapp/composables/pos/items/useItemsSelectorSearch.ts?raw";
import EffectsSource from "../src/posapp/components/pos/invoice/invoiceShortcuts.ts?raw";
import EsCsv from "../../posawesome/translations/es.csv?raw";

/**
 * The keyboard-driven register (owner, 2026-09-05: «people using SICAR fast
 * af using keyboard only for searching, selecting, editing prices, discount…
 * lets add more keyboard driven actions», and «alt-3 should select the
 * searchbar and clean it»).
 *
 * Three promises are pinned. The ROW scope is invisible to the document
 * listener — a bare `p` typed in the search box must stay a p. The
 * multiplier `3*` is read the same way by the filter, the dispatch and the
 * scan primer. And the cheat sheet tells the cashier about every key, in the
 * cashier's words.
 */

const key = (k: string, code = "", mods: Partial<KeyboardEvent> = {}) =>
	({ key: k, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

const resolved = resolveKeymap(MUELLE_DEFAULT);

describe("keymap v5 — the row scope", () => {
	it("is a new revision, bound whole, with no clashes", () => {
		expect(MUELLE_DEFAULT.version).toBe(5);
		expect(resolved.errors).toEqual([]);
		expect(resolved.conflicts).toEqual([]);
		expect(resolved.unbound).toEqual([]);
	});

	it("names every line key as a row-scoped action", () => {
		const rowActions = SHORTCUT_ACTIONS.filter((a) => a.scope === "row").map((a) => a.id);
		expect(rowActions).toEqual([
			"row.previous",
			"row.next",
			"row.increment",
			"row.decrement",
			"row.quantity",
			"row.price",
			"row.discount",
			"row.lots",
			"row.details",
			"row.remove",
			"row.back",
		]);
		expect(actionScope("row.price")).toBe("row");
		expect(actionScope("payment.submit")).toBe("global");
	});

	it("keeps a bare key OUT of the global listener and IN the row", () => {
		const p = key("p", "KeyP");
		expect(resolveShortcutAction(p, resolved)).toBeNull();
		expect(resolveRowShortcutAction(p, resolved)).toBe("row.price");

		expect(resolveRowShortcutAction(key("ArrowDown", "ArrowDown"), resolved)).toBe("row.next");
		expect(resolveRowShortcutAction(key("+", "BracketRight"), resolved)).toBe("row.increment");
		expect(resolveRowShortcutAction(key("+", "BracketRight", { altKey: true }), resolved)).toBeNull();
		expect(resolveRowShortcutAction(key("+", "NumpadAdd"), resolved)).toBe("row.increment");
		expect(resolveRowShortcutAction(key("-", "NumpadSubtract"), resolved)).toBe("row.decrement");
		expect(resolveRowShortcutAction(key("Delete", "Delete"), resolved)).toBe("row.remove");
		expect(resolveRowShortcutAction(key("Escape", "Escape"), resolved)).toBe("row.back");
		expect(resolveRowShortcutAction(key("Enter", "Enter"), resolved)).toBe("row.details");
		expect(resolveRowShortcutAction(key("s", "KeyS"), resolved)).toBe("row.lots");
	});

	it("reaches the lines and the line discount from anywhere", () => {
		expect(resolveShortcutAction(key("ArrowDown", "ArrowDown", { altKey: true }), resolved)).toBe(
			"cart.focusRows",
		);
		expect(resolveShortcutAction(key("w", "KeyW", { altKey: true }), resolved)).toBe("cart.focusDiscount");
		// …and a row key never answers a global chord.
		expect(resolveRowShortcutAction(key("ArrowDown", "ArrowDown", { altKey: true }), resolved)).toBeNull();
	});

	it("draws the lines section on the cheat sheet, in the cashier's keys", () => {
		expect(CATEGORY_ORDER).toEqual(["navigation", "cart", "lines", "customer", "payment", "documents", "app"]);
		const lines = describeKeymap(resolved).find((s) => s.category === "lines");
		expect(lines?.label).toBe("Cart lines · with a line focused");
		const chords = Object.fromEntries((lines?.entries ?? []).map((e) => [e.actionId, e.chords]));
		expect(chords["row.previous"]).toEqual(["↑"]);
		expect(chords["row.increment"]).toEqual(["+", "Num +"]);
		expect(chords["row.decrement"]).toEqual(["−", "Num −"]);
		expect(chords["row.remove"]).toEqual(["Supr"]);
		expect(chords["row.back"]).toEqual(["Esc"]);
		const cart = describeKeymap(resolved).find((s) => s.category === "cart");
		expect(cart?.entries.find((e) => e.actionId === "cart.focusRows")?.chords).toEqual(["Alt + ↓"]);
	});
});

describe("the multiplier in the search box", () => {
	it("reads qty*term and qty* alone", () => {
		expect(parseQtyPrefix("3*coca")).toEqual({ qty: 3, term: "coca", armed: false });
		expect(parseQtyPrefix("3 * coca cola")).toEqual({ qty: 3, term: "coca cola", armed: false });
		expect(parseQtyPrefix("2.5*")).toEqual({ qty: 2.5, term: "", armed: true });
		expect(parseQtyPrefix("1,5*kg")).toEqual({ qty: 1.5, term: "kg", armed: false });
		expect(stripQtyPrefix("12*7501055300013")).toBe("7501055300013");
	});

	it("leaves an ordinary term, a bare code and a zero alone", () => {
		expect(parseQtyPrefix("coca")).toEqual({ qty: null, term: "coca", armed: false });
		expect(parseQtyPrefix("7501055300013")).toEqual({ qty: null, term: "7501055300013", armed: false });
		expect(parseQtyPrefix("0*coca").qty).toBeNull();
		expect(parseQtyPrefix("")).toEqual({ qty: null, term: "", armed: false });
	});

	it("still primes a scan behind a multiplier", () => {
		expect(isSearchFieldPrimedForScan("")).toBe(true);
		expect(isSearchFieldPrimedForScan("3*")).toBe(true);
		expect(isSearchFieldPrimedForScan("3*75010")).toBe(true);
		expect(isSearchFieldPrimedForScan("coca")).toBe(false);
	});

	it("adds the highlighted result on Enter before any profile re-searches", () => {
		// Limit-search profiles (Doco Ventas) re-ran the server search on Enter
		// even with a row highlighted, so ↓ then Enter never added anything.
		const highlighted = SearchSource.indexOf("if (getHighlightedIndex(itemSelection || vm.itemSelection) >= 0) {");
		const limit = SearchSource.indexOf("if (usesLimitSearch(vm)) {\n\t\t\tif (event && typeof event.preventDefault");
		expect(highlighted).toBeGreaterThan(-1);
		expect(limit).toBeGreaterThan(highlighted);
	});

	it("is read by the filter, the dispatch and the add path", () => {
		expect(SelectorSource).toContain("const term = stripQtyPrefix(");
		expect(SelectorSource).toContain("const parsed = parseQtyPrefix(next);");
		expect(SearchSource).toContain("const prefixed = parseQtyPrefix(rawQuery);");
		expect(SearchSource).toContain("vm.qty = prefixed.qty;");
	});
});

describe("wiring pins", () => {
	it("a cart line is a keyboard target that answers the row scope", () => {
		expect(RowSource).toContain('data-pos-keyboard-target="cart-row"');
		expect(RowSource).toContain("data-pos-keyboard-native-arrows");
		expect(RowSource).toContain('@keydown="onRowKeydown"');
		expect(RowSource).toContain("const action = rowActionForEvent(event);");
		// Bare keys must not steal keystrokes from an editor open inside the row.
		expect(RowSource).toContain("isEditableElement(event.target)) return;");
		expect(RowSource).toContain('rowBus?.emit("movil:edit-lots", {');
	});

	it("Alt+3 resets the box and Alt+↓ lands on the last line", () => {
		expect(EffectsSource).toContain("this.uiStore.triggerItemSearchReset();");
		expect(EffectsSource).toContain('querySelectorAll<HTMLElement>(".posa-cart-item-row[tabindex]")');
		expect(SelectorSource).toContain("if (uiStore.searchFocusResetPending) {");
	});

	it("ships the Spanish the cheat sheet asks for", () => {
		for (const row of [
			"Cart lines · with a line focused,Líneas del carrito · con una línea enfocada",
			"Jump to the cart lines,Ir a las líneas del carrito",
			"Change the price,Cambiar el precio",
			"Line discount %,Descuento % de la línea",
			"Back to search,Volver al buscador",
			"Clears the box · type 3* before a term or a scan to add three,Limpia el buscador · escribe 3* antes del término o del escaneo para agregar tres",
		]) {
			expect(EsCsv).toContain(row);
		}
	});
});
