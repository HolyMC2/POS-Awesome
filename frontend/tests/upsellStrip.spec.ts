// @vitest-environment jsdom

/**
 * "Se suele llevar junto" — the tiles, and the sentence about Enter
 * (`docs/POS-RIEL-Y-CAJON-BUILD.md` §11 item D, `Main.dc.html` nodes 93–107).
 *
 * Two properties are worth a suite of their own, and both are about NOT
 * saying something false at the counter:
 *
 *   1. An absent stock figure draws nothing. `0` is a claim — it tells the
 *      cashier the shop has none, and they repeat that to the customer.
 *      `cartLineStock.ts` settled this for the cart's Existencia column and
 *      the strip must not settle it differently.
 *   2. The hint and the shortcut are ONE boolean. The artboard writes "Enter
 *      para agregar el primero" unconditionally, but the scan field owns Enter
 *      whenever it holds focus — which on a desktop register is nearly always.
 *      A hint that lies about a shortcut is worse than no hint, so the last
 *      describe block here asserts the equivalence directly rather than
 *      asserting the two halves separately and hoping they stay in step.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";

import ComboSuggestionStrip from "../src/posapp/components/pos/combos/ComboSuggestionStrip.vue";
import type { ComboSuggestion } from "../src/posapp/composables/pos/combos/comboCatalog";

/** A marker no formatter would produce, so a money figure can be counted. */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${value.toFixed(2)}`;

const COMBO: ComboSuggestion = {
	item_code: "COMBO-X8A",
	item_name: "Combo Protección Honor X8A",
	rate: 289,
	saving: 36,
	kind: "combo",
	reason: "targets-cart-item",
};

const ITEM: ComboSuggestion = {
	item_code: "MICA15P",
	item_name: "Mica Cristal iPhone 15 Pro",
	rate: 80,
	availableQty: 24,
	kind: "item",
	reason: "universal",
};

const strip = (suggestions: ComboSuggestion[], onAdd = vi.fn()) => {
	const wrapper = mount(ComboSuggestionStrip, {
		attachTo: document.body,
		props: { suggestions, formatCurrency: money, onAdd },
	});
	return { wrapper, onAdd };
};

/**
 * Every strip is torn down between tests, and this is load-bearing rather than
 * tidiness: the component listens on the DOCUMENT for Enter, so a wrapper left
 * mounted keeps handling keys in the next test. Its handler runs first, calls
 * `preventDefault()`, and the strip under test then correctly declines an
 * already-handled Enter — which reads as "the binding is broken" and is not.
 */
enableAutoUnmount(afterEach);

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("what a tile says", () => {
	it("draws price and saving for a combo, price and stock for a plain item", () => {
		const { wrapper } = strip([COMBO, ITEM]);
		const comboTile = wrapper.get('[data-testid="upsell-tile-COMBO-X8A"]');
		const itemTile = wrapper.get('[data-testid="upsell-tile-MICA15P"]');

		expect(comboTile.text()).toContain(money(289));
		expect(comboTile.find('[data-testid="combo-saving"]').text()).toContain(money(36));
		expect(comboTile.find('[data-testid="upsell-qty"]').exists()).toBe(false);

		expect(itemTile.text()).toContain(money(80));
		expect(itemTile.get('[data-testid="upsell-qty"]').text()).toBe("· 24 pcs");
		expect(itemTile.find('[data-testid="combo-saving"]').exists()).toBe(false);
	});

	it("draws NOTHING rather than 0 when the stock figure is absent", () => {
		// Three ways to have no figure and only one of them is "the shelves are
		// empty": a service with no shelf, an offline tile, a payload without
		// the field. None of them may render a zero.
		for (const availableQty of [null, undefined]) {
			const { wrapper } = strip([{ ...ITEM, availableQty }]);
			const tile = wrapper.get('[data-testid="upsell-tile-MICA15P"]');
			expect(tile.find('[data-testid="upsell-qty"]').exists()).toBe(false);
			expect(tile.text()).not.toContain("0 pcs");
			expect(tile.text()).toContain(money(80));
			wrapper.unmount();
		}
	});

	it("does draw a real zero on a combo, which is a genuine answer", () => {
		// Symmetry check, so "absent draws nothing" is not read as "never draw
		// a zero". A combo whose availability RESOLVED to 0 is exactly the
		// moment the figure is worth having.
		const { wrapper } = strip([
			{
				...COMBO,
				availability: { show: true, value: 0, limitedBy: "Mica", isLow: true, reason: "bounded" },
			},
		]);
		expect(wrapper.get('[data-testid="upsell-stock"]').text()).toBe("· left 0");
	});

	it("renders nothing at all when there is nothing to suggest", () => {
		const { wrapper } = strip([]);
		expect(wrapper.find('[data-testid="upsell-strip"]').exists()).toBe(false);
		expect(wrapper.text()).toBe("");
	});
});

describe("every amount declares what it is", () => {
	it("labels each figure and puts exactly one figure under each label", () => {
		// The rule `registerSaysItOnce.spec.ts` enforces on the summary: a money
		// figure with no `data-money-role` is exactly how a third total got on
		// screen. A tile price is an OFFER — money for something the ticket does
		// not contain yet.
		const { wrapper } = strip([COMBO, ITEM]);
		// Counted on the TEXT, not the markup: each tile's `aria-label` repeats
		// its figures as one spoken sentence, and those are the same facts said
		// once, not extra numbers on screen.
		const figures = (wrapper.text().match(new RegExp(MONEY, "g")) || []).length;
		const declared = wrapper.findAll("[data-money-role]");

		expect(figures).toBe(3); // combo price, combo saving, item price
		expect(declared).toHaveLength(figures);
		for (const element of declared) {
			expect((element.text().match(new RegExp(MONEY, "g")) || []).length).toBe(1);
		}
		expect(wrapper.findAll('[data-money-role="offer"]')).toHaveLength(2);
		expect(wrapper.findAll('[data-money-role="offer-saving"]')).toHaveLength(1);
	});

	it("claims no total — the band owns that lane", () => {
		const { wrapper } = strip([COMBO, ITEM]);
		expect(wrapper.findAll('[data-money-role="total"]')).toHaveLength(0);
	});
});

/**
 * The scan field owns Enter while it holds focus, and it holds focus almost
 * always: `ItemHeader.vue` autofocuses it, `@keydown.enter` runs
 * `useItemsSelectorSearch.onEnter`, and after a scanner-driven search
 * `_performSearch` calls `clearSearch()` then `focusItemSearch()` — so an
 * EMPTY, focused scan field is the resting state right after every scan. A gun
 * emitting a trailing CR would land that Enter on whatever else claimed the
 * key. Stealing it would add an up-sell item to the ticket on every scan.
 */
describe("Enter, without taking it from the scan field", () => {
	/** A stand-in for the scan bar: same thing that matters, a focused input. */
	const scanField = () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		return input;
	};

	const pressEnter = (target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
		target.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }),
		);

	it("adds the first tile when nothing else claims the key", async () => {
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		await wrapper.vm.$nextTick();

		pressEnter();
		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ item_code: "COMBO-X8A" });
	});

	it("does not fire while the scan field holds focus", async () => {
		const field = scanField();
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		field.focus();
		await wrapper.vm.$nextTick();

		pressEnter(field);
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("re-arms once focus leaves the field, and disarms when it returns", async () => {
		const field = scanField();
		const { wrapper, onAdd } = strip([COMBO, ITEM]);

		field.focus();
		await wrapper.vm.$nextTick();
		expect(wrapper.find('[data-testid="upsell-enter-hint"]').exists()).toBe(false);

		field.blur();
		await wrapper.vm.$nextTick();
		expect(wrapper.find('[data-testid="upsell-enter-hint"]').exists()).toBe(true);
		pressEnter();
		expect(onAdd).toHaveBeenCalledTimes(1);
	});

	it("stands aside for a focused tile, which activates itself", async () => {
		// Otherwise Tab-then-Enter on the third tile would add the FIRST one.
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		const tile = wrapper.get('[data-testid="upsell-tile-MICA15P"]').element as HTMLElement;
		tile.focus();
		await wrapper.vm.$nextTick();

		pressEnter(tile);
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("leaves a modified Enter to whoever registered that chord", async () => {
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		await wrapper.vm.$nextTick();

		for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
			pressEnter(document.body, init);
		}
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("leaves an Enter something upstream already handled", async () => {
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		await wrapper.vm.$nextTick();

		const swallow = (event: Event) => event.preventDefault();
		document.body.addEventListener("keydown", swallow);
		pressEnter();
		document.body.removeEventListener("keydown", swallow);
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("does not fire an IME composition commit", async () => {
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		await wrapper.vm.$nextTick();

		pressEnter(document.body, { keyCode: 229 } as KeyboardEventInit);
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("stops listening once the strip is gone", async () => {
		const { wrapper, onAdd } = strip([COMBO, ITEM]);
		await wrapper.vm.$nextTick();
		wrapper.unmount();

		pressEnter();
		expect(onAdd).not.toHaveBeenCalled();
	});
});

/**
 * THE MUTATION TEST.
 *
 * Every assertion above checks one half — the hint, or the behaviour. This
 * block checks that they are the SAME half, which is the property that
 * actually matters and the one a future edit is most likely to break: someone
 * makes the hint unconditional to match the artboard, or drops the `v-if`
 * while refactoring the header, and the register then promises a shortcut that
 * silently does nothing.
 *
 * Mutations this fails against, all four verified by hand:
 *   - hint rendered unconditionally  → visible/works disagree while focused
 *   - hint never rendered            → disagree while unfocused
 *   - handler's focus guard removed  → the strip steals Enter from the field
 *   - handler removed entirely       → hint shows, nothing happens
 */
describe("the hint is visible IF AND ONLY IF Enter works", () => {
	const SCENARIOS = [
		{ name: "nothing focused", focus: () => null },
		{
			name: "the scan field focused",
			focus: () => {
				const input = document.createElement("input");
				input.setAttribute("data-pos-keyboard-target", "item-search");
				document.body.appendChild(input);
				input.focus();
				return input;
			},
		},
		{
			name: "a customer field focused",
			focus: () => {
				const wrap = document.createElement("div");
				wrap.innerHTML = '<div class="v-field"><input /></div>';
				document.body.appendChild(wrap);
				(wrap.querySelector("input") as HTMLElement).focus();
				return wrap;
			},
		},
		{
			name: "a dialog open with a non-input focused",
			focus: () => {
				const dialog = document.createElement("div");
				dialog.setAttribute("role", "dialog");
				dialog.innerHTML = '<div tabindex="0"></div>';
				document.body.appendChild(dialog);
				(dialog.firstElementChild as HTMLElement).focus();
				return dialog;
			},
		},
	];

	for (const scenario of SCENARIOS) {
		it(`agrees with itself: ${scenario.name}`, async () => {
			const onAdd = vi.fn();
			const wrapper = mount(ComboSuggestionStrip, {
				attachTo: document.body,
				props: { suggestions: [COMBO, ITEM], formatCurrency: money, onAdd },
			});
			const focused = scenario.focus();
			await wrapper.vm.$nextTick();

			const hintVisible = wrapper.find('[data-testid="upsell-enter-hint"]').exists();
			(focused ?? document.body).dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
			);
			const enterWorked = onAdd.mock.calls.length > 0;

			expect(
				hintVisible,
				`the strip promises "Enter adds the first" but pressing Enter ${
					enterWorked ? "works" : "does nothing"
				}`,
			).toBe(enterWorked);
			wrapper.unmount();
		});
	}

	it("promises nothing when there is no first tile to add", async () => {
		const wrapper = mount(ComboSuggestionStrip, {
			attachTo: document.body,
			props: { suggestions: [], formatCurrency: money },
		});
		await wrapper.vm.$nextTick();
		expect(wrapper.find('[data-testid="upsell-enter-hint"]').exists()).toBe(false);
	});
});
