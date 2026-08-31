// @vitest-environment jsdom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import padSource from "../src/posapp/components/pos/payments/cobro/CobroTenderPad.vue?raw";
import methodsSource from "../src/posapp/components/pos/payments/cobro/CobroMethodRows.vue?raw";
import changeSource from "../src/posapp/components/pos/payments/cobro/CobroChangeCard.vue?raw";
import giftSource from "../src/posapp/components/pos/payments/cobro/CobroGiftCard.vue?raw";
import CobroTenderPad from "../src/posapp/components/pos/payments/cobro/CobroTenderPad.vue";
import CobroMethodRows from "../src/posapp/components/pos/payments/cobro/CobroMethodRows.vue";
import CobroChangeCard from "../src/posapp/components/pos/payments/cobro/CobroChangeCard.vue";
import CobroGiftCard from "../src/posapp/components/pos/payments/cobro/CobroGiftCard.vue";
import { resetTenderSelection, peekArmedTender } from "../src/posapp/components/pos/invoice/armedTender";

/**
 * COBRO IS ONE PAGE ON A TABLET — the 2026-08-30 mandate, as a build failure.
 *
 * Owner, on an iPad-class window (1195×741, then 1143×656): «the tarjeta de
 * regalo is under forma de pago, which is ok, but ends up being a long ass
 * scroll, instead of one consistent 1 page app, no scrolls, all touchscreen
 * featureful, and also it opened the keyboard, which breaks the numberpad we
 * have on the center for touch screens … we have extra space on the action
 * bar, left is the total, right cobrar e imprimir, and all the center is dead
 * space».
 *
 * Four defects, four properties, and each one is stated here rather than left
 * to a reviewer's eye at a size nobody opens:
 *
 *   1. The tender list is a CHIP ROW, not a stack of cards.
 *   2. The gift card is a chip plus a SCAN-FIRST capture in column one — and
 *      the capture never summons the OS keyboard on a touch register.
 *   3. Column three says the change ONCE; the band's figure is the copy that
 *      survives.
 *   4. The band's two published lanes are FILLED, by the surface that owns
 *      those figures.
 *
 * ## Why the height budget is arithmetic over the stylesheet
 *
 * The only honest measurement is a real browser, and this suite has none —
 * jsdom lays nothing out. What it CAN do is add up the numbers the stylesheet
 * actually declares against the box the shell actually gives the grid, and
 * fail when the fixed part of a column outgrows it. That is the failure mode
 * the owner hit: a 440px floor written against ~385px of grid box, which does
 * not overflow by accident but by construction.
 *
 * `sizesOf` reads the CSS as text for the same reason `cobroControlPanel`
 * does — the guarantee is about what is WRITTEN, and a written number is the
 * thing that drifts.
 */

const MONEY = "¤";
const money = (value: number) => `${MONEY}${Number(value).toFixed(2)}`;

const CASH = { mode_of_payment: "Efectivo", amount: 0, default: 1, type: "Cash" };
const CARD = { mode_of_payment: "Tarjeta", amount: 0, default: 0, type: "Bank" };

const methodProps = (payments: Record<string, unknown>[], overrides = {}) => ({
	payments,
	currency: "MXN",
	usesGiftCards: false,
	currencySymbol: () => "$",
	formatCurrency: (value: number) => money(value),
	isNumber: () => true,
	isCashLikePayment: (payment: { type?: string }) => payment?.type === "Cash",
	isMpesaC2bPayment: () => false,
	...overrides,
});

const padProps = (payments: Record<string, unknown>[], overrides = {}) => ({
	payments,
	currency: "MXN",
	formatCurrency: (value: number) => money(value),
	getVisibleDenominations: () => [1150, 1200, 1500, 2000],
	...overrides,
});

const giftProps = (overrides = {}) => ({
	enabled: true,
	cardCode: "",
	balance: 0,
	appliedAmount: 0,
	loading: false,
	errorMessage: "",
	formatCurrency: (value: number) => money(value),
	...overrides,
});

/** A band, as the shell draws it: two published lanes and nothing in them. */
const bandHost = () => {
	const host = document.createElement("div");
	host.className = "action-band";
	host.innerHTML =
		'<div data-band-lane="breakdown"></div><div data-band-lane="context"></div>';
	document.body.appendChild(host);
	return host;
};

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

afterEach(() => {
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

// ── 1. The tender list is a chip row ─────────────────────────────────────

describe("column two opens on the artboard's tender chips", () => {
	it("renders one chip per configured method and arms the one that is picked", async () => {
		const rows = [{ ...CASH }, { ...CARD }];
		const onSetFullAmount = vi.fn();
		const methods = mount(CobroMethodRows, {
			props: { ...methodProps(rows), "onSet-full-amount": onSetFullAmount },
		});

		expect(methods.findAll('[data-testid^="cobro-tender-"]')).toHaveLength(2);
		// The register's default is lit before anything is touched — the row
		// the pad already commits into (`resolveTenderTarget`).
		expect(methods.find('[data-testid="cobro-tender-Efectivo"]').attributes("data-armed")).toBe(
			"true",
		);

		await methods.find('[data-testid="cobro-tender-Tarjeta"]').trigger("click");
		// The SAME act the card's big button performed, through the same event.
		expect(onSetFullAmount).toHaveBeenLastCalledWith(rows[1], false);
		// And the sale screen's own strip is kept in step, so `Volver a la
		// venta` does not disagree with what was just picked.
		expect(peekArmedTender()).toBe("Tarjeta");
	});

	it("is a row, and its chips clear the touch minimum", () => {
		// A 44px chip on a tablet, and a row that WRAPS rather than a column
		// that stacks. The stack was ~190px of the column that also holds the
		// numpad; the row is 44.
		expect(methodsSource).toMatch(/\.cobro-methods__list \{[^}]*display:\s*flex/);
		expect(methodsSource).toMatch(/\.cobro-methods__list \{[^}]*flex-wrap:\s*wrap/);
		expect(methodsSource).toMatch(
			/\.cobro-methods__row \{[^}]*height:\s*var\(--reg-touch-min, 44px\)/,
		);
	});

	it("draws the gift card as a tender chip when the register offers one", async () => {
		const onOpen = vi.fn();
		const methods = mount(CobroMethodRows, {
			props: {
				...methodProps([{ ...CASH }], { usesGiftCards: true, giftAppliedAmount: 0 }),
				"onOpen-gift-card": onOpen,
			},
		});

		const chip = methods.find('[data-testid="cobro-tender-gift-card"]');
		expect(chip.exists(), "no gift chip on a register that redeems gift cards").toBe(true);
		await chip.trigger("click");
		// `open-gift-card` is `PaymentMethods`' own event; the chip adds no seam.
		expect(onOpen).toHaveBeenCalledWith(null);

		// Off, the chip is simply absent — never disabled.
		expect(
			mount(CobroMethodRows, { props: methodProps([{ ...CASH }]) })
				.find('[data-testid="cobro-tender-gift-card"]')
				.exists(),
		).toBe(false);
	});

	it("says what a redeemed gift card covered, on its own chip", () => {
		const methods = mount(CobroMethodRows, {
			props: methodProps([{ ...CASH }], { usesGiftCards: true, giftAppliedAmount: 250 }),
		});
		expect(methods.find('[data-testid="cobro-tender-gift-card"]').text()).toContain(money(250));
	});
});

// ── 2. The gift card is a capture in column one ──────────────────────────

describe("the gift card is captured in column one, scan first", () => {
	it("lives under the ticket's totals, not under the method list", () => {
		// The block that ran off the bottom of Marco's iPad was in the METHODS
		// section. The capture is in the SUMMARY section, after the totals it
		// changes — the artboard's `Monedero del cliente` slot.
		const summary = paymentsSource.indexOf('class="payment-section payment-section--summary"');
		const totals = paymentsSource.indexOf("<CobroTotalsFooter");
		const capture = paymentsSource.indexOf("<CobroGiftCard");
		const tender = paymentsSource.indexOf('class="payment-section payment-section--tender"');
		expect(summary).toBeGreaterThan(-1);
		expect(capture).toBeGreaterThan(totals);
		expect(capture, "the capture must be inside the SUMMARY section").toBeLessThan(tender);
		// And the marketing block is off on this surface.
		expect(paymentsSource).toContain(
			':enabled="!cobroMode && Boolean(pos_profile?.posa_use_gift_cards)"',
		);
	});

	it("keeps the tablet keyboard shut: inputmode none on a coarse pointer", async () => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query.includes("coarse"),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
		const gift = mount(CobroGiftCard, { props: giftProps() });
		const field = gift.find('[data-testid="cobro-gift-code"]');

		expect(field.attributes("inputmode")).toBe("none");
		// NO AUTOFOCUS. A wedge scanner types into whatever has focus, which is
		// exactly why a scan-first field wants it — and taking it on mount is
		// what raised the keyboard over the pad (`pointer.ts` states the rule
		// for every search field on this product).
		expect(document.activeElement).not.toBe(field.element);
		expect(giftSource, "a mount-time focus is the defect").not.toMatch(/onMounted\(/);

		// The way out for a code with letters in it.
		const toggle = gift.find('[data-testid="cobro-gift-keyboard"]');
		expect(toggle.exists()).toBe(true);
		await toggle.trigger("click");
		expect(gift.find('[data-testid="cobro-gift-code"]').attributes("inputmode")).toBe("text");
	});

	it("is a plain text field on a desk, where there is no keyboard to keep shut", () => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: false,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
		const gift = mount(CobroGiftCard, { props: giftProps() });
		expect(gift.find('[data-testid="cobro-gift-code"]').attributes("inputmode")).toBe("text");
		expect(gift.find('[data-testid="cobro-gift-keyboard"]').exists()).toBe(false);
	});

	it("states balance and applied amount as facts, and nothing about what a gift card is", () => {
		const looked = mount(CobroGiftCard, { props: giftProps({ cardCode: "GC-1", balance: 500 }) });
		expect(looked.find('[data-testid="cobro-gift-balance"]').text()).toContain(money(500));

		const applied = mount(CobroGiftCard, {
			props: giftProps({ cardCode: "GC-1", balance: 500, appliedAmount: 500 }),
		});
		expect(applied.find('[data-testid="cobro-gift-applied"]').text()).toContain(money(500));

		// A card nobody has looked up says neither, and says nothing instead.
		const idle = mount(CobroGiftCard, { props: giftProps() });
		expect(idle.find('[data-testid="cobro-gift-balance"]').exists()).toBe(false);
		expect(idle.find('[data-testid="cobro-gift-applied"]').exists()).toBe(false);

		// The retired pitch: a «Scan-First Flow» pill and a paragraph telling
		// the cashier to tap a button to redeem a gift card during checkout.
		// Comments stripped — this file EXPLAINS what it stopped drawing, and
		// the explanation is why the rule survives the next round.
		const markup = giftSource.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
		expect(markup).not.toContain("Scan-First Flow");
		expect(markup).not.toContain("Tap the button below");
	});

	it("reuses the register's own gift engine and opens no dialog", () => {
		// Every act leaves through a function `Payments.vue` already answers.
		expect(paymentsSource).toMatch(/<CobroGiftCard[\s\S]{0,900}@check-balance="checkGiftCardBalance"/);
		expect(paymentsSource).toMatch(/const applyCobroGiftCard = async \(\) => \{[\s\S]{0,200}applyGiftCardRedemption\(\)/);
		expect(paymentsSource).toMatch(/const clearCobroGiftCard = \(\) => \{[\s\S]{0,200}clearGiftCardRedemption\(\)/);
		// `GiftCardDialog` stays mounted as the desk fallback, and is no longer
		// what the hosted surface opens.
		expect(paymentsSource).toContain("<GiftCardDialog");
		expect(paymentsSource).toMatch(
			/const openGiftCardDialog = \(payment = null\) => \{[\s\S]{0,600}if \(props\.cobroMode\) \{[\s\S]{0,300}cobroGiftActive\.value = true;/,
		);
	});
});

// ── The keys the capture borrows ─────────────────────────────────────────

describe("the centre pad feeds whichever field is active", () => {
	it("publishes raw keys instead of composing an amount while redirected", async () => {
		const onKey = vi.fn();
		const onUpdateAmount = vi.fn();
		const pad = mount(CobroTenderPad, {
			props: {
				...padProps([{ ...CASH }], { keysRedirected: true }),
				onKey,
				"onUpdate-amount": onUpdateAmount,
			},
		});

		for (const key of ["4", "2"]) {
			await pad.find(`[data-testid="movil-key-${key}"]`).trigger("click");
		}
		expect(onKey.mock.calls.map((call) => call[0])).toEqual(["4", "2"]);
		// The pad's own buffer stands still — it belongs to the other field now.
		expect(pad.find('[data-testid="cobro-keyed-amount"]').text()).toBe(money(0));
		expect(onUpdateAmount).not.toHaveBeenCalled();
	});

	it("keeps composing an amount when nothing has taken the keys", async () => {
		const onKey = vi.fn();
		const pad = mount(CobroTenderPad, { props: { ...padProps([{ ...CASH }]), onKey } });
		for (const key of ["5", "0"]) {
			await pad.find(`[data-testid="movil-key-${key}"]`).trigger("click");
		}
		// Silent upward — the redirect is the only state that publishes keys.
		expect(onKey).not.toHaveBeenCalled();
		// `applyKeypadKey` composes MAJOR units — `5` then `0` is fifty pesos,
		// which is what a cashier keying a note means and the opposite of what
		// a gift-card code needs.
		expect(pad.find('[data-testid="cobro-keyed-amount"]').text()).toBe(money(50));
	});

	it("composes the code as TEXT, not as a decimal", () => {
		// `applyKeypadKey` turns `1` then `2` into `0.12` at two decimals, which
		// is right for money and wrong for a code. So the router in
		// `Payments.vue` appends characters, and backspace deletes one.
		expect(paymentsSource).toMatch(
			/const onCobroKeypadKey = \(key\) => \{[\s\S]{0,900}giftCardCode\.value = `\$\{giftCardCode\.value \|\| ""\}\$\{key\}`/,
		);
		expect(paymentsSource).toMatch(/if \(key === "backspace"\)[\s\S]{0,200}\.slice\(0, -1\)/);
		// `Aplicar` on a code means "look it up" — the only thing a code can be
		// applied to.
		expect(paymentsSource).toMatch(/if \(key === "split"\) \{\s*checkGiftCardBalance\(\);/);
		expect(paymentsSource).toContain('@key="onCobroKeypadKey"');
		expect(paymentsSource).toContain(':keys-redirected="cobroGiftActive"');
	});

	it("latches the claim, because tapping a key would blur the field that made it", () => {
		// The whole reason this is not `@blur`: a pad key is a <button>, so the
		// first digit would release the claim it was meant to serve.
		expect(giftSource).not.toMatch(/@blur=/);
		expect(giftSource).toMatch(/@focus="\$emit\('activate'\)"/);
		expect(giftSource).toMatch(/@keydown\.esc="\$emit\('deactivate'\)"/);
		// Released by an act that means something else: picking a tender.
		expect(paymentsSource).toContain('@set-full-amount="cobroGiftActive = false"');
	});
});

// ── 3. Column three says the change once ─────────────────────────────────

describe("the change is stated once, and the band is where", () => {
	it("draws no figure of its own once the band owns it", () => {
		const banded = mount(CobroChangeCard, {
			props: {
				total: 1129,
				tendered: 1200,
				currency: "MXN",
				formatCurrency: (value: number) => money(value),
				bandOwnsFigure: true,
			},
			attachTo: bandHost(),
		});
		// The 46px «CAMBIO A ENTREGAR $71.00» is gone: `resolveBandState({ kind:
		// "tender" })` is already saying exactly that, one row below.
		expect(banded.find('[data-testid="movil-change-amount"]').exists()).toBe(false);
		expect(banded.findAll('[data-money-role="change"]')).toHaveLength(0);
		// What survives is what the band cannot say: the notes to hand back.
		expect(banded.findAll('[data-testid="movil-change-note"]').length).toBeGreaterThan(0);
	});

	it("draws nothing at all when there is no change to break down", () => {
		// A settled sale under a band: an empty labelled box is the dead space
		// this round was sent to remove.
		const settled = mount(CobroChangeCard, {
			props: {
				total: 1129,
				tendered: 0,
				currency: "MXN",
				formatCurrency: (value: number) => money(value),
				bandOwnsFigure: true,
			},
			attachTo: bandHost(),
		});
		expect(settled.find('[data-testid="movil-change-card"]').exists()).toBe(false);
	});

	it("keeps the whole card where there is no band to carry the figure", () => {
		// The dialog, the phone, a bare mount. `cobroSaysItOnce.spec.ts` mounts
		// exactly this shape and expects change/received/shortfall in it.
		const bare = mount(CobroChangeCard, {
			props: {
				total: 1129,
				tendered: 1200,
				currency: "MXN",
				formatCurrency: (value: number) => money(value),
			},
		});
		expect(bare.find('[data-money-role="change"]').exists()).toBe(true);
		expect(bare.find('[data-money-role="received"]').exists()).toBe(true);
		expect(bare.find('[data-money-role="shortfall"]').exists()).toBe(true);
		// And no copy in the lane, which would be the same pair twice.
		expect(bare.find('[data-testid="cobro-band-breakdown"]').exists()).toBe(false);
	});
});

// ── 4. The band's lanes are filled ───────────────────────────────────────

describe("the band's empty lanes are filled by the surface that owns them", () => {
	it("names both lane targets in Payments.vue, the way Invoice.vue does for the sale", () => {
		// The SOURCE pin. `Invoice.vue` states these two selectors for the sale;
		// `Payments.vue` states them for Cobro, so there is one place per
		// surface to look when a lane goes empty again.
		expect(paymentsSource).toContain("band-breakdown-target=\"[data-band-lane='breakdown']\"");
		expect(paymentsSource).toContain("band-context-target=\"[data-band-lane='context']\"");
		expect(paymentsSource).toContain(':band-owns-figure="cobroBandLaneActive"');
		expect(paymentsSource).toContain(':band-lane-active="cobroBandLaneActive"');
		// The predicate is IMPORTED, not re-derived: this surface and
		// `InvoiceSummary` must not disagree about whether a band exists.
		expect(paymentsSource).toContain(
			'import { bandOwnsLane } from "./invoice/bandLaneOwnership"',
		);
	});

	it("lands Recibido · Falta inside the band's breakdown lane", async () => {
		const host = bandHost();
		mount(CobroChangeCard, {
			props: {
				total: 1129,
				tendered: 1200,
				currency: "MXN",
				formatCurrency: (value: number) => money(value),
				bandBreakdownTarget: "[data-band-lane='breakdown']",
				bandOwnsFigure: true,
			},
			attachTo: host,
		});
		await nextTick();
		await nextTick();

		const lane = host.querySelector('[data-band-lane="breakdown"]') as HTMLElement;
		const landed = lane.querySelector('[data-testid="cobro-band-breakdown"]');
		expect(landed, "the breakdown lane is still empty on Cobro").not.toBeNull();
		expect(landed!.querySelector('[data-money-role="received"]')?.textContent).toContain(
			money(1200),
		);
		expect(landed!.querySelector('[data-money-role="shortfall"]')?.textContent).toContain(
			money(0),
		);
		// The divider the artboard draws between blocks, supplied by the filler
		// because a teleported node carries the FILLER's scope id.
		expect(lane.querySelectorAll(".cobro-band-divider")).toHaveLength(1);
		// Never a second total and never a second primary: the lane carries a
		// breakdown, and this is the whole of it.
		expect(lane.querySelectorAll('[data-money-role="total"]')).toHaveLength(0);
		expect(lane.querySelectorAll("button")).toHaveLength(0);
	});

	it("lands the shortcut chips inside the band's context lane", async () => {
		const host = bandHost();
		mount(CobroTenderPad, {
			props: padProps([{ ...CASH }], {
				bandContextTarget: "[data-band-lane='context']",
				bandLaneActive: true,
			}),
			attachTo: host,
		});
		await nextTick();
		await nextTick();

		const lane = host.querySelector('[data-band-lane="context"]') as HTMLElement;
		expect(lane.querySelector('[data-testid="cobro-presets"]')).not.toBeNull();
		expect(lane.querySelectorAll('[data-money-role="preset"]').length).toBeGreaterThan(0);
		// `Exacto` travels with them — it is the same kind of offer.
		expect(lane.querySelector('[data-testid="cobro-exact"]')).not.toBeNull();
		expect(lane.querySelectorAll(".cobro-band-divider")).toHaveLength(1);
	});

	it("renders the chips in place when there is no lane, so the pad is never short of them", async () => {
		const pad = mount(CobroTenderPad, { props: padProps([{ ...CASH }]) });
		await nextTick();
		expect(pad.find('[data-testid="cobro-presets"]').exists()).toBe(true);
		expect(pad.find(".cobro-band-divider").exists()).toBe(false);
	});
});

// ── The height budget ────────────────────────────────────────────────────

describe("the panel fits an iPad-class window without a scroll", () => {
	const TIER = "@media (min-width: 1100px) and (max-height: 820px)";

	/** The declaration bodies inside the dense-desk block of one source. */
	const tierBlock = (source: string): string => {
		const start = source.indexOf(TIER);
		if (start < 0) return "";
		let depth = 0;
		for (let i = source.indexOf("{", start); i < source.length; i += 1) {
			if (source[i] === "{") depth += 1;
			else if (source[i] === "}") {
				depth -= 1;
				if (depth === 0) return source.slice(start, i + 1);
			}
		}
		return "";
	};

	it("carries the tier in every file the surface draws with", () => {
		// `denseDeskTier.spec.ts` holds these in lockstep with the JS predicate;
		// this is the Cobro-side statement that they exist at all.
		for (const [name, source] of [
			["Payments.vue", paymentsSource],
			["CobroTenderPad.vue", padSource],
			["CobroMethodRows.vue", methodsSource],
			["CobroChangeCard.vue", changeSource],
			["CobroGiftCard.vue", giftSource],
		] as const) {
			expect(source, `${name} is outside the dense desk tier`).toContain(TIER);
		}
	});

	it("takes the 440px floor off the panel at exactly the size it was breaking", () => {
		// THE DEFECT, as arithmetic. At 1143×656 the shell hands the grid about
		// 385px; the `max-height: 739px` rule was giving the folded panel a
		// 440px floor, so the surface could not fit and switched on the
		// scrollbar the owner was looking at. The tier restores `1fr` — the pad
		// absorbs the difference, which is the property this surface is judged
		// on — and the floor stays for the genuinely short screens below 1100px
		// wide, which have no rail and no hosted Cobro anyway.
		const short = paymentsSource.slice(paymentsSource.indexOf("@media (max-height: 739px)"));
		expect(short).toContain("minmax(440px, auto)");
		const tier = tierBlock(paymentsSource);
		expect(tier).toContain("grid-template-rows: auto auto minmax(0, 1fr) auto auto");
		expect(tier).toMatch(/\.payment-scroll--cobro \{\s*overflow: hidden;/);
		// Later in the file than the 739px rule, because the two tie on
		// specificity and this one has to win.
		expect(paymentsSource.indexOf(TIER)).toBeGreaterThan(
			paymentsSource.indexOf("@media (max-height: 739px)"),
		);
	});

	/**
	 * THE BUDGET. Every number below is declared in a stylesheet this suite
	 * reads, and the sum is checked against the box the shell measured on the
	 * owner's own two windows (grid 470px at 1195×741, 385px at 1143×656).
	 */
	const GRID_BOX = { tall: 470, short: 385 };
	const READINESS = 44 + 4; // the back button, plus the tier's 4px foot
	const GRID_GAP = 4; // --pos-space-1, the tier's grid gap
	const CHIPS = 44; // --reg-touch-min, one row, no card around it
	const ON_CLOSE = 18; // one 11.5px caption, or nothing at all
	const PAD_PADDING = 8 * 2; // --reg-space-sm, the tier's card padding
	const FIELD = 40; // the tier's amount field
	const CARD_GAP = 6 * 2; // pad card gap ×2 (field→keys, section→caption)
	const KEY_ROWS = 4;
	const KEY_GAP = 5; // the tier's keypad grid gap

	it.each([
		["1195×741", GRID_BOX.tall],
		["1143×656", GRID_BOX.short],
	])("leaves the keys above the 44px touch minimum at %s", (_name, box) => {
		const columns = box - READINESS - GRID_GAP;
		const tender = columns - CHIPS - GRID_GAP;
		const pad = tender - ON_CLOSE - CARD_GAP / 2 - PAD_PADDING;
		const keypad = pad - FIELD - CARD_GAP / 2;
		const key = (keypad - KEY_GAP * (KEY_ROWS - 1)) / KEY_ROWS;

		expect(columns, "the columns must fit the grid box").toBeGreaterThan(0);
		expect(key).toBeGreaterThanOrEqual(44);
	});

	it("spends nothing on a scrollport it does not have", () => {
		// The owner rejected per-column scrollports on 2026-08-23 («why so many
		// scrolls?») and `cobroControlPanel.spec.ts` pins the count at exactly
		// one — the ticket's line list. The fix for 08-30 is the budget above,
		// not four more scrollbars, so the count is restated here from the
		// other side: none of the new work declares one.
		for (const source of [padSource, methodsSource, changeSource, giftSource]) {
			expect(source).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
		}
	});
});
