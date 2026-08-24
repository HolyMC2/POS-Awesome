// @vitest-environment jsdom

/**
 * What the customer-facing screen must NEVER show.
 *
 * This surface faces outward. The person next in the queue reads it too, and
 * the customer cannot opt out of what the screen behind the till says about
 * them — so the line is: what is already on the counter may appear, what only
 * the shop's database knows may not.
 *
 * Every field below is one a well-meaning change could add back in a single
 * line, and each would ship a real person's data to a stranger. Two guards,
 * because they fail differently:
 *
 *   1. a MOUNTED check — the value is not in the DOM for a snapshot that
 *      carries it, which catches it however it got rendered. That is this
 *      file;
 *   2. a SOURCE check on the template — the identifier is not referenced at
 *      all, which catches a field bound behind a `v-if` no fixture happens to
 *      satisfy. That is `customerDisplayPrivacySource.spec.ts`, split out for
 *      the same reason `registerSaysItOnceSource.spec.ts` is: `node:fs` does
 *      not interop under jsdom (build plan §10), and this file must mount.
 *
 * `Cobro.dc.html` shows `Monedero del cliente $418.00`; that is the CASHIER's
 * screen, a different privacy context, and it is the reason a wallet balance
 * looks acceptable here until you stand behind the customer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("vue-router", () => ({ useRoute: () => routeState }));

import CustomerDisplay from "../src/posapp/components/customer_display/CustomerDisplay.vue";
import {
	getCustomerDisplayStorageKey,
	type CustomerDisplaySnapshot,
} from "../src/posapp/utils/customerDisplay";

const CHANNEL = "cd_privacy_channel_sentinel";
const CUSTOMER = "Alejandra Ríos Bautista";
const ITEM_CODE = "IPN001758";

const SNAPSHOT: CustomerDisplaySnapshot = {
	channel_id: CHANNEL,
	currency: "MXN",
	customer_name: CUSTOMER,
	items: [
		{
			id: "row-1",
			item_code: ITEM_CODE,
			item_name: "Anillo Case iPhone 15 Pro Negro",
			qty: 1,
			rate: 200,
			amount: 200,
			uom: "Nos",
		},
	],
	total_qty: 1,
	total_amount: 200,
	updated_at: "2026-08-22T18:00:00.000Z",
};

const mountWithSnapshot = async () => {
	const envelope = JSON.stringify({
		type: "snapshot",
		payload: SNAPSHOT,
		sent_at: new Date().toISOString(),
	});
	window.localStorage.setItem(getCustomerDisplayStorageKey(CHANNEL), envelope);
	const wrapper = mount(CustomerDisplay);
	await nextTick();
	return wrapper;
};

beforeEach(() => {
	routeState.query = { channel: CHANNEL };
	window.localStorage.clear();
});

describe("the customer display shows nothing about the person standing at it", () => {
	it("renders the sale at all, so the absences below mean something", async () => {
		const wrapper = await mountWithSnapshot();
		expect(wrapper.find('[data-testid="customer-display-line"]').text()).toContain(
			"Anillo Case iPhone 15 Pro Negro",
		);
	});

	it("never prints the customer's name", async () => {
		const wrapper = await mountWithSnapshot();
		expect(
			wrapper.html(),
			"the queue behind the customer reads this screen; their name is not " +
				"theirs to publish, and the CASHIER's screen already carries it",
		).not.toContain(CUSTOMER);
		// Initials are not a fix: in a small shop a half-name still names a
		// regular, and it invites the question it was meant to prevent.
		expect(wrapper.html()).not.toContain("Alejandra");
		expect(wrapper.html()).not.toContain("Ríos");
	});

	it("never prints the internal item code", async () => {
		const wrapper = await mountWithSnapshot();
		expect(
			wrapper.html(),
			"not a privacy leak — noise. A SKU means nothing at two metres and " +
				"every character competes with the item's name",
		).not.toContain(ITEM_CODE);
	});

	it("never prints the channel id", async () => {
		const wrapper = await mountWithSnapshot();
		expect(wrapper.html()).not.toContain(CHANNEL);
	});

});
