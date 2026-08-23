// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import InvoiceLedgerHeader from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerHeader.vue";
import InvoiceLedgerPanel from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerPanel.vue";
import InvoiceLedgerSurface from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerSurface.vue";
import InvoiceLedgerTable from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerTable.vue";
import {
	buildCashierDirectory,
	describeColumns,
	describeFindModes,
	describeRows,
	describeSegments,
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
 * The ledger as a cashier meets it — the four children of §15.3, mounted
 * (build plan §15.4).
 *
 * Split from `invoiceLedger.spec.ts`, which keeps the pure model and the seam
 * with `InvoiceManagement.vue`, when that file passed the 500-line limit.
 *
 * All four mount cleanly under a runtime-only VTU because they are plain
 * elements: no `v-menu`, no `v-dialog`, no `v-icon`. That is deliberate —
 * an unresolved Vuetify component renders as `<!---->` here, so a must-find
 * element inside one would be a test that can never see it.
 *
 * Listeners are PROPS (`onOpen`, `onFilters`, `onTab`), never
 * `wrapper.emitted()`: VTU does not record component emits in this repo.
 */

beforeEach(() => {
	vi.stubGlobal("__", translateStub);
	vi.stubGlobal("frappe", { datetime: { get_today: () => TODAY } });
});

/* -------------------------------------------------------------------------- */
/* The table and its keyboard ring                                             */
/* -------------------------------------------------------------------------- */

const tableProps = (rows: LedgerRowSource[], overrides = {}) => {
	const shaped = describeRows(rows, { today: TODAY, directory: DIRECTORY });
	return {
		rows: shaped,
		columns: describeColumns(shaped),
		selectedIndex: 0,
		formatCurrency,
		page: 1,
		pageCount: 1,
		total: shaped.length,
		pageSize: 25,
		loadedOnPage: shaped.length,
		footerKind: "page" as const,
		...overrides,
	};
};

// `nextIndex` itself — clamping, entering from either end, refusing a key it
// does not own — is pure and lives with the model in `invoiceLedger.spec.ts`.
// What is here is the table WIRED to it.
describe("the ring walks the rows and stops at the ends", () => {
	it("hands the selection up on an arrow and the row up on Enter", async () => {
		const onSelect = vi.fn();
		const onOpen = vi.fn();
		const wrapper = mount(InvoiceLedgerTable, {
			props: {
				...tableProps([row({ name: "B-1" }), row({ name: "B-2" })]),
				onSelect,
				onOpen,
			},
		});

		await wrapper.find('[data-testid="ledger-rows"]').trigger("keydown", { key: "ArrowDown" });
		expect(onSelect).toHaveBeenCalledWith(1);

		await wrapper.find('[data-testid="ledger-rows"]').trigger("keydown", { key: "Enter" });
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0][0].row.name).toBe("B-1");
	});

	it("is reachable from the keyboard at all", () => {
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps([row()]) });
		expect(wrapper.find('[data-testid="ledger-rows"]').attributes("tabindex")).toBe("0");
	});

	it("draws no Cobro column header, ever", () => {
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps([row()]) });
		const headers = wrapper.findAll(".ledger-table__col").map((node) => node.text());
		expect(headers).toEqual(["Ticket", "Hour", "Customer", "Cashier", "Total", "Status"]);
	});

	it("drops the Cajero header with the column when no row resolves", () => {
		const wrapper = mount(InvoiceLedgerTable, {
			props: tableProps([row({ owner: "someone@else.mx" })]),
		});
		const headers = wrapper.findAll(".ledger-table__col").map((node) => node.text());
		expect(headers).toEqual(["Ticket", "Hour", "Customer", "Total", "Status"]);
	});

	it("names only the keys it binds — not the artboard's F5 and F8", () => {
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps([row()]) });
		const footer = wrapper.find('[data-testid="ledger-footer"]').text();
		expect(footer).toContain("Enter");
		expect(footer).not.toMatch(/\bF5\b/);
		expect(footer).not.toMatch(/\bF8\b/);
	});

	it("says the count is of the rows on screen while the amount mode is running", () => {
		const wrapper = mount(InvoiceLedgerTable, {
			props: tableProps([row()], { footerKind: "loaded", loadedOnPage: 25, total: 31 }),
		});
		expect(wrapper.find('[data-testid="ledger-count"]').text()).toBe("1 of the 25 loaded");
	});

	it("counts the page against the whole filtered collection otherwise", () => {
		const wrapper = mount(InvoiceLedgerTable, {
			props: tableProps([row({ name: "B-1" }), row({ name: "B-2" })], { total: 31 }),
		});
		expect(wrapper.find('[data-testid="ledger-count"]').text()).toBe("1–2 of 31");
	});
});

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

const panelProps = (source: LedgerRowSource, overrides = {}) => ({
	row: describeRows([source], { today: TODAY, directory: DIRECTORY })[0],
	detail: null,
	formatCurrency,
	formatFloat,
	currencySymbol: "",
	isRepairCandidate: () => false,
	draftActionsFor: () => [],
	draftActionLabel: (action: string) => action,
	...overrides,
});

describe("the panel replaces the dialog and offers what the tab already offered", () => {
	it("offers Imprimir and Devolver on a submitted invoice", () => {
		const wrapper = mount(InvoiceLedgerPanel, { props: panelProps(row()) });
		expect(wrapper.find('[data-testid="ledger-action-print"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="ledger-action-return"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="ledger-action-collect"]').exists()).toBe(false);
	});

	it("puts the ONE filled button on an unpaid row's Cobrar saldo, and only there", () => {
		const paid = mount(InvoiceLedgerPanel, { props: panelProps(row()) });
		expect(paid.findAll(".ledger-panel__primary")).toHaveLength(0);

		const unpaid = mount(InvoiceLedgerPanel, {
			props: panelProps(row({ outstanding_amount: 2510, status: "Partly Paid" })),
		});
		const primaries = unpaid.findAll(".ledger-panel__primary");
		expect(primaries).toHaveLength(1);
		expect(primaries[0].attributes("data-testid")).toBe("ledger-action-collect");
	});

	it("owns no band: the sale's band below the ledger is still the sale's", () => {
		const wrapper = mount(InvoiceLedgerPanel, {
			props: panelProps(row({ outstanding_amount: 2510 })),
		});
		expect(wrapper.findAll('[data-testid="band-primary"]')).toHaveLength(0);
	});

	it("offers the draft's own actions and Eliminar on a draft", () => {
		const wrapper = mount(InvoiceLedgerPanel, {
			props: panelProps(row({ name: "DRAFT-1" }), {
				row: describeRows([row({ name: "DRAFT-1", source: "invoice" })], {
					today: TODAY,
					directory: DIRECTORY,
					isDraft: true,
				})[0],
				draftActionsFor: () => ["invoice_load_draft"],
				draftActionLabel: () => "Resume",
				canDeleteDraft: true,
			}),
		});
		expect(wrapper.find('[data-testid="ledger-action-draft-invoice_load_draft"]').text()).toBe(
			"Resume",
		);
		expect(wrapper.find('[data-testid="ledger-action-delete"]').exists()).toBe(true);
		// A draft has nothing to print and nothing to return.
		expect(wrapper.find('[data-testid="ledger-action-print"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="ledger-action-return"]').exists()).toBe(false);
	});

	it("offers Reparar cambio only for a candidate, and never while offline", () => {
		const none = mount(InvoiceLedgerPanel, { props: panelProps(row()) });
		expect(none.find('[data-testid="ledger-action-repair"]').exists()).toBe(false);

		const candidate = mount(InvoiceLedgerPanel, {
			props: panelProps(row(), { isRepairCandidate: () => true, offline: true }),
		});
		const button = candidate.find('[data-testid="ledger-action-repair"]');
		expect(button.exists()).toBe(true);
		expect(button.attributes("disabled")).toBeDefined();
	});

	it("shows the tender the TABLE cannot, once the document has been read", () => {
		const wrapper = mount(InvoiceLedgerPanel, {
			props: panelProps(row(), {
				detail: {
					name: "B-04812",
					items: [{ item_name: "Anillo Case", item_code: "IPN001545", qty: 1, rate: 200, amount: 200 }],
					payments: [{ mode_of_payment: "Efectivo", amount: 1200 }],
					change_amount: 71,
				},
			}),
		});
		expect(wrapper.text()).toContain("Efectivo");
		expect(wrapper.find('[data-money-role="ledger-panel-tender"]').text()).toBe(`${MONEY}1200.00`);
		expect(wrapper.find('[data-money-role="ledger-panel-change"]').text()).toBe(`${MONEY}71.00`);
	});

	it("asks for Enter rather than inventing lines it has not read", () => {
		const wrapper = mount(InvoiceLedgerPanel, { props: panelProps(row()) });
		expect(wrapper.find('[data-testid="ledger-panel-pending"]').exists()).toBe(true);
		expect(wrapper.findAll(".ledger-panel__line")).toHaveLength(0);
	});

	it("claims no CFDI state and offers no CFDI send, because neither exists here", () => {
		const wrapper = mount(InvoiceLedgerPanel, {
			props: panelProps(row(), { detail: { name: "B-04812", items: [], payments: [] } }),
		});
		expect(wrapper.text()).not.toContain("CFDI");
	});

	it("declares no `total` money role — the band owns that number", () => {
		const wrapper = mount(InvoiceLedgerPanel, {
			props: panelProps(row(), {
				detail: { name: "B-04812", items: [], payments: [{ mode_of_payment: "Efectivo", amount: 1129 }] },
			}),
		});
		expect(wrapper.findAll('[data-money-role="total"]')).toHaveLength(0);
		expect(wrapper.findAll("[data-money-role]").length).toBeGreaterThan(0);
	});

	it("says so plainly when nothing is selected", () => {
		const wrapper = mount(InvoiceLedgerPanel, { props: panelProps(row(), { row: null }) });
		expect(wrapper.find('[data-testid="ledger-panel-blank"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="ledger-panel-actions"]').exists()).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* The header                                                                  */
/* -------------------------------------------------------------------------- */

describe("the header draws the segment and the finder, and no chord it cannot honour", () => {
	const headerProps = (overrides = {}) => ({
		segments: describeSegments({ shiftScoped: false }),
		activeSegment: "today" as const,
		counts: { today: 31, shift: null, pending: 11, drafts: 62, returns: 11 },
		modes: describeFindModes(null),
		activeMode: "ticket" as const,
		query: "",
		dateFrom: TODAY,
		dateTo: TODAY,
		...overrides,
	});

	it("draws one button per offered segment, with its loaded count", () => {
		const wrapper = mount(InvoiceLedgerHeader, { props: headerProps() });
		const buttons = wrapper.findAll(".ledger-seg__item");
		expect(buttons).toHaveLength(4);
		expect(buttons[0].text()).toContain("31");
		expect(wrapper.find('[data-testid="ledger-segment-shift"]').exists()).toBe(false);
	});

	it("draws no number for a collection that has not loaded", () => {
		const wrapper = mount(InvoiceLedgerHeader, {
			props: headerProps({ counts: { today: null, shift: null, pending: null, drafts: null, returns: null } }),
		});
		expect(wrapper.findAll(".ledger-seg__count")).toHaveLength(0);
	});

	it("renders no chord chip beside any finder mode", () => {
		const wrapper = mount(InvoiceLedgerHeader, { props: headerProps() });
		expect(wrapper.findAll(".ledger-chord")).toHaveLength(0);
		expect(wrapper.find('[data-testid="ledger-finder"]').text()).not.toMatch(/\bF[1-4]\b/);
	});

	it("swaps the box for the tab's own from/to range in Fecha mode", () => {
		const wrapper = mount(InvoiceLedgerHeader, { props: headerProps({ activeMode: "date" }) });
		expect(wrapper.find('[data-testid="ledger-finder-input"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="ledger-finder-date-from"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="ledger-finder-date-to"]').exists()).toBe(true);
	});

	it("hands the operator's choices up", async () => {
		const onSegment = vi.fn();
		const onMode = vi.fn();
		const wrapper = mount(InvoiceLedgerHeader, {
			props: { ...headerProps(), onSegment, onMode },
		});
		await wrapper.find('[data-testid="ledger-segment-drafts"]').trigger("click");
		expect(onSegment).toHaveBeenCalledWith("drafts");

		await wrapper.find('[data-testid="ledger-finder-amount"]').trigger("click");
		expect(onMode).toHaveBeenCalledWith("amount");

		// The date chip and the Fecha mode are one control, not two.
		await wrapper.find('[data-testid="ledger-daterange"]').trigger("click");
		expect(onMode).toHaveBeenCalledWith("date");
	});
});

/* -------------------------------------------------------------------------- */
/* The surface                                                                 */
/* -------------------------------------------------------------------------- */

const surfaceProps = (overrides: Record<string, unknown> = {}) => ({
	activeTab: "history",
	collections: collections({
		history: {
			page: [row({ name: "B-1", grand_total: 1129 }), row({ name: "B-2", grand_total: 349 })],
			total: 2,
			loaded: [row({ name: "B-1", grand_total: 1129 }), row({ name: "B-2", grand_total: 349 })],
		},
	}),
	pageSize: 25,
	dateFrom: TODAY,
	dateTo: TODAY,
	detail: null,
	employees: [{ user: "jenni@doco.mx", full_name: "Jenni" }],
	currentCashier: null,
	formatCurrency,
	formatFloat,
	currencySymbol: "",
	isRepairCandidate: () => false,
	draftActionsFor: () => [],
	draftActionLabel: (action: string) => action,
	today: TODAY,
	...overrides,
});

describe("the surface lands where the rail sent it and speaks only in intents", () => {
	it("publishes Hoy's range on mount for the `invoices` destination", async () => {
		const onTab = vi.fn();
		const onFilters = vi.fn();
		mount(InvoiceLedgerSurface, {
			props: { ...surfaceProps({ destinationId: "invoices" }), onTab, onFilters },
		});
		await nextTick();

		expect(onTab).toHaveBeenCalledWith("history");
		expect(onFilters).toHaveBeenCalledWith({ search: "", from: TODAY, to: TODAY });
	});

	it("lands the `drafts` destination on Borradores with no date scope", async () => {
		const onTab = vi.fn();
		const onFilters = vi.fn();
		mount(InvoiceLedgerSurface, {
			props: { ...surfaceProps({ destinationId: "drafts", activeTab: "drafts" }), onTab, onFilters },
		});
		await nextTick();

		expect(onTab).toHaveBeenCalledWith("drafts");
		expect(onFilters).toHaveBeenCalledWith({ search: "", from: "", to: "" });
	});

	it("feeds the tab's search in the two search modes and clears it in the other two", async () => {
		const onFilters = vi.fn();
		const wrapper = mount(InvoiceLedgerSurface, {
			props: { ...surfaceProps({ destinationId: "invoices" }), onFilters },
		});
		await nextTick();

		const input = wrapper.find('[data-testid="ledger-finder-input"]');
		await input.setValue("B-04812");
		expect(onFilters).toHaveBeenLastCalledWith({ search: "B-04812", from: TODAY, to: TODAY });

		// Monto matches on screen; leaving a ticket number in the tab's search
		// would silently empty the list under a cashier who thought they had
		// switched to searching by amount.
		await wrapper.find('[data-testid="ledger-finder-amount"]').trigger("click");
		expect(onFilters).toHaveBeenLastCalledWith({ search: "", from: TODAY, to: TODAY });
	});

	it("narrows the rows on screen by amount, and says so in the footer", async () => {
		const wrapper = mount(InvoiceLedgerSurface, {
			props: surfaceProps({ destinationId: "invoices" }),
		});
		await nextTick();

		expect(wrapper.findAll('[data-testid="ledger-row"]')).toHaveLength(2);

		await wrapper.find('[data-testid="ledger-finder-amount"]').trigger("click");
		await wrapper.find('[data-testid="ledger-finder-input"]').setValue("1129");
		await nextTick();

		expect(wrapper.findAll('[data-testid="ledger-row"]')).toHaveLength(1);
		expect(wrapper.find('[data-testid="ledger-count"]').text()).toBe("1 of the 2 loaded");
	});

	it("hands the raw list record back on open, so the engine keeps its own fields", async () => {
		const onOpen = vi.fn();
		const wrapper = mount(InvoiceLedgerSurface, {
			props: { ...surfaceProps({ destinationId: "invoices" }), onOpen },
		});
		await nextTick();

		await wrapper.findAll('[data-testid="ledger-row"]')[1].trigger("click");
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0][0]).toMatchObject({ name: "B-2", doctype: "Sales Invoice" });
	});

	it("moves the panel with the ring without reading anything from the server", async () => {
		const onOpen = vi.fn();
		const wrapper = mount(InvoiceLedgerSurface, {
			props: { ...surfaceProps({ destinationId: "invoices" }), onOpen },
		});
		await nextTick();

		await wrapper.find('[data-testid="ledger-rows"]').trigger("keydown", { key: "ArrowDown" });
		await nextTick();

		expect(wrapper.find('[data-testid="ledger-panel"]').text()).toContain("B-1");
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("shows the panel's lines only for the document it actually holds", async () => {
		const wrapper = mount(InvoiceLedgerSurface, {
			props: surfaceProps({
				destinationId: "invoices",
				// A stale detail from the row the cashier looked at a moment ago.
				detail: { name: "B-9", items: [{ item_name: "Cable", qty: 1, rate: 99, amount: 99 }] },
			}),
		});
		await nextTick();
		await wrapper.find('[data-testid="ledger-rows"]').trigger("keydown", { key: "ArrowDown" });
		await nextTick();

		expect(wrapper.text()).not.toContain("Cable");
		expect(wrapper.find('[data-testid="ledger-panel-pending"]').exists()).toBe(true);
	});

	it("draws exactly one accent action, and only when there is a balance to collect", async () => {
		const unpaidRow = row({ name: "B-7", outstanding_amount: 670, status: "Unpaid" });
		const wrapper = mount(InvoiceLedgerSurface, {
			props: surfaceProps({
				destinationId: "invoices",
				activeTab: "partial",
				collections: collections({
					partial: { page: [unpaidRow], total: 1, loaded: [unpaidRow] },
				}),
			}),
		});
		await nextTick();
		await wrapper.find('[data-testid="ledger-segment-pending"]').trigger("click");
		await nextTick();
		await wrapper.find('[data-testid="ledger-rows"]').trigger("keydown", { key: "ArrowDown" });
		await nextTick();

		expect(wrapper.findAll(".ledger-panel__primary")).toHaveLength(1);
		expect(wrapper.findAll('[data-testid="band-primary"]')).toHaveLength(0);
	});

	it("carries every intent to the engine and nothing else", async () => {
		const spies = {
			onPrint: vi.fn(),
			onReturn: vi.fn(),
			onCollect: vi.fn(),
			onPage: vi.fn(),
		};
		const wrapper = mount(InvoiceLedgerSurface, {
			props: { ...surfaceProps({ destinationId: "invoices" }), ...spies },
		});
		await nextTick();
		await wrapper.find('[data-testid="ledger-rows"]').trigger("keydown", { key: "ArrowDown" });
		await nextTick();

		await wrapper.find('[data-testid="ledger-action-print"]').trigger("click");
		expect(spies.onPrint.mock.calls[0][0]).toMatchObject({ name: "B-1" });

		await wrapper.find('[data-testid="ledger-action-return"]').trigger("click");
		expect(spies.onReturn.mock.calls[0][0]).toMatchObject({ name: "B-1" });
	});
});
