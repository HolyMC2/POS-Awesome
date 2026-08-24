import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SHEET_COMPONENTS } from "../src/posapp/composables/pos/shell/destinationRegistry";

/**
 * What the Orden surface refuses to do (artboard `Orden.dc.html`).
 *
 * Source-scanned rather than mounted, for the reason `singleAccent.spec.ts`
 * gives: every guarantee below is a NEGATIVE — no second price, no second
 * submit, no second band — and only a scan can prove a negative. A mount
 * proves one render did not do it today.
 *
 * No jsdom — this reads real files.
 */

const SRC = resolve(__dirname, "../src/posapp");
const read = (path: string) => readFileSync(resolve(SRC, path), "utf8");

describe("what the rail opens", () => {
	it("is the designed surface, not the navbar dialog", () => {
		expect(String(SHEET_COMPONENTS.serviceOrder)).toContain("orden/OrdenSurface.vue");
		expect(String(SHEET_COMPONENTS.serviceOrder)).not.toContain("ChargeRequestsDialog");
	});

	it("leaves the dialog itself alone for the layouts with no rail", () => {
		// The navbar's Pending Charges entry is unchanged; only the rail moved.
		const dialog = read("components/navbar/ChargeRequestsDialog.vue");
		expect(dialog).toContain("get_open_charge_requests");
	});
});

describe("the surface does not fork the money path", () => {
	const surface = read("components/pos/flows/orden/OrdenSurface.vue");

	it("loads the cart through the endpoint the dialog has always used", () => {
		expect(surface).toContain("charge_requests.prepare_charge_request_invoice");
		expect(surface).toContain("triggerLoadInvoice");
	});

	it("submits nothing and marks nothing charged itself", () => {
		// The request is completed by the existing mark-charged path when the
		// sale submits. A second call site on that transition is a second way
		// to close a request that was never charged.
		expect(surface).not.toContain("mark_charge_request_charged");
		expect(surface).not.toContain("submit_invoice");
	});

	it("draws no band of its own", () => {
		// §17.7 invariant 1: one number, one action. The surface publishes a
		// BandState upward and the shell renders the only band on screen.
		expect(surface).toContain('emit("band"');
		expect(surface).not.toContain("ActionBand");
	});

	it("reaches the bus through injection, never through a module singleton", () => {
		expect(surface).toContain('inject<BusLike | null>("eventBus"');
	});
});

describe("the shell answers the band it adopted", () => {
	const shell = read("components/pos/shell/Pos.vue");

	it("adopts balanceDue, so the order's saldo reaches the one band", () => {
		expect(shell).toContain('"balanceDue"');
	});

	it("sends the press down rather than reaching into the surface", () => {
		expect(shell).toContain('actionId === "order.collectAndDeliver"');
		expect(shell).toContain('eventBus.emit("orden:collect")');
	});

	it("probes the badge only where the destination exists", () => {
		// A register with no taller seam has no Orden rail item to badge;
		// probing anyway would put a guaranteed refusal on every retail boot.
		expect(shell).toContain("vertical.externalDocumentCheckout");
		expect(shell).toContain("getServiceOrderCountsCached");
	});
});

describe("the story is recycled, not re-implemented", () => {
	it("is the same component on the repair order and on the sales order", () => {
		expect(read("components/pos/flows/orden/OrdenSurface.vue")).toContain(
			'doctype="Repair Order"',
		);
		expect(read("components/pos/flows/SalesOrders.vue")).toContain('doctype="Sales Order"');
		expect(read("components/pos/flows/SalesOrders.vue")).toContain(
			'import OrderStory from "./orden/OrderStory.vue"',
		);
	});

	it("draws the repair leg only where the request points at a repair order", () => {
		// Not gated on a capability flag: a charge request from another
		// vertical has no bench log regardless of what the tenant installed.
		const surface = read("components/pos/flows/orden/OrdenSurface.vue");
		expect(surface).toContain('reference_doctype === "Repair Order"');
		expect(surface).toContain('v-if="repairName"');
	});

	it("asks one endpoint for both legs", () => {
		const service = read("services/serviceOrderService.ts");
		expect(service).toContain("order_story.get_order_story");
		expect(service.match(/get_order_story/g)).toHaveLength(1);
	});
});

describe("the client view reuses the timeline instead of copying it", () => {
	it("feeds OrderStory its own payload rather than re-rendering the rows", () => {
		// `payload` is the seam that exists so a caller with a DIFFERENT
		// endpoint does not have to re-implement the timeline.
		const view = read("components/pos/customer/CustomerStory.vue");
		expect(view).toContain('import OrderStory from "../flows/orden/OrderStory.vue"');
		expect(view).toContain(":payload=");
		expect(view).toContain("fetchCustomerStory");
	});

	it("states the window and the cap the server actually applied", () => {
		// Ninety days is a scope, not a complete account, and a history that
		// quietly stops looks like a customer who quietly stopped buying.
		const view = read("components/pos/customer/CustomerStory.vue");
		expect(view).toContain("Last {0} days · up to {1} events");
		expect(view).toContain("story.value?.days");
	});

	it("opens over the ticket rather than becoming a destination", () => {
		// The question is asked with the customer standing there and the sale
		// open. A destination would navigate away from a cart mid-sale.
		const view = read("components/pos/customer/CustomerStory.vue");
		expect(view).toContain("v-dialog");

		const registry = read("composables/pos/shell/destinationRegistry.ts");
		expect(registry).not.toContain("CustomerStory");
	});

	it("costs the sale nothing until somebody asks for it", () => {
		const strip = read("components/pos/customer/CustomerStrip.vue");
		expect(strip).toContain('defineAsyncComponent(() => import("./CustomerStory.vue"))');
		expect(strip).toContain('v-if="historyMounted"');
	});
});
