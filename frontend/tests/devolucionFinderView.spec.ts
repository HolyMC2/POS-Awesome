// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import ReturnFinder from "../src/posapp/components/pos/flows/returns/ReturnFinder.vue";
import { describeFindMethods } from "../src/posapp/components/pos/flows/returns/findMethods";
import { defaultSelection } from "../src/posapp/components/pos/flows/returns/returnLines";
import { resolveWarrantyWindow } from "../src/posapp/components/pos/flows/returns/warrantyWindow";
import { MUELLE_DEFAULT } from "../src/posapp/shortcuts/keymap";
import { resolveKeymap } from "../src/posapp/shortcuts/engine";

const ROSA = { user: "rosa@doco.mx", full_name: "Rosa Elena Pech", is_supervisor: true };
const JENNI = { user: "jenni@doco.mx", full_name: "Jenni Robledo", is_supervisor: false };

const SALE = {
	name: "B-04788",
	customer: "CUST-01",
	customer_name: "Público en general",
	posting_date: "2026-08-18",
	posting_time: "16:41",
	grand_total: 558,
	currency: "MXN",
	posa_return_valid_upto: "2026-09-17",
	posa_return_expired: 0,
};

const LINES = [
	{ name: "row-mica", item_code: "IPN003282", item_name: "Mica 9D Samsung A16", rate: 149, qty: 1 },
	{ name: "row-cable", item_code: "IPN004117", item_name: "Cable USB-C 1 m", rate: 189, qty: 1 },
];

/**
 * Vuetify is NOT stubbed here, deliberately.
 *
 * This lane runs the runtime-only Vue build, so a stub declared with a
 * `template` string compiles to nothing and renders an empty comment — every
 * assertion about the stubbed element then fails as "empty DOMWrapper", which
 * reads like a missing element rather than a missing compiler. Left
 * unresolved, Vue renders `<v-btn data-testid="…">` as a custom element with
 * its attributes intact, which is exactly what these queries need. The
 * resolution warnings are silenced rather than suppressed component by
 * component.
 */
const mountConfig = { config: { warnHandler: () => {} } };
const mountFinder = (props: Record<string, unknown> = {}, listeners: Record<string, unknown> = {}) =>
	mount(ReturnFinder, {
		props: {
			methods: describeFindMethods(
				{ serialIdentity: true, noReceiptReturns: true },
				resolveKeymap(MUELLE_DEFAULT),
			),
			activeMethod: "ticket",
			term: "",
			searching: false,
			searchedOnce: false,
			searchError: null,
			results: [],
			selectedSale: null,
			cashier: null,
			cashierOnDuty: "Jenni Robledo",
			warranty: null,
			lines: [],
			selection: {},
			authorisers: [JENNI, ROSA],
			noTicket: {
				allowedByProfile: true,
				authoriserUser: null,
				signatureTaken: false,
				reason: null,
			},
			formatCurrency: (value: number) => `¤${value.toFixed(2)}`,
			formatDate: (value: string) => value,
			...props,
			...listeners,
		},
		global: mountConfig,
	});

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
	(window as unknown as { __: (value: string) => string }).__ = (value: string) => value;
});

describe("the five ways, drawn from capabilities and the keymap", () => {
	it("draws every way the register grants", () => {
		const finder = mountFinder();
		for (const id of ["ticket", "item", "customer", "serial", "noReceipt"]) {
			expect(finder.find(`[data-testid="find-method-${id}"]`).exists(), id).toBe(true);
		}
	});

	it("has no IMEI search on a giro that does not track serials", () => {
		const finder = mountFinder({
			methods: describeFindMethods(
				{ serialIdentity: false, noReceiptReturns: true },
				resolveKeymap(MUELLE_DEFAULT),
			),
		});
		expect(finder.find('[data-testid="find-method-serial"]').exists()).toBe(false);
		expect(finder.find('[data-testid="find-method-ticket"]').exists()).toBe(true);
	});

	it("has no no-ticket path when the profile withholds it", () => {
		const finder = mountFinder({
			methods: describeFindMethods(
				{ serialIdentity: true, noReceiptReturns: false },
				resolveKeymap(MUELLE_DEFAULT),
			),
		});
		expect(finder.find('[data-testid="find-method-noReceipt"]').exists()).toBe(false);
	});

	it("shows a label with NO chip while the action is unbound", () => {
		// R8: the artboard prints F1–F4 and the shipped pack binds none of them.
		const finder = mountFinder();
		expect(finder.findAll("[data-testid^='find-chord-']")).toHaveLength(0);
		expect(finder.find('[data-testid="find-method-serial"]').text()).toContain("By serial or IMEI");
	});

	it("marks the no-ticket way as supervised rather than as a fifth search", () => {
		const finder = mountFinder();
		expect(
			finder.find('[data-testid="find-method-noReceipt"]').attributes("data-find-kind"),
		).toBe("supervised");
		expect(finder.find('[data-testid="find-method-ticket"]').attributes("data-find-kind")).toBe(
			"search",
		);
	});

	it("reports the way the cashier clicked", async () => {
		const onUpdateActiveMethod = vi.fn();
		// Listener props, not `emitted()` — VTU does not record component emits
		// in this repo (build plan §10).
		const finder = mountFinder({}, { "onUpdate:activeMethod": onUpdateActiveMethod });
		await finder.find('[data-testid="find-method-customer"]').trigger("click");
		expect(onUpdateActiveMethod).toHaveBeenCalledWith("customer");
	});
});

describe("a resolved sale fills the panel", () => {
	it("shows the date, the customer and the total", () => {
		const finder = mountFinder({ selectedSale: SALE, cashier: "Rosa Elena Pech" });
		const panel = finder.find('[data-testid="original-sale"]');
		expect(panel.exists()).toBe(true);
		expect(panel.text()).toContain("2026-08-18");
		expect(panel.text()).toContain("Público en general");
		expect(panel.text()).toContain("¤558.00");
		expect(finder.find('[data-testid="original-cashier"]').text()).toContain("Rosa Elena Pech");
	});

	it("hides the cashier row rather than printing a blank one", () => {
		// `owner` is the one panel field with no guaranteed source; an empty row
		// would be the register claiming it knows and does not.
		const finder = mountFinder({ selectedSale: SALE, cashier: null });
		expect(finder.find('[data-testid="original-cashier"]').exists()).toBe(false);
	});

	it("declares every money figure it renders", () => {
		// registerSaysItOnce's rule, applied here: a figure with no
		// `data-money-role` is how a third total got on a live register.
		const finder = mountFinder({
			selectedSale: SALE,
			results: [SALE],
			lines: LINES,
			selection: defaultSelection(LINES),
		});
		const money = (finder.html().match(/¤/g) || []).length;
		expect(finder.findAll("[data-money-role]")).toHaveLength(money);
	});

	it("renders no hero total, because the band owns that lane", () => {
		// "One number, one action": bandState.ts already has a `refund` kind
		// carrying the ticket and the amount.
		const finder = mountFinder({ selectedSale: SALE, lines: LINES, selection: defaultSelection(LINES) });
		expect(finder.findAll('[data-money-role="total"]')).toHaveLength(0);
	});

	it("says the warranty window is open and needs nobody", () => {
		const finder = mountFinder({
			selectedSale: SALE,
			warranty: resolveWarrantyWindow(SALE, "2026-08-22"),
		});
		const line = finder.find('[data-testid="warranty-window"]');
		expect(line.text()).toContain("26");
		expect(line.text()).toContain("No authorisation needed");
		expect(finder.find('[data-testid="record-authoriser"]').text()).toBe("not needed");
	});

	it("asks for a supervisor once the window has closed", () => {
		const expired = { ...SALE, posa_return_valid_upto: "2026-07-17", posa_return_expired: 1 };
		const finder = mountFinder({
			selectedSale: expired,
			warranty: resolveWarrantyWindow(expired, "2026-08-22"),
			lines: LINES,
			selection: defaultSelection(LINES),
		});
		expect(finder.find('[data-testid="expired-panel"]').exists()).toBe(true);
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("0");
	});
});

describe("the line picker", () => {
	it("shows what was sold and what is coming back", () => {
		const finder = mountFinder({
			selectedSale: SALE,
			lines: LINES,
			selection: { "row-mica": 1, "row-cable": 0 },
		});
		expect(finder.find('[data-testid="return-line-IPN003282"]').text()).toContain("¤149.00");
		expect(finder.find('[data-testid="return-line-count"]').text()).toContain("1");
		expect(finder.find('[data-testid="return-selected-amount"]').text()).toBe("¤149.00");
	});

	it("cannot select more than was sold", () => {
		// Typed 9 against a line that sold 1: the report back is clamped, so the
		// screen can never show a quantity the register would not accept.
		const onUpdateSelection = vi.fn();
		const finder = mountFinder(
			{ selectedSale: SALE, lines: LINES, selection: defaultSelection(LINES) },
			{ "onUpdate:selection": onUpdateSelection },
		);
		const input = finder.find('[data-testid="return-line-qty-IPN003282"]');
		(input.element as HTMLInputElement).value = "9";
		input.trigger("input");
		expect(onUpdateSelection).toHaveBeenCalledWith(
			expect.objectContaining({ "row-mica": 1 }),
		);
	});

	it("refuses to continue with nothing selected", () => {
		const finder = mountFinder({ selectedSale: SALE, lines: LINES, selection: {} });
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("0");
	});

	it("continues once a line is chosen on an in-warranty sale", () => {
		const finder = mountFinder({
			selectedSale: SALE,
			warranty: resolveWarrantyWindow(SALE, "2026-08-22"),
			lines: LINES,
			selection: { "row-mica": 1 },
		});
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("1");
	});
});

describe("the no-ticket path demands a signature and a named supervisor", () => {
	const noTicketProps = (noTicket: Record<string, unknown>) => ({
		activeMethod: "noReceipt" as const,
		noTicket: {
			allowedByProfile: true,
			authoriserUser: null,
			signatureTaken: false,
			reason: null,
			...noTicket,
		},
	});

	it("refuses with nothing supplied, and names every missing thing", () => {
		const finder = mountFinder(noTicketProps({}));
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("0");
		const blockers = finder.findAll('[data-testid="no-ticket-blockers"] li');
		expect(blockers.map((node) => node.attributes("data-blocker"))).toEqual([
			"no_authoriser_named",
			"signature_not_taken",
			"reason_missing",
		]);
	});

	it("still refuses with a supervisor and a reason but no signature", () => {
		const finder = mountFinder(
			noTicketProps({ authoriserUser: ROSA.user, reason: "No traía el ticket" }),
		);
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("0");
		expect(finder.find('[data-blocker="signature_not_taken"]').exists()).toBe(true);
	});

	it("still refuses when the named authoriser is not a supervisor", () => {
		const finder = mountFinder(
			noTicketProps({
				authoriserUser: JENNI.user,
				signatureTaken: true,
				reason: "No traía el ticket",
			}),
		);
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("0");
		expect(finder.find('[data-blocker="authoriser_not_a_supervisor"]').exists()).toBe(true);
	});

	it("proceeds only once all three are in place", () => {
		const finder = mountFinder(
			noTicketProps({
				authoriserUser: ROSA.user,
				signatureTaken: true,
				reason: "No traía el ticket",
			}),
		);
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("1");
		expect(finder.findAll('[data-testid="no-ticket-blockers"] li')).toHaveLength(0);
		expect(finder.find('[data-testid="record-authoriser"]').text()).toBe("Rosa Elena Pech");
	});

	it("needs no original sale, unlike every other way", () => {
		const finder = mountFinder(
			noTicketProps({
				authoriserUser: ROSA.user,
				signatureTaken: true,
				reason: "No traía el ticket",
			}),
		);
		expect(finder.find('[data-testid="original-sale"]').exists()).toBe(false);
		expect(finder.find('[data-testid="return-proceed"]').attributes("data-can-proceed")).toBe("1");
	});

	it("does not offer a search box on a path that searches nothing", () => {
		const finder = mountFinder(noTicketProps({}));
		expect(finder.find('[data-testid="find-term"]').exists()).toBe(false);
	});
});

describe("a failed search says so", () => {
	it("distinguishes a broken lookup from an empty result", () => {
		const broken = mountFinder({ searchError: "PermissionError", searchedOnce: true });
		expect(broken.find('[data-testid="find-error"]').exists()).toBe(true);
		expect(broken.find('[data-testid="find-empty"]').exists()).toBe(false);

		const empty = mountFinder({ searchError: null, searchedOnce: true });
		expect(empty.find('[data-testid="find-empty"]').exists()).toBe(true);
		expect(empty.find('[data-testid="find-error"]').exists()).toBe(false);
	});
});
