// @vitest-environment jsdom

/**
 * The four states of the customer's screen
 * (`docs/PANTALLA_CLIENTE_GOLDEN_FLOW.md` §1, artboard
 * `PantallaCliente.dc.html`).
 *
 *     Idle   → brand mark + «Bienvenido»
 *     Sale   → lines appear as scanned; running total BIG
 *     Tender → TOTAL dominant; «Recibido $700 · Cambio $102»
 *     Done   → «Gracias» + change reminder + the accrual, enrolled only
 *            → back to Idle
 *
 * Two halves, and they fail differently. The state machine is asserted
 * directly on `displayModel.ts`, which is pure — so the rules about what may
 * be inferred from a feed are readable without a mount. The rendering is
 * asserted through the REAL transport contract (a storage envelope written to
 * the key `utils/customerDisplay.ts` computes, then the `storage` event the
 * browser would raise), because the window seam is the part most likely to
 * rot and a mock of it would agree with whatever the component believed.
 *
 * The storage leg is used in preference to `BroadcastChannel` on purpose: it
 * delivers synchronously, so nothing here waits on a macrotask that jsdom may
 * schedule differently from a browser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("vue-router", () => ({ useRoute: () => routeState }));

import CustomerDisplay from "../src/posapp/components/customer_display/CustomerDisplay.vue";
import {
	resolveDisplayView,
	type CustomerDisplayFeed,
} from "../src/posapp/components/customer_display/displayModel";
import { getCustomerDisplayStorageKey } from "../src/posapp/utils/customerDisplay";

const CHANNEL = "cd_states";
const STORAGE_KEY = getCustomerDisplayStorageKey(CHANNEL);

const line = (id: string, item_name: string, qty: number, rate: number, extra = {}) => ({
	id,
	item_code: `CODE-${id}`,
	item_name,
	qty,
	rate,
	amount: qty * rate,
	uom: "Nos",
	...extra,
});

const feed = (
	items: ReturnType<typeof line>[],
	overrides: Partial<CustomerDisplayFeed> = {},
): CustomerDisplayFeed => ({
	channel_id: CHANNEL,
	currency: "MXN",
	customer_name: "Alejandra Ríos Bautista",
	items,
	total_qty: items.reduce((sum, row) => sum + row.qty, 0),
	total_amount: items.reduce((sum, row) => sum + row.amount, 0),
	updated_at: "2026-08-23T18:00:00.000Z",
	...overrides,
});

/** What the component's own formatter produces, computed the same way, so the
 *  assertions do not hard-code one machine's ICU output. */
const money = (value: number) =>
	new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: "MXN",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);

const publish = async (snapshot: CustomerDisplayFeed) => {
	const envelope = JSON.stringify({
		type: "snapshot",
		payload: snapshot,
		sent_at: new Date().toISOString(),
	});
	window.localStorage.setItem(STORAGE_KEY, envelope);
	window.dispatchEvent(
		new StorageEvent("storage", { key: STORAGE_KEY, newValue: envelope }),
	);
	await nextTick();
};

beforeEach(() => {
	routeState.query = { channel: CHANNEL };
	window.localStorage.clear();
});

const BASKET = [
	line("a", "Mica Cristal iPhone 13", 1, 120),
	line("b", "Funda Case negro", 1, 199),
];

/* ---------------------------------------------------------------------- */

describe("the state machine reads the feed and infers nothing else", () => {
	it("is idle with no feed at all", () => {
		expect(resolveDisplayView(null).state).toBe("idle");
		expect(resolveDisplayView(undefined).state).toBe("idle");
	});

	it("is idle with a feed that carries no lines", () => {
		expect(resolveDisplayView(feed([])).state).toBe("idle");
	});

	it("is sale as soon as a line arrives", () => {
		expect(resolveDisplayView(feed(BASKET)).state).toBe("sale");
	});

	it("is tender when money has been received, with or without a stage", () => {
		expect(resolveDisplayView(feed(BASKET, { received_amount: 700 })).state).toBe("tender");
		expect(resolveDisplayView(feed(BASKET, { stage: "tender" })).state).toBe("tender");
	});

	it("does NOT read a received of zero as a tender", () => {
		// Zero is the absence of a tender written as a number. A «Recibido
		// $0.00» card in front of someone who has not paid yet is the screen
		// inventing a step.
		expect(resolveDisplayView(feed(BASKET, { received_amount: 0 })).state).toBe("sale");
		expect(resolveDisplayView(feed(BASKET, { received_amount: 0 })).tender).toBeNull();
	});

	it("only reaches done when the feed SAYS so", () => {
		// An emptied cart is a completed sale AND a voided one. Printing
		// «Gracias» at a customer whose sale the cashier just cancelled is a
		// lie with their money in it, so this state is never inferred.
		expect(resolveDisplayView(feed([])).state).toBe("idle");
		expect(resolveDisplayView(feed([], { stage: "done" })).state).toBe("done");
		expect(resolveDisplayView(feed(BASKET, { stage: "paid" })).state).toBe("done");
	});

	it("returns to idle when the feed declares a stage but has nothing to show", () => {
		expect(resolveDisplayView(feed([], { stage: "sale" })).state).toBe("idle");
		expect(resolveDisplayView(feed(BASKET, { stage: "idle" })).state).toBe("idle");
	});
});

describe("the arithmetic the screen shows closes", () => {
	it("says nothing when the lines already add up to the total", () => {
		const view = resolveDisplayView(feed(BASKET));
		expect(view.saving).toBeNull();
		expect(view.surcharge).toBeNull();
		expect(view.total).toBe(319);
	});

	it("names a saving when the total is below the lines", () => {
		const view = resolveDisplayView(feed(BASKET, { total_amount: 240 }));
		expect(view.saving).toBe(79);
		expect(view.surcharge).toBeNull();
	});

	it("names a charge separately, so the two never wear the same tone", () => {
		const view = resolveDisplayView(feed(BASKET, { total_amount: 344 }));
		expect(view.surcharge).toBe(25);
		expect(view.saving).toBeNull();
	});

	it("does not state the same saving twice", () => {
		// A combo whose line prints «ahorras $79» and whose total is $79 below
		// the rows has ONE saving. A summary row underneath would give a
		// customer counting the discounts two.
		const combo = [line("a", "Combo Protección", 1, 378, { saving: 79 })];
		const view = resolveDisplayView(
			feed(combo as never, { total_amount: 299 }) as CustomerDisplayFeed,
		);
		expect(view.lines[0]!.saving).toBe(79);
		expect(view.saving, "the lines already explained the whole discount").toBeNull();
	});

	it("still names the part of a saving the lines did not explain", () => {
		const combo = [line("a", "Combo Protección", 1, 378, { saving: 79 })];
		const view = resolveDisplayView(
			feed(combo as never, { total_amount: 279 }) as CustomerDisplayFeed,
		);
		expect(view.saving).toBe(20);
	});

	it("counts the pieces the feed declares, falling back to the rows", () => {
		expect(resolveDisplayView(feed(BASKET, { total_qty: 4 })).itemCount).toBe(4);
		expect(resolveDisplayView(feed(BASKET, { total_qty: 0 })).itemCount).toBe(2);
	});
});

/* ---------------------------------------------------------------------- */

describe("idle", () => {
	it("greets rather than reporting an empty cart", async () => {
		const wrapper = mount(CustomerDisplay);
		await nextTick();

		const idle = wrapper.find('[data-testid="customer-display-idle"]');
		expect(idle.exists()).toBe(true);
		expect(idle.text()).toContain("Welcome");
		// A shop with the register open and nothing scanned is showing this to
		// the street, so it must not read as a fault.
		expect(wrapper.text()).not.toContain("Waiting");
		expect(wrapper.find('[data-money-role="total"]').exists()).toBe(false);
	});

	it("carries the brand, and no product mark of its own", async () => {
		const wrapper = mount(CustomerDisplay);
		await nextTick();
		expect(wrapper.text()).toContain("Muelle");
		expect(wrapper.html().toLowerCase()).not.toContain("posawesome");
	});

	it("names the missing link once, quietly, when there is no channel", async () => {
		routeState.query = {};
		const wrapper = mount(CustomerDisplay);
		await nextTick();

		const unlinked = wrapper.find('[data-testid="customer-display-unlinked"]');
		expect(unlinked.exists()).toBe(true);
		expect(unlinked.text()).toBe("Not linked to a register");
		expect(wrapper.find('[data-testid="customer-display-idle"]').text()).toContain("Welcome");
	});

	it("says nothing about the register when it IS linked", async () => {
		const wrapper = mount(CustomerDisplay);
		await nextTick();
		expect(wrapper.find('[data-testid="customer-display-unlinked"]').exists()).toBe(false);
	});
});

describe("sale", () => {
	it("shows every line the feed carries, once", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET));

		expect(wrapper.attributes("data-state")).toBe("sale");
		const rows = wrapper.findAll('[data-testid="customer-display-line"]');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.text()).toContain("Mica Cristal iPhone 13");
		expect(wrapper.findAll('[data-money-role="line"]')).toHaveLength(2);
	});

	it("puts one dominant figure on the screen and declares what it is", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET));

		const figures = wrapper.findAll('[data-testid="customer-display-figure"]');
		expect(figures).toHaveLength(1);
		expect(figures[0]!.text()).toBe(money(319));
		expect(figures[0]!.attributes("data-money-role")).toBe("total");
		expect(wrapper.find('[data-testid="customer-display-figure-label"]').text()).toBe(
			"Total to pay",
		);
	});

	it("states the piece count beside the basket, not beside the figure", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { total_qty: 4 }));
		expect(wrapper.find('[data-testid="customer-display-count"]').text()).toBe("4 items");
	});

	it("shows a unit price only when the quantity is not one", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed([line("a", "Cargador 20 W", 2, 179)]));
		expect(wrapper.find('[data-money-role="line-unit"]').text()).toBe(`2 × ${money(179)}`);

		await publish(feed([line("a", "Cargador 20 W", 1, 179)]));
		expect(wrapper.find('[data-money-role="line-unit"]').exists()).toBe(false);
	});

	it("keeps the unit price on a weighed line, where it matters most", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed([line("a", "Jamón serrano", 0.75, 400)]));
		expect(wrapper.find('[data-money-role="line-unit"]').text()).toBe(`0.75 × ${money(400)}`);
	});

	it("prints a combo's saving on its own line when the feed carries one", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(
			feed([line("a", "Combo Protección", 1, 299, { note: "combo protección", saving: 79 })]),
		);

		const saving = wrapper.find('[data-testid="customer-display-line-saving"]');
		expect(saving.exists()).toBe(true);
		expect(saving.text()).toBe(`you save ${money(79)}`);
		expect(wrapper.find('[data-testid="customer-display-line"]').text()).toContain(
			"combo protección",
		);
	});

	it("prints no saving and no qualifier when the feed carries neither", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET));
		expect(wrapper.find('[data-testid="customer-display-line-saving"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("·");
	});

	it("closes the gap between the rows and the figure, in the positive tone", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { total_amount: 240 }));

		const saving = wrapper.find('[data-testid="customer-display-saving"]');
		expect(saving.exists()).toBe(true);
		expect(saving.find('[data-money-role="saving"]').text()).toBe(`−${money(79)}`);
		expect(saving.classes()).toContain("cd-line--saving");
		expect(wrapper.find('[data-testid="customer-display-surcharge"]').exists()).toBe(false);
	});

	it("marks a charge as an addition and leaves it neutral", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { total_amount: 344 }));

		const charge = wrapper.find('[data-testid="customer-display-surcharge"]');
		expect(charge.find('[data-money-role="surcharge"]').text()).toBe(`+${money(25)}`);
		expect(charge.classes()).not.toContain("cd-line--saving");
	});

	it("returns to the greeting when the sale is cleared", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET));
		expect(wrapper.find('[data-testid="customer-display-sale"]').exists()).toBe(true);

		await publish(feed([]));
		expect(wrapper.find('[data-testid="customer-display-idle"]').exists()).toBe(true);
	});
});

describe("tender", () => {
	it("keeps the total dominant and puts the cash in a card beneath it", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { received_amount: 700, change_amount: 381 }));

		expect(wrapper.attributes("data-state")).toBe("tender");
		const figure = wrapper.find('[data-testid="customer-display-figure"]');
		expect(figure.attributes("data-money-role")).toBe("total");
		expect(figure.text()).toBe(money(319));

		const card = wrapper.find('[data-testid="customer-display-tender"]');
		expect(card.find('[data-money-role="received"]').text()).toBe(money(700));
		expect(card.find('[data-money-role="change"]').text()).toBe(money(381));
	});

	it("still shows the basket, so the customer can check what they are paying for", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { received_amount: 700, change_amount: 381 }));
		expect(wrapper.findAll('[data-testid="customer-display-line"]')).toHaveLength(2);
	});

	it("shows no tender card at all while nothing has been received", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET));
		expect(wrapper.find('[data-testid="customer-display-tender"]').exists()).toBe(false);
	});

	it("prints an exact payment as change of zero rather than hiding the row", async () => {
		// Once money is on the counter, «$0.00» is a READ fact and the one the
		// customer wants confirmed. That is different from the zero the screen
		// refuses to invent before any tender exists.
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { received_amount: 319, change_amount: 0 }));
		expect(wrapper.find('[data-money-role="change"]').text()).toBe(money(0));
	});
});

describe("done", () => {
	const DONE = { stage: "done", received_amount: 700, change_amount: 381 };

	it("thanks the customer and makes the CHANGE the dominant figure", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, DONE));

		expect(wrapper.attributes("data-state")).toBe("done");
		expect(wrapper.find('[data-testid="customer-display-thanks"]').text()).toBe("Thank you");

		const figure = wrapper.find('[data-testid="customer-display-figure"]');
		expect(figure.attributes("data-money-role")).toBe("change");
		expect(figure.text()).toBe(money(381));
		expect(wrapper.find('[data-testid="customer-display-figure-label"]').text()).toBe(
			"Remember your change",
		);
	});

	it("says the change exactly once — the card does not repeat the figure", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, DONE));
		expect(wrapper.findAll('[data-money-role="change"]')).toHaveLength(1);
		// What the card still adds is the amount handed over, which the
		// dominant figure does not say.
		expect(wrapper.find('[data-money-role="received"]').text()).toBe(money(700));
	});

	it("falls back to the total when there is nothing to hand back", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { stage: "done", received_amount: 319, change_amount: 0 }));

		const figure = wrapper.find('[data-testid="customer-display-figure"]');
		expect(figure.attributes("data-money-role")).toBe("total");
		expect(figure.text()).toBe(money(319));
		expect(wrapper.find('[data-testid="customer-display-figure-label"]').text()).toBe("Paid");
	});

	it("goes back to idle on the next snapshot, as the loop closes", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, DONE));
		await publish(feed([]));
		expect(wrapper.find('[data-testid="customer-display-idle"]').exists()).toBe(true);
	});
});

describe("the cashback card is absent, never zeroed", () => {
	// walletSummary.ts's standing rule, and the artboard says so in its own
	// comment: the card is for enrolled customers on card-enabled registers,
	// and for everyone else it is simply not there.
	it("renders nothing for a feed that says nothing about a card", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { stage: "done", change_amount: 381, received_amount: 700 }));
		expect(wrapper.find('[data-testid="customer-display-accrual"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("earns you");
	});

	it.each([
		["an accrual of zero", 0],
		["a negative accrual", -12.5],
	])("renders nothing for %s", async (_why, earned) => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { stage: "done", cashback_earned: earned }));
		expect(wrapper.find('[data-testid="customer-display-accrual"]').exists()).toBe(false);
	});

	it("renders the accrual when the feed carries a real one", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(
			feed(BASKET, {
				stage: "done",
				cashback_earned: 17.94,
				cashback_balance_after: 435.94,
			}),
		);

		const card = wrapper.find('[data-testid="customer-display-accrual"]');
		expect(card.exists()).toBe(true);
		expect(card.find('[data-money-role="accrual"]').text()).toBe(`+${money(17.94)}`);
		expect(card.find('[data-testid="customer-display-accrual-balance"]').text()).toContain(
			money(435.94),
		);
	});

	it("names no person on the card — the queue behind reads this screen too", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(
			feed(BASKET, { stage: "done", cashback_earned: 17.94, cashback_balance_after: 435.94 }),
		);
		expect(wrapper.html()).not.toContain("Alejandra");
		expect(wrapper.find('[data-testid="customer-display-accrual"]').text()).toContain("Your card");
	});

	it("drops the balance line rather than printing an invented one", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { stage: "done", cashback_earned: 17.94 }));
		expect(wrapper.find('[data-testid="customer-display-accrual"]').exists()).toBe(true);
		expect(
			wrapper.find('[data-testid="customer-display-accrual-balance"]').exists(),
			"a balance nobody sent is not a balance",
		).toBe(false);
	});
});

describe("a mirror, never a control", () => {
	const STATES: [string, CustomerDisplayFeed][] = [
		["idle", feed([])],
		["sale", feed(BASKET)],
		["tender", feed(BASKET, { received_amount: 700, change_amount: 381 })],
		[
			"done",
			feed(BASKET, {
				stage: "done",
				received_amount: 700,
				change_amount: 381,
				cashback_earned: 17.94,
				cashback_balance_after: 435.94,
			}),
		],
	];

	it.each(STATES)("renders nothing tappable in the %s state", async (_state, snapshot) => {
		const wrapper = mount(CustomerDisplay);
		await publish(snapshot);

		const html = wrapper.html();
		for (const tag of ["<button", "<a ", "<input", "<select", "<textarea"]) {
			expect(html, `the customer display rendered a ${tag.trim()}`).not.toContain(tag);
		}
		expect(wrapper.findAll('[role="button"]')).toHaveLength(0);
		expect(wrapper.findAll("[tabindex]")).toHaveLength(0);
		expect(wrapper.findAll("[href]")).toHaveLength(0);
	});

	it("binds no listener a customer could fire", async () => {
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET, { received_amount: 700, change_amount: 381 }));

		// Vue attaches DOM listeners as `onClick` props on the vnode; a template
		// with no handler produces none anywhere in the tree.
		const withHandlers = wrapper
			.findAll("*")
			.filter((node) =>
				Object.keys((node as any).element ?? {}).some((key) => key.startsWith("__vnode")),
			)
			.filter((node) => {
				const vnode = ((node as any).element.__vnode ?? {}) as { props?: Record<string, unknown> };
				return Object.keys(vnode.props ?? {}).some((key) => /^on[A-Z]/.test(key));
			});
		expect(withHandlers, "an element on the customer display carries a DOM handler").toHaveLength(
			0,
		);
	});
});

describe("the register must not care whether this window works", () => {
	it("renders without a channel and opens no transport", async () => {
		routeState.query = {};
		const spy = vi.spyOn(window, "addEventListener");
		const wrapper = mount(CustomerDisplay);
		await nextTick();

		expect(wrapper.find('[data-testid="customer-display"]').exists()).toBe(true);
		expect(
			spy.mock.calls.some(([event]) => event === "storage"),
			"a display with no channel subscribed to storage anyway",
		).toBe(false);
		spy.mockRestore();
	});

	it("renders where BroadcastChannel does not exist", async () => {
		const original = (window as any).BroadcastChannel;
		delete (window as any).BroadcastChannel;
		try {
			const wrapper = mount(CustomerDisplay);
			await publish(feed(BASKET));
			expect(wrapper.find('[data-money-role="total"]').text()).toBe(money(319));
		} finally {
			(window as any).BroadcastChannel = original;
		}
	});

	it("survives a snapshot with no items array at all", async () => {
		const wrapper = mount(CustomerDisplay);
		const broken = { ...feed([]) } as any;
		delete broken.items;
		await publish(broken);
		expect(wrapper.find('[data-testid="customer-display-idle"]').exists()).toBe(true);
	});

	it("keeps the sale it already knows when the feed stops arriving", async () => {
		// The register losing its network does not reach this window at all:
		// the last snapshot stays on screen and nothing alarming appears.
		const wrapper = mount(CustomerDisplay);
		await publish(feed(BASKET));
		await nextTick();
		expect(wrapper.findAll('[data-testid="customer-display-line"]')).toHaveLength(2);
		expect(wrapper.text()).not.toMatch(/error|offline|failed|desconectad/i);
	});

	it("tears its subscription down on unmount", async () => {
		const spy = vi.spyOn(window, "removeEventListener");
		const wrapper = mount(CustomerDisplay);
		await nextTick();
		wrapper.unmount();
		expect(spy.mock.calls.some(([event]) => event === "storage")).toBe(true);
		spy.mockRestore();
	});
});
