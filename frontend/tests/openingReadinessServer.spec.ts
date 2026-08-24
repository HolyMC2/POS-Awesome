/**
 * The server's answer, from the wire to the verdict.
 *
 * `get_opening_readiness` exists because nine of the ten Apertura points could
 * not be answered at a FIRST opening — the register's caches are written when
 * a shift opens, so the screen that opens the first shift has nothing to read.
 * Two things about carrying that answer across can go wrong quietly, and both
 * would show a cashier a tick nobody earned:
 *
 *   1. **snake_case to the check's vocabulary.** An account the server sent as
 *      an empty string is the money FAILURE; mapped to `undefined` it becomes
 *      "not reported", which is unknown, which never blocks. Same shape, and
 *      only one of them is a reason not to open a till. `authorisers: []` has
 *      the identical trap on point 7.
 *   2. **the merge direction.** The cached payload describes whichever
 *      register opened here LAST. The server describes the one about to open.
 *      A merge that let the cache win would answer the wrong question
 *      confidently, and a merge that fired when the server said nothing would
 *      break offline apertura — which must keep degrading exactly as today.
 *
 * No mount, no transport: `serverReadinessInput` is a pure mapper and the
 * merge is reached by handing `collectReadinessInput` a `server` source, which
 * is the only way the snapshot ever sees one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const offline = {
	getOpeningStorage: vi.fn(() => null as any),
	getBootstrapSnapshot: vi.fn(() => null as any),
	getCachedPriceListItems: vi.fn(() => null as any),
	getTaxTemplate: vi.fn(() => null as any),
	getCacheUsageEstimate: vi.fn(async () => ({ total: 0 })),
	getPendingOfflineInvoiceCount: vi.fn(() => 0),
	getWriteQueueDraftReviewCount: vi.fn(async () => 0),
};

vi.mock("../src/offline/index", () => offline);

vi.mock("../src/posapp/composables/core/usePrintHealthShared", () => ({
	usePrintHealthShared: () => ({ rollup: { value: "unknown" } }),
}));

import {
	serverReadinessInput,
	type OpeningReadinessPayload,
} from "../src/posapp/services/openingReadinessService";
import { collectReadinessInput } from "../src/posapp/components/pos/shift/readinessSnapshot";
import { evaluateReadiness } from "../src/posapp/components/pos/shift/openingReadiness";

const PAYLOAD: OpeningReadinessPayload = {
	pos_profile: "Doco Ventas",
	company: "Grupo Doco",
	contract: {
		status: "resolved",
		mode: "Venta al mostrador",
		giro: "Celulares y accesorios",
		company: "Grupo Doco",
	},
	catalogue: {
		warehouse: "Mostrador - GD",
		price_list: "Standard Selling",
		warehouse_sells: true,
		priced_items: 5328,
	},
	fiscal: { stamping_enabled: true, tax_template: "IVA 16% - GD", tax_rate: 16 },
	tenders: {
		accounts_reported: true,
		rows: [
			{ mode: "Cash", account: "Caja Tienda - GD" },
			{ mode: "Wire Transfer", account: "BBVA Debito - GD" },
		],
	},
	formats: {
		ticket_format: "Ticket 80mm",
		ticket_format_exists: true,
		return_note_format: null,
		cfdi_pdf: true,
	},
	people: {
		cashier: "Jenni Robledo",
		seller_count: 2,
		authorisers: ["Rosa Elena"],
	},
	test_sale: { performed: true, reverted_on: "2026-07-15", reversal: "ACC-SINV-2026-02467" },
};

/** The cached previous shift, which is what the snapshot reads on its own. */
const CACHED_PROFILE = {
	name: "Doco Ventas",
	company: "Grupo Doco",
	warehouse: "Bodega vieja",
	selling_price_list: "Lista vieja",
	print_format: "Ticket 58 mm",
	taxes_and_charges: "IVA 8%",
	posa_cfdi_enable_stamping: 0,
	applicable_for_users: [{ user: "jenni@doco.mx" }],
};

describe("mapping the server's answer into the check's vocabulary", () => {
	it("carries every group it was given", () => {
		const input = serverReadinessInput(PAYLOAD);

		expect(input?.contract).toMatchObject({ status: "resolved", mode: "Venta al mostrador" });
		expect(input?.catalogue).toMatchObject({ warehouse: "Mostrador - GD", pricedItems: 5328 });
		expect(input?.fiscal).toMatchObject({ taxTemplate: "IVA 16% - GD", taxRate: 16 });
		expect(input?.formats).toMatchObject({ ticketFormat: "Ticket 80mm", cfdiPdf: true });
		expect(input?.testSale).toMatchObject({ performed: true, revertedOn: "2026-07-15" });
	});

	/** The one that turns the money failure into a shrug. */
	it("keeps an empty account an EMPTY ACCOUNT, not a missing key", () => {
		const input = serverReadinessInput({
			...PAYLOAD,
			tenders: {
				accounts_reported: true,
				rows: [
					{ mode: "Cash", account: "Caja Tienda - GD" },
					{ mode: "Monedero", account: "" },
				],
			},
		});

		expect(input?.tenders?.accountsReported).toBe(true);
		expect(input?.tenders?.rows[1]).toEqual({ mode: "Monedero", account: "" });
		// And the check has to STOP on it, which is the whole reason for the row.
		const verdict = evaluateReadiness(input);
		const tender = verdict.checks.find((check) => check.id === "tenderAccounts");
		expect(tender?.outcome).toBe("stop");
		expect(tender?.subjects).toEqual(["Monedero"]);
	});

	it("keeps an empty roster an EMPTY ROSTER, which is a finding", () => {
		const input = serverReadinessInput({
			...PAYLOAD,
			people: { cashier: "Jenni Robledo", seller_count: 2, authorisers: [] },
		});

		// `null` would mean "nobody looked" and render unverified. `[]` means
		// nobody on this register can authorise an exception, and warns.
		expect(input?.people?.authorisers).toEqual([]);
		expect(
			evaluateReadiness(input).checks.find((check) => check.id === "peopleAndAuthority")
				?.outcome,
		).toBe("warn");
	});

	it("leaves a group the server could not compute ABSENT rather than empty", () => {
		// The server omits what it could not answer. An omitted group renders
		// unverified; an empty one would render as a finding, and the two are
		// the difference between "nobody checked" and "this is broken".
		const input = serverReadinessInput({ pos_profile: "Doco Ventas", catalogue: null });

		expect(input).not.toBeNull();
		expect(input?.catalogue).toBeUndefined();
		expect(input?.tenders).toBeUndefined();
	});

	it("does not carry emc's fiscal facts, so a merge cannot blank them", () => {
		const input = serverReadinessInput(PAYLOAD);

		expect(input?.fiscal).not.toHaveProperty("cfdiVersion");
		expect(input?.fiscal).not.toHaveProperty("regime");
	});

	it("answers null for a payload that never arrived", () => {
		expect(serverReadinessInput(null)).toBeNull();
		expect(serverReadinessInput(undefined)).toBeNull();
	});
});

describe("layering the server over what the register found on its own", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		offline.getOpeningStorage.mockReturnValue(null);
		offline.getBootstrapSnapshot.mockReturnValue(null);
		offline.getCachedPriceListItems.mockReturnValue(null);
		offline.getTaxTemplate.mockReturnValue(null);
		offline.getCacheUsageEstimate.mockResolvedValue({ total: 0 });
		offline.getPendingOfflineInvoiceCount.mockReturnValue(0);
		offline.getWriteQueueDraftReviewCount.mockResolvedValue(0);
	});

	it("answers the seven server-side points on a register with no cache at all", async () => {
		// This is the first opening: nothing has ever been cached here. Before
		// the endpoint these nine rows all read «no verificado».
		const verdict = evaluateReadiness(
			await collectReadinessInput({
				company: "Grupo Doco",
				posProfile: "Doco Ventas",
				paymentRows: null,
				server: PAYLOAD,
			}),
		);

		const outcome = (id: string) =>
			verdict.checks.find((check) => check.id === id)?.outcome;
		for (const id of [
			"modeAndBranch",
			"warehouseAndPriceList",
			"fiscalPosture",
			"tenderAccounts",
			"documentFormats",
			"peopleAndAuthority",
			"testSale",
		]) {
			expect(outcome(id), `${id} is still unverified`).not.toBe("unknown");
		}
		// Devices stay unverifiable from here and the offline cache stays
		// unmeasured — those are the browser's own facts, not the server's.
		expect(outcome("devices")).toBe("unknown");
		expect(outcome("offlineReady")).toBe("unknown");
		expect(verdict.canOpen).toBe(true);
	});

	it("wins over the cached previous shift, which describes a different day", async () => {
		offline.getOpeningStorage.mockReturnValue({
			pos_profile: CACHED_PROFILE,
			capability_profile: { name: "Modo viejo", vertical: "Giro viejo" },
		});
		offline.getCachedPriceListItems.mockReturnValue(new Array(11).fill({}));

		const input = await collectReadinessInput({
			company: "Grupo Doco",
			posProfile: "Doco Ventas",
			server: PAYLOAD,
		});

		expect(input.catalogue).toMatchObject({
			warehouse: "Mostrador - GD",
			priceList: "Standard Selling",
			pricedItems: 5328,
		});
		expect(input.contract?.mode).toBe("Venta al mostrador");
		expect(input.fiscal).toMatchObject({ taxTemplate: "IVA 16% - GD", stampingEnabled: true });
		expect(input.formats?.ticketFormat).toBe("Ticket 80mm");
	});

	it("fills the gaps it does not carry rather than blanking them", async () => {
		offline.getOpeningStorage.mockReturnValue({
			pos_profile: CACHED_PROFILE,
			capability_profile: null,
		});

		const input = await collectReadinessInput({ posProfile: "Doco Ventas", server: PAYLOAD });

		// emc's three, untouched by the server and still reported as unknown
		// rather than resolved to something this app cannot see.
		expect(input.fiscal).toMatchObject({ cfdiVersion: null, regime: null });
		// And points 6, 9 and 10 are never in the payload at all.
		expect(input.devices?.length).toBeGreaterThan(0);
		expect(input.floor).toBeDefined();
	});

	it("changes NOTHING when the server never answered — offline apertura as today", async () => {
		offline.getOpeningStorage.mockReturnValue({
			pos_profile: CACHED_PROFILE,
			capability_profile: { name: "Modo viejo" },
		});

		const offlineInput = await collectReadinessInput({ posProfile: "Doco Ventas" });
		const refusedInput = await collectReadinessInput({
			posProfile: "Doco Ventas",
			server: null,
		});

		expect(refusedInput.catalogue).toEqual(offlineInput.catalogue);
		expect(refusedInput.catalogue?.warehouse).toBe("Bodega vieja");
		expect(refusedInput.tenders).toBeUndefined();
		expect(refusedInput.testSale).toBeUndefined();
	});

	it("stops the opening on a warehouse the server says cannot sell", async () => {
		// The judgement no payload could carry: a group node, a disabled
		// warehouse and another company's all look like a working one by name.
		const verdict = evaluateReadiness(
			await collectReadinessInput({
				posProfile: "Doco Ventas",
				server: {
					...PAYLOAD,
					catalogue: {
						warehouse: "Almacenes - GD",
						price_list: "Standard Selling",
						warehouse_sells: false,
						priced_items: 5328,
					},
				},
			}),
		);

		const check = verdict.checks.find((c) => c.id === "warehouseAndPriceList");
		expect(check?.outcome).toBe("stop");
		expect(check?.subjects).toEqual(["Almacenes - GD"]);
		expect(verdict.canOpen).toBe(false);
	});

	it("stops on a ticket format the profile names and the tenant no longer has", async () => {
		const verdict = evaluateReadiness(
			await collectReadinessInput({
				posProfile: "Doco Ventas",
				server: {
					...PAYLOAD,
					formats: {
						ticket_format: "Ticket 58 mm",
						ticket_format_exists: false,
						return_note_format: null,
						cfdi_pdf: true,
					},
				},
			}),
		);

		const check = verdict.checks.find((c) => c.id === "documentFormats");
		expect(check?.outcome).toBe("stop");
		expect(check?.subjects).toEqual(["Ticket 58 mm"]);
	});

	it("warns, and does not wall, a register with no test sale on record", async () => {
		const verdict = evaluateReadiness(
			await collectReadinessInput({
				posProfile: "Doco Ventas",
				server: {
					...PAYLOAD,
					test_sale: { performed: false, reverted_on: null, reversal: null },
				},
			}),
		);

		expect(verdict.checks.find((c) => c.id === "testSale")?.outcome).toBe("warn");
		expect(verdict.canOpen).toBe(true);
	});

	it("survives a payload of the wrong shape rather than taking the screen down", async () => {
		const input = await collectReadinessInput({
			posProfile: "Doco Ventas",
			server: { tenders: { accounts_reported: true } } as any,
		});

		// A `rows` that is not an array is not a tender list, so the point stays
		// unverified — never an empty list, which would FAIL the check.
		expect(input.tenders).toBeUndefined();
	});
});
