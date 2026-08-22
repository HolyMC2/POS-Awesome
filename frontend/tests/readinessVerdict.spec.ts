/**
 * The ten-point readiness check, and the rule that decides what each answer
 * costs (roadmap §5.1, build plan §12 A, artboard `Apertura.dc.html`).
 *
 * This is the suite with money behind it. A register that opens with a payment
 * method missing its accounting account takes cash it cannot post, and the
 * only thing standing between that and a shop floor is the required/optional
 * split asserted below. So the split is not tested by "it works" — it is
 * tested by name, by inversion, and by the three ways a wrong answer could
 * reach a cashier:
 *
 *   1. a required failure that does NOT stop the opening;
 *   2. an optional failure that DOES;
 *   3. an unverified point that renders as verified.
 *
 * No jsdom, no mount, no tenant: `openingReadiness.ts` is pure, which is the
 * entire reason it is a module rather than a computed property.
 */
import { describe, expect, it } from "vitest";

import {
	READINESS_CHECKS,
	evaluateReadiness,
	outcomeFor,
	type ReadinessCheckId,
	type ReadinessInput,
	type ReadinessSeverity,
	type ReadinessState,
} from "../src/posapp/components/pos/shift/openingReadiness";

/**
 * The artboard's ten, in its order. Pinned as data rather than derived from
 * the module, so a reordering or a quietly dropped point fails here instead of
 * agreeing with itself.
 */
const ARTBOARD_ORDER: ReadinessCheckId[] = [
	"modeAndBranch",
	"warehouseAndPriceList",
	"fiscalPosture",
	"tenderAccounts",
	"documentFormats",
	"devices",
	"peopleAndAuthority",
	"testSale",
	"offlineReady",
	"floorClear",
];

/**
 * The four the design names in so many words — *"Una caja no abre si a una
 * forma de pago le falta cuenta, si el almacén no sirve para vender, si falta
 * el formato del ticket o si al giro le faltan datos"* — plus `floorClear`,
 * which is required because the SERVER already refuses a second open shift.
 */
const REQUIRED: ReadinessCheckId[] = [
	"modeAndBranch",
	"warehouseAndPriceList",
	"tenderAccounts",
	"documentFormats",
	"floorClear",
];

/** Everything that is fully configured and verifiable — an all-green register. */
const HEALTHY: ReadinessInput = {
	contract: {
		status: "resolved",
		mode: "Venta al mostrador",
		giro: "Celulares y accesorios",
		company: "Doco Mexico",
	},
	catalogue: { warehouse: "Mostrador", priceList: "Lista Mostrador", pricedItems: 1482 },
	fiscal: { stampingEnabled: true, taxTemplate: "IVA 16%", taxRate: 16 },
	tenders: {
		accountsReported: true,
		rows: [
			{ mode: "Efectivo", account: "Caja - DM" },
			{ mode: "Tarjeta", account: "Bancos - DM" },
		],
	},
	formats: { ticketFormat: "Ticket 58 mm", returnNoteFormat: "Nota de devolución", cfdiPdf: true },
	devices: [
		{ id: "printer", labelKey: "Ticket printer", state: "ready", detail: "58 mm" },
		{ id: "customerDisplay", labelKey: "Customer display", state: "ready" },
	],
	people: { cashier: "Jenni Robledo", sellerCount: 2, authorisers: ["Rosa Elena"] },
	testSale: { performed: true, revertedOn: "14 de agosto" },
	offline: { missingPrerequisites: [], cacheBytes: 18 * 1024 * 1024 },
	floor: { openShift: false, hungDrafts: 0, pendingUploads: 0 },
};

const resultFor = (input: ReadinessInput, id: ReadinessCheckId) => {
	const found = evaluateReadiness(input).checks.find((check) => check.id === id);
	if (!found) throw new Error(`no result for ${id}`);
	return found;
};

describe("the ten points", () => {
	it("renders all ten in the artboard's order, whatever the input", () => {
		for (const input of [{}, HEALTHY, { contract: null, tenders: null }]) {
			const verdict = evaluateReadiness(input as ReadinessInput);
			expect(verdict.checks.map((check) => check.id)).toEqual(ARTBOARD_ORDER);
			expect(verdict.checks.map((check) => check.order)).toEqual([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
			]);
		}
	});

	it("numbers each point exactly once", () => {
		const ids = READINESS_CHECKS.map((check) => check.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.length).toBe(10);
	});

	it("passes every point on a fully configured register", () => {
		const verdict = evaluateReadiness(HEALTHY);
		expect(verdict.verified).toBe(10);
		expect(verdict.canOpen).toBe(true);
		expect(verdict.stops).toEqual([]);
		expect(verdict.warnings).toEqual([]);
		expect(verdict.unknowns).toEqual([]);
		expect(verdict.blockingIssues).toBe(0);
	});

	it("carries a finding on every row, not only on the failures", () => {
		for (const check of evaluateReadiness(HEALTHY).checks) {
			expect(check.detailKey, `${check.id} rendered no finding`).not.toBe("");
		}
	});
});

describe("required vs optional — the split with money behind it", () => {
	it("classifies each of the ten by name", () => {
		const actual = Object.fromEntries(
			READINESS_CHECKS.map((check) => [check.id, check.severity]),
		) as Record<ReadinessCheckId, ReadinessSeverity>;

		expect(actual).toEqual({
			modeAndBranch: "required",
			warehouseAndPriceList: "required",
			fiscalPosture: "optional",
			tenderAccounts: "required",
			documentFormats: "required",
			devices: "optional",
			peopleAndAuthority: "optional",
			testSale: "optional",
			offlineReady: "optional",
			floorClear: "required",
		});
	});

	/**
	 * The mutation test. Inverting one severity must break the gate for THAT
	 * check and be named — a suite that only asserts the table above would pass
	 * just as happily with the table and the behaviour both wrong.
	 */
	it("fails by name when a severity is inverted", () => {
		const failing: Record<ReadinessCheckId, ReadinessInput> = {
			modeAndBranch: { contract: { status: "invalid" } },
			warehouseAndPriceList: { catalogue: { warehouse: "", priceList: "" } },
			fiscalPosture: { fiscal: { stampingEnabled: true, taxTemplate: "" } },
			tenderAccounts: {
				tenders: { accountsReported: true, rows: [{ mode: "Efectivo", account: "" }] },
			},
			documentFormats: { formats: { ticketFormat: "" } },
			devices: {
				devices: [{ id: "printer", labelKey: "Ticket printer", state: "failed" }],
			},
			peopleAndAuthority: { people: { cashier: "Jenni", authorisers: [] } },
			testSale: { testSale: { performed: false } },
			offlineReady: { offline: { missingPrerequisites: ["items_cache_ready"] } },
			floorClear: { floor: { openShift: true } },
		};

		for (const check of READINESS_CHECKS) {
			const input = failing[check.id];
			const result = resultFor(input, check.id);

			// The input has to actually fail, or the inversion below proves nothing.
			expect(result.state, `${check.id}: fixture did not fail the check`).toBe("fail");

			const inverted: ReadinessSeverity =
				check.severity === "required" ? "optional" : "required";

			expect(
				outcomeFor("fail", check.severity),
				`${check.id} is ${check.severity}, so a failure must ${
					check.severity === "required" ? "STOP" : "WARN"
				}`,
			).toBe(check.severity === "required" ? "stop" : "warn");

			expect(
				outcomeFor("fail", inverted),
				`${check.id}: inverting its severity must change what a failure costs`,
			).not.toBe(outcomeFor("fail", check.severity));

			expect(evaluateReadiness(input).canOpen, `${check.id} gated the wrong way`).toBe(
				check.severity !== "required",
			);
		}
	});

	it("agrees with the required list, so a promotion has to be deliberate", () => {
		const required = READINESS_CHECKS.filter((check) => check.severity === "required").map(
			(check) => check.id,
		);
		expect(required.sort()).toEqual([...REQUIRED].sort());
	});
});

describe("the verdict rule", () => {
	it("maps every state × severity pair", () => {
		const states: ReadinessState[] = ["pass", "fail", "unknown"];
		const table = states.flatMap((state) =>
			(["required", "optional"] as ReadinessSeverity[]).map(
				(severity) => `${severity}.${state}=${outcomeFor(state, severity)}`,
			),
		);
		expect(table).toEqual([
			"required.pass=pass",
			"optional.pass=pass",
			"required.fail=stop",
			"optional.fail=warn",
			"required.unknown=unknown",
			"optional.unknown=unknown",
		]);
	});

	it("never lets an unknown read as a pass, at either severity", () => {
		for (const severity of ["required", "optional"] as ReadinessSeverity[]) {
			expect(outcomeFor("unknown", severity)).not.toBe("pass");
			expect(outcomeFor("unknown", severity)).not.toBe("stop");
		}
	});
});

describe("the gate", () => {
	it("stops the opening on a failed REQUIRED check, with the reason", () => {
		const verdict = evaluateReadiness({
			...HEALTHY,
			tenders: {
				accountsReported: true,
				rows: [
					{ mode: "Efectivo", account: "Caja - DM" },
					{ mode: "Monedero", account: "" },
				],
			},
		});
		expect(verdict.canOpen).toBe(false);
		expect(verdict.blockingIssues).toBe(1);
		expect(verdict.stops.map((stop) => stop.id)).toEqual(["tenderAccounts"]);
		// The reason has to name the tender, or the cashier is told "something
		// is wrong" and has nothing to act on.
		expect(verdict.stops[0]?.subjects).toEqual(["Monedero"]);
		expect(verdict.stops[0]?.detailParams).toContain("Monedero");
	});

	it("lets the cashier through a failed OPTIONAL check, and warns", () => {
		const verdict = evaluateReadiness({
			...HEALTHY,
			devices: [
				{ id: "printer", labelKey: "Ticket printer", state: "ready", detail: "58 mm" },
				{
					id: "customerDisplay",
					labelKey: "Customer display",
					state: "failed",
					detail: "la pantalla del cliente no responde",
				},
			],
		});
		expect(verdict.canOpen).toBe(true);
		expect(verdict.blockingIssues).toBe(0);
		expect(verdict.warnings.map((warning) => warning.id)).toEqual(["devices"]);
		expect(verdict.verified).toBe(9);
	});

	it("does not block a register whose checks could not be evaluated", () => {
		const verdict = evaluateReadiness({});
		expect(verdict.canOpen).toBe(true);
		expect(verdict.unknowns).toHaveLength(10);
		// The point of the whole module: not one of them counts as verified.
		expect(verdict.verified).toBe(0);
		expect(verdict.checks.every((check) => check.outcome === "unknown")).toBe(true);
	});

	it("counts only earned passes towards the summary", () => {
		const verdict = evaluateReadiness({
			...HEALTHY,
			testSale: null,
			offline: null,
			devices: [
				{ id: "printer", labelKey: "Ticket printer", state: "failed", detail: "no responde" },
			],
		});
		expect(verdict.verified).toBe(7);
		expect(verdict.unknowns.map((unknown) => unknown.id)).toEqual([
			"testSale",
			"offlineReady",
		]);
		expect(verdict.warnings.map((warning) => warning.id)).toEqual(["devices"]);
		expect(verdict.verified + verdict.warnings.length + verdict.unknowns.length).toBe(10);
	});

	it("stops on every required failure at once rather than the first", () => {
		const verdict = evaluateReadiness({
			contract: { status: "invalid" },
			catalogue: { warehouse: "", priceList: "" },
			formats: { ticketFormat: "" },
			tenders: { accountsReported: true, rows: [] },
			floor: { openShift: true },
		});
		expect(verdict.canOpen).toBe(false);
		expect(verdict.blockingIssues).toBe(5);
		expect(verdict.stops.map((stop) => stop.id)).toEqual(REQUIRED);
	});
});

describe("point 4 — payment methods and their accounts", () => {
	it("is UNKNOWN, never a pass, while the payload carries no account", () => {
		const result = resultFor(
			{
				tenders: {
					accountsReported: false,
					rows: [{ mode: "Efectivo" }, { mode: "Tarjeta" }],
				},
			},
			"tenderAccounts",
		);
		expect(result.state).toBe("unknown");
		expect(result.outcome).toBe("unknown");
		expect(result.subjects).toEqual(["Efectivo", "Tarjeta"]);
	});

	it("counts the ones that DO post, the artboard's '4 de 4'", () => {
		const result = resultFor(
			{
				tenders: {
					accountsReported: true,
					rows: [
						{ mode: "Efectivo", account: "Caja - DM" },
						{ mode: "Tarjeta", account: "Bancos - DM" },
						{ mode: "Transferencia", account: "Bancos - DM" },
						{ mode: "Monedero", account: "Monedero - DM" },
					],
				},
			},
			"tenderAccounts",
		);
		expect(result.state).toBe("pass");
		expect(result.detailParams).toContain(4);
	});

	it("fails a register that offers no tender at all", () => {
		const result = resultFor(
			{ tenders: { accountsReported: true, rows: [] } },
			"tenderAccounts",
		);
		expect(result.state).toBe("fail");
		expect(result.outcome).toBe("stop");
	});

	it("treats a blank account as missing, not as an account named ''", () => {
		for (const account of ["", "   ", null, undefined]) {
			const result = resultFor(
				{
					tenders: {
						accountsReported: true,
						rows: [{ mode: "Efectivo", account: account as string | null }],
					},
				},
				"tenderAccounts",
			);
			expect(result.state, `account=${JSON.stringify(account)}`).toBe("fail");
		}
	});
});

describe("the other nine findings", () => {
	it("point 1 passes an unconfigured preset — that is the shipped register", () => {
		const result = resultFor(
			{ contract: { status: "unconfigured", company: "Doco Mexico" } },
			"modeAndBranch",
		);
		expect(result.state).toBe("pass");
	});

	it("point 1 stops an invalid capability profile, which the server also refuses", () => {
		expect(resultFor({ contract: { status: "invalid" } }, "modeAndBranch").outcome).toBe(
			"stop",
		);
	});

	it("point 2 states the price count only when it was counted", () => {
		const counted = resultFor(
			{ catalogue: { warehouse: "Mostrador", priceList: "Lista", pricedItems: 1482 } },
			"warehouseAndPriceList",
		);
		expect(counted.detailParams).toContain(1482);

		const uncounted = resultFor(
			{ catalogue: { warehouse: "Mostrador", priceList: "Lista", pricedItems: null } },
			"warehouseAndPriceList",
		);
		expect(uncounted.state).toBe("pass");
		expect(uncounted.detailKey).toContain("not counted");
	});

	it("point 2 does not fail an empty catalogue — that is a device fact, not a fault", () => {
		const result = resultFor(
			{ catalogue: { warehouse: "Mostrador", priceList: "Lista", pricedItems: 0 } },
			"warehouseAndPriceList",
		);
		expect(result.state).toBe("pass");
	});

	it("point 2 names which of the two is missing", () => {
		expect(
			resultFor({ catalogue: { warehouse: "", priceList: "Lista" } }, "warehouseAndPriceList")
				.subjects,
		).toEqual(["warehouse"]);
		expect(
			resultFor({ catalogue: { warehouse: "Mostrador", priceList: "" } }, "warehouseAndPriceList")
				.subjects,
		).toEqual(["priceList"]);
	});

	it("point 3 fails stamping-on-with-no-tax-template, and only that", () => {
		expect(
			resultFor({ fiscal: { stampingEnabled: true, taxTemplate: "" } }, "fiscalPosture").state,
		).toBe("fail");
		// Stamping off and no template is an exento shop or a misconfigured one,
		// and nothing here can tell them apart.
		expect(
			resultFor({ fiscal: { stampingEnabled: false, taxTemplate: "" } }, "fiscalPosture").state,
		).toBe("unknown");
	});

	it("point 3 renders the rate when the cached template carried one", () => {
		const withRate = resultFor(
			{ fiscal: { stampingEnabled: true, taxTemplate: "IVA 16%", taxRate: 16 } },
			"fiscalPosture",
		);
		expect(withRate.detailParams).toContain(16);

		const withoutRate = resultFor(
			{ fiscal: { stampingEnabled: true, taxTemplate: "IVA 16%", taxRate: null } },
			"fiscalPosture",
		);
		expect(withoutRate.state).toBe("pass");
		expect(withoutRate.detailKey).toContain("not read");
	});

	it("point 5 stops only on the ticket format, the one §5.1 names", () => {
		expect(resultFor({ formats: { ticketFormat: "" } }, "documentFormats").outcome).toBe("stop");
		expect(
			resultFor(
				{ formats: { ticketFormat: "Ticket 58 mm", returnNoteFormat: null, cfdiPdf: false } },
				"documentFormats",
			).state,
		).toBe("pass");
	});

	it("point 6 does not call a device ready just because it is configured", () => {
		const result = resultFor(
			{
				devices: [
					{ id: "scanner", labelKey: "Scanner", state: "unverifiable" },
					{ id: "drawer", labelKey: "Cash drawer", state: "unverifiable" },
				],
			},
			"devices",
		);
		expect(result.state).toBe("unknown");
		expect(result.subjects).toEqual(["scanner", "drawer"]);
	});

	it("point 6 names the device that failed, as the artboard does", () => {
		const result = resultFor(
			{
				devices: [
					{ id: "printer", labelKey: "Ticket printer", state: "ready" },
					{
						id: "customerDisplay",
						labelKey: "Customer display",
						state: "failed",
						detail: "la pantalla del cliente no responde",
					},
					{ id: "scale", labelKey: "Scale", state: "unverifiable" },
				],
			},
			"devices",
		);
		expect(result.outcome).toBe("warn");
		expect(result.detailParams).toContain("la pantalla del cliente no responde");
		// One responded of two that could answer; the scale is not counted as a
		// failure for being unreachable.
		expect(result.detailParams?.slice(0, 2)).toEqual([1, 2]);
	});

	it("point 7 keeps 'roster not loaded' apart from 'nobody authorises'", () => {
		expect(
			resultFor({ people: { cashier: "Jenni", authorisers: null } }, "peopleAndAuthority")
				.state,
		).toBe("unknown");
		expect(
			resultFor({ people: { cashier: "Jenni", authorisers: [] } }, "peopleAndAuthority").state,
		).toBe("fail");
	});

	it("point 9 fails on a named missing prerequisite and passes on none", () => {
		const failed = resultFor(
			{ offline: { missingPrerequisites: ["items_cache_ready", "payment_methods"] } },
			"offlineReady",
		);
		expect(failed.state).toBe("fail");
		expect(failed.subjects).toEqual(["items_cache_ready", "payment_methods"]);
		expect(
			resultFor({ offline: { missingPrerequisites: [], cacheBytes: 0 } }, "offlineReady").state,
		).toBe("pass");
	});

	it("point 9 renders the cache size in MB, the artboard's 18", () => {
		const result = resultFor(
			{ offline: { missingPrerequisites: [], cacheBytes: 18 * 1024 * 1024 } },
			"offlineReady",
		);
		expect(result.detailParams).toEqual([18]);
	});

	it("point 10 stops on an open shift and stays unknown when nobody looked", () => {
		expect(resultFor({ floor: { openShift: true } }, "floorClear").outcome).toBe("stop");
		expect(resultFor({ floor: { openShift: undefined } }, "floorClear").state).toBe("unknown");
		expect(resultFor({ floor: { openShift: false } }, "floorClear").state).toBe("pass");
	});

	it("point 10 reports parked drafts and unsent tickets without stopping on them", () => {
		const result = resultFor(
			{ floor: { openShift: false, hungDrafts: 2, pendingUploads: 3 } },
			"floorClear",
		);
		expect(result.state).toBe("pass");
		expect(result.detailParams).toEqual([2, 3]);
	});
});
