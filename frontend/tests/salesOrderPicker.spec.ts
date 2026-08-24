// @vitest-environment jsdom

/**
 * «Select S.O» — the chip that picks a SALES ORDER (owner report 2026-08-24).
 *
 * What Marco pressed and what he got: the chip is supposed to list the
 * register's open sales orders and drop the chosen one into the sale; it landed
 * him on Borradores, the draft-INVOICE list, every time.
 *
 * The chip's request was real and the surface could serve it — `draftSource:
 * "order"` is a first-class mode of the drafts surface, and
 * `commercial_flow.list_source_documents` has answered for `source: "order"`
 * since the flows round. Two writes on the way there threw the request away:
 *
 *  1. `uiStore.closeInvoiceManagement()` reset the source to `"invoice"`, and
 *     `Pos.vue` CLOSES this sheet to hand the destination to the rail — so the
 *     reset sat squarely between the request and the mount that serves it.
 *  2. The hosted sheet re-opened with `uiStore.draftSource`, the ref belonging
 *     to the legacy floating drafts dialog (`openDrafts`), which is permanently
 *     `"invoice"` on this surface.
 *
 * Both are pinned below, along with what the fix has to leave alone: the tab
 * still resets on close, and the whole mode is still gated on
 * `custom_allow_select_sales_order`.
 *
 * The engine's methods are called with a fabricated context rather than mounted
 * — `invoiceManagementSupervisor.spec.ts`'s approach, and the only one that
 * reaches `loadDrafts` without standing up 3,300 lines of `v-dialog`. The
 * server call is asserted through the REAL `documentSources.ts`, un-mocked, so
 * the wire names (`source`, `company`, `pos_profile`) are the ones the endpoint
 * actually reads.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

vi.mock("../src/posapp/composables/core/useTheme", () => ({
	useTheme: () => ({ isDark: { value: false } }),
}));

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({ windowWidth: { value: 1400 } }),
}));

vi.mock("../src/offline/index", () => ({ isOffline: () => false }));

vi.mock("../src/posapp/plugins/print", () => ({
	appendDebugPrintParam: (url: string) => url,
	isDebugPrintEnabled: () => false,
	silentPrint: vi.fn(),
	watchPrintWindow: vi.fn(),
}));

vi.mock("../src/posapp/services/qzTray", () => ({ printDocumentViaQz: vi.fn() }));

import InvoiceManagement from "../src/posapp/components/pos/flows/InvoiceManagement.vue";
import invoiceManagementSource from "../src/posapp/components/pos/flows/InvoiceManagement.vue?raw";
import InvoiceLedgerHeader from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerHeader.vue";
import InvoiceLedgerSurface from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerSurface.vue";
import {
	describeRows,
	describeSegments,
	describeFindModes,
	segmentCounts,
} from "../src/posapp/components/pos/flows/ledger/ledgerModel";
import { get_draft_orders } from "../src/posapp/components/pos/invoice_utils/dialogs";
import { useUIStore } from "../src/posapp/stores/uiStore";
import {
	getAvailableCommercialDocumentSources,
	getDocumentFlowActionsForRecord,
} from "../src/posapp/utils/documentSources";
import { collections, DIRECTORY, formatCurrency, formatFloat, TODAY, translateStub } from "./ledgerFixtures";

/** A register that sells against sales orders. The gate, on. */
const PROFILE = {
	name: "Doco Centro",
	company: "Doco Mexico",
	currency: "MXN",
	custom_allow_select_sales_order: 1,
};

/** What `list_source_documents` returns for `source: "order"`, normalized. */
const ORDER_ROW = {
	name: "SAL-ORD-2026-00031",
	source: "order",
	source_doctype: "Sales Order",
	doctype: "Sales Order",
	customer: "ALE-001",
	customer_name: "Alejandra Ríos Bautista",
	posting_date: TODAY,
	posting_time: "",
	currency: "MXN",
	grand_total: 4820,
	status: "To Deliver and Bill",
	docstatus: 1,
	source_docstatus: 1,
};

beforeEach(() => {
	setActivePinia(createPinia());
	vi.stubGlobal("__", translateStub);
	vi.stubGlobal("frappe", { call: vi.fn(), datetime: { get_today: () => TODAY } });
});

/* -------------------------------------------------------------------------- */
/* 1. The request reaches the surface                                          */
/* -------------------------------------------------------------------------- */

describe("«Select S.O» asks the drafts surface for sales orders, and the ask survives the trip", () => {
	it("opens Borradores on the order source", () => {
		const uiStore = useUIStore();
		get_draft_orders({ uiStore, toastStore: { show: vi.fn() } });

		expect(uiStore.invoiceManagementDialog).toBe(true);
		expect(uiStore.invoiceManagementTargetTab).toBe("drafts");
		expect(uiStore.invoiceManagementDraftSource).toBe("order");
	});

	it("keeps the source through the rail hand-off, which is a CLOSE", () => {
		// `Pos.vue` answers a legacy open with `closeInvoiceManagement()` +
		// `activate(destination)` whenever the rail is on screen. This close is
		// not the operator leaving — it is the shell changing how the same sheet
		// is mounted — so it may not erase what the sheet was asked for. THE BUG.
		const uiStore = useUIStore();
		get_draft_orders({ uiStore, toastStore: { show: vi.fn() } });

		uiStore.closeInvoiceManagement();

		expect(uiStore.invoiceManagementDraftSource).toBe("order");
	});

	it("still resets the tab on close, so Facturas does not re-enter on Borradores", () => {
		const uiStore = useUIStore();
		get_draft_orders({ uiStore, toastStore: { show: vi.fn() } });

		uiStore.closeInvoiceManagement();

		expect(uiStore.invoiceManagementDialog).toBe(false);
		expect(uiStore.invoiceManagementTargetTab).toBe("history");
	});

	it("re-opens the hosted sheet with THIS sheet's source, never the legacy drafts dialog's", () => {
		// Source-scanned: `openSheet` runs inside `useHostedSheet`'s `onMounted`
		// under `DestinationHost`, and reaching it through a mount means standing
		// up the whole dialog. `uiStore.draftSource` belongs to `openDrafts` —
		// a different surface, a different ref — and reading it here is what
		// wrote "invoice" over the chip's "order".
		const start = invoiceManagementSource.indexOf("const hosted = useHostedSheet({");
		expect(start).toBeGreaterThan(-1);
		const block = invoiceManagementSource.slice(start, invoiceManagementSource.indexOf("});", start));

		expect(block).toContain("uiStore.invoiceManagementDraftSource");
		expect(block).not.toContain("uiStore.draftSource");
	});
});

/* -------------------------------------------------------------------------- */
/* 2. Borradores asks the server for sales orders                              */
/* -------------------------------------------------------------------------- */

const engineContext = (overrides: Record<string, unknown> = {}) => ({
	posProfile: PROFILE,
	posOpeningShift: { name: "POSA-OS-26-0000007" },
	currentCashier: { user: "jenni@doco.mx" },
	currentInvoiceDoctype: "Sales Invoice",
	draftSource: "order",
	draftRecordsBySource: { invoice: [], order: [], quote: [], delivery: [] },
	loading: false,
	activeTab: "drafts",
	isSupervisorScope: () => false,
	resolveSupervisorProfileScope: () => null,
	uiStore: { setInvoiceManagementDraftSource: vi.fn(), closeInvoiceManagement: vi.fn() },
	invoiceStore: { triggerLoadFlow: vi.fn() },
	toastStore: { show: vi.fn() },
	get currentDraftSource() {
		return (InvoiceManagement as any).computed.currentDraftSource.call(this);
	},
	...overrides,
});

describe("Borradores on the order source lists the register's sales orders", () => {
	it("asks `list_source_documents` for orders, scoped to this register's company", async () => {
		const call = (globalThis as any).frappe.call as ReturnType<typeof vi.fn>;
		call.mockResolvedValue({ message: [ORDER_ROW] });
		const context = engineContext();

		await (InvoiceManagement as any).methods.loadDrafts.call(context);

		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "posawesome.posawesome.api.commercial_flow.list_source_documents",
				args: expect.objectContaining({
					source: "order",
					company: "Doco Mexico",
					currency: "MXN",
					pos_profile: "Doco Centro",
				}),
			}),
		);
	});

	it("files the rows under the order source, leaving the draft invoices alone", async () => {
		const call = (globalThis as any).frappe.call as ReturnType<typeof vi.fn>;
		call.mockResolvedValue({ message: [ORDER_ROW] });
		const context = engineContext();

		await (InvoiceManagement as any).methods.loadDrafts.call(context);

		expect(context.draftRecordsBySource.order).toHaveLength(1);
		expect(context.draftRecordsBySource.order[0].name).toBe("SAL-ORD-2026-00031");
		expect(context.draftRecordsBySource.invoice).toEqual([]);
		expect(context.uiStore.setInvoiceManagementDraftSource).toHaveBeenCalledWith("order");
	});

	it("falls back to draft invoices when the register does not allow sales orders", async () => {
		// The gate is `custom_allow_select_sales_order` and it stays: the chip is
		// not rendered without it, and a request that arrives anyway resolves to
		// the one source every register has.
		const call = (globalThis as any).frappe.call as ReturnType<typeof vi.fn>;
		call.mockResolvedValue({ message: [] });
		const context = engineContext({
			posProfile: { ...PROFILE, custom_allow_select_sales_order: 0 },
		});

		expect(context.currentDraftSource).toBe("invoice");

		await (InvoiceManagement as any).methods.loadDrafts.call(context);

		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({ args: expect.objectContaining({ source: "invoice" }) }),
		);
	});
});

/* -------------------------------------------------------------------------- */
/* 3. Picking one loads it into the sale                                       */
/* -------------------------------------------------------------------------- */

describe("the picked order reaches the cart, and can then be charged", () => {
	it("offers Abrir orden and Crear factura on a submitted, billable order", () => {
		// `order_load` is the legacy dialog's whole job — it is still the first
		// action, so the row's default press loads the order into the sale.
		expect(getDocumentFlowActionsForRecord(ORDER_ROW)).toEqual([
			"order_load",
			"order_to_delivery_note",
			"order_to_invoice",
		]);
	});

	it("prepares the order server-side and hands the prepared doc to the invoice store", async () => {
		const call = (globalThis as any).frappe.call as ReturnType<typeof vi.fn>;
		const prepared = { doctype: "Sales Invoice", items: [{ item_code: "TEL-01", qty: 2 }] };
		call.mockResolvedValue({
			message: { prepared_doc: prepared, source_record: ORDER_ROW, flow_context: {} },
		});
		const context = engineContext();

		await (InvoiceManagement as any).methods.runDraftAction.call(context, ORDER_ROW, "order_load");

		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "posawesome.posawesome.api.commercial_flow.prepare_document_flow_action",
				args: expect.objectContaining({
					action: "order_load",
					source_doctype: "Sales Order",
					source_name: "SAL-ORD-2026-00031",
					target_invoice_doctype: "Sales Invoice",
				}),
			}),
		);
		expect(context.invoiceStore.triggerLoadFlow).toHaveBeenCalledWith(
			expect.objectContaining({ prepared_doc: prepared }),
		);
		// The sheet gets out of the way: the cart it just filled is behind it.
		expect(context.uiStore.closeInvoiceManagement).toHaveBeenCalled();
	});

	it("never offers Delete on a sales order — deleting is an invoice-draft act", () => {
		const context = engineContext();
		expect((InvoiceManagement as any).computed.canDeleteActiveDraftSource.call(context)).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* 4. The ledger says which family it is listing                               */
/* -------------------------------------------------------------------------- */

const headerProps = (overrides: Record<string, unknown> = {}) => ({
	segments: describeSegments({ shiftScoped: false }),
	activeSegment: "drafts" as const,
	counts: segmentCounts(collections(), { sold: null, receivable: null, refunded: null } as any),
	modes: describeFindModes(null),
	activeMode: "ticket" as const,
	query: "",
	dateFrom: "",
	dateTo: "",
	sources: getAvailableCommercialDocumentSources(PROFILE),
	activeSource: "order",
	...overrides,
});

describe("the ledger's Borradores says which documents it is showing", () => {
	it("draws the switch on Borradores, with the asked-for source lit", () => {
		const wrapper = mount(InvoiceLedgerHeader, { props: headerProps() });

		expect(wrapper.find('[data-testid="ledger-source"]').exists()).toBe(true);
		expect(
			wrapper.find('[data-testid="ledger-source-order"]').classes().join(" "),
		).toContain("ledger-source__item--on");
		expect(wrapper.find('[data-testid="ledger-source-invoice"]').exists()).toBe(true);
	});

	it("draws no switch on the other segments — Hoy has one kind of row", () => {
		const wrapper = mount(InvoiceLedgerHeader, { props: headerProps({ activeSegment: "today" }) });
		expect(wrapper.find('[data-testid="ledger-source"]').exists()).toBe(false);
	});

	it("draws no switch on a register with a single source: a lone button answers nothing", () => {
		const wrapper = mount(InvoiceLedgerHeader, {
			props: headerProps({
				sources: getAvailableCommercialDocumentSources({ name: "Plain POS" }),
				activeSource: "invoice",
			}),
		});
		expect(wrapper.find('[data-testid="ledger-source"]').exists()).toBe(false);
	});

	it("hands the chosen source up and drops the selection with it", async () => {
		// Listeners are PROPS here; VTU records no component emits in this repo.
		const onDraftSource = vi.fn();
		const wrapper = mount(InvoiceLedgerSurface, {
			props: {
				activeTab: "drafts",
				destinationId: "drafts",
				collections: collections({
					drafts: { page: [ORDER_ROW], total: 1, loaded: [ORDER_ROW] },
				}),
				pageSize: 25,
				dateFrom: "",
				dateTo: "",
				detail: null,
				employees: [],
				currentCashier: null,
				formatCurrency,
				formatFloat,
				currencySymbol: "",
				isRepairCandidate: () => false,
				draftActionsFor: getDocumentFlowActionsForRecord,
				draftActionLabel: (action: string) => action,
				draftSources: getAvailableCommercialDocumentSources(PROFILE),
				draftSource: "order",
				today: TODAY,
				onDraftSource,
			},
		});
		await nextTick();

		await wrapper.find('[data-testid="ledger-row"]').trigger("click");
		expect(wrapper.find('[data-testid="ledger-source-invoice"]').exists()).toBe(true);

		await wrapper.find('[data-testid="ledger-source-invoice"]').trigger("click");

		expect(onDraftSource).toHaveBeenCalledWith("invoice");
		// The panel was reading a sales order; the list is about to be draft
		// invoices, so the row it was reading goes with them.
		expect(wrapper.find('[data-testid="ledger-panel-blank"]').exists()).toBe(true);
	});

	it("does not call a submitted sales order a draft invoice", () => {
		const [order] = describeRows([ORDER_ROW], {
			today: TODAY,
			directory: DIRECTORY,
			isDraft: true,
		});
		expect(order!.status.label).toBe("To Deliver and Bill");

		// And the draft invoice it shares the segment with keeps its own chip.
		const [draft] = describeRows([{ name: "ACC-SINV-0001", source: "invoice", status: "Draft" }], {
			today: TODAY,
			directory: DIRECTORY,
			isDraft: true,
		});
		expect(draft!.status.label).toBe("Draft invoice");
	});
});
