<template>
	<!-- The phone's own register (roadmap §12: six mobile views, artboards
	     MovilVenta/MovilExplorar). This shell is CHROME, deliberately thin:
	     the engines stay mounted where they always were — Invoice.vue keeps
	     the bus (add_item, request_invoice_payment), the ONE ItemsSelector
	     keeps the scanner and the teleported search header — and this layer
	     only decides which mobile screen draws the current dock tab. Every
	     emit is translated by Pos.vue into a handler the desktop already
	     trusts; nothing here touches a store or the money path. -->
	<MobileBrowseScreen
		v-if="screen === 'browse'"
		:items="browseItems"
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
import MobileSaleScreen from "../../mobile/sale/MobileSaleScreen.vue";
import type { MobileSaleLine } from "../../mobile/sale/mobileSaleLines";

defineOptions({ name: "MovilShell" });

withDefaults(
	defineProps<{
		/** Which mobile screen owns the stage — follows the dock, decided by Pos.vue. */
		screen: "browse" | "cart" | "pay" | "orden";
		browseItems?: readonly BrowseCatalogItem[];
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
	}>(),
	{
		browseItems: () => [],
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
	},
);

const emit = defineEmits<{
	(_event: "add", _card: BrowseCard): void;
	(_event: "search"): void;
	(_event: "primary", _actionId: string): void;
	(_event: "select-line", _line: MobileSaleLine): void;
	(_event: "change-customer"): void;
	(_event: "update:tender", _mode: string | null): void;
	(_event: "split", _intent: CollectionIntent): void;
	(_event: "collect", _intent: CollectionIntent): void;
	(_event: "orden-back"): void;
}>();

const __ = (text: string): string => {
	const translate = typeof window !== "undefined" ? (window as any).__ : undefined;
	return translate ? translate(text) : text;
};
</script>

<style scoped>
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
