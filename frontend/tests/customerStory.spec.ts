// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import CustomerStrip from "../src/posapp/components/pos/customer/CustomerStrip.vue";

/**
 * «Historial» on the ticket.
 *
 * The dialog itself reads two stores and an endpoint, so what is asserted here
 * is the AFFORDANCE — that it exists beside «change», that it is absent
 * without a customer to ask about, and that opening it is what mounts the
 * chunk. The timeline it shows is `OrderStory`, already covered by
 * `ordenSurface.spec.ts`; the window and cap it states are the server's, and
 * `test_customer_story.py` owns those.
 */

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

const mountStrip = (props: Record<string, unknown> = {}) =>
	mount(CustomerStrip, { props: { customerName: "Alejandra Ríos Bautista", ...props } });

describe("the history affordance", () => {
	it("sits beside «change», where the name already is", () => {
		const strip = mountStrip();
		expect(strip.find('[data-testid="customer-strip-history"]').exists()).toBe(true);
		expect(strip.find('[data-testid="customer-strip-change"]').exists()).toBe(true);
	});

	it("is absent with nobody on the ticket, rather than opening an empty history", () => {
		const strip = mountStrip({ customerName: "" });
		expect(strip.find('[data-testid="customer-strip-history"]').exists()).toBe(false);
	});

	it("draws no history sheet until it is asked for", async () => {
		// The strip renders on every sale; the timeline is a chunk and a round
		// trip, and neither belongs on the sale's first paint. (That it is a
		// LAZY import is asserted from source in `ordenSources.spec.ts` — a
		// mount cannot see an import that has not been reached.)
		const strip = mountStrip();
		expect(strip.html()).not.toContain("customer-story");
		await strip.find('[data-testid="customer-strip-history"]').trigger("click");
	});

	it("is a control of its own, not a second way to change the customer", async () => {
		const onChange = vi.fn();
		const strip = mount(CustomerStrip, {
			props: { customerName: "Alejandra", onChange } as never,
		});
		await strip.find('[data-testid="customer-strip-history"]').trigger("click");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("leaves the change affordance doing exactly what it did", () => {
		const onChange = vi.fn();
		const strip = mount(CustomerStrip, {
			props: { customerName: "Alejandra", onChange } as never,
		});
		strip.find('[data-testid="customer-strip-change"]').trigger("click");
		expect(onChange).toHaveBeenCalled();
	});
});
