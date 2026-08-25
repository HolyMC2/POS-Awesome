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
import MobileSaleScreen from "../../mobile/sale/MobileSaleScreen.vue";
import type { MobileSaleLine } from "../../mobile/sale/mobileSaleLines";

defineOptions({ name: "MovilShell" });

withDefaults(
	defineProps<{
		/** Which mobile screen owns the stage — follows the dock, decided by Pos.vue. */
		screen: "browse" | "cart" | "pay";
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
}>();
</script>
