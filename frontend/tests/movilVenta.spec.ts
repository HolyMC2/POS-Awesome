// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * The phone's sale screen, against its own artboard
 * (`design/register-hifi/MovilVenta.dc.html`, 45 nodes).
 *
 * Money first. Every figure on this screen is asserted against the canvas's
 * own ticket — B-04812, subtotal 973.28 + IVA 155.72 = 1,129.00, six lines —
 * the same numbers `bandState.spec.ts` pins for the desk, so the two surfaces
 * cannot drift apart while both stay green.
 *
 * The second half of this file is the duplication guard, and it is written to
 * FAIL: `registerSaysItOnce.spec.ts` was green while a live register stacked
 * three totals, because it counted only the figures it already knew about. So
 * the count here is mutation-tested — the same audit is run over deliberately
 * broken markup and must report the break.
 */

import MobileSaleScreen from "../src/posapp/components/pos/mobile/sale/MobileSaleScreen.vue";
import MobileCartLine from "../src/posapp/components/pos/mobile/sale/MobileCartLine.vue";
import MobileSaleTotals from "../src/posapp/components/pos/mobile/sale/MobileSaleTotals.vue";
import { describeMobileSaleLines } from "../src/posapp/components/pos/mobile/sale/mobileSaleLines";
import { compactBandAction } from "../src/posapp/components/pos/mobile/sale/mobileSaleAction";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

/**
 * A marker no formatter would produce, so counting occurrences in the rendered
 * HTML counts MONEY FIGURES rather than incidental digits. Borrowed verbatim
 * from `registerSaysItOnce.spec.ts` — a `$` would also match a price typed
 * into a placeholder, and `9` matches half the document.
 */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${value.toFixed(2)}`;
const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

/** The artboard's ticket, line for line. Amounts are tax-inclusive and sum to
 *  the total, which is how the canvas draws an ERPNext inclusive-tax sale. */
const ARTBOARD_ITEMS = [
	{
		item_code: "COMBO-IP15P",
		item_name: "Combo Protección iPhone 15 Pro",
		qty: 1,
		rate: 299,
		amount: 299,
		posa_combo_components: [
			{ item_code: "CASE-NEG", item_name: "Case negro", qty: 1, rate: 200 },
			{ item_code: "MICA-CRI", item_name: "Mica Cristal", qty: 1, rate: 140 },
			{ item_code: "INSTALA", item_name: "Instalación", qty: 1, rate: 0 },
		],
		is_stock_item: 1,
		_base_actual_qty: 4,
		conversion_factor: 1,
	},
	{
		item_code: "IPN001545",
		item_name: "Anillo Case iPhone 12 Pro Max Negro",
		qty: 1,
		rate: 200,
		amount: 200,
		is_stock_item: 1,
		_base_actual_qty: 5,
		conversion_factor: 1,
	},
	{
		item_code: "IPN002611",
		item_name: "Anillo Case Honor X8A Rojo",
		qty: 1,
		rate: 200,
		amount: 200,
		is_stock_item: 1,
		_base_actual_qty: 7,
		conversion_factor: 1,
	},
	{
		item_code: "IPN001880",
		item_name: "Adaptador Apple Lightning a Jack",
		qty: 2,
		rate: 120,
		amount: 240,
		is_stock_item: 1,
		_base_actual_qty: 3,
		conversion_factor: 1,
	},
	{
		item_code: "IPN000774",
		item_name: "Adaptador USB a Micro SD 2.0/1.1",
		qty: 1,
		rate: 70,
		amount: 70,
		is_stock_item: 1,
		_base_actual_qty: 14,
		conversion_factor: 1,
	},
	{
		item_code: "IPN001902",
		item_name: "Adaptador Samsung C a Jack 3.5 mm",
		qty: 1,
		rate: 120,
		amount: 120,
		is_stock_item: 1,
		_base_actual_qty: 15,
		conversion_factor: 1,
	},
];

const SALE_STATE = resolveBandState({ kind: "sale", total: 1129, itemCount: 9 });

const screenProps = (overrides: Record<string, unknown> = {}) => ({
	items: ARTBOARD_ITEMS,
	state: SALE_STATE,
	subtotal: 973.28,
	tax: 155.72,
	taxRate: 16,
	status: {
		ticketName: "B-04812",
		registerLabel: "Caja 2",
		cashierName: "Jenni",
		saldoLabel: money(1240),
		online: true,
		pendingCount: 0,
	},
	customerName: "Alejandra Ríos Bautista",
	walletLabel: money(418),
	cfdiReady: true,
	lowStockThreshold: 5,
	formatCurrency: money,
	...overrides,
});

const mountScreen = (overrides: Record<string, unknown> = {}) =>
	mount(MobileSaleScreen, { props: screenProps(overrides) as never });

beforeEach(() => {
	// No `__` on purpose: the components fall back to the English source and
	// interpolate their own params, so these assertions read the strings the
	// translation scan checks rather than a stubbed identity of them.
	vi.unstubAllGlobals();
});

describe("the cart the artboard draws", () => {
	it("renders one row per line, in cart order", () => {
		const rows = mountScreen().findAll('[data-testid="movil-cart-line"]');

		expect(rows).toHaveLength(6);
		expect(rows[0].text()).toContain("Combo Protección iPhone 15 Pro");
		expect(rows[5].text()).toContain("Adaptador Samsung C a Jack 3.5 mm");
	});

	it("puts the code and the stock figure on an ordinary line", () => {
		const row = mountScreen().findAll('[data-testid="movil-cart-line"]')[1];
		const subtitle = row.find('[data-testid="movil-line-subtitle"]');

		expect(subtitle.text()).toContain("IPN001545");
		expect(subtitle.text()).toContain("left 5");
	});

	it("draws the unit rate above one unit and never on a single", () => {
		// `IPN001880 · 2 × 120.00` — on a single-qty line the rate would
		// restate the amount already on the row.
		const rows = mountScreen().findAll('[data-testid="movil-cart-line"]');

		expect(rows[3].find('[data-part="unit-rate"]').text()).toBe(`2 × ${money(120)}`);
		expect(rows[1].find('[data-part="unit-rate"]').exists()).toBe(false);
	});

	it("shows the stock figure on a multi-quantity line too", () => {
		// The artboard spends that row on the multiplier alone; the brief asks
		// for `quedan N` on EVERY line, and at 9.5px mono all three facts fit
		// the slot. Pinned so a later "match the artboard exactly" sweep has to
		// argue with the brief rather than delete the figure quietly.
		const subtitle = mountScreen()
			.findAll('[data-testid="movil-cart-line"]')[3]
			.find('[data-testid="movil-line-subtitle"]');

		expect(subtitle.text()).toContain("2 ×");
		expect(subtitle.text()).toContain("left 3");
	});

	it("tints a line at or under the register's own low-stock threshold", () => {
		const rows = mountScreen().findAll('[data-testid="movil-cart-line"]');

		// Threshold 5: `quedan 5` glows, `quedan 7` does not — the artboard's
		// own split, reached through posa_low_stock_alert_threshold rather than
		// a hand-picked tint.
		expect(rows[1].find(".movil-line__subtitle--low").exists()).toBe(true);
		expect(rows[2].find(".movil-line__subtitle--low").exists()).toBe(false);
	});

	it("badges a combo with its component count and its saving", () => {
		const combo = mountScreen().findAll('[data-testid="movil-cart-line"]')[0];

		expect(combo.attributes("data-line-kind")).toBe("combo");
		expect(combo.find('[data-testid="movil-combo-badge"]').text()).toBe("COMBO · 3");
		// list 200 + 140 + 0 = 340, sold at 299.
		expect(combo.find('[data-testid="movil-combo-saving"]').text()).toBe(`−${money(41)}`);
	});

	it("gives a combo no stock figure of its own", () => {
		// Availability for a bundle is min(components), and that figure lives on
		// the desk's own combo chip. A second way of computing it here could
		// disagree with the first.
		const combo = mountScreen().findAll('[data-testid="movil-cart-line"]')[0];

		expect(combo.find('[data-testid="movil-line-subtitle"]').exists()).toBe(false);
	});
});

describe("absent stock renders nothing, never a zero", () => {
	const lineFor = (item: Record<string, unknown>) =>
		mount(MobileCartLine, {
			props: {
				line: describeMobileSaleLines([{ item_code: "X", item_name: "X", qty: 1, rate: 1, ...item }])
					.lines[0],
				formatCurrency: money,
			},
		});

	it("says nothing for a line that is not stocked at all", () => {
		// Labour and services have no shelf to be counted on.
		const row = lineFor({ is_stock_item: 0, _base_actual_qty: 0 });

		expect(row.attributes("data-availability")).toBe("not-stocked");
		expect(row.find('[data-part="stock"]').exists()).toBe(false);
		expect(row.text()).not.toContain("left");
	});

	it("says nothing when the register genuinely does not know", () => {
		const row = lineFor({ is_stock_item: 1 });

		expect(row.attributes("data-availability")).toBe("unknown");
		expect(row.find('[data-part="stock"]').exists()).toBe(false);
	});

	it("DOES draw a real zero, because that is the moment it is worth having", () => {
		const row = lineFor({ is_stock_item: 1, _base_actual_qty: 0, conversion_factor: 1 });

		expect(row.attributes("data-availability")).toBe("bounded");
		expect(row.find('[data-part="stock"]').text()).toBe("left 0");
	});

	it("degrades every line rather than pairing one line's stock onto another", () => {
		// A row the summary drops and this module keeps (or the reverse) would
		// slide the figures by one. Showing nothing costs a glance at the shelf;
		// showing the WRONG shelf count sells stock the shop does not have.
		const cart = describeMobileSaleLines([
			null,
			{ item_code: "", item_name: "" },
			{ item_code: "A", item_name: "A", qty: 1, rate: 1, is_stock_item: 1, _base_actual_qty: 9, conversion_factor: 1 },
		]);

		expect(cart.lines).toHaveLength(1);
		expect(cart.lines[0].stock.value).toBe(9);
	});
});

describe("the totals block", () => {
	it("adds up to the canvas's own ticket", () => {
		const screen = mountScreen();

		expect(screen.find('[data-testid="movil-subtotal"]').text()).toBe(money(973.28));
		expect(screen.find('[data-testid="movil-tax"]').text()).toBe(money(155.72));
		expect(screen.find('[data-testid="movil-total"]').text()).toBe(money(1129));
		expect(973.28 + 155.72).toBeCloseTo(1129, 2);
	});

	it("takes the total from the band state rather than re-adding the cart", () => {
		// One number, one action (§17.7 invariant 1). A card that recomputed
		// subtotal + tax would be a second opinion on what the customer pays.
		const screen = mountScreen({
			state: resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }),
			subtotal: 0,
			tax: 0,
		});

		expect(screen.find('[data-testid="movil-total"]').text()).toBe(money(1129));
	});

	it("names the tax rate the way the ticket does", () => {
		expect(mountScreen().find('[data-testid="movil-totals"]').text()).toContain("Tax 16 %");
	});

	it("stays silent about the wallet accrual the register cannot compute", () => {
		// `walletSummary.ts`: the collection factor never reaches the client, so
		// "Monedero acumula +$29.20" is a promise this build cannot make.
		const screen = mountScreen({
			wallet: { loyaltyProgram: "Puntos Doco", loyaltyValue: 418 },
		});

		expect(screen.find('[data-testid="movil-wallet-accrual"]').exists()).toBe(false);
	});

	it("draws it the moment the register can", () => {
		const screen = mountScreen({
			wallet: { loyaltyProgram: "Puntos Doco", loyaltyValue: 418, accrual: 29.2 },
		});

		expect(screen.find('[data-testid="movil-wallet-accrual"]').text()).toBe(`+${money(29.2)}`);
	});
});

describe("the primary carries the amount", () => {
	it("says COBRAR $1,129.00 — verb and money on the button", () => {
		const button = mountScreen().find('[data-testid="movil-primary"]');

		expect(button.text()).toContain("Charge");
		expect(button.find('[data-testid="movil-primary-amount"]').text()).toBe(money(1129));
		expect(button.attributes("data-band-action")).toBe("sale.pay");
	});

	it("emits the band's own action id", async () => {
		const onPrimary = vi.fn();
		// Listener prop, not `wrapper.emitted()`: VTU records only the native
		// event that bubbles to the root in this repo (build plan §10).
		const screen = mount(MobileSaleScreen, {
			props: { ...screenProps(), onPrimary } as never,
		});
		await screen.find('[data-testid="movil-primary"]').trigger("click");

		expect(onPrimary).toHaveBeenCalledWith("sale.pay");
	});

	it("cannot be pressed on an empty cart, and still occupies its place", () => {
		const screen = mountScreen({
			items: [],
			state: resolveBandState({ kind: "sale", total: 0, itemCount: 0 }),
		});
		const button = screen.find('[data-testid="movil-primary"]');

		expect(button.exists()).toBe(true);
		expect(button.attributes("disabled")).toBeDefined();
	});

	it("keeps the desk's label for an action the phone has no compact wording for", () => {
		// A blank button would be worse than one that says what the desk says.
		const refund = resolveBandState({ kind: "refund", amount: 149, ticketId: "B-04801" });
		const compact = compactBandAction(refund);

		expect(compact.labelKey).toBe("REFUND {0}");
		expect(compact.amount).toBeNull();
	});

	it("prefers bandState's own compact label the day it grows one", () => {
		// The seam this module exists to close: `BandAction.compactLabelKey`.
		// Reading it first means the change lands as a deletion here, not a
		// rewrite — and the `{0}` form is detected, not configured.
		const seam = {
			...SALE_STATE,
			primaryAction: { ...SALE_STATE.primaryAction, compactLabelKey: "CHARGE {0}" },
		};
		const compact = compactBandAction(seam as never);

		expect(compact.labelKey).toBe("CHARGE {0}");
		expect(compact.interpolates).toBe(true);
		expect(compact.amount).toBe(1129);

		const totals = mount(MobileSaleTotals, {
			props: { state: seam, subtotal: 973.28, tax: 155.72, formatCurrency: money } as never,
		});
		// Interpolated: the amount is IN the label, so no sibling span repeats it.
		expect(totals.find('[data-testid="movil-primary"]').text()).toBe(`CHARGE ${money(1129)}`);
		expect(totals.find('[data-testid="movil-primary-amount"]').exists()).toBe(false);
	});
});

/**
 * The audit, as a function so it can be run over MUTATED markup.
 *
 * `registerSaysItOnce.spec.ts` counts against a live mount only, which is how
 * it stayed green while a third total was on screen. Here the counting is
 * separated from the sample, so the tests below can prove the counter reports
 * a break it is given rather than merely passing on markup that happens to be
 * correct today.
 */
const auditMoney = (html: string) => {
	const root = document.createElement("div");
	root.innerHTML = html;

	/**
	 * `CustomerStrip` is the desk's component, reused whole. Its wallet chip is
	 * a money figure that declares NO role, because `components/pos/customer/**`
	 * belongs to nobody in this wave and §7 forbids editing outside owned paths.
	 * Subtracted the way `registerSaysItOnce` subtracts the discount dialog's
	 * subtree — and pinned below, so the exclusion cannot quietly grow.
	 */
	const strip = root.querySelector('[data-testid="customer-strip"]');
	const excluded = {
		figures: strip ? countMoney(strip.innerHTML) : 0,
		declared: strip ? strip.querySelectorAll("[data-money-role]").length : 0,
	};
	strip?.remove();

	const declared = [...root.querySelectorAll("[data-money-role]")];
	return {
		figures: countMoney(root.innerHTML),
		declared: declared.length,
		roles: declared.map((element) => element.getAttribute("data-money-role")),
		/** A role covering two numbers hides the second one. */
		overloaded: declared.filter((element) => countMoney(element.innerHTML) !== 1).length,
		excluded,
	};
};

const auditOf = (overrides: Record<string, unknown> = {}) => auditMoney(mountScreen(overrides).html());

describe("every money figure on the sale surface declares what it is", () => {
	it("has figures to count at all", () => {
		// A count over zero figures passes every assertion below vacuously.
		expect(auditOf().figures).toBeGreaterThanOrEqual(10);
	});

	it("leaves no unlabelled figure", () => {
		const audit = auditOf();

		expect(
			audit.declared,
			"a money figure with no data-money-role is exactly how the third total got on screen",
		).toBe(audit.figures);
	});

	it("declares one role per figure, so a role cannot cover two numbers", () => {
		expect(auditOf().overloaded).toBe(0);
	});

	it("shows exactly one total, and the button's copy of it is not a second", () => {
		const { roles } = auditOf();

		expect(roles.filter((role) => role === "total"), "two totals on one screen is the defect").toHaveLength(1);
		// The phone inlines the money into the action because it has no 134px
		// lane. That restatement declares itself as `action-total`, so it is
		// counted and visible rather than passing as an unremarked figure — and
		// a genuine third total cannot hide behind the button's role.
		expect(roles.filter((role) => role === "action-total")).toHaveLength(1);
	});

	it("names every role it uses, so a new one is a deliberate act", () => {
		expect([...new Set(auditOf().roles)].sort()).toEqual([
			"action-total",
			"breakdown",
			"line",
			"line-saving",
			"saldo",
			"total",
			"unit-rate",
		]);
	});

	it("carries the known CustomerStrip gap and no more than that", () => {
		// RATCHET, not a fix: the strip's wallet chip needs
		// `data-money-role="wallet"` and that file is outside this task's paths.
		// Recorded so the number can only go DOWN — see the task report.
		const { excluded } = auditOf();

		expect(excluded.figures).toBe(1);
		expect(excluded.declared).toBe(0);
	});
});

describe("the guard fails when the register says a number twice", () => {
	it("catches a second total", () => {
		const html = mountScreen().html();
		const total = /<span[^>]*data-money-role="total"[\s\S]*?<\/span>/.exec(html);
		expect(total, "the mutation needs a total to duplicate").not.toBeNull();

		const mutated = auditMoney(html.replace((total as RegExpExecArray)[0], `${total![0]}${total![0]}`));

		expect(mutated.roles.filter((role) => role === "total")).toHaveLength(2);
		expect(mutated.figures).toBe(auditMoney(html).figures + 1);
	});

	it("catches a figure that stopped declaring itself", () => {
		const html = mountScreen().html();
		const mutated = auditMoney(html.replace('data-money-role="breakdown"', ""));

		expect(mutated.declared).toBeLessThan(mutated.figures);
	});

	it("catches one role stretched over two figures", () => {
		const html = mountScreen().html();
		const mutated = auditMoney(
			html.replace(
				/(<span[^>]*data-money-role="total"[^>]*>)([^<]*)(<\/span>)/,
				(_match, open, text, close) => `${open}${text}${text}${close}`,
			),
		);

		expect(mutated.overloaded).toBe(1);
	});
});

describe("the app bar states the register once", () => {
	it("names the ticket, the till and the cashier", () => {
		const screen = mountScreen();

		expect(screen.find('[data-testid="movil-ticket"]').text()).toBe("B-04812");
		// `registerStatusLine.ts` omits the cashier on the desk because the
		// avatar chip states it as the label of a control. The phone's sale
		// screen has no avatar control, so without this the name appears zero
		// times.
		expect(screen.find('[data-testid="movil-where"]').text()).toBe("Caja 2 · Jenni");
	});

	it("drops the profile name and the clock, exactly as the mobile boards do", () => {
		const text = mountScreen({
			status: { ...screenProps().status, profileName: "Doco Ventas" },
		})
			.find('[data-testid="movil-sale-header"]')
			.text();

		expect(text).not.toContain("Doco Ventas");
	});

	it("orders saldo before the connection chip", () => {
		// The chip that must never be lost is dropped last. The stylesheet used
		// to claim this and the DOM disagreed.
		const chips = mountScreen()
			.find('[data-testid="movil-sale-header"]')
			.findAll("[data-chip]")
			.map((chip) => chip.attributes("data-chip"));

		expect(chips).toEqual(["saldo", "connection"]);
	});

	it("never claims to be synced while the queue still holds invoices", () => {
		const chip = mountScreen({
			status: { ...screenProps().status, online: true, pendingCount: 3 },
		}).find('[data-chip="connection"]');

		expect(chip.text()).toContain("To upload");
		expect(chip.classes()).toContain("movil-header__chip--warning");
	});

	it("builds no scan field of its own", () => {
		// `useScannerInput` attaches the wedge to the DOCUMENT behind a
		// singleton; a second input here would double every barcode or kill the
		// gun outright, depending on mount order. The one header teleports in.
		const screen = mountScreen();

		expect(screen.findAll("input")).toHaveLength(0);
		expect(screen.find('[data-testid="movil-scan-slot"]').exists()).toBe(false);
	});

	it("hosts the register's one scan header when the shell hands it over", () => {
		const screen = mount(MobileSaleScreen, {
			props: screenProps() as never,
			slots: { "scan-bar": '<div id="register-scan-bar"></div>' },
		});

		expect(screen.find('[data-testid="movil-scan-slot"] #register-scan-bar').exists()).toBe(true);
	});
});

describe("the phone frame", () => {
	it("takes an explicit height, because the document scrolls under a fixed dock", () => {
		const style = mountScreen().find('[data-testid="movil-venta"]').attributes("style") ?? "";

		expect(style).toContain("var(--viewport-height)");
		expect(style).toContain("var(--bottom-safe-space)");
	});

	it("lets a wider column own the height instead", () => {
		const style =
			mountScreen({ isPhone: false, windowWidth: 1024 })
				.find('[data-testid="movil-venta"]')
				.attributes("style") ?? "";

		expect(style).not.toContain("--viewport-height");
		expect(style).toContain("overflow: hidden");
	});
});

describe("the cart is counted once, and the count says what it counts", () => {
	it("reports lines and pieces from the one shared summary", () => {
		expect(mountScreen().find('[data-testid="movil-line-count"]').text()).toBe(
			"6 lines · 7 pcs",
		);
	});

	it("records that the canvas counts a combo's components as pieces and the code does not", () => {
		// KNOWN DIVERGENCE, pinned rather than fixed. `_rail.txt` and both
		// artboards say "6 líneas · 9 piezas": 3 (the combo's components) + 1 +
		// 1 + 2 + 1 + 1. `payments/saleSummary.ts` counts a combo line as ONE
		// piece, giving 7, and the payment screen ships that number today.
		// Making the phone say 9 would give one register two answers to one
		// fact; the fix belongs in the shared module. See the task report.
		const cart = describeMobileSaleLines(ARTBOARD_ITEMS);

		expect(cart.lineCount).toBe(6);
		expect(cart.pieceCount).toBe(7);
		const canvasPieces = 3 + 1 + 1 + 2 + 1 + 1;
		expect(canvasPieces).toBe(9);
	});
});
