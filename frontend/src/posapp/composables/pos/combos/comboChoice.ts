/**
 * Paquetes — combos whose customer picks («elige tu bebida, elige tu pan»).
 *
 * A Product Bundle combo (`comboPricing.ts`, `comboLineAttachment.ts`) has
 * fixed components and sells as ONE line whose packing list moves the stock.
 * A paquete cannot: what it contains is decided at the till. So it sells as
 * the paquete's own item at its Item Price, followed by one line per pick —
 * priced 0, or at the option's extra charge — each naming the paquete line in
 * `posa_combo_parent` and its group in `posa_combo_group`. Those picks are
 * real lines: they move their own stock, route to the kitchen and count in
 * item reports. The server vouches for their prices against the POS Combo at
 * submit (`api/combo_choice.py`); nothing here decides a price the server has
 * not published in `get_combos`.
 *
 * This module is pure: the offer's shape, the selection rules the picker
 * enforces, and the arithmetic every surface shows. The picker
 * (`ComboChoiceSheet.vue`), the cart builder (`comboChoiceCart.ts`) and the
 * cart surfaces all read it, so "is this paquete complete" and "what does it
 * cost" have one answer.
 */

/** The fields that tie a pick to its paquete line (Custom Fields, both invoice item doctypes). */
export const COMBO_PARENT_FIELD = "posa_combo_parent" as const;
export const COMBO_GROUP_FIELD = "posa_combo_group" as const;

/** One answer to a group — «Capuchino», «Latte +$10». */
export interface ChoiceOption {
	item_code: string;
	item_name: string;
	/** Units of the item ONE pick puts on the ticket, in its stock UOM. */
	qty: number;
	/** Charged on top of the paquete price, per pick. 0 = included. */
	extra_price: number;
	/** Preselected when the picker opens. */
	is_default: boolean;
	/** What the item sells for on its own — the saving is measured against it, never charged. */
	rate: number;
	uom: string | null;
	image: string | null;
	is_stock_item: boolean;
	/**
	 * Free stock in the register's warehouse. `null` for a service (no shelf)
	 * or an unknown figure — never `0`, which is a claim the cashier repeats.
	 */
	actual_qty: number | null;
}

/** One question a paquete asks — «Bebida» (pick 1), «Extras» (pick 0–2). */
export interface ChoiceGroup {
	name: string;
	min: number;
	max: number;
	options: ChoiceOption[];
}

/** A paquete as the register holds it, from `api/combos.get_combos` (kind "choice"). */
export interface ChoiceCombo {
	kind: "choice";
	item_code: string;
	item_name: string;
	/** The paquete's own Item Price. Extra charges add to it. */
	rate: number;
	image?: string | null;
	groups: ChoiceGroup[];
}

/** Picks per group, per option: `{ Bebida: { LATTE: 1 }, Pan: { CONCHA: 2 } }`. */
export type ComboSelection = Record<string, Record<string, number>>;

/** What the picker hands back when the cashier confirms. */
export interface ComboChoiceResult {
	selection: ComboSelection;
	/** How many identical paquetes — each pick line scales with it. */
	qty: number;
}

/** A pick as a cart surface lists it under the paquete's name. */
export interface ChoiceComponent {
	item_code: string;
	item_name: string;
	/** Units per ONE paquete (picks × option qty). */
	qty: number;
	/** List price per unit — for the saving only. */
	rate: number;
	/** Extra charge for these picks, per ONE paquete. */
	extra_price: number;
	group: string;
	uom: string | null;
	is_stock_item: boolean;
	actual_qty: number | null;
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

const text = (value: unknown): string => String(value ?? "").trim();

const truthy = (value: unknown): boolean =>
	value === true || value === 1 || value === "1";

/** Money the way a price tag rounds it. */
const roundMoney = (value: number): number =>
	Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

const normalizeOption = (raw: any): ChoiceOption | null => {
	const itemCode = text(raw?.item_code);
	if (!itemCode) return null;
	const actual = raw?.actual_qty;
	return {
		item_code: itemCode,
		item_name: text(raw?.item_name) || itemCode,
		qty: toNumber(raw?.qty) > 0 ? toNumber(raw?.qty) : 1,
		extra_price: Math.max(0, toNumber(raw?.extra_price)),
		is_default: truthy(raw?.is_default),
		rate: toNumber(raw?.rate),
		uom: text(raw?.uom) || null,
		image: text(raw?.image) || null,
		is_stock_item: truthy(raw?.is_stock_item),
		// Absent stays absent: a payload without the figure is "unknown", and
		// the picker must not read it as sold out.
		actual_qty: actual === null || actual === undefined || actual === "" ? null : toNumber(actual),
	};
};

/**
 * The groups as the picker may trust them. Tolerant on purpose: the payload
 * also arrives from the offline cache and from drafts written by older
 * builds, and a malformed group must drop out rather than wedge the sheet.
 */
export const normalizeChoiceGroups = (raw: unknown): ChoiceGroup[] => {
	if (!Array.isArray(raw)) return [];
	const groups: ChoiceGroup[] = [];
	for (const entry of raw) {
		const name = text((entry as any)?.name);
		if (!name) continue;
		const max = Math.max(0, Math.trunc(toNumber((entry as any)?.max)));
		const min = Math.min(max, Math.max(0, Math.trunc(toNumber((entry as any)?.min))));
		const options = (Array.isArray((entry as any)?.options) ? (entry as any).options : [])
			.map(normalizeOption)
			.filter((option: ChoiceOption | null): option is ChoiceOption => option !== null);
		if (max < 1 || !options.length) continue;
		groups.push({ name, min, max, options });
	}
	return groups;
};

/** Is this offer a paquete the register can open a picker for? */
export const isChoiceCombo = (offer: unknown): offer is ChoiceCombo =>
	!!offer &&
	(offer as any).kind === "choice" &&
	!!text((offer as any).item_code) &&
	Array.isArray((offer as any).groups) &&
	(offer as any).groups.length > 0;

/** Normalise a raw `get_combos` row into a `ChoiceCombo`, or null when it is not one. */
export const normalizeChoiceCombo = (raw: unknown): ChoiceCombo | null => {
	if (!raw || (raw as any).kind !== "choice") return null;
	const groups = normalizeChoiceGroups((raw as any).groups);
	const itemCode = text((raw as any).item_code);
	if (!itemCode || !groups.length) return null;
	return {
		kind: "choice",
		item_code: itemCode,
		item_name: text((raw as any).item_name) || itemCode,
		rate: toNumber((raw as any).rate),
		image: text((raw as any).image) || null,
		groups,
	};
};

// ---------------------------------------------------------------------------
// Selection rules
// ---------------------------------------------------------------------------

/**
 * A group with exactly one way to answer it is not a question: «Incluye:
 * Molletes». One option asked `min` times, or every option preselected and
 * the group full with them. The picker draws these as included, not as a
 * choice, and the cashier cannot change them.
 */
export const isFixedGroup = (group: ChoiceGroup): boolean =>
	group.min >= 1 &&
	group.min === group.max &&
	(group.options.length === 1 ||
		(group.options.length === group.min && group.options.every((option) => option.is_default)));

export const groupPickCount = (selection: ComboSelection, group: ChoiceGroup): number =>
	Object.values(selection[group.name] ?? {}).reduce((sum, count) => sum + Math.max(0, count), 0);

export const optionPickCount = (
	selection: ComboSelection,
	group: ChoiceGroup,
	itemCode: string,
): number => Math.max(0, selection[group.name]?.[itemCode] ?? 0);

export interface GroupStatus {
	picked: number;
	min: number;
	max: number;
	/** Between min and max — the group no longer blocks the confirm. */
	satisfied: boolean;
	/** At max: another pick would have to replace one. */
	full: boolean;
	/** Picks still required. */
	missing: number;
}

export const groupStatus = (selection: ComboSelection, group: ChoiceGroup): GroupStatus => {
	const picked = groupPickCount(selection, group);
	return {
		picked,
		min: group.min,
		max: group.max,
		satisfied: picked >= group.min && picked <= group.max,
		full: picked >= group.max,
		missing: Math.max(0, group.min - picked),
	};
};

/** Every group answered within its bounds. */
export const isSelectionComplete = (combo: ChoiceCombo, selection: ComboSelection): boolean =>
	combo.groups.every((group) => groupStatus(selection, group).satisfied);

/** The first group still asking for a pick — where the picker scrolls on a blocked confirm. */
export const firstIncompleteGroup = (
	combo: ChoiceCombo,
	selection: ComboSelection,
): ChoiceGroup | null => combo.groups.find((group) => !groupStatus(selection, group).satisfied) ?? null;

/** What the picker shows when it opens: fixed groups filled, defaults preselected. */
export const defaultSelection = (combo: ChoiceCombo): ComboSelection => {
	const selection: ComboSelection = {};
	for (const group of combo.groups) {
		const picks: Record<string, number> = {};
		if (isFixedGroup(group)) {
			if (group.options.length === 1) {
				picks[group.options[0]!.item_code] = group.min;
			} else {
				for (const option of group.options) picks[option.item_code] = 1;
			}
		} else {
			let room = group.max;
			for (const option of group.options) {
				if (!option.is_default || room <= 0) continue;
				picks[option.item_code] = 1;
				room -= 1;
			}
			// One option and a required pick: there is nothing to decide.
			if (!Object.keys(picks).length && group.options.length === 1 && group.min >= 1) {
				picks[group.options[0]!.item_code] = group.min;
			}
		}
		selection[group.name] = picks;
	}
	return selection;
};

const withGroup = (
	selection: ComboSelection,
	group: ChoiceGroup,
	picks: Record<string, number>,
): ComboSelection => {
	const cleaned: Record<string, number> = {};
	for (const [code, count] of Object.entries(picks)) {
		if (count > 0) cleaned[code] = count;
	}
	return { ...selection, [group.name]: cleaned };
};

/**
 * One more pick of `itemCode`. A single-pick group behaves like a radio: the
 * new pick REPLACES the old one, because «Latte» after «Capuchino» means
 * "the latte instead", never "refuse". A multi-pick group at its maximum
 * refuses (returns the selection unchanged) — silently replacing one of
 * several picks would change an order the cashier did not look at.
 */
export const addPick = (
	selection: ComboSelection,
	group: ChoiceGroup,
	itemCode: string,
): ComboSelection => {
	if (isFixedGroup(group) || !group.options.some((option) => option.item_code === itemCode)) {
		return selection;
	}
	if (group.max === 1) {
		return withGroup(selection, group, { [itemCode]: 1 });
	}
	if (groupPickCount(selection, group) >= group.max) return selection;
	const current = selection[group.name] ?? {};
	return withGroup(selection, group, { ...current, [itemCode]: (current[itemCode] ?? 0) + 1 });
};

/** One pick of `itemCode` fewer. Never below zero; fixed groups do not move. */
export const removePick = (
	selection: ComboSelection,
	group: ChoiceGroup,
	itemCode: string,
): ComboSelection => {
	if (isFixedGroup(group)) return selection;
	const current = selection[group.name] ?? {};
	if (!current[itemCode]) return selection;
	return withGroup(selection, group, { ...current, [itemCode]: current[itemCode]! - 1 });
};

/**
 * The tap on an option card. Single-pick: select it, or clear it when it is
 * already the pick and the group is optional. Multi-pick: add one.
 */
export const tapPick = (
	selection: ComboSelection,
	group: ChoiceGroup,
	itemCode: string,
): ComboSelection => {
	if (group.max === 1 && optionPickCount(selection, group, itemCode) > 0) {
		return group.min === 0 ? removePick(selection, group, itemCode) : selection;
	}
	return addPick(selection, group, itemCode);
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface OptionAvailabilityContext {
	/** POS Profile `posa_block_sale_beyond_available_qty`. */
	blockSaleBeyondAvailable?: boolean;
	/** How many paquetes the line will carry. */
	comboQty?: number;
}

/**
 * Can this option take ONE MORE pick? Only a stock item with a known figure,
 * on a register that blocks overselling, is ever refused — a service has no
 * shelf, an unknown figure is not a zero, and a warn-and-sell register keeps
 * selling exactly as it does for a plain line.
 */
export const canPickMore = (
	option: ChoiceOption,
	alreadyPicked: number,
	context: OptionAvailabilityContext = {},
): boolean => {
	if (!context.blockSaleBeyondAvailable || !option.is_stock_item || option.actual_qty === null) {
		return true;
	}
	const combos = Math.max(1, toNumber(context.comboQty) || 1);
	return (alreadyPicked + 1) * option.qty * combos <= option.actual_qty + 1e-9;
};

/** Sold out for this register's purposes: not one pick fits. */
export const isOptionSoldOut = (
	option: ChoiceOption,
	context: OptionAvailabilityContext = {},
): boolean => !canPickMore(option, 0, context);

// ---------------------------------------------------------------------------
// Arithmetic every surface shares
// ---------------------------------------------------------------------------

export interface SelectedPick {
	group: ChoiceGroup;
	option: ChoiceOption;
	/** Picks of this option per ONE paquete. */
	picks: number;
}

/** The picks in group order, then option order — the order the ticket prints them. */
export const selectedPicks = (combo: ChoiceCombo, selection: ComboSelection): SelectedPick[] => {
	const result: SelectedPick[] = [];
	for (const group of combo.groups) {
		for (const option of group.options) {
			const picks = optionPickCount(selection, group, option.item_code);
			if (picks > 0) result.push({ group, option, picks });
		}
	}
	return result;
};

/** Extra charges per ONE paquete. */
export const selectionExtras = (combo: ChoiceCombo, selection: ComboSelection): number =>
	roundMoney(
		selectedPicks(combo, selection).reduce((sum, pick) => sum + pick.picks * pick.option.extra_price, 0),
	);

/** What one paquete costs with these picks: its price plus their extra charges. */
export const selectionUnitPrice = (combo: ChoiceCombo, selection: ComboSelection): number =>
	roundMoney(combo.rate + selectionExtras(combo, selection));

/** What the picks would cost bought one by one, per ONE paquete. */
export const selectionListValue = (combo: ChoiceCombo, selection: ComboSelection): number =>
	roundMoney(
		selectedPicks(combo, selection).reduce(
			(sum, pick) => sum + pick.picks * pick.option.qty * pick.option.rate,
			0,
		),
	);

/** «Ahorras $17» per paquete — never negative (a paquete may bundle for convenience). */
export const selectionSaving = (combo: ChoiceCombo, selection: ComboSelection): number =>
	roundMoney(Math.max(0, selectionListValue(combo, selection) - selectionUnitPrice(combo, selection)));

/** The picks as the cart line lists them under the paquete's name. */
export const selectionComponents = (
	combo: ChoiceCombo,
	selection: ComboSelection,
): ChoiceComponent[] =>
	selectedPicks(combo, selection).map(({ group, option, picks }) => ({
		item_code: option.item_code,
		item_name: option.item_name,
		qty: picks * option.qty,
		rate: option.rate,
		extra_price: roundMoney(picks * option.extra_price),
		group: group.name,
		uom: option.uom,
		is_stock_item: option.is_stock_item,
		actual_qty: option.actual_qty,
	}));

/** Rebuild a selection from the components a paquete line carries (to edit it). */
export const selectionFromComponents = (
	combo: ChoiceCombo,
	components: readonly { item_code?: unknown; qty?: unknown; group?: unknown }[] | null | undefined,
): ComboSelection => {
	const selection: ComboSelection = {};
	for (const group of combo.groups) selection[group.name] = {};
	for (const component of components ?? []) {
		const group = combo.groups.find((candidate) => candidate.name === text(component?.group));
		const code = text(component?.item_code);
		const option = group?.options.find((candidate) => candidate.item_code === code);
		if (!group || !option) continue;
		const picks = Math.round(toNumber(component?.qty) / option.qty);
		if (picks > 0) selection[group.name]![code] = (selection[group.name]![code] ?? 0) + picks;
	}
	return selection;
};

/** «Capuchino · 2 × Concha · Molletes» — the paquete's shape at a glance. */
export const describeSelection = (combo: ChoiceCombo, selection: ComboSelection): string =>
	selectedPicks(combo, selection)
		.map(({ option, picks }) => (picks > 1 ? `${picks} × ${option.item_name}` : option.item_name))
		.join(" · ");

// ---------------------------------------------------------------------------
// The paquete on the cart
// ---------------------------------------------------------------------------

/** Does this cart line belong to a paquete line? */
export const isComboChildLine = (line: unknown): boolean =>
	!!text((line as any)?.[COMBO_PARENT_FIELD]);

/** The pick lines of one paquete line, in cart order. */
export const comboChildrenOf = <T>(items: readonly T[] | null | undefined, header: unknown): T[] => {
	const rowId = text((header as any)?.posa_row_id);
	if (!rowId) return [];
	return (items ?? []).filter((line) => text((line as any)?.[COMBO_PARENT_FIELD]) === rowId);
};

export interface FoldedCart<T> {
	/** The rows a cart surface draws: every line except picks whose paquete line is present. */
	visible: T[];
	/** Σ amount of each paquete line's picks, keyed by the paquete line's row id. */
	childAmountByParent: Map<string, number>;
	/** How many pick lines each paquete line carries. */
	childCountByParent: Map<string, number>;
}

const lineAmount = (line: any): number => {
	const raw = line?.amount;
	if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) {
		return toNumber(raw);
	}
	return toNumber(line?.qty) * toNumber(line?.rate);
};

/**
 * Fold a paquete's picks into its line for display.
 *
 * A pick is drawn only through its paquete line — the customer bought ONE
 * paquete, and «Concha $0.00» as a row of its own reads like a free item the
 * cashier forgot to charge. A pick whose paquete line is NOT in the list
 * stays visible: hiding a line nobody can see is how a ticket ends up
 * charging for something off-screen.
 */
export const foldComboChildren = <T>(items: readonly T[] | null | undefined): FoldedCart<T> => {
	const rows = (items ?? []).filter(Boolean) as T[];
	const present = new Set(rows.map((row) => text((row as any)?.posa_row_id)).filter(Boolean));
	const childAmountByParent = new Map<string, number>();
	const childCountByParent = new Map<string, number>();
	const visible: T[] = [];
	for (const row of rows) {
		const parent = text((row as any)?.[COMBO_PARENT_FIELD]);
		if (parent && present.has(parent)) {
			childAmountByParent.set(parent, (childAmountByParent.get(parent) ?? 0) + lineAmount(row));
			childCountByParent.set(parent, (childCountByParent.get(parent) ?? 0) + 1);
			continue;
		}
		visible.push(row);
	}
	return { visible, childAmountByParent, childCountByParent };
};

/** Is this line a paquete line — does it carry picks (or the components of one)? */
export const isChoiceHeaderLine = (
	line: unknown,
	folded?: Pick<FoldedCart<unknown>, "childCountByParent">,
): boolean => {
	const rowId = text((line as any)?.posa_row_id);
	if (rowId && folded?.childCountByParent.has(rowId)) return true;
	const components = (line as any)?.posa_combo_components;
	return (
		Array.isArray(components) &&
		components.length > 0 &&
		components.some((component: any) => !!text(component?.group))
	);
};
