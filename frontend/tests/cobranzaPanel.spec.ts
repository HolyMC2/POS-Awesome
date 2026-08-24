// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import CobranzaDetail from "../src/posapp/components/pos/payments/cobranza/CobranzaDetail.vue";
import {
	defaultTab,
	describeDue,
	describeTabs,
	emptyStateKey,
	estadoChip,
	matchesCollectedQuery,
	matchesQuery,
	reminderChip,
	type CollectedRow,
	type ReceivableRow,
} from "../src/posapp/components/pos/payments/cobranza/receivablesModel";

/**
 * The Cobranza panel (COBRANZA_GOLDEN_FLOW, artboard `Cobranza.dc.html`).
 *
 * The premise being defended is that the WORKLIST is the surface and search is
 * a refinement of it — the owner's complaint about the tool this replaced was
 * "you have to manually search each time". Everything below is one of the ways
 * that promise can quietly stop being true: landing on an empty tab beside a
 * full one, a search box that filters to nothing without saying why, a chip
 * that reports the calendar when the money is the story, or a monedero chip
 * that reads «$0» on every customer until cashiers stop looking at it.
 *
 * The rows are fixtures shaped exactly as `get_receivables` returns them,
 * `aging` and `estado` included: the server computes both (its clock is the
 * one that is right), and a client-side recomputation here would test an
 * opinion this surface is not allowed to hold.
 */

const currency = (value: number) => `$${Number(value).toFixed(2)}`;

const row = (overrides: Partial<ReceivableRow> = {}): ReceivableRow => ({
	name: "ACC-SINV-2026-04711",
	doctype: "Sales Invoice",
	customer: "CUST-0007",
	customer_name: "Taller Los Pinos",
	date: "2026-07-20",
	due: "2026-07-31",
	total: 4980,
	outstanding: 2490,
	paid: 2490,
	currency: "MXN",
	outstanding_currency: "MXN",
	pos_profile: "Doco Ventas",
	aging: "overdue",
	days_until_due: -24,
	estado: "apartado",
	...overrides,
});

const collected = (overrides: Partial<CollectedRow> = {}): CollectedRow => ({
	name: "ACC-PAY-2026-00310",
	party: "CUST-0007",
	party_name: "Taller Los Pinos",
	party_type: "Customer",
	mode_of_payment: "Efectivo",
	reference_no: "TURNO-14",
	date: "2026-08-24",
	amount: 1500,
	currency: "MXN",
	tendered_amount: 1500,
	tendered_currency: "MXN",
	...overrides,
});

const detailProps = (overrides: Record<string, any> = {}) => ({
	row: row(),
	contact: {
		customer: "CUST-0007",
		customer_name: "Taller Los Pinos",
		phone: "5541286370",
		email: null,
	},
	lines: [
		{ item_code: "MICA-9H", item_name: "Mica 9H", qty: 2, uom: "Nos", rate: 120, amount: 240 },
	],
	payments: [
		{
			name: "ACC-PAY-2026-00220",
			date: "2026-08-12",
			mode_of_payment: "Efectivo",
			reference_no: null,
			amount: 1500,
		},
	],
	lineCount: 1,
	storeCredit: null,
	loadingDetail: false,
	collecting: false,
	offline: false,
	reminderState: "idle" as const,
	formatCurrency: currency,
	...overrides,
});

const mountDetail = (overrides: Record<string, any> = {}) =>
	mount(CobranzaDetail, {
		props: detailProps(overrides) as any,
		global: {
			// `components`, NOT `stubs`. Vuetify is not installed in this lane, so
			// `v-btn` never resolves — and `stubs` only REPLACES a component the
			// runtime could resolve, so every button would render as an empty
			// comment node and the assertions would pass on selectors that match
			// nothing (the cotizaciones lane learned this the hard way).
			components: {
				"v-btn": {
					props: ["disabled", "loading", "color", "size", "block", "variant"],
					emits: ["click"],
					template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
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

describe("where the panel lands", () => {
	it("opens on Vencidas when there is anything overdue — zero typing", () => {
		expect(defaultTab({ overdue: 6, due_soon: 3, all: 14 })).toBe("overdue");
	});

	it("falls back to «Todas» rather than showing an empty tab beside a full one", () => {
		// The failure this guards is subtle and total: land on an empty Vencidas
		// with fourteen invoices one tab over and the cashier is back to
		// hunting, which is the entire thing this surface replaced.
		expect(defaultTab({ overdue: 0, due_soon: 3, all: 14 })).toBe("all");
	});

	it("still lands somewhere on a register that owes nothing", () => {
		expect(defaultTab({ overdue: 0, due_soon: 0, all: 0 })).toBe("all");
	});
});

describe("the tab row", () => {
	it("renders every tab at zero, so it does not change shape under a finger", () => {
		const tabs = describeTabs({ overdue: 0, due_soon: 0, all: 0 }, 0, "all");

		expect(tabs.map((tab) => tab.id)).toEqual([
			"overdue",
			"due_soon",
			"all",
			"collected_today",
		]);
		expect(tabs.every((tab) => tab.count === 0)).toBe(true);
	});

	it("counts «Cobrado hoy» off the payments, not off the invoice buckets", () => {
		// Two documents, two reads. Folding the payment count into the invoice
		// counts would put the day's collections in the receivable total.
		const tabs = describeTabs({ overdue: 6, due_soon: 3, all: 14 }, 5, "overdue");
		const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab.count]));

		expect(byId).toEqual({ overdue: 6, due_soon: 3, all: 14, collected_today: 5 });
		expect(tabs.find((tab) => tab.id === "overdue")?.active).toBe(true);
	});
});

describe("the aging cell", () => {
	it("says how long ago, not how negative", () => {
		expect(describeDue(row({ days_until_due: -24 }))).toEqual({
			key: "{0} days ago",
			count: 24,
			tone: "bad",
		});
	});

	it("names the day rather than counting to one", () => {
		expect(describeDue(row({ days_until_due: 0 }))?.key).toBe("due today");
		expect(describeDue(row({ days_until_due: 1 }))?.key).toBe("tomorrow");
	});

	it("warms only inside the seven-day horizon the tab uses", () => {
		expect(describeDue(row({ days_until_due: 7 }))?.tone).toBe("warn");
		expect(describeDue(row({ days_until_due: 12 }))?.tone).toBe("muted");
	});

	it("claims nothing about an invoice it cannot date", () => {
		expect(describeDue(row({ due: "", days_until_due: null }))).toBeNull();
		expect(describeDue(row({ days_until_due: null }))).toBeNull();
	});
});

describe("the estado chip", () => {
	it("renders a part-paid invoice as an apartado, even 24 days late", () => {
		// The artboard's first row. The TAB says the calendar passed; the CHIP
		// says somebody already put money down — and the second is what the
		// cashier repeats on the phone.
		const chip = estadoChip(row({ aging: "overdue", estado: "apartado" }));

		expect(chip.label).toBe("Layaway");
		expect(chip.tone).toBe("warn");
	});

	it("wears the aging when nothing has been paid", () => {
		expect(estadoChip(row({ estado: "overdue" })).label).toBe("Overdue invoice");
		expect(estadoChip(row({ estado: "overdue" })).tone).toBe("bad");
		expect(estadoChip(row({ estado: "due_soon" })).tone).toBe("warn");
		expect(estadoChip(row({ estado: "upcoming" })).tone).toBe("muted");
	});
});

describe("search is a refinement, never the way in", () => {
	const rows = [
		row({ name: "F-04711", customer_name: "Taller Los Pinos" }),
		row({ name: "F-04760", customer_name: "Comercializadora del Valle" }),
		row({ name: "F-04785", customer_name: "Ana Sofía Torres" }),
	];

	it("shows the whole bucket on an empty box", () => {
		expect(rows.filter((candidate) => matchesQuery(candidate, ""))).toHaveLength(3);
		expect(rows.filter((candidate) => matchesQuery(candidate, "   "))).toHaveLength(3);
	});

	it("narrows by folio", () => {
		const hits = rows.filter((candidate) => matchesQuery(candidate, "4760"));
		expect(hits.map((hit) => hit.name)).toEqual(["F-04760"]);
	});

	it("narrows by customer, ignoring case", () => {
		const hits = rows.filter((candidate) => matchesQuery(candidate, "TALLER"));
		expect(hits.map((hit) => hit.name)).toEqual(["F-04711"]);
	});

	it("narrows the day's payments by reference too — that is what is on the slip", () => {
		const payments = [collected(), collected({ name: "P-2", reference_no: "TURNO-15" })];

		expect(payments.filter((p) => matchesCollectedQuery(p, "turno-15"))).toHaveLength(1);
		expect(payments.filter((p) => matchesCollectedQuery(p, ""))).toHaveLength(2);
	});
});

describe("empty states say which emptiness this is", () => {
	it("distinguishes a clean register from a search that matched nothing", () => {
		// One shared "no hay resultados" would tell a cashier with nothing
		// overdue the same thing it tells one who mistyped a folio, and their
		// next moves are opposite.
		expect(emptyStateKey("overdue", false)).toContain("Nothing is overdue");
		expect(emptyStateKey("overdue", true)).toContain("matches what you typed");
	});

	it("gives each bucket its own sentence", () => {
		const sentences = new Set([
			emptyStateKey("overdue", false),
			emptyStateKey("due_soon", false),
			emptyStateKey("all", false),
			emptyStateKey("collected_today", false),
		]);

		expect(sentences.size).toBe(4);
		expect(emptyStateKey("collected_today", false)).toContain("No payments received yet today");
	});
});

describe("the detail panel", () => {
	it("says what to do when nothing is chosen", () => {
		const wrapper = mountDetail({ row: null });
		expect(wrapper.find('[data-testid="cobranza-detail-empty"]').exists()).toBe(true);
	});

	it("puts the amount on the button, so the cashier reads it before pressing", () => {
		const wrapper = mountDetail();
		expect(wrapper.find('[data-testid="cobranza-collect"]').text()).toContain("$2490.00");
	});

	it("prints the customer's phone beside the folio", () => {
		const wrapper = mountDetail();
		expect(wrapper.find('[data-testid="cobranza-detail-contact"]').text()).toContain(
			"5541286370",
		);
	});

	it("shows «Pagado» when the two currencies agree", () => {
		const wrapper = mountDetail();
		expect(wrapper.find('[data-testid="cobranza-detail-totals"]').text()).toContain("Paid");
	});

	it("omits «Pagado» rather than printing arithmetic across two currencies", () => {
		// `paid: null` is the server refusing to subtract a party-account figure
		// from an invoice-currency one. Rendering it as $0.00 would tell a
		// cashier nobody has paid.
		const wrapper = mountDetail({ row: row({ paid: null }) });
		const totals = wrapper.find('[data-testid="cobranza-detail-totals"]').text();

		expect(totals).not.toContain("Paid");
		expect(totals).toContain("$2490.00");
	});

	it("says an invoice has no payments rather than leaving a blank under the heading", () => {
		const wrapper = mountDetail({ payments: [] });
		expect(wrapper.find('[data-testid="cobranza-detail-no-payments"]').exists()).toBe(true);
	});

	it("lists the payments already received", () => {
		const wrapper = mountDetail();
		const payment = wrapper.find('[data-testid="cobranza-payment-ACC-PAY-2026-00220"]');

		expect(payment.exists()).toBe(true);
		expect(payment.text()).toContain("Efectivo");
		expect(payment.text()).toContain("$1500.00");
	});

	it("marks a counter tender as one, because it shares the invoice's date", () => {
		// Found on doco-mirror: an invoice reading «Pagado $200» listed NO
		// payments, because the $200 was tendered at the till and lives in the
		// invoice's own payments table rather than in a Payment Entry. Now it
		// is listed — and qualified, or it reads as a payment made on the day
		// of a sale the customer did not finish paying for.
		const wrapper = mountDetail({
			payments: [
				{
					name: "ACC-SINV-2026-01670#1",
					date: "2026-05-18",
					mode_of_payment: "Cash",
					reference_no: null,
					amount: 200,
					at_the_counter: true,
				},
			],
		});
		const tender = wrapper.find('[data-testid="cobranza-payment-ACC-SINV-2026-01670#1"]');

		expect(tender.exists()).toBe(true);
		expect(tender.text()).toContain("at the counter");
	});

	it("owns up to a truncated line list instead of implying it is the whole invoice", () => {
		const wrapper = mountDetail({ lineCount: 30 });
		expect(wrapper.find('[data-testid="cobranza-detail-more-lines"]').text()).toContain("29");
	});
});

describe("the monedero chip", () => {
	it("renders only where there is credit to spend", () => {
		const wrapper = mountDetail({ storeCredit: 350 });
		expect(wrapper.find('[data-testid="cobranza-store-credit"]').text()).toContain("$350.00");
	});

	it("is absent — not «$0» — when the customer has none", () => {
		// Absence, not zeros (§2). A chip that appears on every customer saying
		// nothing is a chip cashiers learn to stop reading, and then they miss
		// the one that mattered.
		expect(mountDetail({ storeCredit: null }).find('[data-testid="cobranza-store-credit"]').exists()).toBe(
			false,
		);
		expect(mountDetail({ storeCredit: 0 }).find('[data-testid="cobranza-store-credit"]').exists()).toBe(
			false,
		);
	});
});

describe("the escalation ladder", () => {
	const entry = (overrides: Record<string, any> = {}) => ({
		name: "POS-REM-26-00001",
		level: 1,
		channel: "CRM",
		note: null,
		outstanding_at_send: 450,
		owner: "cashier@lab",
		creation: "2026-08-22 10:00:00",
		...overrides,
	});

	it("prints the history latest-first shape the server sends, day + rung + amount", () => {
		const wrapper = mountDetail({
			reminders: [entry({ name: "POS-REM-26-00002", level: 2, creation: "2026-08-23 09:00:00" }), entry()],
		});
		const rows = wrapper.findAll('[data-testid^="cobranza-reminder-log-"]');
		expect(rows).toHaveLength(2);
		expect(rows[0].text()).toContain("2026-08-23");
		expect(rows[0].text()).toContain("R2");
		expect(rows[0].text()).toContain("Firm reminder");
		expect(rows[0].text()).toContain("$450.00");
	});

	it("says nobody has reminded, rather than leaving a blank under the heading", () => {
		const wrapper = mountDetail({ reminders: [] });
		expect(wrapper.find('[data-testid="cobranza-no-reminders"]').text()).toContain(
			"Nobody has reminded this customer yet.",
		);
	});

	it("announces the rung the NEXT press files on the button itself", () => {
		const row = {
			...detailProps().row,
			reminders: { count: 2, last_level: 2, last_on: "2026-08-23", last_channel: "CRM", next_level: 3 },
		};
		const wrapper = mountDetail({ row });
		expect(wrapper.find('[data-testid="cobranza-reminder"]').text()).toContain("Final notice");
	});

	it("keeps the bare label for the first rung — «Recordatorio» promises gently", () => {
		const wrapper = mountDetail({});
		expect(wrapper.find('[data-testid="cobranza-reminder"]').text().trim()).toBe("Reminder");
	});

	it("the worklist chip derives from the summary and caps its tone at the final notice", () => {
		expect(reminderChip({ reminders: undefined })).toBeNull();
		expect(
			reminderChip({
				reminders: { count: 0, last_level: null, last_on: null, last_channel: null, next_level: 1 },
			}),
		).toBeNull();
		const chip = reminderChip({
			reminders: { count: 5, last_level: 3, last_on: "2026-08-23", last_channel: "CRM", next_level: 3 },
		});
		expect(chip).toEqual({ label: "R3", levelLabel: "Final notice", tone: "bad" });
	});
});

describe("the two secondary chips", () => {
	it("hands «Recordatorio» up rather than filing anything itself", async () => {
		// Asserted through a listener, not `wrapper.emitted()`: this repo has
		// been bitten before by VTU recording nothing for a `<script setup>`
		// component's emits (POS rail round, 08-22). A spy passed in as
		// `onReminder` is what a real parent receives.
		const onReminder = vi.fn();
		const wrapper = mountDetail({ onReminder });

		await wrapper.find('[data-testid="cobranza-reminder"]').trigger("click");

		expect(onReminder).toHaveBeenCalledTimes(1);
		expect(onReminder.mock.calls[0]?.[0]).toMatchObject({ name: "ACC-SINV-2026-04711" });
	});

	it("shows the reminder as filed once it is, so nobody presses it a third time", () => {
		const wrapper = mountDetail({ reminderState: "filed" });
		expect(wrapper.find('[data-testid="cobranza-reminder"]').text()).toContain("filed");
	});

	it("keeps «Estado de cuenta» present and honest — it asks rather than doing nothing", async () => {
		const onStatement = vi.fn();
		const wrapper = mountDetail({ onStatement });
		const chip = wrapper.find('[data-testid="cobranza-statement"]');

		expect(chip.exists()).toBe(true);
		await chip.trigger("click");
		// The surface answers this with a toast naming the gap; a chip that
		// asked nobody would be the silent stub.
		expect(onStatement).toHaveBeenCalledTimes(1);
	});
});

describe("offline", () => {
	it("refuses COBRAR, because the capture behind it needs the server", () => {
		expect(
			mountDetail({ offline: true }).find('[data-testid="cobranza-collect"]').attributes("disabled"),
		).toBeDefined();
	});

	it("refuses the reminder too — the CRM write is a round trip", () => {
		expect(
			mountDetail({ offline: true }).find('[data-testid="cobranza-reminder"]').attributes("disabled"),
		).toBeDefined();
	});
});
