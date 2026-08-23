// @vitest-environment jsdom

/**
 * The customer-facing screen (`docs/POS-RIEL-Y-CAJON-BUILD.md` §13).
 *
 * These drive the component through the REAL transport contract — a storage
 * envelope written to the key `utils/customerDisplay.ts` computes, then the
 * `storage` event the browser would raise — rather than through a stubbed
 * subscribe. The window seam is the part most likely to rot, and a mock of it
 * would agree with whatever the component believed.
 *
 * The storage leg is used in preference to `BroadcastChannel` on purpose: it
 * delivers synchronously, so nothing here waits on a macrotask that jsdom may
 * schedule differently from a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("vue-router", () => ({ useRoute: () => routeState }));

import CustomerDisplay from "../src/posapp/components/customer_display/CustomerDisplay.vue";
import {
	getCustomerDisplayStorageKey,
	type CustomerDisplayLineItem,
	type CustomerDisplaySnapshot,
} from "../src/posapp/utils/customerDisplay";

const CHANNEL = "cd_spec";
const STORAGE_KEY = getCustomerDisplayStorageKey(CHANNEL);

const line = (
	id: string,
	item_name: string,
	qty: number,
	rate: number,
): CustomerDisplayLineItem => ({
	id,
	item_code: `CODE-${id}`,
	item_name,
	qty,
	rate,
	amount: qty * rate,
	uom: "Nos",
});

const snapshotOf = (
	items: CustomerDisplayLineItem[],
	overrides: Partial<CustomerDisplaySnapshot> = {},
): CustomerDisplaySnapshot => ({
	channel_id: CHANNEL,
	currency: "MXN",
	customer_name: "Alejandra Ríos Bautista",
	items,
	total_qty: items.reduce((sum, row) => sum + row.qty, 0),
	total_amount: items.reduce((sum, row) => sum + row.amount, 0),
	updated_at: "2026-08-22T18:00:00.000Z",
	...overrides,
});

/** What the component's own formatter will produce, computed the same way, so
 *  the assertions do not hard-code one machine's ICU output. */
const money = (value: number) =>
	new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: "MXN",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);

const store = (snapshot: CustomerDisplaySnapshot) => {
	const envelope = JSON.stringify({
		type: "snapshot",
		payload: snapshot,
		sent_at: new Date().toISOString(),
	});
	window.localStorage.setItem(STORAGE_KEY, envelope);
	return envelope;
};

/** Writes the envelope AND raises the event, which is what a publish from the
 *  register window looks like from in here. */
const publish = async (snapshot: CustomerDisplaySnapshot) => {
	const envelope = store(snapshot);
	window.dispatchEvent(
		new StorageEvent("storage", { key: STORAGE_KEY, newValue: envelope }),
	);
	await nextTick();
};

const mountDisplay = () => mount(CustomerDisplay);

beforeEach(() => {
	routeState.query = { channel: CHANNEL };
	window.localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("the idle screen", () => {
	it("greets rather than reporting an empty cart", async () => {
		const wrapper = mountDisplay();
		await nextTick();

		const idle = wrapper.find('[data-testid="customer-display-idle"]');
		expect(idle.exists()).toBe(true);
		expect(idle.text()).toContain("Welcome");
		// A shop with the register open and nothing scanned is showing this to
		// the street, so it must not read as a fault.
		expect(wrapper.text()).not.toContain("Waiting");
		expect(wrapper.find('[data-testid="customer-display-total"]').exists()).toBe(false);
	});

	it("says nothing about the register when it IS linked", async () => {
		const wrapper = mountDisplay();
		await nextTick();
		expect(wrapper.find('[data-testid="customer-display-unlinked"]').exists()).toBe(false);
	});

	it("names the missing link once, quietly, when there is no channel", async () => {
		routeState.query = {};
		const wrapper = mountDisplay();
		await nextTick();

		const unlinked = wrapper.find('[data-testid="customer-display-unlinked"]');
		expect(unlinked.exists()).toBe(true);
		expect(unlinked.text()).toBe("Not linked to a register");
		// The customer still sees the greeting; only the caption differs.
		expect(wrapper.find('[data-testid="customer-display-idle"]').text()).toContain("Welcome");
	});

	it("returns to the greeting when the sale is cleared", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		expect(wrapper.find('[data-testid="customer-display-hero"]').exists()).toBe(true);

		await publish(snapshotOf([]));
		expect(wrapper.find('[data-testid="customer-display-idle"]').exists()).toBe(true);
	});
});

describe("the sale screen", () => {
	it("puts the total in the bottom lane, once, declaring what it is", async () => {
		const wrapper = mountDisplay();
		await publish(
			snapshotOf([
				line("a", "Anillo Case iPhone 15 Pro Negro", 1, 200),
				line("b", "Adaptador Apple Lightning a Jack 3.5 mm", 2, 120),
			]),
		);

		const totals = wrapper.findAll('[data-money-role="total"]');
		expect(totals).toHaveLength(1);
		expect(totals[0]!.text()).toBe(money(440));
		// The figure declares itself: "Total to charge · 3 items".
		expect(wrapper.find('[data-testid="customer-display-total-label"]').text()).toBe(
			"Total to charge · 3 items",
		);
	});

	it("renders every cart line exactly once across the hero and the list", async () => {
		const wrapper = mountDisplay();
		await publish(
			snapshotOf([
				line("a", "Combo Protección iPhone 15 Pro", 1, 299),
				line("b", "Anillo Case Honor X8A Rojo", 1, 200),
				line("c", "Adaptador USB a Micro SD", 1, 70),
			]),
		);

		expect(wrapper.find('[data-testid="customer-display-hero-name"]').text()).toBe(
			"Combo Protección iPhone 15 Pro",
		);
		const rest = wrapper.findAll('[data-testid="customer-display-line"]');
		expect(rest).toHaveLength(2);
		// The hero is not repeated in the list — the same money said twice is
		// the duplication registerSaysItOnce.spec.ts exists over.
		expect(
			rest.filter((row) => row.text().includes("Combo Protección")),
			"the highlighted line is rendered twice",
		).toHaveLength(0);
		expect(wrapper.findAll('[data-money-role="line"]')).toHaveLength(3);
	});

	it("shows a unit price only when the quantity is not one", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case iPhone 15 Pro Negro", 1, 200)]));
		expect(wrapper.find('[data-testid="customer-display-hero-unit"]').exists()).toBe(false);

		await publish(snapshotOf([line("a", "Adaptador Apple Lightning a Jack 3.5 mm", 2, 120)]));
		expect(wrapper.find('[data-testid="customer-display-hero-unit"]').text()).toBe(
			`2 × ${money(120)}`,
		);
	});

	it("keeps the unit price on a weighed line, where it matters most", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Jamón serrano", 0.75, 400)]));
		expect(wrapper.find('[data-testid="customer-display-hero-unit"]').text()).toBe(
			`0.75 × ${money(400)}`,
		);
	});
});

describe("the line that just changed", () => {
	it("claims nothing on the first snapshot it ever sees", async () => {
		// A display opened mid-sale has no history, so "just added" would be a
		// guess about a line it never watched arrive.
		store(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		const wrapper = mountDisplay();
		await nextTick();

		expect(wrapper.find('[data-testid="customer-display-hero"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="customer-display-hero-label"]').exists()).toBe(false);
	});

	it("marks a new line as just added, wherever it sits in the cart", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		await publish(
			snapshotOf([
				line("a", "Anillo Case Honor X8A Rojo", 1, 200),
				line("b", "Adaptador USB a Micro SD", 1, 70),
			]),
		);

		expect(wrapper.find('[data-testid="customer-display-hero-label"]').text()).toBe("Just added");
		expect(wrapper.find('[data-testid="customer-display-hero-name"]').text()).toBe(
			"Adaptador USB a Micro SD",
		);
	});

	it("marks a re-scanned line as updated, not as added", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 2, 200)]));

		expect(wrapper.find('[data-testid="customer-display-hero-label"]').text()).toBe("Updated");
		expect(wrapper.find('[data-testid="customer-display-hero-unit"]').text()).toBe(
			`2 × ${money(200)}`,
		);
	});

	it("holds the highlight through a republish that changed no line", async () => {
		// The publisher also republishes on customer and profile changes. The
		// last thing that changed is still the last thing that changed.
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		await publish(
			snapshotOf([
				line("a", "Anillo Case Honor X8A Rojo", 1, 200),
				line("b", "Adaptador USB a Micro SD", 1, 70),
			]),
		);
		await publish(
			snapshotOf(
				[
					line("a", "Anillo Case Honor X8A Rojo", 1, 200),
					line("b", "Adaptador USB a Micro SD", 1, 70),
				],
				{ customer_name: "Someone Else" },
			),
		);

		expect(wrapper.find('[data-testid="customer-display-hero-name"]').text()).toBe(
			"Adaptador USB a Micro SD",
		);
	});

	it("drops the claim when the highlighted line leaves the cart", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		await publish(
			snapshotOf([
				line("a", "Anillo Case Honor X8A Rojo", 1, 200),
				line("b", "Adaptador USB a Micro SD", 1, 70),
			]),
		);
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));

		expect(wrapper.find('[data-testid="customer-display-hero-label"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="customer-display-hero-name"]').text()).toBe(
			"Anillo Case Honor X8A Rojo",
		);
	});
});

describe("the arithmetic closes", () => {
	it("says nothing when the lines already add up to the total", async () => {
		const wrapper = mountDisplay();
		await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
		expect(wrapper.find('[data-testid="customer-display-adjustment"]').exists()).toBe(false);
	});

	it("names the gap when the total is below the lines, without guessing why", async () => {
		const wrapper = mountDisplay();
		await publish(
			snapshotOf([line("a", "Combo Protección iPhone 15 Pro", 1, 340)], {
				total_amount: 299,
			}),
		);

		const adjust = wrapper.find('[data-testid="customer-display-adjustment"]');
		expect(adjust.exists()).toBe(true);
		expect(adjust.text()).toContain("Adjustment");
		expect(adjust.find('[data-money-role="adjustment"]').text()).toBe(`−${money(41)}`);
		// A saving carries the positive STATE tone; a charge does not.
		expect(adjust.classes()).toContain("cd-total__adjust--saving");
	});

	it("marks a charge as an addition and leaves it neutral", async () => {
		const wrapper = mountDisplay();
		await publish(
			snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)], {
				total_amount: 225,
			}),
		);

		const adjust = wrapper.find('[data-testid="customer-display-adjustment"]');
		expect(adjust.find('[data-money-role="adjustment"]').text()).toBe(`+${money(25)}`);
		expect(adjust.classes()).not.toContain("cd-total__adjust--saving");
	});
});

describe("the register must not care whether this window works", () => {
	it("renders without a channel and opens no transport", async () => {
		routeState.query = {};
		const spy = vi.spyOn(window, "addEventListener");
		const wrapper = mountDisplay();
		await nextTick();

		expect(wrapper.find('[data-testid="customer-display"]').exists()).toBe(true);
		expect(
			spy.mock.calls.some(([event]) => event === "storage"),
			"a display with no channel subscribed to storage anyway",
		).toBe(false);
	});

	it("renders where BroadcastChannel does not exist", async () => {
		const original = (window as any).BroadcastChannel;
		delete (window as any).BroadcastChannel;
		try {
			const wrapper = mountDisplay();
			await publish(snapshotOf([line("a", "Anillo Case Honor X8A Rojo", 1, 200)]));
			expect(wrapper.find('[data-money-role="total"]').text()).toBe(money(200));
		} finally {
			(window as any).BroadcastChannel = original;
		}
	});

	it("survives a snapshot with no items array at all", async () => {
		const wrapper = mountDisplay();
		const broken = { ...snapshotOf([]) } as any;
		delete broken.items;
		await publish(broken);
		expect(wrapper.find('[data-testid="customer-display-idle"]').exists()).toBe(true);
	});

	it("tears its subscription down on unmount", async () => {
		const spy = vi.spyOn(window, "removeEventListener");
		const wrapper = mountDisplay();
		await nextTick();
		wrapper.unmount();
		expect(spy.mock.calls.some(([event]) => event === "storage")).toBe(true);
	});
});
