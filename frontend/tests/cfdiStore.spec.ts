// @vitest-environment jsdom

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cfdiApi from "../src/posapp/api/cfdi";
import { useCfdiStore } from "../src/posapp/stores/cfdiStore";

const bootstrap = {
	enabled: true,
	company: "Doco",
	catalogs: {
		tax_regimes: [
			{ key: "601", description: "General de Ley Personas Morales" },
			{ key: "612", description: "PF con Actividades Empresariales" },
		],
		cfdi_uses: [
			{ key: "G03", description: "Gastos en general", tax_regimes: ["601", "612"] },
			{ key: "D01", description: "Honorarios médicos", tax_regimes: ["612"] },
			{ key: "S01", description: "Sin efectos fiscales", tax_regimes: [] },
		],
		payment_options: [{ key: "PUE", description: "Pago en una sola exhibición" }],
		payment_methods: [{ key: "01", description: "Efectivo" }],
	},
};

function makeDetail(overrides: Record<string, unknown> = {}) {
	return {
		invoice: {
			name: "ACC-SINV-0001",
			posting_date: "2026-08-11",
			grand_total: 116,
			currency: "MXN",
			docstatus: 1,
			is_return: 0,
			customer: "CUST-1",
			customer_name: "Cliente Uno",
			customer_address: "",
			mx_cfdi_use: "",
			mx_payment_option: "PUE",
			mx_payment_mode: "01",
			mode_of_payment: "Cash",
			mx_uuid: "",
			sat_status: "",
			stamp_error: "",
			is_stamped: false,
			...overrides,
		},
		customer_fiscal: {},
		preflight: { status: "Válido", blocking: false, checks: [] },
		files: {},
	};
}

describe("cfdiStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.restoreAllMocks();
	});

	it("filters uso CFDI options by régimen, keeping unrestricted rows", async () => {
		vi.spyOn(cfdiApi, "getCfdiBootstrap").mockResolvedValue(bootstrap as never);
		const store = useCfdiStore();
		await store.loadBootstrap("Doco Ventas");

		const for601 = store.usesForRegime("601").map((row) => row.key);
		expect(for601).toEqual(["G03", "S01"]);
		const forEmpty = store.usesForRegime("").map((row) => row.key);
		expect(forEmpty).toEqual(["G03", "D01", "S01"]);
	});

	it("bootstrap failures degrade to a disabled surface, not a crash", async () => {
		vi.spyOn(cfdiApi, "getCfdiBootstrap").mockRejectedValue(new Error("boom"));
		const store = useCfdiStore();
		await store.loadBootstrap("Doco Ventas");
		expect(store.enabled).toBe(false);
		expect(store.bootstrap?.reason).toBe("load_failed");
	});

	it("stamp success flips the open detail and the matching search row", async () => {
		const store = useCfdiStore();
		store.profileName = "Doco Ventas";
		store.detail = makeDetail() as never;
		store.rows = [
			{
				name: "ACC-SINV-0001",
				stamp_status: "unstamped",
				stamp_error: "was failing",
				mx_uuid: "",
			} as never,
		];
		vi.spyOn(cfdiApi, "stampInvoice").mockResolvedValue({
			ok: true,
			already_stamped: false,
			invoice: "ACC-SINV-0001",
			uuid: "UUID-1",
			files: { pdf: "ACC-SINV-0001_CFDI.pdf", xml: "ACC-SINV-0001_CFDI.xml" },
		} as never);

		const result = await store.stamp({ tax_id: "GODE561231GR8" });
		expect(result?.uuid).toBe("UUID-1");
		expect(store.stampPhase).toBe("success");
		expect(store.detail?.invoice.is_stamped).toBe(true);
		expect(store.detail?.invoice.mx_uuid).toBe("UUID-1");
		expect(store.rows[0]?.stamp_status).toBe("stamped");
		expect(store.rows[0]?.stamp_error).toBe("");
	});

	it("stamp failure surfaces the server message verbatim and stays recoverable", async () => {
		const store = useCfdiStore();
		store.profileName = "Doco Ventas";
		store.detail = makeDetail() as never;
		vi.spyOn(cfdiApi, "stampInvoice").mockRejectedValue({
			message: "CFDI40147 - El RFC del receptor no existe en la lista de RFC",
		});

		const result = await store.stamp({ tax_id: "GODE561231GR8" });
		expect(result).toBeNull();
		expect(store.stampPhase).toBe("error");
		expect(store.stampError).toContain("CFDI40147");
		expect(store.detail?.invoice.is_stamped).toBe(false);
	});

	it("ignores a second tap while a stamp is in flight", async () => {
		const store = useCfdiStore();
		store.profileName = "Doco Ventas";
		store.detail = makeDetail() as never;
		let resolveCall: (value: unknown) => void = () => {};
		const spy = vi.spyOn(cfdiApi, "stampInvoice").mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCall = resolve;
				}) as never,
		);

		const first = store.stamp({});
		const second = await store.stamp({});
		expect(second).toBeNull();
		expect(spy).toHaveBeenCalledTimes(1);

		resolveCall({
			ok: true,
			already_stamped: false,
			invoice: "ACC-SINV-0001",
			uuid: "UUID-2",
			files: {},
		});
		await first;
		expect(store.stampPhase).toBe("success");
	});
});
