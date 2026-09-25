/**
 * A paquete on the cart: its line, its picks, and keeping the two in step.
 *
 * `comboChoice.ts` owns the rules; this module turns a confirmed pick into
 * cart lines and keeps them honest afterwards. Every line is built by the
 * register's own `getNewItem`, so a pick carries the same warehouse, UOM
 * table and base-currency fields as any line — then it is PINNED
 * (`locked_price`), the same pin `free_items.ts` and the credit sale use, so
 * no repricing (customer change, pricing rules, the background detail sync)
 * can move a pick off the price the server will vouch for.
 *
 * Lines are added straight to the store, like a free item: the generic add
 * pipeline would merge a pick into a plain line of the same item, and its
 * stock gate speaks about one line where a paquete is several.
 */

import {
	COMBO_BROKEN_FIELD,
	COMBO_COMPONENTS_FIELD,
} from "../items/comboLineAttachment";
import {
	COMBO_GROUP_FIELD,
	COMBO_PARENT_FIELD,
	comboChildrenOf,
	selectedPicks,
	selectionComponents,
	type ChoiceCombo,
	type ComboChoiceResult,
} from "./comboChoice";

export interface ChoiceCartDeps {
	/** The register's line builder (`useItemCreation().getNewItem`). */
	getNewItem: (_item: any, _context: any) => any;
	/** Stock-UOM quantity for a line (`useStockUtils().calcStockQty`). */
	calcStockQty?: (_line: any, _qty: number) => void;
	/** A catalogue row for an item code, when the register holds one. */
	lookupItem?: (_itemCode: string) => any;
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

const round = (value: number, places = 6): number => {
	const factor = 10 ** places;
	return Math.round((value + Number.EPSILON) * factor) / factor;
};

const cartItems = (context: any): any[] => {
	const items = context?.invoiceStore?.items ?? context?.items ?? [];
	return Array.isArray(items) ? items : [];
};

/**
 * Invoice-currency factor for a company-currency amount. Extra charges are
 * configured in company currency (`POS Combo Option.extra_price`), and the
 * server divides by the invoice's conversion rate to vouch for them.
 */
const conversionFor = (context: any): number => {
	const company = context?.pos_profile?.currency;
	const selected = context?.selected_currency || company;
	return selected && company && selected !== company ? toNumber(context?.conversion_rate) || 1 : 1;
};

const setMoney = (line: any, qty: number, unit: number, unitBase: number): void => {
	line.qty = qty;
	line.rate = unit;
	line.price_list_rate = unit;
	line.base_rate = unitBase;
	line.base_price_list_rate = unitBase;
	line.discount_percentage = 0;
	line.discount_amount = 0;
	line.base_discount_amount = 0;
	line.amount = round(qty * unit, 2);
	line.base_amount = round(qty * unitBase, 2);
};

/** The paquete's own line: its Item Price, the picks listed for the cart row. */
const buildHeader = (
	catalogItem: any,
	combo: ChoiceCombo,
	result: ComboChoiceResult,
	context: any,
	deps: ChoiceCartDeps,
): any => {
	const template: any = {
		...(catalogItem ?? {}),
		item_code: combo.item_code,
		item_name: catalogItem?.item_name || combo.item_name,
		image: catalogItem?.image ?? combo.image ?? null,
		qty: result.qty,
	};
	// A tap from a card that is not in the loaded catalogue arrives as a bare
	// `{ item_code }`; the paquete's published price stands in until the
	// background detail sync confirms it, as it does for any bare add.
	if (!(toNumber(template.rate) > 0) && !(toNumber(template.price_list_rate) > 0)) {
		template.rate = combo.rate;
		template.price_list_rate = combo.rate;
	}
	const header = deps.getNewItem(template, context);
	header.qty = result.qty;
	header[COMBO_COMPONENTS_FIELD] = selectionComponents(combo, result.selection);
	header[COMBO_BROKEN_FIELD] = 0;
	header._needs_update = true;
	header.amount = round(result.qty * toNumber(header.rate), 2);
	deps.calcStockQty?.(header, header.qty);
	return header;
};

/** One line per picked option, pinned at the option's extra charge. */
const buildPicks = (
	header: any,
	combo: ChoiceCombo,
	result: ComboChoiceResult,
	context: any,
	deps: ChoiceCartDeps,
): any[] => {
	const conversion = conversionFor(context);
	return selectedPicks(combo, result.selection).map(({ group, option, picks }) => {
		const qty = round(result.qty * picks * option.qty);
		const unitBase = option.qty > 0 ? option.extra_price / option.qty : 0;
		const unit = unitBase / conversion;
		const row = deps.lookupItem?.(option.item_code) ?? null;
		const stockUom = row?.stock_uom || option.uom || row?.uom || null;
		const template: any = {
			...(row ?? {}),
			item_code: option.item_code,
			item_name: row?.item_name || option.item_name,
			image: row?.image ?? option.image,
			stock_uom: stockUom,
			// Picks are counted in stock units: the server divides the line's
			// stock quantity by the option's qty per pick.
			uom: stockUom,
			conversion_factor: 1,
			item_uoms: stockUom ? [{ uom: stockUom, conversion_factor: 1 }] : [],
			is_stock_item: option.is_stock_item ? 1 : 0,
			qty,
			rate: unit,
			price_list_rate: unit,
			base_rate: unitBase,
			base_price_list_rate: unitBase,
		};
		if (option.actual_qty !== null) template.actual_qty = option.actual_qty;
		const line = deps.getNewItem(template, context);
		setMoney(line, qty, unit, unitBase);
		line.conversion_factor = 1;
		line.locked_price = true;
		line._manual_rate_set = true;
		line[COMBO_PARENT_FIELD] = header.posa_row_id;
		line[COMBO_GROUP_FIELD] = group.name;
		line._needs_update = true;
		deps.calcStockQty?.(line, qty);
		return line;
	});
};

/** The paquete line and its picks, in cart order. Nothing is added. */
export const buildChoiceLines = (
	catalogItem: any,
	combo: ChoiceCombo,
	result: ComboChoiceResult,
	context: any,
	deps: ChoiceCartDeps,
): any[] => {
	const header = buildHeader(catalogItem, combo, result, context, deps);
	return [header, ...buildPicks(header, combo, result, context, deps)];
};

const insertLines = (lines: any[], index: number, context: any): any[] => {
	if (context?.invoiceStore?.addItems) {
		return context.invoiceStore.addItems(lines, index) ?? lines;
	}
	const items = context?.items;
	if (Array.isArray(items)) {
		items.splice(Math.max(0, index), 0, ...lines);
	}
	return lines;
};

/**
 * Put a confirmed paquete on the cart, at the top like any fresh line.
 * Returns the paquete line (the store's reactive copy when there is a store).
 */
export const addChoiceCombo = (
	catalogItem: any,
	combo: ChoiceCombo,
	result: ComboChoiceResult,
	context: any,
	deps: ChoiceCartDeps,
): any => {
	const lines = buildChoiceLines(catalogItem, combo, result, context, deps);
	const added = insertLines(lines, 0, context);
	context?.triggerBackgroundFlush?.();
	return added[0] ?? lines[0];
};

const removeLine = (line: any, context: any): void => {
	if (context?.invoiceStore?.removeItemByRowId) {
		context.invoiceStore.removeItemByRowId(line.posa_row_id);
		return;
	}
	const items = context?.items;
	if (Array.isArray(items)) {
		const index = items.indexOf(line);
		if (index >= 0) items.splice(index, 1);
	}
};

/**
 * Take a paquete's picks off the cart. Called whenever its line leaves: a
 * pick without its paquete line is a $0 line the server will refuse, and one
 * the cart would draw as a free item.
 */
export const removeChoiceChildren = (header: any, context: any): number => {
	const children = comboChildrenOf(cartItems(context), header);
	children.forEach((child) => removeLine(child, context));
	return children.length;
};

/**
 * Re-pick a paquete already on the ticket: the line keeps its row (and any
 * discount the cashier gave it), its picks are replaced and its quantity
 * follows the sheet.
 */
export const replaceChoiceSelection = (
	header: any,
	combo: ChoiceCombo,
	result: ComboChoiceResult,
	context: any,
	deps: ChoiceCartDeps,
): void => {
	removeChoiceChildren(header, context);
	const apply = (line: any) => {
		line.qty = result.qty;
		line[COMBO_COMPONENTS_FIELD] = selectionComponents(combo, result.selection);
		line[COMBO_BROKEN_FIELD] = 0;
		line.amount = round(result.qty * toNumber(line.rate), 2);
		deps.calcStockQty?.(line, line.qty);
	};
	if (context?.invoiceStore?.updateItemWithTotals && header?.posa_row_id) {
		context.invoiceStore.updateItemWithTotals(header.posa_row_id, apply);
	} else {
		apply(header);
	}
	const picks = buildPicks(header, combo, result, context, deps);
	const index = cartItems(context).findIndex((line) => line?.posa_row_id === header?.posa_row_id);
	insertLines(picks, index >= 0 ? index + 1 : cartItems(context).length, context);
	context?.triggerBackgroundFlush?.();
};

/**
 * Picks follow their paquete's quantity. Any path that changes the paquete
 * line's qty — the phone's line sheet, a keyboard step, a return — is caught
 * here after the fact, from the components the paquete line carries (which
 * a resumed draft reloads with it). Returns the number of picks corrected;
 * zero on a cart already in step, so a watcher calling it cannot loop.
 */
export const syncChoiceChildQty = (
	items: readonly any[] | null | undefined,
	update: (_rowId: string, _mutate: (_line: any) => void) => void,
): number => {
	const rows = (items ?? []).filter(Boolean);
	const byRow = new Map(rows.map((row) => [String(row.posa_row_id ?? ""), row]));
	let corrected = 0;
	for (const child of rows) {
		const parentId = String(child?.[COMBO_PARENT_FIELD] ?? "").trim();
		if (!parentId) continue;
		const header = byRow.get(parentId);
		const components = header?.[COMBO_COMPONENTS_FIELD];
		if (!header || !Array.isArray(components)) continue;
		const group = String(child?.[COMBO_GROUP_FIELD] ?? "").trim();
		const component = components.find(
			(entry: any) =>
				String(entry?.item_code ?? "") === String(child.item_code ?? "") &&
				String(entry?.group ?? "").trim() === group,
		);
		if (!component) continue;
		const expected = round(toNumber(header.qty) * toNumber(component.qty));
		if (Math.abs(toNumber(child.qty) - expected) <= 1e-9) continue;
		update(child.posa_row_id, (line) => {
			const factor = toNumber(line.conversion_factor) || 1;
			line.qty = expected;
			line.stock_qty = round(expected * factor);
			line.amount = round(expected * toNumber(line.rate), 2);
			line.base_amount = round(expected * toNumber(line.base_rate ?? line.rate), 2);
		});
		corrected += 1;
	}
	return corrected;
};
