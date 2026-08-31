<template>
	<!-- The phone's own register (roadmap §12: six mobile views, artboards
	     MovilVenta/MovilExplorar). This shell is CHROME, deliberately thin:
	     the engines stay mounted where they always were — Invoice.vue keeps
	     the bus (add_item, request_invoice_payment), the ONE ItemsSelector
	     keeps the scanner and the teleported search header — and this layer
	     only decides which mobile screen draws the current dock tab. Every
	     emit is translated by Pos.vue into a handler the desktop already
	     trusts; nothing here touches a store or the money path. -->
	<!--
		THE DOCK-TAB TRANSITION (native-feel round 2). It lives here and not in
		`Pos.vue` for a reason the specs already state: the compact shell's
		panels are `v-show` siblings and `compactPanelSwitchInstant.spec.ts`
		pins them unanimated — the dock FLIPS its panels, it does not animate
		them, because a transition on the container is the panel switch itself
		running slowly. What the phone's screens are, by contrast, is chrome
		this shell mounts and unmounts on the `screen` prop, so a cross-fade
		here costs nothing the engines can feel.

		`mode="out-in"` because the screens are full-height siblings in a
		column: two of them alive at once would stack, and the second would be
		measured against a frame the first is still occupying. The leave takes
		`--motion-fast` and the enter `--motion-base` — the tap is answered at
		once, and the arriving screen is the part allowed to settle.
	-->
	<Transition name="movil-screen" mode="out-in">
		<MobileBrowseScreen
			v-if="screen === 'browse'"
			:items="browseItems"
			:loading="browseLoading"
			:combos="combos"
			:cart="cartItems"
			:query="query"
			:catalogue-count="catalogueCount"
			:register-label="registerLabel"
			:online="online"
			:low-stock-threshold="lowStockThreshold"
			:format-currency="formatCurrency"
			@add="(card) => emit('add', card)"
			@search="emit('search')"
			@scan="emit('scan')"
			@clear="emit('clear-search')"
		/>
		<div v-else-if="screen === 'orden'" class="movil-orden-stage">
			<!-- Host chrome, not the ghost component's: MovilOrdenView draws ONE
			     order and has no queue, so "back" means deselecting in the surface
			     that owns the selection (orden:deselect via the host). -->
			<button
				type="button"
				class="movil-orden-stage__back"
				data-testid="movil-orden-back"
				@click="emit('orden-back')"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M15 5 8 12l7 7"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				{{ __("All orders") }}
			</button>
			<MovilOrdenView
				:view="ordenView"
				:title="ordenTitle"
				:who="ordenWho"
				:ready-count="ordenReadyCount"
				:online="online"
				:format-currency="formatCurrency"
				@primary="(actionId) => emit('primary', actionId)"
				@search="emit('orden-back')"
			/>
		</div>
		<MovilCobroView
			v-else-if="screen === 'pay'"
			:title="payTitle"
			:customer-name="customerName"
			:total="payTotal"
			:tendered="0"
			:currency="currency"
			:format-currency="formatCurrency"
			:profile="profile"
			:cart-has-items="itemCount > 0"
			:is-return="isReturn"
			:prints-ticket="true"
			:item-count="itemCount"
			:can-collect="canCollect"
			@update:tender="(mode) => emit('update:tender', mode)"
			@split="(intent) => emit('split', intent)"
			@collect="(intent) => emit('collect', intent)"
		/>
		<MobileSaleScreen
			v-else-if="screen === 'cart'"
			:items="cartItems"
			:state="bandState"
			:subtotal="subtotal"
			:tax="tax"
			:customer-name="customerName"
			:price-list="priceList"
			:is-return="isReturn"
			:low-stock-threshold="lowStockThreshold"
			:format-currency="formatCurrency"
			:is-phone="true"
			:window-width="windowWidth"
			:window-height="windowHeight"
			@primary="(actionId) => emit('primary', actionId)"
			@select-line="(line) => emit('select-line', line)"
			@change-customer="emit('change-customer')"
		/>
	</Transition>

	<!-- The line sheet, over whichever screen is up. A SIBLING, not a child of
	     the cart screen: that screen owns an exact height budget and one
	     scrollport, and a fixed overlay nested inside it would be measured
	     against a frame it is meant to cover. `v-if` is right here — this IS
	     the transient surface, it owns no engine and holds no subscription;
	     the mounted-ness rule protects Invoice / ItemsSelector / Payments,
	     which stay exactly where they were. -->
	<!-- `<Transition>` and not a self-animating panel, because a sheet that
	     only knows how to ARRIVE is half a sheet: the dismissal is the gesture
	     the cashier repeats all day, and it has to travel back down rather
	     than blink out. Vue holds the leaving element for the length of the
	     leave transition; `close` still emits on the tap, so nothing about the
	     line's write path waits on an animation. -->
	<Transition name="movil-sheet">
		<MovilLineSheet
			v-if="lineSheet"
			:line="lineSheet"
			:format-currency="formatCurrency"
			@edit="(intent) => emit('line-edit', intent)"
			@close="emit('line-close')"
			@more="emit('line-more')"
			@weigh="emit('line-weigh')"
			@lots="emit('line-lots')"
		/>
	</Transition>
</template>

<script setup lang="ts">
import type { BandState } from "../../../../composables/pos/shell/bandState";
import type { ComboOffer } from "../../../../composables/pos/combos/comboCatalog";
import type { TenderProfile } from "../../invoice/tenderChips";
import type { SaleSummarySourceLine } from "../../payments/saleSummary";
import MobileBrowseScreen from "../../mobile/browse/MobileBrowseScreen.vue";
import type { BrowseCard, BrowseCatalogItem } from "../../mobile/browse/browseCatalog";
import MovilCobroView, { type CollectionIntent } from "../../mobile/pay/MovilCobroView.vue";
import MovilOrdenView from "../../mobile/orders/MovilOrdenView.vue";
import type { ServiceOrderView } from "../../mobile/orders/serviceOrderLines";
import MovilLineSheet from "../../mobile/line/MovilLineSheet.vue";
import type { MovilLineEdit, MovilLineIntent } from "../../mobile/line/movilLineEdit";
import MobileSaleScreen from "../../mobile/sale/MobileSaleScreen.vue";
import type { MobileSaleLine } from "../../mobile/sale/mobileSaleLines";

defineOptions({ name: "MovilShell" });

withDefaults(
	defineProps<{
		/** Which mobile screen owns the stage — follows the dock, decided by Pos.vue. */
		screen: "browse" | "cart" | "pay" | "orden";
		browseItems?: readonly BrowseCatalogItem[];
		/** ItemsSelector's own first-load flag — the browse grid draws
		 *  skeletons rather than «No items found» while it is true. */
		browseLoading?: boolean;
		combos?: readonly ComboOffer[];
		/** The invoice's items child table — the browse screen's compatibility
		 *  scope AND the sale screen's lines read the same rows. */
		cartItems?: readonly SaleSummarySourceLine[];
		/** The live query, owned by ItemsSelector's teleported search header. */
		query?: string;
		catalogueCount?: number;
		registerLabel?: string;
		online?: boolean;
		lowStockThreshold?: number;
		bandState: BandState;
		subtotal?: number;
		tax?: number;
		customerName?: string;
		priceList?: string;
		isReturn?: boolean;
		windowWidth?: number;
		windowHeight?: number;
		formatCurrency: (_value: number) => string;
		/** Pay screen (MovilCobroView) — the figures; the money path stays in
		 *  Payments.vue, which answers the emitted intents. */
		payTitle?: string;
		payTotal?: number;
		currency?: string | null;
		profile?: TenderProfile | null;
		itemCount?: number;
		canCollect?: boolean;
		/** Orden screen — the surface owns selection and charge; this is the
		 *  loaded selection mapped through toServiceOrderView by the host. */
		ordenView?: ServiceOrderView | null;
		ordenTitle?: string;
		ordenWho?: string;
		ordenReadyCount?: number;
		/** The tapped cart line, already gated by the profile (`movilLineEdit.ts`).
		 *  Null closes the sheet — including when the row leaves the cart. */
		lineSheet?: MovilLineEdit | null;
	}>(),
	{
		browseItems: () => [],
		browseLoading: false,
		combos: () => [],
		cartItems: () => [],
		query: "",
		catalogueCount: 0,
		registerLabel: "",
		online: true,
		lowStockThreshold: 0,
		subtotal: 0,
		tax: 0,
		customerName: "",
		priceList: "",
		isReturn: false,
		windowWidth: 390,
		windowHeight: 844,
		payTitle: "",
		payTotal: 0,
		currency: null,
		profile: null,
		itemCount: 0,
		canCollect: false,
		ordenView: null,
		ordenTitle: "",
		ordenWho: "",
		ordenReadyCount: 0,
		lineSheet: null,
	},
);

const emit = defineEmits<{
	(_event: "add", _card: BrowseCard): void;
	(_event: "search"): void;
	(_event: "scan"): void;
	(_event: "clear-search"): void;
	(_event: "primary", _actionId: string): void;
	(_event: "select-line", _line: MobileSaleLine): void;
	(_event: "change-customer"): void;
	(_event: "update:tender", _mode: string | null): void;
	(_event: "split", _intent: CollectionIntent): void;
	(_event: "collect", _intent: CollectionIntent): void;
	(_event: "orden-back"): void;
	/** The line sheet's verb — the host stamps the row identity on it. */
	(_event: "line-edit", _intent: MovilLineIntent): void;
	(_event: "line-close"): void;
	/** «More options» — hand the line back to the classic cart, which still
	 *  owns UOM, batch, serial, the offer toggle and the weighing pad. */
	(_event: "line-more"): void;
	/** The sheet's scale button — the pad itself is hosted by `Pos.vue`. */
	(_event: "line-weigh"): void;
	/** The sheet's serial / batch row — the picker is hosted by `Pos.vue`. */
	(_event: "line-lots"): void;
}>();

const __ = (text: string): string => {
	const translate = typeof window !== "undefined" ? (window as any).__ : undefined;
	return translate ? translate(text) : text;
};
</script>

<style scoped>
/* ---- the dock-tab cross-fade ------------------------------------------
 * `transform` and `opacity` only, per the shell's animation contract: a
 * screen swap that animates height or margin reflows the whole column once
 * per frame on the hardware §6 budgets for, and it looks correct while doing
 * it. The 8px is a HINT of travel, not a slide — a phone tab bar that pushes
 * a full screen-width panel across reads as navigation, and these four
 * screens are peers, not a stack.
 *
 * `will-change` lives on the active classes and nowhere else; Vue removes
 * them the moment the transition settles, so no screen keeps a compositor
 * layer alive while the cashier reads it.
 *
 * The scope id reaches these because Vue stamps a child component's ROOT
 * element with its parent's scope as well as its own — the same mechanism
 * that lets this file style `.movil-orden-stage__back`.
 */
.movil-screen-enter-active {
	transition:
		opacity var(--motion-base) var(--ease-out),
		transform var(--motion-base) var(--ease-out);
	will-change: transform, opacity;
}

.movil-screen-leave-active {
	transition:
		opacity var(--motion-fast) var(--ease-in-out),
		transform var(--motion-fast) var(--ease-in-out);
	will-change: transform, opacity;
}

.movil-screen-enter-from {
	opacity: 0;
	transform: translateY(8px);
}

.movil-screen-leave-to {
	opacity: 0;
	transform: translateY(-8px);
}

/* Belt and braces: the tokens above are already 0ms here, and this makes the
 * intent readable at the call site rather than only in the token file. */
@media (prefers-reduced-motion: reduce) {
	.movil-screen-enter-active,
	.movil-screen-leave-active {
		transition: none;
	}

	.movil-screen-enter-from,
	.movil-screen-leave-to {
		opacity: 1;
		transform: none;
	}
}

.movil-orden-stage {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

/* The back chip is host chrome in the register vocabulary (44px touch floor,
   the rail's pressed tint) — MovilOrdenView itself stays untouched. */
.movil-orden-stage__back {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	align-self: flex-start;
	min-height: 44px;
	padding: 8px 14px;
	border: 0;
	border-radius: 10px;
	background: var(--reg-rail-pressed, #e3e8ee);
	color: var(--pos-text-primary, #16222a);
	font-size: 13.5px;
	font-weight: 700;
	cursor: pointer;
}

.movil-orden-stage__back:focus-visible {
	outline: none;
	box-shadow: inset 0 0 0 2px var(--pos-primary-variant, #00838f);
}
</style>
