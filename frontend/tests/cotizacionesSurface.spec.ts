// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import QuotationDetail from "../src/posapp/components/pos/flows/cotizaciones/QuotationDetail.vue";
import type {
	QuotationLine,
	QuotationRow,
} from "../src/posapp/components/pos/flows/cotizaciones/quotationModel";

/**
 * The Cotizaciones detail panel, mounted (artboard `Cotizacion.dc.html`).
 *
 * The panel is where the promises are made visible, so what it gets wrong is
 * visible too: a «CARGAR A LA VENTA» button live on a quotation somebody
 * already billed, or an expiry warning that says "prices may have changed"
 * without naming a number the cashier can repeat.
 *
 * The SURFACE's own guarantee — that it computes no price and re-asks the
 * server before loading — is exercised in `quotationConversion.spec.ts`
 * against the service layer, because proving it by mounting would mean
 * asserting on the absence of arithmetic.
 */

const currency = (value: number) => `$${Number(value).toFixed(2)}`;

const row = (overrides: Partial<QuotationRow> = {}): QuotationRow => ({
	name: "SAL-QTN-2026-00114",
	customer: "CUST-1",
	customer_name: "Fam. Zavala Ruiz",
	date: "2026-08-21",
	valid_till: "2026-08-28",
	total: 18450,
	estado: "active",
	days_left: 5,
	converted_invoice: null,
	converted_invoice_doctype: null,
	...overrides,
});

const line = (overrides: Partial<QuotationLine> = {}): QuotationLine => ({
	item_code: "SALA-GENOVA",
	item_name: "Sala modular Génova 3 pzas",
	qty: 1,
	uom: "Nos",
	rate: 14900,
	quoted_rate: 14900,
	today_rate: 14900,
	provenance: null,
	...overrides,
});

const detailProps = (overrides: Record<string, any> = {}) => ({
	row: row(),
	lines: [line()],
	loadingLines: false,
	loading: false,
	offline: false,
	expired: false,
	quotedTotal: 18450,
	todayTotal: 18450,
	formatCurrency: currency,
	...overrides,
});

const mountDetail = (overrides: Record<string, any> = {}) =>
	mount(QuotationDetail, {
		props: detailProps(overrides) as any,
		global: {
			// `components`, NOT `stubs`. Vuetify is not installed in this lane, so
			// `v-btn` never resolves — and `stubs` only REPLACES a component the
			// runtime could resolve. Under `stubs` every button rendered as an
			// empty comment node and the assertions below passed or failed on
			// selectors that matched nothing.
			components: {
				"v-btn": {
					props: ["disabled", "loading", "color", "size", "block", "variant"],
					emits: ["click"],
					template:
						'<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
				},
				"v-icon": { template: "<i />" },
			},
		},
	});

beforeEach(() => {
	setActivePinia(createPinia());
	(window as any).__ = (value: string, args?: any[]) =>
		args?.length
			? args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), value)
			: value;
});

describe("the detail panel", () => {
	it("says what to do when nothing is chosen", () => {
		const wrapper = mountDetail({ row: null });
		expect(wrapper.find('[data-testid="quotation-detail-empty"]').exists()).toBe(true);
	});

	it("prints the provenance only on the line whose price moved", () => {
		const wrapper = mountDetail({
			lines: [
				line({ provenance: { quoted_rate: 14900, today_rate: 15400 } }),
				line({ item_code: "MESA-NOGAL", provenance: null }),
			],
		});
		expect(wrapper.find('[data-testid="quotation-provenance-SALA-GENOVA"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="quotation-provenance-MESA-NOGAL"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="quotation-provenance-SALA-GENOVA"]').text()).toContain(
			"15400.00",
		);
	});

	it("names both totals when the quote expired", () => {
		const wrapper = mountDetail({
			row: row({ estado: "expired", days_left: -3 }),
			expired: true,
			quotedTotal: 149,
			todayTotal: 169,
		});
		const warning = wrapper.find('[data-testid="quotation-expiry-warning"]');
		expect(warning.exists()).toBe(true);
		expect(warning.text()).toContain("$149.00");
		expect(warning.text()).toContain("$169.00");
	});

	it("says the total is unchanged rather than printing it twice as a diff", () => {
		const wrapper = mountDetail({
			row: row({ estado: "expired", days_left: -1 }),
			expired: true,
			quotedTotal: 149,
			todayTotal: 149,
		});
		expect(wrapper.find('[data-testid="quotation-expiry-warning"]').text()).toContain(
			"the same",
		);
	});

	it("shows no expiry warning while the quote is honoured", () => {
		const wrapper = mountDetail();
		expect(wrapper.find('[data-testid="quotation-expiry-warning"]').exists()).toBe(false);
	});
});

describe("a converted quotation", () => {
	const converted = row({
		estado: "converted",
		converted_invoice: "ACC-SINV-2026-04791",
		converted_invoice_doctype: "Sales Invoice",
	});

	it("links the sale that already happened", () => {
		const wrapper = mountDetail({ row: converted });
		const notice = wrapper.find('[data-testid="quotation-converted-notice"]');
		expect(notice.exists()).toBe(true);
		expect(notice.text()).toContain("ACC-SINV-2026-04791");
	});

	it("cannot be loaded into a second sale", () => {
		const wrapper = mountDetail({ row: converted });
		expect(
			wrapper.find('[data-testid="quotation-load"]').attributes("disabled"),
		).toBeDefined();
	});

	it("hands the invoice link UP rather than navigating itself", async () => {
		// Asserted through a listener, not `wrapper.emitted()`: this repo has
		// been bitten before by VTU recording nothing for a `<script setup>`
		// component's emits (POS rail round, 08-22). A spy passed in as
		// `onOpenInvoice` is what a real parent receives, so it cannot pass
		// while the wiring is broken.
		const onOpenInvoice = vi.fn();
		const wrapper = mountDetail({ row: converted, onOpenInvoice });
		await wrapper.find('[data-testid="quotation-converted-notice"] button').trigger("click");
		expect(onOpenInvoice).toHaveBeenCalledTimes(1);
		expect(onOpenInvoice.mock.calls[0]?.[0]).toMatchObject({
			converted_invoice: "ACC-SINV-2026-04791",
		});
	});
});

describe("offline", () => {
	it("refuses the load, because the load mints a draft on the server", () => {
		const wrapper = mountDetail({ offline: true });
		expect(
			wrapper.find('[data-testid="quotation-load"]').attributes("disabled"),
		).toBeDefined();
	});

	it("refuses printing too — the format is rendered server-side", () => {
		const wrapper = mountDetail({ offline: true });
		expect(
			wrapper.find('[data-testid="quotation-print"]').attributes("disabled"),
		).toBeDefined();
	});
});

describe("«Extender vigencia»", () => {
	it("is present and asks rather than doing nothing", async () => {
		const onExtend = vi.fn();
		const wrapper = mountDetail({ onExtend });
		const chip = wrapper.find('[data-testid="quotation-extend"]');
		expect(chip.exists()).toBe(true);
		await chip.trigger("click");
		// The surface answers this with a toast naming the gap; the panel's job
		// is only to ask, and a chip that asked nobody would be the silent stub.
		expect(onExtend).toHaveBeenCalledTimes(1);
	});
});
