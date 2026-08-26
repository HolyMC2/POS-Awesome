<template>
	<div ref="rootEl" class="movil-venta" :style="frameStyle" data-testid="movil-venta">
		<MobileSaleHeader :status="status">
			<template v-if="$slots['scan-bar']" #scan-bar><slot name="scan-bar" /></template>
		</MobileSaleHeader>

		<!-- The customer, on the artboard's card. `CustomerStrip` is the desk's
		     component, reused whole: it already renders the identity, the
		     `cambiar` affordance and the chips, and it already refuses to
		     invent the artboard's "11 compras · última hace 3 semanas", for
		     which there is no read model. -->
		<div class="movil-venta__card movil-venta__customer" data-testid="movil-customer">
			<CustomerStrip
				:customer-name="customerName"
				:balance-label="walletLabel"
				:price-list="priceList"
				:sale-type="saleType"
				:is-return="isReturn"
				:cfdi-ready="cfdiReady"
				@change="onChangeCustomer"
			/>
		</div>

		<section class="movil-venta__card movil-venta__cart" data-testid="movil-cart">
			<div class="movil-venta__cart-head">
				<span class="movil-venta__cart-title">{{ __("Cart") }}</span>
				<span class="movil-venta__cart-count" data-testid="movil-line-count">{{
					countLabel
				}}</span>
			</div>

			<!-- No empty-cart illustration here on purpose. The register already
			     shipped one whose copy pointed at a control that no longer
			     exists, the count strip above already says "0 líneas · 0 pzas",
			     and the empty-cart treatment is a separate piece of work — a
			     second one drawn here would be the third thing on this screen
			     saying the cart is empty. -->
			<div class="movil-venta__lines">
				<MobileCartLine
					v-for="line in cart.lines"
					:key="line.key"
					:line="line"
					:format-currency="formatCurrency"
					@select="onSelectLine"
				>
					<template #thumb><slot name="line-thumb" :line="line" /></template>
				</MobileCartLine>
			</div>
		</section>

		<MobileSaleTotals
			class="movil-venta__totals"
			:state="state"
			:subtotal="subtotal"
			:tax="tax"
			:tax-rate="taxRate"
			:wallet="wallet"
			:format-currency="formatCurrency"
			@primary="onPrimary"
		>
			<template v-if="$slots['primary-icon']" #primary-icon><slot name="primary-icon" /></template>
		</MobileSaleTotals>
	</div>
</template>

<script setup lang="ts">
/**
 * The sale screen inside the phone's `cart` dock tab (`MovilVenta.dc.html`).
 *
 * The shell around it is already shipped and is not this component's business:
 * `DOCK_TAB_IDS` is a cross-stack contract with a parity test, `lean_vertical`
 * forces the stacked single panel, and the compact switcher engages below
 * 1100 px. This is what lives INSIDE `cart`.
 *
 * WHY IT OWNS A HEIGHT. The artboard is drawn in an 844 px frame, so its cart
 * panel can be `flex: 1`. In the app the document SCROLLS below 768 px and the
 * fixed dock covers the bottom, so a `flex: 1` panel inside an auto-height
 * document gets no height at all and the totals card walks off the screen. The
 * budget comes from `useItemsSelectorPanelSizing` rather than a second guess:
 * that composable already measured what the dock leaves a phone panel
 * (`--viewport-height` minus `--bottom-safe-space`), and the sale screen and
 * the catalogue must not disagree about how tall a phone is.
 *
 * ONE SCROLLPORT. The cart is it. Everything else on the screen is `flex: none`
 * — a screen with a scrolling document AND a scrolling panel is the fight
 * `defaultLayoutMainScroller.spec.ts` exists to prevent.
 */
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from "vue";

import CustomerStrip from "../../customer/CustomerStrip.vue";
import { useItemsSelectorPanelSizing } from "../../../../composables/pos/items/useItemsSelectorPanelSizing";
import type { BandState } from "../../../../composables/pos/shell/bandState";
import type { RegisterStatusInput } from "../../../navbar/registerStatusLine";
import type { WalletSummaryInput } from "../../payments/walletSummary";
import type { SaleSummarySourceLine } from "../../payments/saleSummary";
import MobileCartLine from "./MobileCartLine.vue";
import MobileSaleHeader from "./MobileSaleHeader.vue";
import MobileSaleTotals from "./MobileSaleTotals.vue";
import { describeMobileSaleLines, type MobileSaleLine } from "./mobileSaleLines";

const props = withDefaults(
	defineProps<{
		/** The invoice's `items` child table, as the cart holds it. */
		items?: readonly (SaleSummarySourceLine | null | undefined)[] | null;
		/** From `resolveBandState({ kind: "sale", ... })`. Never recomputed. */
		state: BandState;
		subtotal: number;
		tax: number;
		taxRate?: number | null;
		status?: RegisterStatusInput;
		customerName?: string;
		/** Wallet balance as the shell already formatted it — the strip's chip. */
		walletLabel?: string;
		priceList?: string;
		saleType?: string;
		isReturn?: boolean;
		cfdiReady?: boolean;
		wallet?: WalletSummaryInput | null;
		/** POS Profile `posa_low_stock_alert_threshold` (Int, default 10). */
		lowStockThreshold?: number;
		formatCurrency?: (_value: number) => string;
		/** Phone geometry. Injected so the frame is testable without a window. */
		isPhone?: boolean;
		windowWidth?: number;
		windowHeight?: number;
	}>(),
	{
		items: () => [],
		taxRate: null,
		status: () => ({}),
		customerName: "",
		walletLabel: "",
		priceList: "",
		saleType: "",
		isReturn: false,
		cfdiReady: false,
		wallet: null,
		lowStockThreshold: 0,
		formatCurrency: (value: number) => value.toFixed(2),
		isPhone: true,
		windowWidth: 390,
		windowHeight: 844,
	},
);

const emit = defineEmits<{
	(_event: "primary", _actionId: string): void;
	(_event: "select-line", _line: MobileSaleLine): void;
	(_event: "change-customer"): void;
}>();

/** Named, not inline: `$emit` is not bound on the `<script setup>` proxy. */
const onPrimary = (actionId: string) => emit("primary", actionId);
const onSelectLine = (line: MobileSaleLine) => emit("select-line", line);
const onChangeCustomer = () => emit("change-customer");

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = typeof window !== "undefined" ? (window as any).__ : undefined;
	if (translate) return translate(text, args);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const cart = computed(() =>
	describeMobileSaleLines(props.items, { lowStockThreshold: props.lowStockThreshold }),
);

/** `6 líneas · 9 pzas` — the one place this screen counts the cart. */
const countLabel = computed(() =>
	__("{0} lines · {1} pcs", [cart.value.lineCount, cart.value.pieceCount]),
);

const { selectorCardStyle } = useItemsSelectorPanelSizing({
	isPhone: computed(() => props.isPhone),
	windowWidth: computed(() => props.windowWidth),
	windowHeight: computed(() => props.windowHeight),
	// Read by neither computed the composable returns; passed because the
	// signature asks for it rather than being faked into something meaningful.
	responsiveStyles: ref<Record<string, string | number | undefined>>({}),
});

/**
 * The phone's explicit frame. Above the phone breakpoint the composable
 * returns `overflow: hidden` and no height, which is what a tablet or a narrow
 * desktop window wants: the column it sits in owns the height there.
 *
 * The composable's budget is viewport minus the dock — measured for a panel
 * that starts at the top of the layout. This frame starts BELOW the navbar
 * AND the teleported scan row, so the budget overshot by their combined
 * height and the totals card slid under the dock while the cart got the
 * leftovers (owner's live phone test, 2026-08-26). No CSS var states that
 * offset (`--v-layout-top` resolves empty here, and the scan row is a
 * sibling this component cannot name), so the frame measures its OWN top —
 * the one number that is true whatever chrome stacks above it.
 */
const rootEl = ref<HTMLElement | null>(null);
const frameTop = ref(0);
const measureFrameTop = () => {
	const rect = rootEl.value?.getBoundingClientRect();
	if (rect) frameTop.value = Math.max(0, Math.round(rect.top));
};
onMounted(() => {
	measureFrameTop();
	// Fonts and the teleported scan header can land a beat after mount.
	window.setTimeout(measureFrameTop, 300);
	window.addEventListener("resize", measureFrameTop);
});
onBeforeUnmount(() => window.removeEventListener("resize", measureFrameTop));

const frameStyle = computed<CSSProperties>(() => {
	const style: CSSProperties = { ...selectorCardStyle.value };
	if (style.height) {
		style.height = `calc(var(--viewport-height, 100vh) - var(--bottom-safe-space, 0px) - ${frameTop.value}px)`;
	}
	return style;
});
</script>

<style scoped>
.movil-venta {
	display: flex;
	flex-direction: column;
	min-width: 0;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.movil-venta__card {
	flex: none;
	margin: 9px 11px 0;
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #ffffff);
}

.movil-venta__customer {
	padding: 10px 12px;
}

.movil-venta__cart {
	/* THE scrollport. `min-height: 0` is load-bearing: without it a flex child
	   refuses to shrink below its content and the panel pushes the totals card
	   off the bottom of the frame instead of scrolling. */
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	padding: 3px 12px 6px;
}

.movil-venta__cart-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	flex: none;
	padding: 10px 0 3px;
}

.movil-venta__cart-title {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.movil-venta__cart-count {
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.movil-venta__lines {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	/* Momentum scrolling inside the panel; the document behind it must not
	   chain into a second scroll when the cart hits its end. */
	overscroll-behavior: contain;
}

.movil-venta__totals {
	margin: 9px 11px 0;
}
</style>
