import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source-level tripwires for the hosted-sheet wiring (roadmap §17.7). Kept
 * out of the jsdom suite on purpose: that environment shims `node:fs` away.
 * The behavioural half lives in `hostedSheetsSelfOpen.spec.ts`.
 */

describe("what the registry hosts", () => {
	const registry = readFileSync(
		resolve("src/posapp/composables/pos/shell/destinationRegistry.ts"),
		"utf8",
	);

	it("hosts Invoice Management for BOTH Borradores and Facturas, never the Drafts redirect", () => {
		const block = registry.slice(registry.indexOf("SHEET_COMPONENTS"));
		expect(block).toMatch(/drafts: \(\) => import\("[^"]*InvoiceManagement\.vue"\)/);
		expect(block).toMatch(/invoices: \(\) => import\("[^"]*InvoiceManagement\.vue"\)/);
		expect(block).not.toMatch(/import\("[^"]*flows\/Drafts\.vue"\)/);
	});

	it("hosts the Recargas destination, not the catalogue picker", () => {
		const block = registry.slice(registry.indexOf("SHEET_COMPONENTS"));
		expect(block).toMatch(/recharge: \(\) => import\("[^"]*RecargasDestination\.vue"\)/);
		expect(block).not.toMatch(/recharge: \(\) => import\("@saldo/);
	});
});

describe("the shell keeps the floating copies down while the rail hosts them", () => {
	const shell = readFileSync(resolve("src/posapp/components/pos/shell/Pos.vue"), "utf8");

	it("gates Drafts and Returns on the rail being absent", () => {
		expect(shell).toMatch(/<Drafts v-if="uiStore\.draftsDialog && !railVisible">/);
		expect(shell).toMatch(/<Returns\s+v-if="returnsMounted && !railVisible"/);
	});

	it("gates Invoice Management on it not being the hosted destination", () => {
		expect(shell).toMatch(
			/<InvoiceManagement\s+v-if="uiStore\.invoiceManagementDialog && !invoiceManagementHosted"/,
		);
	});

	it("relays the hosted band and answers recharge.submit", () => {
		expect(shell).toContain('@band="onHostedBand"');
		expect(shell).toContain('eventBus.emit("recharge:submit")');
	});
});

describe("a loaded draft lands on the sale", () => {
	const source = readFileSync(
		resolve("src/posapp/components/pos/flows/InvoiceManagement.vue"),
		"utf8",
	);

	it("routes the ledger's draft action through the glue that activates the sale", () => {
		expect(source).toContain('@draft-action="runLedgerDraftAction($event.invoice, $event.action)"');
		// The cue is the sheet having closed (a document reached the cart),
		// and the answer is the ONE shell event every destination change uses.
		const glue = source.slice(source.indexOf("async runLedgerDraftAction("));
		expect(glue.slice(0, 400)).toContain("!this.uiStore.invoiceManagementDialog");
		expect(glue.slice(0, 400)).toContain('this.eventBus.emit("open_destination", "sale")');
	});
});
