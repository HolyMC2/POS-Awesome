import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Cobro wallet line reaches the customer it is about, and stays current.
 *
 * TWO DEFECTS, ONE SYMPTOM. On demo.lab an enrolled customer with $200 of
 * monedero got NO «Monedero del cliente» and NO «Acumula …» at Cobro, and
 * `get_cashback_preview` was never even requested — proved live by
 * re-publishing the SAME payload the store already held, which lit the whole
 * card up in one tick.
 *
 *  1. `Payments.vue` kept its own `customer_info` ref and filled it ONLY from a
 *     watcher on the store. Every mount of that component is a `v-if` raised by
 *     the cashier asking to be paid, so the value it waited for had already
 *     arrived. The ref stayed empty for the whole payment, which is why the
 *     card was dark AND why `cashbackAsksTheServer` — which reads the same ref
 *     — never fired.
 *  2. Nothing re-read the sale's customer after the contact view CHANGED it, so
 *     a card activated at the counter kept selling as unenrolled.
 *
 * Source-level, because `Payments.vue` cannot be imported under jsdom without
 * dragging the whole POS stack in — the constraint `payViewWiring.spec.ts` and
 * `settleSeamRoutes.spec.ts` already document. The BEHAVIOUR of the wallet card
 * itself is covered by `cobroWallet.spec.ts`, which mounts the real component.
 *
 * No jsdom — this reads real files.
 */

const SRC = resolve(__dirname, "../src/posapp");
const read = (file: string) => readFileSync(resolve(SRC, file), "utf8");

describe("the payment screen starts from the customer already on the sale", () => {
	const payments = () => read("components/pos/Payments.vue");

	it("seeds `customer_info` from the store instead of an empty literal", () => {
		expect(payments()).toContain("const customer_info = ref(customerInfo.value || \"\")");
	});

	it("no longer declares it empty", () => {
		// The exact line this replaced. A future edit that puts it back
		// reintroduces the dark wallet and the un-asked accrual together.
		expect(payments()).not.toContain("const customer_info = ref(\"\");");
	});

	it("keeps the store watcher, so a customer changed mid-payment still lands", () => {
		expect(payments()).toContain("watch(customerInfo, (newInfo) => {");
		expect(payments()).toContain("customer_info.value = newInfo || \"\";");
	});

	it("assigns the ref in exactly one place — that watcher", () => {
		// The seed is the declaration; the watcher is the only assignment. A
		// third writer would be a second answer to "who is this sale for".
		const writers = payments().match(/customer_info\.value\s*=/g) ?? [];
		expect(writers).toHaveLength(1);
	});
});

describe("an act on the wallet refreshes the sale, not just the card", () => {
	const view = () => read("components/pos/customer/ClienteView.vue");
	const store = () => read("stores/customersStore.ts");

	it("routes the wallet's refresh through a handler, not straight to loadWallet", () => {
		expect(view()).toContain("@refresh=\"onWalletChanged\"");
	});

	it("re-reads the card AND bumps the sale's customer token", () => {
		const text = view();
		expect(text).toContain("function onWalletChanged()");
		expect(text).toContain("void loadWallet();");
		expect(text).toContain("customersStore.requestCustomerRefresh();");
	});

	it("does not bump the token from loadWallet, which also runs on every open", () => {
		// Opening a customer's file to look at it is not a reason to re-fetch the
		// sale's customer; only an ACT on the wallet is.
		const text = view();
		const start = text.indexOf("async function loadWallet()");
		const body = text.slice(start, text.indexOf("\n}", start) + 2);
		expect(body).toContain("fetchCustomerWallet");
		expect(body).not.toContain("requestCustomerRefresh");
	});

	it("uses the store's existing token rather than a second refresh path", () => {
		expect(store()).toContain("function requestCustomerRefresh()");
		expect(store()).toContain("refreshToken.value += 1;");
	});

	it("still has the listeners that make the token mean something", () => {
		// `Invoice.vue` re-runs `fetch_customer_details`, which re-publishes
		// `customerInfo` — the value the payment screen now seeds from.
		expect(read("components/pos/Invoice.vue")).toContain("this.fetch_customer_details();");
		expect(read("components/pos/Invoice.vue")).toContain("() => this.customerRefreshToken,");
	});
});
