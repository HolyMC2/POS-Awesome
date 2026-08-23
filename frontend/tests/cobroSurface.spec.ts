// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import shellSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import summarySource from "../src/posapp/components/pos/payments/PaymentSummary.vue?raw";
import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import PaymentReadinessHeader from "../src/posapp/components/pos/payments/PaymentReadinessHeader.vue";
import CobroTenderPad from "../src/posapp/components/pos/payments/cobro/CobroTenderPad.vue";
import CobroChangeCard from "../src/posapp/components/pos/payments/cobro/CobroChangeCard.vue";
import CobroOnClose from "../src/posapp/components/pos/payments/cobro/CobroOnClose.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import { resetTenderSelection } from "../src/posapp/components/pos/invoice/armedTender";

/**
 * The desktop Cobro as a hosted surface (build plan §14.5).
 *
 * ## Why half of this is a source scan
 *
 * `Payments.vue` cannot be imported under vitest — it pulls the whole payment
 * stack (stores, offline db, printing) through `.js` specifiers that only
 * resolve in the vite pipeline, which is why `paymentsCompactSheet.spec.ts`
 * pins its contract at source level too. `Pos.vue` is the same. So the seams
 * that live inside those two files are read as TEXT (`?raw`, which is a vite
 * transform and therefore survives jsdom where `node:fs` does not), and
 * everything that can be mounted is mounted.
 *
 * The seam that matters most is exactly the one a mount could not prove
 * anyway: that the band's `sale.collectAndClose` reaches the SAME `submit` the
 * dialog's button calls. It travels shell → bus → `Payments.vue`, and each hop
 * is asserted against the file that owns it.
 *
 * Listeners are PROPS (`onBand`, `onPrimary`, `onBack`), never
 * `wrapper.emitted()`: VTU does not record component emits in this repo.
 */

/** A marker no formatter produces, so counting it counts MONEY FIGURES. */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${Number(value).toFixed(2)}`;

const CASH = { mode_of_payment: "Efectivo", amount: 0, default: 1, type: "Cash" };
const CARD = { mode_of_payment: "Tarjeta", amount: 0, default: 0, type: "Bank" };

const padProps = (payments: Record<string, unknown>[], overrides = {}) => ({
	payments,
	currency: "MXN",
	usesGiftCards: false,
	formatCurrency: (value: number) => money(value),
	// The register's own suggestion source, stubbed to what it returns for a
	// $1,129 sale — the artboard's own preset row.
	getVisibleDenominations: () => [1150, 1200, 1500, 2000],
	isCashLikePayment: (payment: { type?: string }) => payment?.type === "Cash",
	diffPayment: 1129,
	...overrides,
});

beforeEach(() => {
	setActivePinia(createPinia());
	resetTenderSelection();
	vi.stubGlobal("__", (value: string, params?: unknown[]) =>
		(params ?? []).reduce<string>(
			(text, param, index) => text.replace(`{${index}}`, String(param)),
			value,
		),
	);
});

describe("the surface is hosted beside the rail, not raised over it", () => {
	it("renders Cobro in the shell's content area on the layout that has a rail", () => {
		// The same slot `DestinationHost` occupies, on the same condition the
		// rail itself is drawn.
		expect(shellSource).toMatch(
			/const cobroHosted = computed\(\(\) => railVisible\.value && paymentDialogOpen\.value\)/,
		);
		expect(shellSource).toContain('<CobroSurface v-if="cobroHosted" @band="onHostedBand" />');
	});

	it("keeps the sale mounted underneath, so backing out returns to the same cart", () => {
		// v-show, never v-if: the cart, its scroll position and its focus have
		// to survive a trip to the payment screen and back.
		expect(shellSource).toContain('v-show="!hostedDestinationId && !cobroHosted"');
		expect(shellSource).not.toMatch(/v-if="!cobroHosted"[\s\S]{0,40}dynamic-main-row/);
	});

	it("leaves the dialog only where there is no rail to host beside", () => {
		// 992–1099px still has the dialog breakpoint and not the rail's, and
		// below 992 the payment panel replaces the selector column untouched.
		expect(shellSource).toContain('v-if="usePaymentDialog && !railVisible"');
	});

	it("adopts the tender band and drops it when the surface goes", () => {
		expect(shellSource).toContain(
			'const HOSTED_BAND_KINDS = ["recharge", "change", "shortfall"];',
		);
		expect(shellSource).toMatch(/watch\(cobroHosted, \(\) => \{\s*hostedBandState\.value = null;/);
	});
});

// The grid is laid over the sections `Payments.vue` already has — there is no
// second markup tree to keep in step, so the layout is read off the stylesheet
// the same way the sections are read off the template.
const styles = paymentsSource.slice(paymentsSource.lastIndexOf("<style"));
const rule = (selector: string) => {
	const start = styles.indexOf(`${selector} {`);
	expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
	return styles.slice(start, styles.indexOf("}", start));
};

describe("three columns at 1440", () => {
	it("lays the sections out in three tracks", () => {
		const grid = rule(".payment-sections--cobro");
		expect(grid).toContain("display: grid");
		// COLUMNS only. The rows carry `minmax()` of their own now — they are
		// what keeps the surface one screen — so counting them here would read
		// six tracks where the artboard draws three.
		const columns = /grid-template-columns:([^;]+);/.exec(grid);
		expect(columns).not.toBeNull();
		expect((columns as RegExpExecArray)[1].match(/minmax\(0, [^)]+\)/g) ?? []).toHaveLength(3);
	});

	it("names an area for every section it renders, so none is auto-placed", () => {
		const grid = rule(".payment-sections--cobro");
		for (const area of [
			"readiness",
			"summary",
			"tender",
			"paper",
			"methods",
			"adjustments",
			"settlement",
			"meta",
		]) {
			expect(grid, `${area} is missing from grid-template-areas`).toContain(area);
			expect(
				styles,
				`nothing assigns grid-area: ${area} under --cobro`,
			).toMatch(new RegExp(`\\.payment-sections--cobro[^{]*\\{\\s*grid-area: ${area};`));
		}
	});

	it("sizes every content row so the grid cannot outgrow its box", () => {
		// The consolidation, stated as a property. An `auto` row is sized by its
		// content, so the tallest section would decide the height of the surface
		// and push the rest past the viewport the shell clips it to — which is
		// precisely how the hosted Cobro came to read as "the new screen with
		// the old one stacked below it".
		const rows = /grid-template-rows:([^;]+);/.exec(rule(".payment-sections--cobro"));
		expect(rows, "the cobro grid states no explicit rows").not.toBeNull();
		const tracks = (rows as RegExpExecArray)[1].trim().split(/\s+(?![^(]*\))/);

		// First is the readiness header (content-height, one row of chips), last
		// four are the two content rows per column plus the tip strip.
		expect(tracks[0]).toBe("auto");
		const contentTracks = tracks.slice(1);
		const autoTracks = contentTracks.filter((track) => track === "auto");
		// Exactly one `auto` survives: the restaurant tip's row, which has to
		// collapse to nothing on the registers that never draw it.
		expect(autoTracks).toHaveLength(1);
		for (const track of contentTracks.filter((track) => track !== "auto")) {
			expect(track, `${track} is not an fr row — it can grow past the box`).toMatch(
				/^minmax\(0,\s*[0-9.]+fr\)$/,
			);
		}
	});

	it("gives the tip strip an area, because it is the one child that is not a section", () => {
		// Without one it is AUTO-PLACED into an implicit sixth row, which is the
		// single remaining way this grid can overflow the box it is clipped to.
		expect(styles).toMatch(
			/\.payment-sections--cobro \.restaurant-tip \{\s*grid-area: tip;/,
		);
		expect(rule(".payment-sections--cobro")).toContain("tip");
	});

	it("makes each section the scrollport for its own cell", () => {
		const section = rule(".payment-sections--cobro .payment-section");
		expect(section).toContain("overflow-y: auto");
		// `min-height: 0` is the load-bearing half: a grid item defaults to
		// `min-height: auto` and refuses to shrink below its content.
		expect(section).toContain("min-height: 0");
	});

	it("stops the surface itself from scrolling, so the band stays put", () => {
		expect(paymentsSource).toContain(
			`:class="['payment-scroll', cobroMode ? 'overflow-hidden' : 'overflow-y-auto']"`,
		);
	});

	it("puts the WHY, the HOW and the PAPER in that order", () => {
		const areas = /grid-template-areas:([\s\S]*?);/.exec(rule(".payment-sections--cobro"));
		expect(areas).not.toBeNull();
		const rows = (areas as RegExpExecArray)[1]
			.split("\n")
			.map((row) => row.replace(/"/g, "").trim())
			.filter(Boolean);
		expect(rows[0]).toBe("readiness readiness readiness");
		expect(rows[1]).toBe("summary tender paper");
	});
});

describe("the legacy tail folds instead of stacking", () => {
	it("hides the settlement and print sections behind one disclosure, on Cobro only", () => {
		// Two sections, one control. Everywhere else the condition is constant
		// and both render outright, which is why it reads `!cobroMode ||`.
		expect(
			paymentsSource.match(/v-show="!cobroMode \|\| cobroDetailsExpanded"/g) ?? [],
		).toHaveLength(2);
		expect(paymentsSource).toContain('data-testid="cobro-more-options"');
		expect(paymentsSource).toContain(
			'aria-controls="payment-cobro-settlement payment-cobro-meta"',
		);
		expect(paymentsSource).toContain('id="payment-cobro-settlement"');
		expect(paymentsSource).toContain('id="payment-cobro-meta"');
	});

	it("keeps them MOUNTED, so a half-typed write-off survives the fold", () => {
		expect(paymentsSource).not.toMatch(/v-if="!cobroMode \|\| cobroDetailsExpanded"/);
	});

	it("draws the control in the column that answers what happens at close", () => {
		// Inside the paper section, after `Charge and print` — not a fourth
		// column and not a second primary.
		expect(paymentsSource).toMatch(
			/data-testid="cobro-charge-and-print"[\s\S]{0,900}data-testid="cobro-more-options"[\s\S]{0,400}<\/section>/,
		);
	});

	it("unfolds itself whenever a settlement the cashier engaged is inside it", () => {
		// The same rule `moreMethodsExpanded` applies to a typed second tender:
		// a disclosure may hide an untouched control, never an active one.
		// `is_cashback` is inverted because FALSE is the state that hides the
		// payment methods, and the switch that undoes it is in this section.
		expect(paymentsSource).toMatch(
			/const cobroDetailsExpanded = computed\(\s*\(\) =>\s*cobroDetailsOpen\.value \|\|\s*!is_cashback\.value \|\|\s*is_credit_sale\.value \|\|\s*is_credit_return\.value \|\|\s*is_write_off_change\.value \|\|\s*redeem_customer_credit\.value,/,
		);
	});

	it("reclaims the rows it folded away instead of leaving dead space", () => {
		const lean = rule(".payment-sections--cobro-lean");
		const rows = /grid-template-areas:([\s\S]*?);/
			.exec(lean)?.[1]
			.split("\n")
			.map((row) => row.replace(/"/g, "").trim())
			.filter(Boolean);
		expect(rows).toBeDefined();
		// The change card takes the whole column back — the sections below it
		// are `display: none`, and their cells would otherwise be two empty
		// rows under it.
		expect((rows as string[]).slice(1).every((row) => row.endsWith("paper"))).toBe(true);
		expect(paymentsSource).toContain(
			"'payment-sections--cobro-lean': cobroMode && !cobroDetailsExpanded,",
		);
	});

	it("starts the next sale folded, like the sheet's own disclosures", () => {
		expect(paymentsSource).toMatch(
			/moreMethodsOpen\.value = false;\s*breakdownOpen\.value = false;\s*cobroDetailsOpen\.value = false;/,
		);
	});

	it("drops the paid/outstanding pair the pad and the band already print", () => {
		// Three copies of two figures: the pad's «Pagos aplicados / Falta por
		// cubrir», the band's shortfall, and the summary's own read-only pair.
		// The change fields underneath are drawn nowhere else, so the flag is
		// scoped to the pair rather than to the component.
		expect(paymentsSource).toMatch(
			/<PaymentSummary\s+:hide-tendered="cobroMode"/,
		);
		expect((summarySource.match(/v-if="!hideTendered"/g) ?? []).length).toBe(2);
		expect(summarySource).toMatch(/hideTendered: \{\s*type: Boolean,\s*default: false,/);
	});

	it("borrows a label the register already ships in Spanish", () => {
		expect(paymentsSource).toContain('{{ __("More options") }}');
		expect(styles).toContain(".payment-disclosure");
	});
});

describe("the band owns the one number and the one action", () => {
	it("reads change once the received amount covers the sale", () => {
		const state = resolveBandState({ kind: "tender", total: 1129, received: 1200 });
		expect(state.kind).toBe("change");
		expect(state.value).toBe(71);
		expect(state.primaryAction.id).toBe("sale.collectAndClose");
		expect(state.primaryEnabled).toBe(true);
	});

	it("reads a shortfall, and refuses the action, until it does", () => {
		const state = resolveBandState({ kind: "tender", total: 1129, received: 500 });
		expect(state.kind).toBe("shortfall");
		expect(state.value).toBe(629);
		expect(state.primaryEnabled).toBe(false);
	});

	it("draws exactly one primary and one figure", () => {
		const band = mount(ActionBand, {
			props: {
				state: resolveBandState({ kind: "tender", total: 1129, received: 1200 }),
				formatCurrency: money,
			},
		});
		expect(band.findAll('[data-testid="band-primary"]')).toHaveLength(1);
		expect(band.findAll('[data-testid="band-value"]')).toHaveLength(1);
	});

	it("hands `sale.collectAndClose` up when the primary is pressed", async () => {
		const onPrimary = vi.fn();
		const band = mount(ActionBand, {
			props: {
				state: resolveBandState({ kind: "tender", total: 1129, received: 1200 }),
				formatCurrency: money,
				onPrimary,
			},
		});
		await band.find('[data-testid="band-primary"]').trigger("click");
		expect(onPrimary).toHaveBeenCalledWith("sale.collectAndClose");
	});

	it("reaches the SAME submit the dialog's button calls, one hop at a time", () => {
		// 1. the shell turns the press into the payment chord's own bus event…
		expect(shellSource).toMatch(
			/actionId === "sale\.collectAndClose"[\s\S]{0,600}eventBus\.emit\("queue_submit_payment_shortcut", \{ print: false \}\)/,
		);
		// 2. …which `Payments.vue` already listens for…
		expect(paymentsSource).toContain(
			'eventBus.on("queue_submit_payment_shortcut", queueShortcutSubmit)',
		);
		// 3. …and answers with `submit`, behind its own in-flight guard. No new
		// call site was added to the money path for this surface.
		expect(paymentsSource).toMatch(
			/const handleSubmitPaymentShortcut = \(\{ print = false \} = \{\} \) =>|const handleSubmitPaymentShortcut = \(\{ print = false \} = \{\}\) => \{[\s\S]{0,240}submit\(null, false, print\)/,
		);
	});

	it("renders no second primary and no second total on the surface", () => {
		// The footer is gone in cobro mode — Submit is the payment screen's one
		// accent and the band already carries it.
		expect(paymentsSource).toMatch(/<div\s+v-if="!cobroMode"\s+:class="\['payment-footer'/);

		// And the surface carries exactly ONE figure declared as the total —
		// the artboard's own `Total $1,129.00` inside the change card. The
		// pad claims none, `InvoiceTotals` and `PaymentSummary` declare no
		// roles at all, and the band's number is the CHANGE, not the total.
		const pad = mount(CobroTenderPad, { props: padProps([{ ...CASH }, { ...CARD }]) });
		const change = mount(CobroChangeCard, {
			props: { total: 1129, tendered: 1200, currency: "MXN", formatCurrency: money },
		});

		expect(pad.findAll('[data-money-role="total"]')).toHaveLength(0);
		const totals = change.findAll('[data-money-role="total"]');
		expect(totals).toHaveLength(1);
		expect(totals[0].attributes("data-testid")).toBe("movil-pay-total");

		for (const wrapper of [pad, change]) {
			expect(wrapper.findAll('[data-testid="band-primary"]')).toHaveLength(0);
		}
	});
});

describe("the pad writes through the register's own handlers", () => {
	it("commits the keyed amount as an `update-amount` on the target row", async () => {
		const onUpdateAmount = vi.fn();
		const rows = [{ ...CASH }, { ...CARD }];
		const pad = mount(CobroTenderPad, {
			props: { ...padProps(rows), "onUpdate-amount": onUpdateAmount },
		});

		for (const key of ["1", "2", "0", "0"]) {
			await pad.find(`[data-testid="movil-key-${key}"]`).trigger("click");
		}
		await pad.find('[data-testid="cobro-apply"]').trigger("click");

		expect(onUpdateAmount).toHaveBeenCalledTimes(1);
		// The row itself, not a copy — `handlePaymentAmountChange` writes
		// `payment.amount` in place. (Identity is through Vue's reactive proxy,
		// so the comparison is on the row's own name.)
		expect(onUpdateAmount.mock.calls[0][0].mode_of_payment).toBe(rows[0].mode_of_payment);
		expect(onUpdateAmount.mock.calls[0][1]).toBe(1200);
	});

	it("refuses to apply an empty buffer", async () => {
		const onUpdateAmount = vi.fn();
		const pad = mount(CobroTenderPad, {
			props: { ...padProps([{ ...CASH }]), "onUpdate-amount": onUpdateAmount },
		});
		expect(
			pad.find('[data-testid="cobro-apply"]').attributes("disabled"),
		).toBeDefined();
		await pad.find('[data-testid="cobro-apply"]').trigger("click");
		expect(onUpdateAmount).not.toHaveBeenCalled();
	});

	it("`Exacto` and a tender chip are the register's `set-full-amount`", async () => {
		const onSetFullAmount = vi.fn();
		const rows = [{ ...CASH }, { ...CARD }];
		const pad = mount(CobroTenderPad, {
			props: { ...padProps(rows), "onSet-full-amount": onSetFullAmount },
		});

		await pad.find('[data-testid="cobro-exact"]').trigger("click");
		expect(onSetFullAmount).toHaveBeenLastCalledWith(rows[0], false);

		await pad.find('[data-testid="cobro-tender-Tarjeta"]').trigger("click");
		expect(onSetFullAmount).toHaveBeenLastCalledWith(rows[1], false);
	});

	it("the preset chips are the register's smart tender suggestions", async () => {
		const onSetDenomination = vi.fn();
		const rows = [{ ...CASH }];
		const pad = mount(CobroTenderPad, {
			props: { ...padProps(rows), "onSet-denomination": onSetDenomination },
		});

		expect(pad.findAll('[data-money-role="preset"]')).toHaveLength(4);
		await pad.find('[data-testid="cobro-preset-1200"]').trigger("click");
		expect(onSetDenomination).toHaveBeenCalledWith(rows[0], 1200);
	});

	it("lights the row that carries the money, not a second store", async () => {
		const rows = [{ ...CASH }, { ...CARD, amount: 1129 }];
		const pad = mount(CobroTenderPad, { props: padProps(rows) });
		await nextTick();

		expect(pad.find('[data-testid="cobro-tender-Tarjeta"]').attributes("data-armed")).toBe(
			"true",
		);
		expect(pad.find('[data-testid="cobro-tender-Efectivo"]').attributes("data-armed")).toBe(
			"false",
		);
		expect(pad.find('[data-testid="cobro-received"]').text()).toBe(money(1129));
	});

	it("emits nothing the payment cards do not already emit", () => {
		// The pad reaches `handlePaymentAmountChange`, `set_full_amount` and
		// `setPaymentToDenomination` through `PaymentMethods`' own contract.
		// A fourth event here would be a new seam on the money path.
		expect(paymentsSource).toMatch(/<CobroTenderPad[\s\S]{0,900}v-on="paymentMethodsHandlers"/);
	});

	it("draws no split hint, because no split flow exists to bind (R8)", () => {
		const pad = mount(CobroTenderPad, { props: padProps([{ ...CASH }]) });
		expect(pad.find('[data-testid="movil-key-split"]').attributes("disabled")).toBeDefined();
		expect(pad.text()).not.toMatch(/F6/);
	});
});

describe("what the surface refuses to draw", () => {
	it("promises only what closing the sale really does", () => {
		const off = mount(CobroOnClose, { props: { itemCount: 9, updatesStock: false } });
		expect(off.find('[data-testid="cobro-on-close"]').exists()).toBe(false);

		const on = mount(CobroOnClose, { props: { itemCount: 9, updatesStock: true } });
		expect(on.find('[data-testid="cobro-promise-stock"]').text()).toContain("9");
		// The artboard's other three rows are absent: printing is never
		// automatic, the register does not stamp at close, and there is no
		// send path on this screen.
		expect(on.findAll("[data-testid^='cobro-promise-']")).toHaveLength(1);
	});

	it("draws no Facturar column, because the register does not stamp at close", () => {
		const paper = mount(CobroChangeCard, {
			props: { total: 1129, tendered: 1200, currency: "MXN", formatCurrency: money },
		});
		const text = paper.text();
		expect(text).not.toMatch(/CFDI/i);
		expect(text).not.toMatch(/timbre|stamp/i);
		expect(text).not.toMatch(/whatsapp/i);
	});

	it("masks the RFC it does have, and draws no card for a customer without one", () => {
		const none = mount(CobroChangeCard, {
			props: { total: 1129, tendered: 1200, currency: "MXN", formatCurrency: money },
		});
		expect(none.find('[data-testid="cobro-fiscal"]').exists()).toBe(false);

		const some = mount(CobroChangeCard, {
			props: {
				total: 1129,
				tendered: 1200,
				currency: "MXN",
				formatCurrency: money,
				taxId: "RIBA850101M4",
			},
		});
		const rfc = some.find('[data-testid="cobro-rfc"]').text();
		expect(rfc.startsWith("RIBA")).toBe(true);
		expect(rfc.endsWith("M4")).toBe(true);
		expect(rfc).not.toContain("850101");
	});

	it("suggests the change in notes, from the corte's own denomination table", () => {
		const paper = mount(CobroChangeCard, {
			props: { total: 1129, tendered: 1200, currency: "MXN", formatCurrency: money },
		});
		expect(paper.find('[data-testid="movil-change-amount"]').text()).toBe(money(71));
		expect(paper.findAll('[data-testid="movil-change-note"]').length).toBeGreaterThan(0);
	});
});

describe("Volver a la venta is the cancel path that already exists", () => {
	it("hands `back` up when pressed", async () => {
		const onBack = vi.fn();
		const header = mount(PaymentReadinessHeader, { props: { onBack } });
		await header.find('[data-testid="pay-back-to-sale"]').trigger("click");
		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("is bound to `cancel_payment()`, which lowers the flag the surface rides on", () => {
		expect(paymentsSource).toMatch(/<PaymentReadinessHeader[\s\S]{0,200}@back="cancel_payment\(\)"/);
		// `paymentDialogOpen` is still the register's word for "the payment
		// screen is up"; only WHERE it lands changed, so the existing exit
		// closes the hosted surface without a second path being invented.
		expect(paymentsSource).toMatch(
			/if \(paymentDialogOpen\.value\) \{[\s\S]{0,320}uiStore\.closePaymentDialog\(\)/,
		);
	});
});

describe("the money path is untouched", () => {
	it("adds a layout prop and nothing else to Payments.vue's contract", () => {
		expect(paymentsSource).toMatch(/cobroMode: \{\s*type: Boolean,\s*default: false,\s*\},/);
		// No emit and no expose were added for the chrome: the surface reads
		// the invoice document the register already writes.
		expect(paymentsSource).not.toContain("defineEmits");
		expect(paymentsSource.match(/defineExpose\(/g) ?? []).toHaveLength(1);
		expect(paymentsSource).toContain("defineExpose({\n\tfocusFirstPaymentTarget,\n});");
	});

	it("keeps `Charge and print` on the submit the footer always used", () => {
		expect(paymentsSource).toMatch(
			/data-testid="cobro-charge-and-print"[\s\S]{0,200}@click="submit\(undefined, false, true\)"/,
		);
	});
});
