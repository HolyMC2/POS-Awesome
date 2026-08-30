// @vitest-environment jsdom

/**
 * The phone's line sheet (movil round 10).
 *
 * The last documented hole in the movil register: tapping a cart line fronted
 * the CLASSIC desktop cart, because the line editor was a five-column `<tr>`
 * and the phone had none of its own. This file covers the three halves of the
 * replacement, and it is deliberately suspicious of all three:
 *
 *   1. the GATES (`movilLineEdit.ts`) — asserted against `CartItemRow.vue`'s
 *      own conditions, because a phone that edits a rate the desk refuses is
 *      not a nicer register, it is a second answer about what a thing costs;
 *   2. the SHEET (`MovilLineSheet.vue`) — every control emits an intent and
 *      mutates nothing, and a field that has not changed sends nothing at all;
 *   3. the WIRING (`Pos.vue` → `movil:line-edit` → `Invoice.vue`) — the sheet
 *      must reach the SAME functions the desktop row reaches, and the classic
 *      fallback must stay reachable rather than being deleted.
 *
 * jsdom because half of it mounts; the source pins ride `?raw`, which is a
 * Vite transform and therefore survives here where `node:fs` is shimmed away.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

// The shell statically imports the whole panel graph; none of it is under test
// here. Same leaf-stubbing as tests/compactCatalogueLanding.spec.ts.
vi.mock("../src/posapp/components/pos/Invoice.vue", () => ({
	default: { name: "Invoice", render: () => null },
}));
vi.mock("../src/posapp/components/pos/items/ItemsSelector.vue", () => ({
	default: { name: "ItemsSelector", render: () => null },
}));
vi.mock("../src/posapp/components/pos/shift/OpeningDialog.vue", () => ({
	default: { name: "OpeningDialog", render: () => null },
}));
vi.mock("../src/posapp/components/pos/offers/PosOffers.vue", () => ({
	default: { name: "PosOffers", render: () => null },
}));
vi.mock("../src/posapp/components/pos/offers/PosCoupons.vue", () => ({
	default: { name: "PosCoupons", render: () => null },
}));
vi.mock("../src/posapp/components/pos/Payments.vue", () => ({
	default: { name: "Payments", render: () => null },
}));
vi.mock("@saldo/SaldoReferenciaDialog.vue", () => ({
	default: { name: "SaldoReferenciaDialog", render: () => null },
}));
vi.mock("@saldo/SaldoStatusDialog.vue", () => ({
	default: { name: "SaldoStatusDialog", render: () => null },
}));
vi.mock("@saldo/SaldoCatalogPicker.vue", () => ({
	default: { name: "SaldoCatalogPicker", render: () => null },
}));

import Pos from "../src/posapp/components/pos/shell/Pos.vue";
import MovilLineSheet from "../src/posapp/components/pos/mobile/line/MovilLineSheet.vue";
import MobileSaleScreen from "../src/posapp/components/pos/mobile/sale/MobileSaleScreen.vue";
import {
	resolveMovilLineEdit,
	type MovilLineEdit,
} from "../src/posapp/components/pos/mobile/line/movilLineEdit";
import { describeMobileSaleLines } from "../src/posapp/components/pos/mobile/sale/mobileSaleLines";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

import SheetSource from "../src/posapp/components/pos/mobile/line/MovilLineSheet.vue?raw";
import ModelSource from "../src/posapp/components/pos/mobile/line/movilLineEdit.ts?raw";
import PosSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import InvoiceSource from "../src/posapp/components/pos/Invoice.vue?raw";
import ShellSource from "../src/posapp/components/pos/shell/movil/MovilShell.vue?raw";
import EsCsv from "../../posawesome/translations/es.csv?raw";

/** A plain cart row, as `invoiceStore.items` hands one over. */
const ROW = {
	posa_row_id: "row-1",
	item_code: "IPN001880",
	item_name: "Adaptador Apple Lightning a Jack",
	qty: 2,
	rate: 120,
	amount: 240,
	discount_percentage: 0,
	price_list_rate: 120,
};

const ALLOW_ALL = {
	posa_allow_user_to_edit_rate: 1,
	posa_allow_user_to_edit_item_discount: 1,
};

const money = (value: number) => `¤${value.toFixed(2)}`;

const edit = (row: Record<string, unknown> = {}, options: Record<string, unknown> = {}) =>
	resolveMovilLineEdit({ ...ROW, ...row } as any, options as any) as MovilLineEdit;

// ---------------------------------------------------------------------------
// 1. the gates
// ---------------------------------------------------------------------------

describe("what the phone may touch is what the desk row may touch", () => {
	it("refuses to open on a row the register has not stamped", () => {
		// `posa_row_id` is the identity every engine handler resolves a row by.
		// Without one an edit would be matched by item code onto whichever line
		// came first — which on a cart holding the same item twice is a coin
		// toss with somebody's money. The caller falls back to the classic cart.
		expect(resolveMovilLineEdit({ ...ROW, posa_row_id: "" } as any)).toBeNull();
		expect(resolveMovilLineEdit(null)).toBeNull();
	});

	it("refuses a row that is not yet a line", () => {
		// A row with neither code nor name is a cart mid-way through building
		// one — `resolveSaleSummary` drops it and so does this.
		expect(
			resolveMovilLineEdit({ posa_row_id: "row-9", item_code: "", item_name: "" } as any),
		).toBeNull();
	});

	it("draws the rate field only where posa_allow_user_to_edit_rate says so", () => {
		expect(edit({}, { profile: ALLOW_ALL }).canEditRate).toBe(true);
		expect(edit({}, { profile: { posa_allow_user_to_edit_rate: 0 } }).canEditRate).toBe(false);
		expect(edit({}, { profile: null }).canEditRate).toBe(false);
		expect(edit({}).canEditRate).toBe(false);
	});

	it("draws the discount field only where posa_allow_user_to_edit_item_discount says so", () => {
		expect(edit({}, { profile: ALLOW_ALL }).canEditDiscount).toBe(true);
		expect(
			edit({}, { profile: { posa_allow_user_to_edit_item_discount: 0 } }).canEditDiscount,
		).toBe(false);
	});

	it("closes both editors on a line an offer already priced", () => {
		// `disableDiscountEdit` on the desk: an applied offer owns the discount,
		// and a second one typed over it is a figure nothing will reproduce.
		expect(edit({ posa_offer_applied: 1 }, { profile: ALLOW_ALL }).canEditDiscount).toBe(false);
		expect(edit({ posa_offer_applied: 1 }, { profile: ALLOW_ALL }).canEditRate).toBe(true);
	});

	it("freezes a replacement line the way the desk freezes it", () => {
		// `posa_is_replace` disables rate, discount, both steppers AND delete on
		// `CartItemRow.vue` — all four, restated here as one row of assertions.
		const replacement = edit({ posa_is_replace: 1 }, { profile: ALLOW_ALL });
		expect(replacement.canEditRate).toBe(false);
		expect(replacement.canEditDiscount).toBe(false);
		expect(replacement.canStepUp).toBe(false);
		expect(replacement.canStepDown).toBe(false);
		expect(replacement.canRemove).toBe(false);
	});

	it("stops the + where the stock guard stopped it", () => {
		expect(edit({ disable_increment: 1 }).canStepUp).toBe(false);
		expect(edit({ disable_increment: 1 }).canStepDown).toBe(true);
	});

	it("leaves a returned free line alone, and only on a return", () => {
		// `disableInput` on the desk. On a SALE the same free line still steps:
		// the rule is about the return, not about the freebie.
		const returned = edit({ is_free_item: 1 }, { isReturn: true });
		expect(returned.canStepUp).toBe(false);
		expect(returned.canStepDown).toBe(false);
		expect(returned.canTypeQty).toBe(false);
		expect(edit({ is_free_item: 1 }, { isReturn: false }).canTypeQty).toBe(true);
	});

	it("takes its money from the shared summary rather than multiplying again", () => {
		// The server-written `amount` is authoritative — discounts included.
		// A sheet that preferred its own qty × rate would quietly disagree with
		// the total the customer is being charged.
		expect(edit({ qty: 2, rate: 120, amount: 199 }).amount).toBe(199);
		expect(edit({ qty: 3, rate: 50, amount: null }).amount).toBe(150);
		expect(ModelSource).toContain('from "../../payments/saleSummary"');
	});

	it("carries the combo badge the cart row carries", () => {
		const combo = edit({
			posa_combo_components: [
				{ item_code: "A", qty: 1, rate: 200 },
				{ item_code: "B", qty: 1, rate: 140 },
			],
		});
		expect(combo.isCombo).toBe(true);
		expect(combo.componentCount).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 2. the sheet
// ---------------------------------------------------------------------------

/**
 * Listener props, not `wrapper.emitted()`: VTU records only the native event
 * that bubbles to the root in this repo (build plan §10) — the same reason
 * `movilCobroView.spec.ts` and `movilVenta.spec.ts` assert intents this way.
 * A spec written against `emitted()` here passes on an empty array forever.
 */
const spy = () => ({ onEdit: vi.fn(), onClose: vi.fn(), onMore: vi.fn() });

const mountSheet = (line: MovilLineEdit, listeners = spy()) => {
	const wrapper = mount(MovilLineSheet, {
		props: { line, formatCurrency: money, ...listeners } as never,
	});
	return Object.assign(wrapper, listeners);
};

describe("the sheet shows the line and mutates nothing", () => {
	it("names the line and prints both figures", () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));

		expect(sheet.find('[data-testid="movil-line-name"]').text()).toBe(ROW.item_name);
		expect(sheet.find('[data-testid="movil-line-code"]').text()).toBe(ROW.item_code);
		expect(sheet.find('[data-testid="movil-line-unit"]').text()).toBe(money(120));
		expect(sheet.find('[data-testid="movil-line-amount"]').text()).toBe(money(240));
	});

	it("follows the line total live, without recomputing it", async () => {
		// The host re-derives the model from the LIVE cart row on every tick,
		// so an engine-clamped qty comes back INTO the sheet rather than the
		// sheet insisting on what was typed.
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));
		await sheet.setProps({ line: edit({ qty: 5, amount: 600 }, { profile: ALLOW_ALL }) });

		expect(sheet.find('[data-testid="movil-line-amount"]').text()).toBe(money(600));
		expect(
			(sheet.find('[data-testid="movil-line-qty"]').element as HTMLInputElement).value,
		).toBe("5");
	});

	it("steps up and down through the engine's own ± verbs", async () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));

		await sheet.find('[data-testid="movil-line-plus"]').trigger("click");
		await sheet.find('[data-testid="movil-line-minus"]').trigger("click");

		expect(sheet.onEdit.mock.calls).toEqual([
			[{ kind: "step", delta: 1 }],
			[{ kind: "step", delta: -1 }],
		]);
	});

	it("sends a typed quantity once, and only when it changed", async () => {
		// `setValue` on a number field dispatches the `change` this commits on;
		// a second `trigger("change")` would count one edit twice.
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));
		const qty = sheet.find('[data-testid="movil-line-qty"]');

		await qty.setValue("7");
		expect(sheet.onEdit.mock.calls).toEqual([[{ kind: "qty", qty: 7 }]]);

		// Back to the row's own figure: tabbing away from a field that says
		// what the line already says is not an edit, and a repricing pass for
		// an unchanged number is a round trip charged to a cashier who only
		// looked at it.
		await qty.setValue("2");
		expect(sheet.onEdit).toHaveBeenCalledTimes(1);
	});

	it("re-shows the row's own figure when the field is left unreadable", async () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));
		const qty = sheet.find('[data-testid="movil-line-qty"]');

		await qty.setValue("");
		await qty.trigger("change");

		expect(sheet.onEdit).not.toHaveBeenCalled();
		// The field re-shows the row rather than sitting empty.
		expect((qty.element as HTMLInputElement).value).toBe("2");
	});

	it("removes on one press — the sheet is already the confirmation", async () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));
		await sheet.find('[data-testid="movil-line-remove"]').trigger("click");
		expect(sheet.onEdit.mock.calls).toEqual([[{ kind: "remove" }]]);
	});

	it("hides the rate control when the profile forbids it", () => {
		const forbidden = mountSheet(edit({}, { profile: { posa_allow_user_to_edit_rate: 0 } }));
		expect(forbidden.find('[data-testid="movil-line-rate-field"]').exists()).toBe(false);
		expect(forbidden.find('[data-testid="movil-line-rate"]').exists()).toBe(false);

		const allowed = mountSheet(edit({}, { profile: ALLOW_ALL }));
		expect(allowed.find('[data-testid="movil-line-rate-field"]').exists()).toBe(true);
	});

	it("hides the discount control when the profile forbids it", () => {
		const forbidden = mountSheet(
			edit({}, { profile: { posa_allow_user_to_edit_item_discount: 0 } }),
		);
		expect(forbidden.find('[data-testid="movil-line-discount-field"]').exists()).toBe(false);

		const allowed = mountSheet(edit({}, { profile: ALLOW_ALL }));
		expect(allowed.find('[data-testid="movil-line-discount-field"]').exists()).toBe(true);
	});

	it("sends a rate and a discount as their own verbs", async () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));

		await sheet.find('[data-testid="movil-line-rate"]').setValue("99.5");
		await sheet.find('[data-testid="movil-line-discount"]').setValue("10");

		expect(sheet.onEdit.mock.calls).toEqual([
			[{ kind: "rate", rate: 99.5 }],
			[{ kind: "discount", discount: 10 }],
		]);
	});

	it("does not offer a control the gate closed, even to a synthetic press", async () => {
		// Not merely `disabled` in the markup: the handler refuses too, so a
		// programmatic click (a stray dispatch, a test, an assistive tool)
		// cannot walk past the profile.
		const frozen = mountSheet(edit({ posa_is_replace: 1 }, { profile: ALLOW_ALL }));
		expect(frozen.find('[data-testid="movil-line-remove"]').exists()).toBe(false);

		const plus = frozen.find('[data-testid="movil-line-plus"]');
		expect(plus.attributes("disabled")).toBeDefined();
		await plus.trigger("click");
		expect(frozen.onEdit).not.toHaveBeenCalled();
	});

	it("closes from the ×, from a tap outside, and from Escape", async () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));

		await sheet.find('[data-testid="movil-line-close"]').trigger("click");
		await sheet.find('[data-testid="movil-line-scrim"]').trigger("click");
		document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
		await nextTick();

		expect(sheet.onClose).toHaveBeenCalledTimes(3);
	});

	it("drops the Escape listener with the sheet", async () => {
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));
		sheet.unmount();
		document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
		await nextTick();
		expect(sheet.onClose).not.toHaveBeenCalled();
	});

	it("keeps the door to the classic cart open", async () => {
		// UOM, batch, serial, the offer toggle, the line note and the weighing
		// pad all still live on the desktop row. «More options» is a door, not
		// a leftover — deleting it would strand them on the phone.
		const sheet = mountSheet(edit({}, { profile: ALLOW_ALL }));
		await sheet.find('[data-testid="movil-line-more"]').trigger("click");
		expect(sheet.onMore).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// 3. the sheet's own surface guarantees
// ---------------------------------------------------------------------------

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const scopedStyles = stripComments(
	/<style scoped>([\s\S]*?)<\/style>/.exec(SheetSource)?.[1] ?? "",
);

interface Rule {
	selector: string;
	body: string;
}

const parseRules = (block: string): Rule[] => {
	const flat = block.replace(/\s+/g, " ");
	const rules: Rule[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(flat)) !== null) {
		rules.push({ selector: match[1].trim(), body: match[2].trim() });
	}
	return rules;
};

const declaration = (block: string, fragment: string, property: string) => {
	for (const rule of parseRules(block)) {
		if (!rule.selector.includes(fragment)) continue;
		const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule.body);
		if (found) return found[1].trim();
	}
	return undefined;
};

const pxOf = (value: string | undefined) => {
	const found = /(\d+(?:\.\d+)?)px/.exec(value ?? "");
	if (!found) throw new Error(`no px length in ${String(value)}`);
	return Number(found[1]);
};

describe("the sheet is drawn in the register's own vocabulary", () => {
	it("has styles to scan at all", () => {
		// A scan over an empty stylesheet passes everything below vacuously.
		expect(parseRules(scopedStyles).length).toBeGreaterThan(10);
	});

	it("routes every colour through a token, with the artboard value as fallback", () => {
		// `mobile/sale/**` gets this from movilVentaSource.spec.ts; the sheet
		// lives in `mobile/line/**`, which that walk does not reach, so the
		// guarantee is restated here rather than lost.
		const bare = scopedStyles.replace(
			/var\(\s*--[\w-]+\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g,
			"",
		);
		expect(bare.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
	});

	it("never fills anything with the brand accent", () => {
		// Invariant 2 of the register: ONE saturated fill per screen, and on
		// the phone's cart that fill is CHARGE. A red or teal block here would
		// be the loudest thing on a screen whose loudest thing takes money.
		const accent = [
			/var\(\s*--reg-accent[,)]/,
			/var\(\s*--reg-accent-pressed\s*[,)]/,
			/var\(\s*--pos-primary\s*[,)]/,
			/var\(\s*--pos-primary-variant\s*[,)]/,
			/#0097a7/i,
			/#00838f/i,
		];
		const offenders = parseRules(scopedStyles)
			.filter((rule) =>
				rule.body
					.split(";")
					.filter((d) => /^\s*background(-color)?\s*:/.test(d))
					.some((d) => accent.some((p) => p.test(d))),
			)
			.map((rule) => rule.selector);
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("gives every control and every field the 44px floor, with no pointer query", () => {
		// Unconditional on purpose: this sheet is only ever drawn inside the
		// compact register, where the hand may be a thumb on a phone or a
		// stylus on a tablet that reports `pointer: fine`. Both get the target.
		for (const selector of [
			".movil-line-sheet__close",
			".movil-line-sheet__step",
			".movil-line-sheet__qty",
			".movil-line-sheet__input",
			".movil-line-sheet__remove",
			".movil-line-sheet__more",
			".movil-line-sheet__field",
		]) {
			expect(
				pxOf(declaration(scopedStyles, selector, "min-height")),
				`${selector} is under the touch floor`,
			).toBeGreaterThanOrEqual(44);
		}
	});

	it("pins every button on the sheet as a set", () => {
		// A seventh control added later fails HERE rather than shipping with a
		// 30px target — the sweep that has to be re-run by hand is the sweep
		// nobody re-runs.
		const template = /<template>([\s\S]*?)<\/template>/.exec(SheetSource)?.[1] ?? "";
		const classes = [...template.matchAll(/<button[\s\S]*?>/g)].flatMap((tag) =>
			[...tag[0].matchAll(/\sclass="([^"]+)"/g)].map((cls) => cls[1].split(/\s+/)[0]),
		);
		expect([...new Set(classes)].sort()).toEqual([
			"movil-line-sheet__close",
			"movil-line-sheet__more",
			"movil-line-sheet__remove",
			"movil-line-sheet__step",
		]);
	});

	it("clears the dock rather than hiding under it", () => {
		// `.mobile-dock` is `position: fixed; z-index: 20`. A sheet the dock
		// covers is a sheet whose Remove button is under the Pay tab.
		expect(Number(declaration(scopedStyles, ".movil-line-sheet", "z-index"))).toBeGreaterThan(
			20,
		);
	});

	it("builds no second scanner and steals no focus", () => {
		expect(SheetSource).not.toContain("useScannerInput");
		expect(SheetSource).not.toContain("autofocus");
	});

	it("has Spanish for every string it authors", () => {
		const translated = new Set<string>();
		for (const row of EsCsv.split(/\r?\n/)) {
			if (!row.trim()) continue;
			if (row.startsWith('"')) {
				const end = row.indexOf('",');
				if (end !== -1) translated.add(row.slice(1, end).replace(/""/g, '"'));
			} else {
				const comma = row.indexOf(",");
				if (comma !== -1) translated.add(row.slice(0, comma));
			}
		}

		const strings = [...SheetSource.matchAll(/__\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
		expect(strings.length).toBeGreaterThanOrEqual(6);

		const missing = strings.filter((value) => !translated.has(value));
		expect(missing, `untranslated: ${missing.join(", ")}`).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 4. the cart row carries the identity the sheet needs
// ---------------------------------------------------------------------------

describe("the tapped line arrives with an identity", () => {
	it("puts posa_row_id on every phone cart line", () => {
		const cart = describeMobileSaleLines([
			{ ...ROW, is_stock_item: 1, _base_actual_qty: 3, conversion_factor: 1 },
		]);
		expect(cart.lines[0].rowId).toBe("row-1");
	});

	it("hands back an empty identity rather than a neighbour's", () => {
		// `key` falls back to `CODE#index` so `v-for` always has something;
		// `rowId` must NOT, because an edit addressed by that would land on
		// whichever row matched first.
		const cart = describeMobileSaleLines([{ item_code: "A", item_name: "A", qty: 1, rate: 1 }]);
		expect(cart.lines[0].key).toBe("A#0");
		expect(cart.lines[0].rowId).toBe("");
	});

	it("carries it out of the sale screen on a tap", async () => {
		const onSelectLine = vi.fn();
		const screen = mount(MobileSaleScreen, {
			props: {
				items: [ROW],
				state: resolveBandState({ kind: "sale", total: 240, itemCount: 2 }),
				subtotal: 240,
				tax: 0,
				formatCurrency: money,
				onSelectLine,
			} as never,
		});

		await screen.find('[data-testid="movil-cart-line"]').trigger("click");

		expect(onSelectLine).toHaveBeenCalledTimes(1);
		expect(onSelectLine.mock.calls[0][0].rowId).toBe("row-1");
	});
});

// ---------------------------------------------------------------------------
// 5. the wiring
// ---------------------------------------------------------------------------

/** Minimal mitt stand-in — the shell registers real bus listeners on mount. */
const makeBus = () => {
	const seen: Array<{ event: string; payload: unknown }> = [];
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	return {
		seen,
		on: (event: string, fn: (payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn: (payload?: unknown) => void) => {
			handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
		},
		emit: (event: string, payload?: unknown) => {
			seen.push({ event, payload });
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await nextTick();
};

describe("the shell routes a tapped line to the sheet, and keeps the old door", () => {
	let bus: ReturnType<typeof makeBus>;

	/**
	 * A phone shell sitting on the CART tab with one line in the ticket.
	 *
	 * The dock tap matters: `movilCartActive` is what the assertions read, and
	 * it is the shell's own answer to "is the movil cart drawn, or has the
	 * classic one been fronted over it" — the observable half of the fallback,
	 * rather than the private ref that drives it.
	 */
	const mountShell = async () => {
		window.innerWidth = 390;
		const wrapper = mount(Pos, {
			shallow: true,
			global: { plugins: [createVuetify()], provide: { eventBus: bus } },
		});
		const vm = wrapper.vm as any;
		useInvoiceStore().setItems([{ ...ROW }]);
		useUIStore().setPosProfile({ name: "Caja 2", ...ALLOW_ALL } as any);
		await settle();
		vm.dockTabs.find((tab: any) => tab.id === "cart").onTap();
		await settle();
		expect(vm.movilCartActive).toBe(true);
		return vm;
	};

	beforeEach(() => {
		setActivePinia(createPinia());
		bus = makeBus();
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "tester@example.com" },
			call: vi.fn().mockResolvedValue({ message: null }),
			db: { get_doc: vi.fn().mockResolvedValue({}) },
			realtime: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
			// `format.ts`'s currency precision falls back to this when the
			// profile carries no `posa_decimal_precision`; without it every
			// formatted figure throws into the shell's error handler.
			defaults: { get_default: () => 2 },
			datetime: {
				nowdate: () => "2026-08-30",
				now_time: () => "10:00:00",
				get_today: () => "2026-08-30",
			},
			boot: { user: { roles: [] }, sysdefaults: {} },
		});
	});

	it("opens the sheet on the tapped row, gated by the live profile", async () => {
		const vm = await mountShell();

		vm.onMovilSelectLine({ rowId: "row-1" });
		await nextTick();

		expect(vm.movilShellProps.lineSheet).not.toBeNull();
		expect(vm.movilShellProps.lineSheet.rowId).toBe("row-1");
		expect(vm.movilShellProps.lineSheet.itemName).toBe(ROW.item_name);
		// The profile really is threaded through — not a hard-coded `true`.
		expect(vm.movilShellProps.lineSheet.canEditRate).toBe(true);
		// …and the classic fallback was NOT taken: the movil cart is still the
		// screen, with the sheet over it.
		expect(vm.movilCartActive).toBe(true);
	});

	it("still falls back to the classic cart for a line with no identity", async () => {
		const vm = await mountShell();

		vm.onMovilSelectLine({ rowId: "" });
		await nextTick();

		expect(vm.movilShellProps.lineSheet).toBeNull();
		// The classic cart is fronted — the round-1 fallback still works.
		expect(vm.movilCartActive).toBe(false);
	});

	it("sends the sheet's verb onto the bus with the row stamped on it", async () => {
		const vm = await mountShell();
		vm.onMovilSelectLine({ rowId: "row-1" });
		await nextTick();

		vm.onMovilLineEdit({ kind: "step", delta: 1 });
		vm.onMovilLineEdit({ kind: "qty", qty: 5 });
		vm.onMovilLineEdit({ kind: "rate", rate: 99 });

		const sent = bus.seen.filter((entry) => entry.event === "movil:line-edit");
		expect(sent.map((entry) => entry.payload)).toEqual([
			{ kind: "step", delta: 1, rowId: "row-1", itemCode: ROW.item_code },
			{ kind: "qty", qty: 5, rowId: "row-1", itemCode: ROW.item_code },
			{ kind: "rate", rate: 99, rowId: "row-1", itemCode: ROW.item_code },
		]);
		// A rate change leaves the sheet up — a cashier adjusting a line is
		// usually adjusting it more than once.
		expect(vm.movilShellProps.lineSheet).not.toBeNull();
	});

	it("closes the sheet on a removal, and when the row leaves the cart", async () => {
		const vm = await mountShell();
		vm.onMovilSelectLine({ rowId: "row-1" });
		await nextTick();

		vm.onMovilLineEdit({ kind: "remove" });
		await nextTick();
		expect(bus.seen.some((e) => e.event === "movil:line-edit")).toBe(true);
		expect(vm.movilShellProps.lineSheet).toBeNull();

		// And the other way round: a row removed from the desk (or a cleared
		// invoice) must not leave a sheet open over an item that is gone.
		vm.onMovilSelectLine({ rowId: "row-1" });
		await nextTick();
		expect(vm.movilShellProps.lineSheet).not.toBeNull();
		useInvoiceStore().setItems([]);
		await nextTick();
		expect(vm.movilShellProps.lineSheet).toBeNull();
	});

	it("hands the line to the classic cart when «More options» is pressed", async () => {
		const vm = await mountShell();
		vm.onMovilSelectLine({ rowId: "row-1" });
		await nextTick();

		vm.onMovilLineMore();
		await nextTick();

		expect(vm.movilShellProps.lineSheet).toBeNull();
		expect(vm.movilCartActive).toBe(false);
	});

	it("closes without editing anything", async () => {
		const vm = await mountShell();
		vm.onMovilSelectLine({ rowId: "row-1" });
		await nextTick();

		vm.onMovilLineClose();
		await nextTick();

		expect(vm.movilShellProps.lineSheet).toBeNull();
		// Closing is not «More options»: the movil cart stays the screen.
		expect(vm.movilCartActive).toBe(true);
		expect(bus.seen.some((e) => e.event === "movil:line-edit")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 6. source pins — the seams a render cannot show
// ---------------------------------------------------------------------------

describe("the routing and the engine call are pinned where they live", () => {
	it("routes select-line to the sheet BEFORE the classic fallback", () => {
		// The order is the whole behaviour: a handler that set `movilCartDetail`
		// first and opened the sheet after would front the desktop cart on
		// every tap and this file's mounted tests would still pass, because
		// both states would be set.
		const handler = /const onMovilSelectLine = \(line\) => \{([\s\S]*?)\n\t\t\};/.exec(
			PosSource,
		)?.[1] as string;
		expect(handler).toBeTruthy();

		const guard = handler.indexOf("const rowId = line?.rowId");
		const fallback = handler.indexOf("movilCartDetail.value = true");
		const open = handler.indexOf("movilLineRowId.value = rowId");

		expect(guard).toBeGreaterThanOrEqual(0);
		expect(guard).toBeLessThan(fallback);
		expect(fallback).toBeLessThan(open);
		// The fallback survives — this round replaces the DEFAULT tap, not the
		// classic cart.
		expect(PosSource).toContain("movilCartDetail");
		expect(PosSource).toContain("const onMovilLineMore");
	});

	it("keeps every engine mounted — the sheet is chrome, not a panel swap", () => {
		// The shell's rule since round 1: Invoice / ItemsSelector / Payments are
		// `v-show`, never `v-if`. The line sheet is the transient surface and is
		// the only thing here allowed a `v-if`.
		expect(ShellSource).toContain('<MovilLineSheet\n\t\tv-if="lineSheet"');
		expect(PosSource).toMatch(/v-show="!movilPayActive"/);
		expect(PosSource).not.toMatch(/v-if="!movilPayActive"/);
	});

	it("answers the bus inside Invoice.vue, with the desktop row's own functions", () => {
		// The point of the whole seam: no second write path into a cart line.
		expect(InvoiceSource).toContain('"movil:line-edit": this.handleMovilLineEdit');

		const handler = /handleMovilLineEdit\(payload = \{\}\) \{([\s\S]*?)\n\t\t\},\n/.exec(
			InvoiceSource,
		)?.[1] as string;
		expect(handler).toBeTruthy();

		// ± rides add_one / subtract_one, which already mirror the return sign
		// and remove the row at zero.
		expect(handler).toContain("this.add_one(item)");
		expect(handler).toContain("this.subtract_one(item)");
		// A typed qty rides the same setter ItemsTable's inline field rides.
		expect(handler).toContain('this.setFormatedQty(item, "qty", null, false, qty)');
		// Rate and discount ride setFormatedCurrency + calc_prices, exactly as
		// handleRateUpdate / handleDiscountPercentUpdate do.
		expect(handler).toContain('this.setFormatedCurrency(item, "rate"');
		expect(handler).toContain('{ target: { id: "rate" } }');
		expect(handler).toContain('this.setFormatedCurrency(item, "discount_percentage"');
		expect(handler).toContain('{ target: { id: "discount_percentage" } }');
		expect(handler).toContain("this.remove_item(item)");

		// Identity, then item code — and NOTHING else. An index fallback would
		// silently edit a neighbouring line.
		expect(handler).toContain("row?.posa_row_id === rowId");
		expect(handler).toContain("row?.item_code === itemCode");
		expect(handler).toContain("if (index < 0) return;");
	});

	it("declares the event on the closed bus map", () => {
		// An undeclared event is one vue-tsc cannot fail a mishandler on.
		expect(SheetSource).not.toContain("eventBus");
		expect(ModelSource).toContain("MovilLineEditIntent");
	});
});
