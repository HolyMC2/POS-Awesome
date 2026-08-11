import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Payments.vue cannot be imported under vitest — it pulls the whole payment
// stack (stores, offline db, printing) through `.js` specifiers that only
// resolve in the vite pipeline — so the compact-sheet contract is pinned at
// source level, the same way tests/invoiceCompactSaleDetails.spec.ts pins the
// cart's disclosure and tests/posShellDrafts.spec.ts pins the shell rail.
const source = readFileSync(
	resolve("src/posapp/components/pos/Payments.vue"),
	"utf8",
);

// Comments stripped: the selector that was removed is named in the comment
// explaining why, and a plain text search would find it there.
const actionButtonsSource = readFileSync(
	resolve("src/posapp/components/pos/payments/PaymentActionButtons.vue"),
	"utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const styleBlock = source.slice(source.lastIndexOf("<style"));

/** Body (with header) of the brace-matched block opened at `start`. */
const blockFrom = (css: string, start: number) => {
	expect(start).toBeGreaterThan(-1);
	let depth = 0;
	for (let index = css.indexOf("{", start); index < css.length; index += 1) {
		if (css[index] === "{") depth += 1;
		if (css[index] === "}") {
			depth -= 1;
			if (depth === 0) return css.slice(start, index + 1);
		}
	}
	throw new Error(`unterminated block at offset ${start}`);
};

const mediaBlock = (query: string) =>
	blockFrom(styleBlock, styleBlock.indexOf(query));

const compactSheetBlock = mediaBlock("@media (max-width: 1099px)");
const phoneBlock = mediaBlock("@media (max-width: 768px)");

const ruleFor = (block: string, selector: string) => {
	const start = block.indexOf(`${selector} {`);
	expect(start).toBeGreaterThan(-1);
	return block.slice(start, block.indexOf("}", start));
};

describe("payment action bar anchoring", () => {
	it("marks the inline shell and its footer as anchored, the dialog as dialog", () => {
		expect(source).toContain(
			"dialogMode ? 'payment-shell--dialog' : 'payment-shell--anchored'",
		);
		expect(source).toContain(
			"dialogMode ? 'payment-footer--dialog' : 'payment-footer--anchored'",
		);
	});

	it("makes the compact shell a height-constrained flex column", () => {
		const shell = ruleFor(compactSheetBlock, ".payment-shell--anchored");
		expect(shell).toContain("display: flex");
		expect(shell).toContain("flex-direction: column");
		expect(shell).toContain("overflow: hidden");
		// Measured top offset, minus the dock the shell already reserves.
		expect(shell).toContain("var(--payment-shell-space");
		expect(shell).toContain("var(--bottom-safe-space, 0px)");
	});

	it("puts the scroll inside the card, so nothing can render past the bar", () => {
		const scroll = ruleFor(
			compactSheetBlock,
			".payment-shell--anchored .payment-scroll",
		);
		expect(scroll).toContain("overflow-y: auto");
		// Without min-height:0 a flex item refuses to shrink below its content
		// and the scrollport never forms.
		expect(scroll).toContain("min-height: 0");

		const card = ruleFor(
			compactSheetBlock,
			".payment-shell--anchored .payment-card",
		);
		expect(card).toContain("flex: 1 1 auto");
		expect(card).toContain("min-height: 0");
		expect(card).toContain("overflow: hidden");
		// v-card is display:block by default; the scrollport's flex/min-height
		// only exist inside a flex parent. Without these two lines the sheet
		// clipped instead of scrolling and every method below the fold was
		// unreachable (prod, 2026-08-10).
		expect(card).toContain("display: flex");
		expect(card).toContain("flex-direction: column");
	});

	it("anchors the bar as a flex sibling below the scrollport, not sticky", () => {
		const footer = ruleFor(compactSheetBlock, ".payment-footer--anchored");
		expect(footer).toContain("position: static");
		expect(footer).toContain("flex: 0 0 auto");
		// Opaque — content used to show through the gradient, and the white
		// stop washed the bar's top edge in dark mode.
		expect(footer).toContain("background: var(--pos-surface)");
		expect(footer).not.toContain("linear-gradient");
	});

	it("drops the sticky lift the floating band came from", () => {
		// The old rule pinned the footer `--bottom-safe-space` above the
		// viewport floor *while it still scrolled*, which is what pulled it up
		// into the middle of the card.
		expect(styleBlock).not.toContain(
			"bottom: calc(var(--bottom-safe-space, 0px) + 8px)",
		);
		expect(phoneBlock).not.toContain("position: sticky");
	});

	it("stops the phone block from forcing the panel to grow", () => {
		// `overflow: visible !important` on the scrollport and `min-height:
		// auto` on a flex child are the two declarations that made the panel
		// page-tall; either one alone re-opens the bug.
		expect(phoneBlock).not.toContain("overflow: visible !important");
		expect(phoneBlock).not.toContain("min-height: auto");
	});

	it("keeps the sheet rules last so they win the ties they make", () => {
		// Several selectors here tie on specificity with the phone block
		// (`.payment-shell--anchored` vs `.payment-shell`), so source order is
		// load-bearing, not cosmetic.
		expect(
			styleBlock.indexOf("@media (max-width: 1099px)"),
		).toBeGreaterThan(styleBlock.indexOf("@media (max-width: 768px)"));
	});

	it("keeps the bar's own compact sizing off a dead :deep selector", () => {
		// `.compact` is PaymentActionButtons' root, so the mirrored
		// `:deep(.compact .v-btn)` compiled to `[data-v-x] .compact .v-btn` and
		// matched nothing — the root cannot be its own descendant. Same trap
		// the last two waves each shipped one of.
		expect(actionButtonsSource).toContain(".compact :deep(.v-btn)");
		expect(actionButtonsSource).not.toContain(":deep(.compact ");
	});

	it("leaves desktop and the dialog on their own rules", () => {
		// Nothing in the compact block may reach a dialog-mode element.
		expect(compactSheetBlock).not.toContain("--dialog");
		const dialogShell = ruleFor(styleBlock, ".payment-shell--dialog");
		expect(dialogShell).toContain("height: calc(100dvh - 48px)");
	});
});

describe("payment method disclosure", () => {
	it("shows the default method full size and collapses the rest on phones", () => {
		expect(source).toContain(
			':payments="compactPaymentLayout ? primaryPaymentMethods : visiblePaymentMethods"',
		);
		expect(source).toContain(':payments="secondaryPaymentMethods"');
		expect(source).toMatch(
			/v-if="compactPaymentLayout && secondaryPaymentMethods\.length"/,
		);
	});

	it("picks the profile default, falling back to the first visible line", () => {
		expect(source).toMatch(
			/primaryPaymentMethod = computed\(\(\) => \{[\s\S]*?payment\?\.default === 1[\s\S]*?\|\| methods\[0\]/,
		);
	});

	it("feeds both lists the same props and handlers", () => {
		// Two hand-written prop lists would drift; one binding cannot.
		const bindings = source.match(
			/v-bind="paymentMethodsProps"\s*\n\s*v-on="paymentMethodsHandlers"/g,
		);
		expect(bindings).toHaveLength(2);
		for (const event of [
			"update-amount",
			"set-full-amount",
			"set-denomination",
			"mpesa-dialog",
			"request-payment",
			"set-rest-amount",
			"open-gift-card",
		]) {
			expect(source).toContain(`"${event}":`);
		}
	});

	it("holds the disclosure open while any collapsed method carries an amount", () => {
		expect(source).toMatch(
			/secondaryMethodsHaveAmount = computed\([\s\S]*?payment\?\.amount \|\| 0[\s\S]*?!== 0/,
		);
		expect(source).toContain(
			"() => moreMethodsOpen.value || secondaryMethodsHaveAmount.value",
		);
	});

	it("wires the disclosure for assistive tech", () => {
		expect(source).toContain('aria-controls="payment-more-methods"');
		expect(source).toContain('id="payment-more-methods"');
		expect(source).toContain(
			":aria-expanded=\"moreMethodsExpanded ? 'true' : 'false'\"",
		);
	});

	it("keeps the collapsed methods mounted so their state survives a toggle", () => {
		expect(source).toContain('v-show="moreMethodsExpanded"');
	});
});

describe("condensed payment summary", () => {
	it("leads the phone summary with the amount to charge", () => {
		expect(source).toMatch(
			/v-if="compactPaymentLayout && invoice_doc" class="payment-total-strip"/,
		);
		expect(source).toContain("formatCurrency(invoiceChargeTotal");
	});

	it("charges the same total the To Be Paid field is derived from", () => {
		// usePaymentCalculations picks grand_total for a foreign-currency
		// invoice under multi-currency and the rounded total otherwise; the
		// strip must not invent its own rule.
		expect(source).toMatch(
			/invoiceChargeTotal = computed\(\(\) => \{[\s\S]*?posa_allow_multi_currency && doc\.currency !== profile\.currency[\s\S]*?doc\.grand_total[\s\S]*?doc\.rounded_total \|\| doc\.grand_total/,
		);
	});

	it("puts the nine-field breakdown behind a toggle on phones only", () => {
		expect(source).toContain('aria-controls="payment-totals-breakdown"');
		expect(source).toContain('id="payment-totals-breakdown"');
		expect(source).toContain(
			'v-show="!compactPaymentLayout || breakdownOpen"',
		);
		expect(source).toMatch(
			/v-if="compactPaymentLayout"[\s\S]{0,400}toggleBreakdown\(\)/,
		);
	});
});

describe("compact layout measurement", () => {
	it("never treats dialog mode as compact", () => {
		expect(source).toContain(
			"compactPaymentLayout.value = !props.dialogMode && window.innerWidth < COMPACT_PAYMENT_WIDTH",
		);
		expect(source).toContain("const COMPACT_PAYMENT_WIDTH = 1100;");
	});

	it("measures the panel's document-relative top, not its scrolled top", () => {
		// Arriving from a scrolled cart view would otherwise measure a panel
		// taller than the viewport.
		expect(source).toContain(
			"el.getBoundingClientRect().top + (window.scrollY || 0)",
		);
	});

	it("re-measures on resize and drops the listeners on unmount", () => {
		expect(source).toContain(
			'window.addEventListener("resize", scheduleShellMeasure)',
		);
		expect(source).toContain(
			'window.addEventListener("orientationchange", scheduleShellMeasure)',
		);
		expect(source).toContain(
			'window.removeEventListener("resize", scheduleShellMeasure)',
		);
		expect(source).toContain(
			'window.removeEventListener("orientationchange", scheduleShellMeasure)',
		);
	});

	it("reopens the next sale as a sheet, not where this one was left", () => {
		expect(source).toMatch(
			/moreMethodsOpen\.value = false;\s*\n\s*breakdownOpen\.value = false;/,
		);
	});
});

describe("leaving the payment view", () => {
	const cancelBody = (() => {
		const start = source.indexOf("const cancel_payment = (");
		expect(start).toBeGreaterThan(-1);
		return source.slice(start, source.indexOf("\n};", start));
	})();

	const backBody = (() => {
		const start = source.indexOf("const back_to_invoice = (");
		expect(start).toBeGreaterThan(-1);
		return source.slice(start, source.indexOf("\n};", start));
	})();

	it("routes Cancel Payment through the cancel exit, not the post-submit one", () => {
		expect(source).toContain('@cancel="cancel_payment()"');
		expect(source).not.toContain('@cancel="back_to_invoice"');
	});

	it("asks the shell for the cart instead of writing the panel state itself", () => {
		expect(cancelBody).toContain('eventBus?.emit?.("show_invoice_panel")');
		// compactPanel and the activeView watcher are the shell's to
		// reconcile; half of that move made from here loses the race.
		expect(cancelBody).not.toContain("set_compact_panel");
	});

	it("keeps a Browse fallback so an unhandled event cannot strand the cashier", () => {
		expect(cancelBody).toMatch(
			/emit\?\.\("show_invoice_panel"\)[\s\S]*?if \(activeView\.value === "payment"\)[\s\S]*?setActiveView\("items"\)/,
		);
	});

	it("leaves the post-submit exit on Browse", () => {
		// A submitted (often cleared) sale has no cart to return to; the next
		// one starts at item search.
		expect(backBody).toContain('uiStore.setActiveView("items")');
		expect(backBody).not.toContain("show_invoice_panel");
		expect(source).toMatch(
			/finishSubmissionNavigation = \([\s\S]{0,200}?back_to_invoice\(\);/,
		);
	});

	it("does not steal focus from the customer form the phone path just opened", () => {
		expect(source).toContain(
			"onBackToInvoice: () => cancel_payment({ refocusSearch: false })",
		);
	});

	it("keeps the desk dialog closing exactly as it did", () => {
		expect(cancelBody).toMatch(
			/if \(paymentDialogOpen\.value\) \{[\s\S]*?closePaymentDialog\(\)[\s\S]*?queueSearchRefocusRecovery\(\)[\s\S]*?return;/,
		);
	});
});
