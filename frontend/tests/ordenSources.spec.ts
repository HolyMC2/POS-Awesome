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
