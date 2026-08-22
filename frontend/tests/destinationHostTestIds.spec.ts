// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";

// Only SHEET_COMPONENTS is replaced; the registry itself stays real, because
// the ids ARE the thing under test. This spec asks whether the host stamps a
// correct handle for every entry — not whether Drafts.vue imports cleanly, which
// is that component's own business and drags four real dialogs (and their
// stores, Dexie and sockets) into a DOM assertion.
vi.mock("../src/posapp/composables/pos/shell/destinationRegistry", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("../src/posapp/composables/pos/shell/destinationRegistry")
	>();
	const stub = { template: "<div class='sheet-stub' />" };
	return {
		...actual,
		SHEET_COMPONENTS: Object.fromEntries(
			Object.keys(actual.SHEET_COMPONENTS).map((id) => [id, async () => stub]),
		),
	};
});

import DestinationHost from "../src/posapp/components/pos/shell/destinations/DestinationHost.vue";
import {
	DESTINATIONS,
	destinationTestId,
	railTestId,
} from "../src/posapp/composables/pos/shell/destinationRegistry";

/**
 * The evidence lane's contract.
 *
 * Screenshots and e2e select on `data-testid`, never on a visible label: labels
 * are Spanish, a preset renames them (Explorar → Menú, Borradores → Cuentas),
 * and a run that hunts label variants across two languages is the run that
 * times out. So the handle is asserted here, per registry entry, rather than
 * discovered by a failing capture at the end of a wave.
 */

const mountHost = (destinationId: string, refusal: string | null = null) =>
	shallowMount(DestinationHost, {
		props: {
			destinationId: destinationId as never,
			refusal: refusal as never,
			t: (key: string) => key,
		},
	});

describe("every destination renders its test handle", () => {
	it.each(DESTINATIONS.map((d) => d.id))("%s stamps its testid and id", (id) => {
		const wrapper = mountHost(id);
		const root = wrapper.find(`[data-testid="${destinationTestId(id)}"]`);
		expect(root.exists(), `${id} did not stamp ${destinationTestId(id)}`).toBe(true);
		// Both attributes, because the lane pairs them: `data-destination` is the
		// join key back to the rail item, `data-testid` is the selector.
		expect(root.attributes("data-destination")).toBe(id);
	});

	it("derives the rail handle from the same ids, so the pair cannot drift", () => {
		// Not a formatting assertion — this is the whole reason the two helpers
		// live in the registry instead of in each component.
		for (const def of DESTINATIONS) {
			expect(railTestId(def.id)).toBe(`rail-${def.id}`);
			expect(destinationTestId(def.id)).toBe(`destination-${def.id}`);
		}
	});

	it("keeps ids out of the operator's language, so a preset can rename freely", async () => {
		// Every id is English while every label is Spanish. That is what lets a
		// cafetería show "Menú" and "Cuentas" without a single id moving, and it
		// keeps this namespace the same shape as DOCK_TAB_IDS, which is checked
		// against a Python backend.
		const ids = DESTINATIONS.map((d) => d.id) as string[];
		expect(ids.every((id) => /^[a-zA-Z]+$/.test(id))).toBe(true);
		// Not `facturacion`, and not because of the spelling: NavbarMenu's
		// `facturacion` action stamps CFDI invoices, while our `invoices`
		// destination is Invoice Management. Aliasing them would point the lane
		// at the wrong dialog and the screenshot would still look plausible.
		expect(ids).not.toContain("facturacion");
	});

	it("slugifies to kebab only at the router boundary", async () => {
		const { slugifyDestinationId } = await import(
			"../src/posapp/composables/pos/shell/destinationRegistry"
		);
		expect(slugifyDestinationId("serviceOrder")).toBe("service-order");
		// One id namespace inside the app: the slug never becomes a lookup key,
		// so a single-word id is unchanged and nothing gains a second name.
		expect(slugifyDestinationId("drafts")).toBe("drafts");
	});
});

describe("state is observable without knowing any CSS", () => {
	const stateOf = (id: string, refusal: string | null) =>
		mountHost(id, refusal).find("[data-destination-state]").attributes("data-destination-state");

	it("reports ready when the destination was allowed", () => {
		expect(stateOf("drafts", null)).toBe("ready");
	});

	it("distinguishes an offline block from a capability gate", () => {
		// Different problems, different fixes: one waits for the network, the
		// other needs a profile change. A single "unavailable" would make the
		// screenshots indistinguishable.
		expect(stateOf("return", "offline")).toBe("offline-blocked");
		expect(stateOf("recharge", "gated")).toBe("gated");
	});

	it("reports a closed shift as a gate, because it cannot be entered either", () => {
		expect(stateOf("sale", "shift_closed")).toBe("gated");
	});

	it("renders the refusal as a surface, not a toast", () => {
		// A cashier who deep-linked into Devolución on a dead network needs the
		// reason to still be on screen when they look up from the router.
		const wrapper = mountHost("return", "offline");
		expect(wrapper.find('[data-testid="destination-refusal"]').exists()).toBe(true);
	});

	it("does not mount the hosted flow while refusing it", () => {
		// Loading Returns.vue behind a refusal would fetch a chunk the register
		// cannot use and run its dialog's setup against a server it cannot reach.
		const wrapper = mountHost("return", "offline");
		expect(wrapper.html()).not.toContain("async-component");
	});
});

describe("accessibility", () => {
	it("names the region with the resolved label, through the preset resolver", () => {
		const t = vi.fn((key: string) => (key === "Drafts" ? "Cuentas" : key));
		const wrapper = shallowMount(DestinationHost, {
			props: { destinationId: "drafts" as never, refusal: null as never, t },
		});
		// `t` not `__`: a cafetería renames Borradores to Cuentas, and the
		// accessible name has to follow the preset like the visible one does.
		expect(wrapper.attributes("aria-label")).toBe("Cuentas");
		expect(t).toHaveBeenCalledWith("Drafts");
	});
});
