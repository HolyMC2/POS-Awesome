/**
 * The till asking the cashier which picks a paquete carries.
 *
 * The add path (`useItemAddition.addItem`) is where every line enters the
 * cart — a desk click, a scan, a phone tap, the drawer, the «se suele llevar
 * junto» strip — so that is where a paquete is intercepted. It cannot mount a
 * dialog, so it ASKS here and awaits the answer, the same shape the saldo
 * capture uses for a recarga's referencia. `ComboChoiceSheet.vue`, mounted
 * once by the register shell, watches `pending` and answers through
 * `settleComboChoice`.
 *
 * The registry maps an item code to its paquete, fed by `useComboOffers`
 * whenever the register's combos load or reload, so the interception is a
 * map lookup on the add path and never a request.
 *
 * STATE IS PINNED ON `globalThis`. The SPA's entry bundle is evaluated twice
 * per page (see `stores/index.ts`), and a module-level `ref` here would exist
 * twice: the add path could ask one copy while the sheet watched the other,
 * and the paquete would add nothing, with nothing in the console.
 */

import { shallowRef, type ShallowRef } from "vue";

import {
	isChoiceCombo,
	normalizeChoiceCombo,
	type ChoiceCombo,
	type ComboChoiceResult,
	type ComboSelection,
} from "./comboChoice";

export interface PendingComboChoice {
	combo: ChoiceCombo;
	/** Preselected picks — the paquete's defaults, or the line being edited. */
	selection?: ComboSelection;
	qty: number;
	/** True when the sheet re-opens a paquete already on the ticket. */
	editing: boolean;
	resolve: (_result: ComboChoiceResult | null) => void;
}

interface ChoiceState {
	pending: ShallowRef<PendingComboChoice | null>;
	byCode: Map<string, ChoiceCombo>;
}

const STATE_KEY = Symbol.for("posawesome.comboChoiceRequest");

const state = (): ChoiceState => {
	const holder = globalThis as unknown as Record<symbol, ChoiceState | undefined>;
	let current = holder[STATE_KEY];
	if (!current) {
		current = { pending: shallowRef<PendingComboChoice | null>(null), byCode: new Map() };
		holder[STATE_KEY] = current;
	}
	return current;
};

/** Replace the registry with the register's current combos (paquetes are picked out). */
export const setChoiceCombos = (offers: readonly unknown[] | null | undefined): void => {
	const byCode = state().byCode;
	byCode.clear();
	for (const offer of offers ?? []) {
		if (!isChoiceCombo(offer)) continue;
		const combo = normalizeChoiceCombo(offer);
		if (combo) byCode.set(combo.item_code, combo);
	}
};

/** The paquete sold as `itemCode`, or null when that item is not one. */
export const choiceComboFor = (itemCode: unknown): ChoiceCombo | null => {
	const code = String(itemCode ?? "").trim();
	return code ? state().byCode.get(code) ?? null : null;
};

/**
 * Ask for the picks. Resolves with the cashier's answer, or `null` when the
 * sheet was dismissed — the add is then abandoned, exactly like cancelling a
 * recarga's capture. A second request while one is open dismisses the first:
 * the cashier tapped another paquete, and the newest tap is the intent.
 */
export const requestComboChoice = (
	combo: ChoiceCombo,
	options: { selection?: ComboSelection; qty?: number; editing?: boolean } = {},
): Promise<ComboChoiceResult | null> =>
	new Promise((resolve) => {
		const pending = state().pending;
		pending.value?.resolve(null);
		pending.value = {
			combo,
			selection: options.selection,
			qty: Math.max(1, Math.trunc(Number(options.qty) || 1)),
			editing: !!options.editing,
			resolve,
		};
	});

/** The sheet's answer. `null` = dismissed. Safe to call when nothing is pending. */
export const settleComboChoice = (result: ComboChoiceResult | null): void => {
	const pending = state().pending;
	const current = pending.value;
	if (!current) return;
	pending.value = null;
	current.resolve(result);
};

/** For the sheet: what is being asked right now. */
export const usePendingComboChoice = (): ShallowRef<PendingComboChoice | null> => state().pending;

/** Test seam — the state is global on purpose and would leak between specs. */
export const resetComboChoiceState = (): void => {
	const current = state();
	current.pending.value?.resolve(null);
	current.pending.value = null;
	current.byCode.clear();
};
