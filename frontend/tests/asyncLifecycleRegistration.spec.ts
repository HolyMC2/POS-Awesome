// Vue keeps a component's effect scope active only for the SYNCHRONOUS part of a
// lifecycle hook. A watch()/interval created after an `await` inside onMounted
// escapes the component and leaks (audit RUNTIME-F6/F7). Source-pinned: the
// registrations happen before any await, or behind an `alive` guard.
import { describe, expect, it } from "vitest";
import customerSrc from "../src/posapp/components/pos/customer/Customer.vue?raw";
import kdsSrc from "../src/posapp/components/kds/KdsView.vue?raw";
import boardSrc from "../src/posapp/components/kiosk/OrderStatusBoard.vue?raw";

/** The body of the first `onMounted(async () => { ... })` in a source. */
const asyncMountedBody = (src: string) => {
	const at = src.indexOf("onMounted(async");
	expect(at, "no async onMounted").toBeGreaterThan(-1);
	// crude but sufficient: from the arrow's `{` to the matching depth-0 `}`.
	const start = src.indexOf("{", at);
	let depth = 0;
	for (let i = start; i < src.length; i += 1) {
		if (src[i] === "{") depth += 1;
		if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(start, i); }
	}
	throw new Error("unbalanced");
};

describe("async lifecycle registrations do not escape the component scope", () => {
	it("Customer.vue registers its watch and bus listener before the first await", () => {
		// Strip comments so the word "await" in the explaining comment is not
		// mistaken for the real top-level await.
		const body = asyncMountedBody(customerSrc)
			.replace(/\/\/[^\n]*/g, "")
			.replace(/\/\*[\s\S]*?\*\//g, "");
		const watchAt = body.indexOf("watch(");
		const busAt = body.indexOf('registerBus("set_customer_readonly"');
		// the top-level warm-up await, not the one inside the watch callback
		const awaitAt = body.indexOf("await customersStore.searchCustomers");
		expect(watchAt).toBeGreaterThan(-1);
		expect(busAt).toBeGreaterThan(-1);
		expect(awaitAt).toBeGreaterThan(-1);
		expect(watchAt).toBeLessThan(awaitAt);
		expect(busAt).toBeLessThan(awaitAt);
	});

	it("KdsView and OrderStatusBoard guard the poll arm with an alive flag", () => {
		for (const src of [kdsSrc, boardSrc]) {
			const body = asyncMountedBody(src);
			// the interval is armed only when still alive
			expect(body).toMatch(/if\s*\(!alive\)\s*return;[\s\S]*pollTimer\s*=\s*setInterval/);
			// and alive is cleared on unmount
			expect(src).toMatch(/onBeforeUnmount\(\(\)\s*=>\s*\{\s*alive\s*=\s*false/);
		}
	});
});
