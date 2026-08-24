// @vitest-environment jsdom

/**
 * `OpeningReadiness.vue` — the Apertura panel (build plan §12 A).
 *
 * The verdict itself is proved in `tests/readinessVerdict.spec.ts` against
 * plain objects. This suite only asks the questions a render can answer and a
 * pure module cannot: that all ten points reach the screen in the artboard's
 * order carrying their findings, that an optional failure is MARKED optional,
 * that a required failure puts its reason on screen, and that the verdict the
 * dialog gates on is the one the panel computed.
 *
 * The verdict listener is a PROP, not `wrapper.emitted()`: VTU does not record
 * component emits in this repo (build plan §10, found the hard way three
 * times).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import type { ReadinessInput } from "../src/posapp/components/pos/shift/openingReadiness";

const collectReadinessInput = vi.fn<[], Promise<ReadinessInput>>();

vi.mock("../src/posapp/components/pos/shift/readinessSnapshot", () => ({
	collectReadinessInput: (...args: unknown[]) =>
		(collectReadinessInput as unknown as (..._a: unknown[]) => Promise<ReadinessInput>)(
			...args,
		),
}));

/**
 * The server probe is mocked away here and answers NOTHING, so every case
 * below is exactly the input the collector was handed. What the probe itself
 * does — one call per register, never retried on refusal, never landing
 * register A's answer under register B — is `aperturaReadinessProbe.spec.ts`'s
 * subject, and left unmocked this suite would be making real `frappe.call`s
 * that only happen to fail.
 */
vi.mock("../src/posapp/services/openingReadinessService", () => ({
	fetchOpeningReadiness: vi.fn(async () => null),
	serverReadinessInput: () => null,
}));

import OpeningReadiness from "../src/posapp/components/pos/shift/OpeningReadiness.vue";

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
	formats: { ticketFormat: "Ticket 58 mm", cfdiPdf: true },
	devices: [{ id: "printer", labelKey: "Ticket printer", state: "ready", detail: "58 mm" }],
	people: { cashier: "Jenni Robledo", sellerCount: 2, authorisers: ["Rosa Elena"] },
	testSale: { performed: true, revertedOn: "14 de agosto" },
	offline: { missingPrerequisites: [], cacheBytes: 18 * 1024 * 1024 },
	floor: { openShift: false, hungDrafts: 0, pendingUploads: 0 },
};

const ARTBOARD_ORDER = [
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

async function mountPanel(input: ReadinessInput, onVerdict = vi.fn()) {
	collectReadinessInput.mockResolvedValue(input);
	const wrapper = mount(OpeningReadiness, {
		props: {
			company: "Doco Mexico",
			posProfile: "Doco Ventas",
			paymentRows: [],
			onVerdict,
		},
	});
	// One tick for the collector's promise, one for the re-render it triggers.
	await nextTick();
	await nextTick();
	await nextTick();
	return wrapper;
}

const rows = (wrapper: ReturnType<typeof mount>) =>
	wrapper.findAll("[data-testid^='readiness-check-']");

describe("the Apertura panel", () => {
	beforeEach(() => {
		collectReadinessInput.mockReset();
	});

	it("renders all ten points, numbered, in the artboard's order", async () => {
		const wrapper = await mountPanel(HEALTHY);
		const found = rows(wrapper);
		expect(found).toHaveLength(10);
		expect(
			found.map((row) => row.attributes("data-testid")?.replace("readiness-check-", "")),
		).toEqual(ARTBOARD_ORDER);
		expect(found.map((row) => row.find(".opening-readiness__n").text())).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
			"8",
			"9",
			"10",
		]);
	});

	it("gives every point its finding, not just a tick", async () => {
		const wrapper = await mountPanel(HEALTHY);
		for (const row of rows(wrapper)) {
			const detail = row.find("[data-testid='readiness-detail']").text();
			expect(detail, `${row.attributes("data-testid")} rendered no finding`).not.toBe("");
		}
		// The findings are the artboard's, resolved from real values rather than
		// left as `{0}` placeholders.
		const text = wrapper.text();
		expect(text).toContain("Mostrador");
		expect(text).toContain("1482");
		expect(text).toContain("Efectivo");
	});

	it("marks an optional failure as optional and still lets the register open", async () => {
		const onVerdict = vi.fn();
		const wrapper = await mountPanel(
			{
				...HEALTHY,
				devices: [
					{
						id: "customerDisplay",
						labelKey: "Customer display",
						state: "failed",
						detail: "la pantalla del cliente no responde",
					},
				],
			},
			onVerdict,
		);

		const devices = wrapper.find("[data-testid='readiness-check-devices']");
		expect(devices.attributes("data-outcome")).toBe("warn");
		expect(devices.attributes("data-severity")).toBe("optional");
		expect(devices.text()).toContain("Optional");
		expect(devices.text()).toContain("la pantalla del cliente no responde");

		expect(wrapper.find("[data-testid='readiness-blocked']").exists()).toBe(false);
		expect(onVerdict).toHaveBeenCalled();
		expect(onVerdict.mock.calls.at(-1)?.[0].canOpen).toBe(true);
	});

	it("puts the reason on screen when a required check stops the opening", async () => {
		const onVerdict = vi.fn();
		const wrapper = await mountPanel(
			{
				...HEALTHY,
				tenders: {
					accountsReported: true,
					rows: [
						{ mode: "Efectivo", account: "Caja - DM" },
						{ mode: "Monedero", account: "" },
					],
				},
			},
			onVerdict,
		);

		const tender = wrapper.find("[data-testid='readiness-check-tenderAccounts']");
		expect(tender.attributes("data-outcome")).toBe("stop");
		expect(tender.attributes("data-severity")).toBe("required");

		const blocked = wrapper.find("[data-testid='readiness-blocked']");
		expect(blocked.exists()).toBe(true);
		// Naming the tender is the point: "something is wrong" is not actionable
		// at a counter with a queue.
		expect(blocked.text()).toContain("Monedero");
		expect(onVerdict.mock.calls.at(-1)?.[0].canOpen).toBe(false);
	});

	it("shows unverified points as unverified, never as ticked", async () => {
		const wrapper = await mountPanel({});
		const found = rows(wrapper);
		expect(found).toHaveLength(10);
		expect(found.every((row) => row.attributes("data-outcome") === "unknown")).toBe(true);
		expect(wrapper.text()).toContain("Not verified");
		expect(wrapper.find("[data-testid='readiness-summary']").text()).toContain("0 of 10");
		// Ten unverified points are not ten reasons to keep the shop shut.
		expect(wrapper.find("[data-testid='readiness-blocked']").exists()).toBe(false);
	});

	it("summarises earned passes, warnings and unverified points separately", async () => {
		const wrapper = await mountPanel({
			...HEALTHY,
			testSale: null,
			devices: [{ id: "printer", labelKey: "Ticket printer", state: "failed" }],
		});
		const summary = wrapper.find("[data-testid='readiness-summary']").text();
		expect(summary).toContain("8 of 10");
		expect(summary).toContain("1 optional");
		expect(summary).toContain("1 not verified");
	});

	it("survives a collector that throws, as ten unverified points", async () => {
		const onVerdict = vi.fn();
		collectReadinessInput.mockRejectedValue(new Error("cache is gone"));
		const wrapper = mount(OpeningReadiness, {
			props: { company: "Doco", posProfile: "Doco Ventas", onVerdict },
		});
		await nextTick();
		await nextTick();
		await nextTick();

		expect(rows(wrapper)).toHaveLength(10);
		expect(onVerdict.mock.calls.at(-1)?.[0].canOpen).toBe(true);
		expect(onVerdict.mock.calls.at(-1)?.[0].verified).toBe(0);
	});

	it("re-checks when the cashier changes register", async () => {
		const wrapper = await mountPanel(HEALTHY);
		expect(collectReadinessInput).toHaveBeenCalledTimes(1);

		collectReadinessInput.mockResolvedValue({});
		await wrapper.setProps({ posProfile: "Doco Taller" });
		await nextTick();
		await nextTick();

		expect(collectReadinessInput).toHaveBeenCalledTimes(2);
		expect(collectReadinessInput.mock.calls.at(-1)?.[0]).toMatchObject({
			posProfile: "Doco Taller",
		});
	});
});
