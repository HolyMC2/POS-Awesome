// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import invoiceManagementSource from "../src/posapp/components/pos/flows/InvoiceManagement.vue?raw";
import InvoiceLedgerFigures from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerFigures.vue";
import {
	buildCashierDirectory,
	collectionForSegment,
	describeColumns,
	describeFigures,
	describeFindModes,
	describeRows,
	describeSegments,
	describeStatus,
	finderFooterKind,
	isRowOverdue,
	matchesAmount,
	nextIndex,
	parseAmountQuery,
	segmentCounts,
	segmentForDestination,
	presentSegments,
	segmentIntent,
	todayPresentation,
	shortTime,
	type LedgerRowSource,
} from "../src/posapp/components/pos/flows/ledger/ledgerModel";
import {
	collections,
	DIRECTORY,
	formatCurrency,
	formatFloat,
	MONEY,
	row,
	translateStub,
	TODAY,
} from "./ledgerFixtures";

/**
 * Facturas — the ledger with a finder (build plan §15.4).
 *
 * The four children are MOUNTED in `invoiceLedgerSurface.spec.ts` — split off
 * when this file passed the 500-line limit, and along a real seam: this half
 * is the model and the engine's wiring, that half is what a cashier sees.
 *
 * ## Why half of this is a source scan
 *
 * `InvoiceManagement.vue` mounts a `v-dialog` full of Vuetify components that
 * resolve to `<!---->` in a runtime-only mount, so the SEAM between the engine
 * and the ledger — which method each intent lands on, and that `data()` and
 * `methods` were not touched to get there — is read as TEXT (`?raw`, a vite
 * transform that survives jsdom where `node:fs` does not). Everything that can
 * be mounted is mounted, and the four children mount cleanly because they are
 * plain elements: no `v-menu`, no `v-dialog`, and no `v-icon` in anything
 * asserted here.
 *
 * Listeners are PROPS (`onOpen`, `onFilters`, `onTab`), never
 * `wrapper.emitted()`: VTU does not record component emits in this repo.
 *
 * ## The absences are assertions too
 *
 * Four of the artboard's promises have no read model — Timbrado, the Cobro
 * column, the Turno segment and every F-key chip — and each is pinned here.
 * An absence nobody tests comes back as an invented figure the first time
 * somebody reads the artboard and not the plan.
 */

beforeEach(() => {
	vi.stubGlobal("__", translateStub);
	vi.stubGlobal("frappe", { datetime: { get_today: () => TODAY } });
});

/* -------------------------------------------------------------------------- */
/* Segments                                                                    */
/* -------------------------------------------------------------------------- */

describe("the segment replaces the tabs, and Turno is absent rather than empty", () => {
	it("offers four segments while no shift field is listed", () => {
		const ids = describeSegments({ shiftScoped: false }).map((segment) => segment.id);
		expect(ids).toEqual(["today", "pending", "drafts", "returns"]);
	});

	it("offers Turno the moment a shift field can be listed", () => {
		// R3: gated-off is ABSENT, not disabled — and the gate is a capability
		// question, so flipping it is the only edit this needs.
		const ids = describeSegments({ shiftScoped: true }).map((segment) => segment.id);
		expect(ids).toEqual(["today", "shift", "pending", "drafts", "returns"]);
	});

	it("lands `drafts` on Borradores and `invoices` on Hoy", () => {
		expect(segmentForDestination("drafts")).toBe("drafts");
		expect(segmentForDestination("invoices")).toBe("today");
		expect(segmentForDestination(null)).toBe("today");
	});

	it("scopes only Hoy to today; an open balance from last month is the point of Pendientes", () => {
		expect(segmentIntent("today", TODAY)).toEqual({
			segment: "today",
			tab: "history",
			from: TODAY,
			to: TODAY,
		});
		expect(segmentIntent("pending", TODAY)).toEqual({
			segment: "pending",
			tab: "partial",
			from: "",
			to: "",
		});
		expect(segmentIntent("returns", TODAY).from).toBe("");
	});

	it("Hoy fallen back to Recientes asks for history unscoped", () => {
		expect(segmentIntent("today", TODAY, { recent: true })).toEqual({
			segment: "today",
			tab: "history",
			from: "",
			to: "",
		});
		expect(segmentIntent("pending", TODAY, { recent: true }).from).toBe("");
	});

	it("falls back to Recientes only once today has been READ and found empty", () => {
		const base = { segment: "today" as const, todayCount: 0, alreadyRecent: false };
		// Not read yet: no verdict, no relabel.
		expect(todayPresentation({ ...base, historyLoaded: null })).toEqual({
			recent: false,
			label: "Today",
		});
		// Read, empty: Recientes.
		expect(todayPresentation({ ...base, historyLoaded: [] })).toEqual({
			recent: true,
			label: "Recent",
		});
		// Read, something today: Hoy stays Hoy.
		expect(todayPresentation({ ...base, historyLoaded: [{}], todayCount: 1 })).toEqual({
			recent: false,
			label: "Today",
		});
		// Other segments never relabel.
		expect(todayPresentation({ ...base, segment: "pending", historyLoaded: [] }).recent).toBe(false);
		// Once fallen back, the loaded (unscoped) rows do not flip it back.
		expect(todayPresentation({ ...base, historyLoaded: [{}, {}], alreadyRecent: true })).toEqual({
			recent: true,
			label: "Recent",
		});
		const segments = presentSegments(describeSegments({ shiftScoped: false }), {
			recent: true,
			label: "Recent",
		});
		expect(segments[0]?.label).toBe("Recent");
		expect(segments[1]?.label).toBe("Pending invoices");
	});

	it("reads each segment's own collection", () => {
		const state = collections({ drafts: { page: [row({ name: "DRAFT-1" })], total: 1 } });
		expect(collectionForSegment(state, "drafts").page).toHaveLength(1);
		expect(collectionForSegment(state, "today").page).toHaveLength(0);
	});

	it("counts the LOADED collection, and draws nothing at all before it has loaded", () => {
		const loading = collections({
			history: { loaded: null },
			partial: { loaded: null },
			drafts: { loaded: null },
		});
		const counts = segmentCounts(loading, describeFigures({ history: null, unpaid: null, today: TODAY }));
		// `null` is not `0`: a register that has not read the day must not
		// announce an empty one.
		expect(counts.today).toBeNull();
		expect(counts.pending).toBeNull();
		expect(counts.drafts).toBeNull();
		expect(counts.returns).toBeNull();
		expect(counts.shift).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* Finder                                                                      */
/* -------------------------------------------------------------------------- */

describe("the finder has four modes and no chord it cannot honour", () => {
	it("offers Ticket · Cliente · Fecha · Monto", () => {
		expect(describeFindModes(null).map((mode) => mode.id)).toEqual([
			"ticket",
			"customer",
			"date",
			"amount",
		]);
	});

	it("draws NO chord, because the keymap binds none of these (R8)", () => {
		// The artboard prints F1–F4. `MUELLE_DEFAULT` binds none of them to a
		// ledger action and `f4` has meant `employee.switch` since before the
		// shortcuts engine existed. A chip for a key that does nothing is worse
		// than no chip.
		for (const mode of describeFindModes(null)) {
			expect(mode.chords, `${mode.id} drew a chord nothing can press`).toEqual([]);
			expect(mode.shortcutActionId).toBeNull();
		}
	});

	it("reads the amount the way a cashier types it off the ticket", () => {
		expect(parseAmountQuery("1,129.00")).toBe(1129);
		expect(parseAmountQuery("$1129")).toBe(1129);
		expect(parseAmountQuery("  1129 ")).toBe(1129);
		expect(parseAmountQuery("")).toBeNull();
		expect(parseAmountQuery("abc")).toBeNull();
	});

	it("matches exactly, then within one per cent, and no wider", () => {
		expect(matchesAmount(1129, 1129)).toBe(true);
		expect(matchesAmount(1129, 1130)).toBe(true); // 0.09 %
		expect(matchesAmount(1140, 1129)).toBe(true); // 0.97 %
		expect(matchesAmount(1200, 1129)).toBe(false); // 6.3 %
		// A refund is stored negative and is still the amount on the ticket.
		expect(matchesAmount(-1129, 1129)).toBe(true);
	});

	it("says the count is of the loaded rows only when the amount mode is running", () => {
		expect(finderFooterKind("ticket", "1129")).toBe("page");
		expect(finderFooterKind("amount", "")).toBe("page");
		expect(finderFooterKind("amount", "1129")).toBe("loaded");
	});
});

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

describe("every figure has a source, and the fourth card has none", () => {
	const history = [
		row({ name: "B-1", grand_total: 1129 }),
		row({ name: "B-2", grand_total: 349 }),
		row({ name: "B-3", grand_total: 500, posting_date: "2026-08-21" }),
		row({ name: "B-4", grand_total: -200, is_return: 1, return_against: "B-2" }),
		row({ name: "B-5", grand_total: -220, is_return: 1, return_against: "" }),
	];
	const unpaid = [
		row({ name: "B-6", outstanding_amount: 2510, status: "Partly Paid", due_date: "2026-09-01" }),
		row({ name: "B-7", outstanding_amount: 670, status: "Unpaid", due_date: "2026-08-04" }),
	];

	it("sums today's non-return history for Vendido hoy", () => {
		const { sold } = describeFigures({ history, unpaid, today: TODAY });
		expect(sold).toEqual({ total: 1478, count: 2, average: 739 });
	});

	it("sums the unpaid outstanding for Por cobrar, with the overdue count beside it", () => {
		const { receivable } = describeFigures({ history, unpaid, today: TODAY });
		expect(receivable).toEqual({ total: 3180, count: 2, overdue: 1 });
	});

	it("sums the absolute return totals for Devuelto and counts the ones with no ticket", () => {
		const { refunded } = describeFigures({ history, unpaid, today: TODAY });
		expect(refunded).toEqual({ total: 420, count: 2, withoutTicket: 1 });
	});

	it("has no Timbrado key at all, because nothing on the client can source one", () => {
		const figures = describeFigures({ history, unpaid, today: TODAY });
		expect(Object.keys(figures).sort()).toEqual(["receivable", "refunded", "sold"]);
		expect("stamped" in figures).toBe(false);
	});

	it("renders three cards and never a fourth", () => {
		const wrapper = mount(InvoiceLedgerFigures, {
			props: {
				figures: describeFigures({ history, unpaid, today: TODAY }),
				formatCurrency,
				currencySymbol: "",
			},
		});
		expect(wrapper.findAll(".ledger-figure")).toHaveLength(3);
		expect(wrapper.text()).not.toContain("Timbrado");
		expect(wrapper.text()).not.toContain("Stamped");
	});

	it("draws a dash rather than a zero for a collection that has not loaded", () => {
		const wrapper = mount(InvoiceLedgerFigures, {
			props: {
				figures: describeFigures({ history: null, unpaid: null, today: TODAY }),
				formatCurrency,
				currencySymbol: "",
			},
		});
		expect(wrapper.findAll("[data-money-role]")).toHaveLength(0);
		expect(wrapper.text()).toContain("—");
	});

	it("declares a role on every money figure, and never the role `total`", () => {
		const wrapper = mount(InvoiceLedgerFigures, {
			props: {
				figures: describeFigures({ history, unpaid, today: TODAY }),
				formatCurrency,
				currencySymbol: "",
			},
		});
		const declared = wrapper.findAll("[data-money-role]");
		const figures = (wrapper.html().match(new RegExp(MONEY, "g")) || []).length;
		// The captions carry a money figure too (`ticket medio`), so the count
		// is roles + the ones inside a caption — what matters is that no figure
		// claims to be THE total: the sale's band below owns that.
		expect(declared.length).toBeGreaterThan(0);
		expect(figures).toBeGreaterThanOrEqual(declared.length);
		expect(wrapper.findAll('[data-money-role="total"]')).toHaveLength(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Rows, tones and columns                                                     */
/* -------------------------------------------------------------------------- */

describe("a row states its status in words, and the optional columns earn their place", () => {
	it("keeps the tone and the word together", () => {
		expect(describeStatus(row({ status: "Paid" }), TODAY)).toMatchObject({
			label: "Paid invoice",
			tone: "positive",
		});
		expect(describeStatus(row({ status: "Partly Paid" }), TODAY).tone).toBe("warning");
		expect(describeStatus(row({ status: "Unpaid" }), TODAY).tone).toBe("warning");
		expect(describeStatus(row({ is_return: 1 }), TODAY)).toMatchObject({
			label: "Returned invoice",
			tone: "returned",
		});
		expect(describeStatus(row(), TODAY, true)).toMatchObject({
			label: "Draft invoice",
			tone: "neutral",
		});
	});

	it("calls a past-due invoice overdue whatever the server called its status", () => {
		expect(
			isRowOverdue(row({ due_date: "2026-08-04", outstanding_amount: 670 }), TODAY),
		).toBe(true);
		// Settled: a due date in the past with nothing outstanding is history.
		expect(isRowOverdue(row({ due_date: "2026-08-04", outstanding_amount: 0 }), TODAY)).toBe(false);
		expect(isRowOverdue(row({ due_date: "2026-09-04", outstanding_amount: 670 }), TODAY)).toBe(false);
		expect(isRowOverdue(row({ status: "Overdue" }), TODAY)).toBe(true);
	});

	it("outranks the raw status with overdue, because that is what the cashier must act on", () => {
		const status = describeStatus(
			row({ status: "Partly Paid", due_date: "2026-08-04", outstanding_amount: 670 }),
			TODAY,
		);
		expect(status).toMatchObject({ label: "Overdue invoice", tone: "negative" });
	});

	it("never renames a status the server invented later", () => {
		expect(describeStatus(row({ status: "Consolidated" }), TODAY).label).toBe("Consolidated");
	});

	it("drops the seconds off the posting time", () => {
		expect(shortTime("19:52:03.121")).toBe("19:52");
		expect(shortTime("")).toBe("");
		expect(shortTime("nonsense")).toBe("");
	});

	it("shows Cajero only when `owner` resolves to a name the client already holds", () => {
		const known = describeRows([row()], { today: TODAY, directory: DIRECTORY });
		expect(known[0].cashier).toBe("Jenni");
		expect(describeColumns(known).cashier).toBe(true);

		// An email is not a cashier's name, so the column is DROPPED rather
		// than filled with an address.
		const unknown = describeRows([row({ owner: "someone@else.mx" })], {
			today: TODAY,
			directory: DIRECTORY,
		});
		expect(unknown[0].cashier).toBeNull();
		expect(describeColumns(unknown).cashier).toBe(false);
	});

	it("treats a directory entry that only echoes the user id as no entry", () => {
		const directory = buildCashierDirectory([{ user: "a@b.mx", full_name: "a@b.mx" }], null);
		expect(directory).toEqual({});
	});

	it("never offers a Cobro column, because the tender is not in the payload", () => {
		const rows = describeRows([row()], { today: TODAY, directory: DIRECTORY });
		expect(describeColumns(rows).tender).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* The seam with the engine                                                    */
/* -------------------------------------------------------------------------- */

describe("the ring walks the rows and stops at the ends", () => {
	it("moves down, up, Home and End, and clamps rather than wrapping", () => {
		expect(nextIndex("ArrowDown", 0, 3)).toBe(1);
		expect(nextIndex("ArrowDown", 2, 3)).toBe(2);
		expect(nextIndex("ArrowUp", 0, 3)).toBe(0);
		expect(nextIndex("Home", 2, 3)).toBe(0);
		expect(nextIndex("End", 0, 3)).toBe(2);
	});

	it("enters the list from either end when nothing is selected", () => {
		expect(nextIndex("ArrowDown", -1, 3)).toBe(0);
		expect(nextIndex("ArrowUp", -1, 3)).toBe(2);
	});

	it("returns null for a key it does not own, so a chord passes through", () => {
		// A list that swallowed every keystroke would eat the chords the
		// shortcuts engine owns — `f4` has been `employee.switch` for years.
		expect(nextIndex("F4", 0, 3)).toBeNull();
		expect(nextIndex("ArrowDown", 0, 0)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* The seam with the engine                                                    */
/* -------------------------------------------------------------------------- */

describe("the engine is chromed, not rewritten", () => {
	it("takes the ledger branch only while the rail hosts the sheet", () => {
		expect(invoiceManagementSource).toContain('<v-card v-if="ledgerMode"');
		expect(invoiceManagementSource).toContain("ledgerMode: hosted.isHosted");
		expect(invoiceManagementSource).toContain("ledgerDestinationId: hosted.destinationId");
	});

	it("stands the detail DIALOG down on the hosted surface, and nowhere else", () => {
		// The panel replaces it here; the floating modal below the rail
		// boundary keeps the dialog exactly as it was.
		expect(invoiceManagementSource).toContain('v-if="!ledgerMode"');
		expect(invoiceManagementSource).toContain('v-model="detailDialog"');
	});

	it("binds every row intent to a method that already existed", () => {
		for (const binding of [
			'@open="viewInvoice($event)"',
			'@print="printInvoice($event)"',
			'@return="runLedgerReturn($event)"',
			'@collect="openAddPayment($event)"',
			'@delete-draft="deleteDraft($event)"',
			'@repair="repairChangeAllocation($event)"',
			// Through the glue that lands a LOADED draft on the sale
			// (hostedSheetsSource.spec.ts pins what the glue does).
			'@draft-action="runLedgerDraftAction($event.invoice, $event.action)"',
			'@page="setTabPage($event.tab, $event.page)"',
		]) {
			expect(invoiceManagementSource, `${binding} is not the wiring`).toContain(binding);
		}
	});

	it("writes the filters into the engine's own fields and invents none", () => {
		for (const field of [
			"historySearch = $event.search",
			"partialSearch = $event.search",
			"draftSearch = $event.search",
			"returnSearch = $event.search",
			"historyDateFrom = $event.from",
			"historyDateTo = $event.to",
		]) {
			expect(invoiceManagementSource).toContain(field);
		}
	});

	it("adds no loader, no server method and no second read", () => {
		const calls = invoiceManagementSource.match(/frappe\.call\(/g) || [];
		// Eight today, and the ledger added none of them: unpaid, history,
		// supervisor profiles, the repair scan, `viewInvoice`, `deleteDraft`,
		// `createReturn` and `runRepairChangeAllocation`. The number is pinned
		// so a ledger feature reaching for a ninth has to argue for it here.
		expect(calls.length).toBe(8);
		expect(invoiceManagementSource).not.toContain("posa_pos_opening_shift,");
	});

	it("keeps the engine's list fields exactly as they were", () => {
		// The Turno segment, the Cobro column and the Timbrado figure are all
		// absent for this one reason, so the shape of this list is what the
		// absences rest on.
		expect(invoiceManagementSource).toContain(`getInvoiceListFields(extraFields = []) {`);
		expect(invoiceManagementSource).toContain(`"owner",\n\t\t\t\t"modified_by",\n\t\t\t\t...extraFields,`);
	});
});
