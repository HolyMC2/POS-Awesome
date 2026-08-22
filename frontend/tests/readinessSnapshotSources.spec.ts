/**
 * Where the ten answers actually come from (`readinessSnapshot.ts`).
 *
 * `openingReadiness.ts` is proved on plain objects; this suite proves the
 * three things about COLLECTING them that a plain object cannot show, and each
 * one is a way a wrong answer could reach a cashier:
 *
 *   1. the cached payload describes the register that opened here LAST, so
 *      describing register B's warehouse under register A's name is a live
 *      risk every time a cashier switches profile in the dialog;
 *   2. "the payload carries no account field" and "this tender has no account"
 *      are the same shape in JavaScript, and only one of them is a reason not
 *      to open;
 *   3. every source is a cache that can be absent, broken or mocked away, and
 *      none of them may take the opening screen down.
 *
 * No mount. The offline barrel and the print-health singleton are mocked
 * wholesale, which is also how they behave in several existing specs — see
 * `callIfFunction` in the module under test.
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

const rollup = { value: "unknown" };
vi.mock("../src/posapp/composables/core/usePrintHealthShared", () => ({
	usePrintHealthShared: () => ({ rollup }),
}));

import { collectReadinessInput } from "../src/posapp/components/pos/shift/readinessSnapshot";

const PROFILE = {
	name: "Doco Ventas",
	company: "Doco Mexico",
	warehouse: "Mostrador",
	selling_price_list: "Lista Mostrador",
	print_format: "Ticket 58 mm",
	taxes_and_charges: "IVA 16%",
	posa_cfdi_enable_stamping: 1,
	posa_silent_print: 1,
	posa_qz_printer_name: "EPSON TM-T20",
	applicable_for_users: [{ user: "jenni@doco.mx" }, { user: "rosa@doco.mx" }],
};

const cachedOpening = (overrides: Record<string, unknown> = {}) => ({
	pos_profile: PROFILE,
	capability_profile: { name: "Venta al mostrador", vertical: "Celulares y accesorios" },
	...overrides,
});

describe("collecting the readiness snapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		offline.getOpeningStorage.mockReturnValue(null);
		offline.getBootstrapSnapshot.mockReturnValue(null);
		offline.getCachedPriceListItems.mockReturnValue(null);
		offline.getTaxTemplate.mockReturnValue(null);
		offline.getCacheUsageEstimate.mockResolvedValue({ total: 0 });
		offline.getPendingOfflineInvoiceCount.mockReturnValue(0);
		offline.getWriteQueueDraftReviewCount.mockResolvedValue(0);
		rollup.value = "unknown";
	});

	it("reads the cached register when it is the one the cashier picked", async () => {
		offline.getOpeningStorage.mockReturnValue(cachedOpening());
		offline.getCachedPriceListItems.mockReturnValue(new Array(1482).fill({}));

		const input = await collectReadinessInput({
			company: "Doco Mexico",
			posProfile: "Doco Ventas",
		});

		expect(input.catalogue).toMatchObject({
			warehouse: "Mostrador",
			priceList: "Lista Mostrador",
			pricedItems: 1482,
		});
		expect(input.contract).toMatchObject({ status: "resolved", mode: "Venta al mostrador" });
		expect(input.formats).toMatchObject({ ticketFormat: "Ticket 58 mm" });
	});

	/** The one that would put register B's configuration under register A's name. */
	it("ignores the cached register when the cashier picked a different one", async () => {
		offline.getOpeningStorage.mockReturnValue(cachedOpening());

		const input = await collectReadinessInput({
			company: "Doco Mexico",
			posProfile: "Doco Taller",
		});

		expect(input.catalogue).toBeUndefined();
		expect(input.contract).toBeUndefined();
		expect(input.formats).toBeUndefined();
		expect(input.fiscal).toBeUndefined();
	});

	it("reports an invalid capability profile as invalid, not as missing", async () => {
		offline.getOpeningStorage.mockReturnValue(
			cachedOpening({ capability_profile: { resolution: { status: "invalid" } } }),
		);

		const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
		expect(input.contract?.status).toBe("invalid");
	});

	it("reports a register with no preset as unconfigured, which is a valid state", async () => {
		offline.getOpeningStorage.mockReturnValue(cachedOpening({ capability_profile: null }));

		const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
		expect(input.contract?.status).toBe("unconfigured");
	});

	describe("payment accounts", () => {
		const rows = [
			{ parent: "Doco Ventas", mode_of_payment: "Efectivo" },
			{ parent: "Doco Ventas", mode_of_payment: "Tarjeta" },
			{ parent: "Doco Taller", mode_of_payment: "Efectivo" },
		];

		it("says accounts were NOT reported when the payload has no such field", async () => {
			const input = await collectReadinessInput({
				posProfile: "Doco Ventas",
				paymentRows: rows,
			});
			expect(input.tenders?.accountsReported).toBe(false);
			// And only this register's rows.
			expect(input.tenders?.rows.map((row) => row.mode)).toEqual(["Efectivo", "Tarjeta"]);
		});

		it("says they WERE reported once the field ships, empty value included", async () => {
			const input = await collectReadinessInput({
				posProfile: "Doco Ventas",
				paymentRows: [
					{ parent: "Doco Ventas", mode_of_payment: "Efectivo", account: "Caja - DM" },
					{ parent: "Doco Ventas", mode_of_payment: "Monedero", account: "" },
				],
			});
			expect(input.tenders?.accountsReported).toBe(true);
			expect(input.tenders?.rows[1]).toMatchObject({ mode: "Monedero", account: "" });
		});

		it("accepts `default_account`, the name the child table would carry", async () => {
			const input = await collectReadinessInput({
				posProfile: "Doco Ventas",
				paymentRows: [
					{
						parent: "Doco Ventas",
						mode_of_payment: "Efectivo",
						default_account: "Caja - DM",
					},
				],
			});
			expect(input.tenders?.accountsReported).toBe(true);
			expect(input.tenders?.rows[0]?.account).toBe("Caja - DM");
		});

		it("refuses a half-reported payload rather than trusting the half it got", async () => {
			const input = await collectReadinessInput({
				posProfile: "Doco Ventas",
				paymentRows: [
					{ parent: "Doco Ventas", mode_of_payment: "Efectivo", account: "Caja - DM" },
					{ parent: "Doco Ventas", mode_of_payment: "Monedero" },
				],
			});
			expect(input.tenders?.accountsReported).toBe(false);
		});
	});

	describe("devices", () => {
		it("reports the printer only where the register prints through the tray", async () => {
			offline.getOpeningStorage.mockReturnValue(
				cachedOpening({ pos_profile: { ...PROFILE, posa_silent_print: 0 } }),
			);
			rollup.value = "ok";

			const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
			const printer = input.devices?.find((device) => device.id === "printer");
			// A browser-print register has no tray to be ready, and a false amber
			// on every one of them is how a warning colour stops being read.
			expect(printer?.state).toBe("unverifiable");
		});

		it("maps the print-health rollup rather than a websocket flag", async () => {
			offline.getOpeningStorage.mockReturnValue(cachedOpening());
			for (const [value, expected] of [
				["ok", "ready"],
				["warn", "failed"],
				["fail", "failed"],
				["unknown", "unverifiable"],
			] as const) {
				rollup.value = value;
				const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
				expect(
					input.devices?.find((device) => device.id === "printer")?.state,
					`rollup=${value}`,
				).toBe(expected);
			}
		});

		it("marks scanner, scale, drawer, terminal and display unverifiable, never ready", async () => {
			const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
			const blind = (input.devices || []).filter((device) => device.id !== "printer");
			expect(blind.map((device) => device.id)).toEqual([
				"scanner",
				"scale",
				"drawer",
				"terminal",
				"customerDisplay",
			]);
			expect(blind.every((device) => device.state === "unverifiable")).toBe(true);
		});
	});

	describe("the floor", () => {
		it("calls the floor clear only when the shift check actually cleared it", async () => {
			offline.getOpeningStorage.mockReturnValue(null);
			const cleared = await collectReadinessInput({ posProfile: "Doco Ventas" });
			expect(cleared.floor?.openShift).toBe(false);
		});

		it("stays unknown — never 'a shift is open' — when the check did not complete", async () => {
			offline.getOpeningStorage.mockReturnValue(cachedOpening());
			const unresolved = await collectReadinessInput({ posProfile: "Doco Ventas" });
			// A false positive here is a REQUIRED stop, which would wall a
			// register out of its own till over a failed network call.
			expect(unresolved.floor?.openShift).toBeUndefined();
		});

		it("carries parked drafts and unsent tickets", async () => {
			offline.getPendingOfflineInvoiceCount.mockReturnValue(3);
			offline.getWriteQueueDraftReviewCount.mockResolvedValue(2);
			const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
			expect(input.floor).toMatchObject({ hungDrafts: 2, pendingUploads: 3 });
		});
	});

	describe("offline readiness", () => {
		it("names the prerequisites that are not ready", async () => {
			offline.getBootstrapSnapshot.mockReturnValue({
				prerequisites: {
					pos_profile: "ready",
					items_cache_ready: "missing",
					payment_methods: "stale",
				},
			});
			offline.getCacheUsageEstimate.mockResolvedValue({ total: 18 * 1024 * 1024 });

			const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
			expect(input.offline?.missingPrerequisites).toEqual([
				"items_cache_ready",
				"payment_methods",
			]);
			expect(input.offline?.cacheBytes).toBe(18 * 1024 * 1024);
		});

		it("stays unmeasured when there is no snapshot, rather than claiming ready", async () => {
			offline.getBootstrapSnapshot.mockReturnValue(null);
			const input = await collectReadinessInput({ posProfile: "Doco Ventas" });
			expect(input.offline).toBeUndefined();
		});
	});

	it("never throws, whatever the caches do", async () => {
		offline.getOpeningStorage.mockImplementation(() => {
			throw new Error("IndexedDB is gone");
		});
		offline.getBootstrapSnapshot.mockImplementation(() => {
			throw new Error("still gone");
		});
		offline.getWriteQueueDraftReviewCount.mockRejectedValue(new Error("and gone"));

		await expect(
			collectReadinessInput({ company: "Doco", posProfile: "Doco Ventas" }),
		).resolves.toBeTruthy();
	});

	it("makes no server call — the opening screen is not the place for one", async () => {
		const fetchSpy = vi.fn();
		(globalThis as any).fetch = fetchSpy;
		(globalThis as any).frappe = { call: vi.fn(), session: { user_fullname: "Jenni Robledo" } };

		const input = await collectReadinessInput({ posProfile: "Doco Ventas" });

		expect(fetchSpy).not.toHaveBeenCalled();
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
		expect(input.people?.cashier).toBe("Jenni Robledo");
		// The supervisor roster is a call this screen refuses to make.
		expect(input.people?.authorisers).toBeNull();
	});
});
