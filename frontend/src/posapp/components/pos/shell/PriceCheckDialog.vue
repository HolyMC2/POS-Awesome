<template>
	<v-dialog v-model="visible" max-width="640" class="price-check" @update:model-value="onToggle">
		<v-card data-testid="price-check-dialog">
			<v-card-title class="price-check-title">
				{{ __("Price checker") }}
				<span class="price-check-readonly">{{
					__("Lookup only — nothing is added to the sale")
				}}</span>
			</v-card-title>

			<v-card-text>
				<v-text-field
					v-model="query"
					autofocus
					clearable
					hide-details
					density="comfortable"
					variant="outlined"
					data-testid="price-check-input"
					:label="__('Scan or type item / barcode')"
					@keydown.enter="lookupNow"
				/>

				<div v-if="loading" class="price-check-state" data-testid="price-check-loading">
					{{ __("Searching…") }}
				</div>
				<div v-else-if="showEmpty" class="price-check-state" data-testid="price-check-empty">
					{{ __("No item found") }}
				</div>

				<div
					v-for="item in results"
					:key="item.item_code"
					class="price-check-row"
					data-testid="price-check-result"
				>
					<div class="price-check-identity">
						<span class="price-check-name">{{ item.item_name || item.item_code }}</span>
						<span class="price-check-meta">
							{{ item.item_code }}
							<template v-if="item.stock_uom"> · {{ item.stock_uom }}</template>
							<template v-if="item.actual_qty !== undefined && item.actual_qty !== null">
								· {{ __("Stock") }}: {{ item.actual_qty }}
							</template>
						</span>
					</div>
					<div class="price-check-price" data-testid="price-check-price">
						{{ formatMoney(item.rate) }}
					</div>
				</div>
			</v-card-text>

			<v-card-actions>
				<!-- Which list answered: with a price-list switch on the register a
				     bare number is ambiguous, and quoting the wrong list to a
				     customer is a promise the till will not honour. -->
				<span class="price-check-list" data-testid="price-check-price-list">{{ priceList }}</span>
				<v-spacer />
				<v-btn variant="text" data-testid="price-check-close" @click="visible = false">
					{{ __("Close") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Checador de precios (roadmap §17.2).
 *
 * A customer asks "how much is this?" in the middle of somebody else's sale.
 * Today the only way to answer is to scan the item into the cart and then
 * remove it — which pollutes an open ticket and, on a bad day, sells the
 * wrong thing. This surface is READ-ONLY BY CONSTRUCTION: it owns its own
 * search field, calls only lookup endpoints, and has no path to the cart at
 * all (pinned by tests/priceCheckDialog.spec.ts).
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";

import eventBusPlugin from "../../../bus";
import itemService from "../../../services/itemService";
import { useUIStore } from "../../../stores/uiStore";

// @ts-ignore — Frappe's global translator; absent in unit tests.
const __ = window.__ || ((value: string) => value);

/** Below this a query is noise: a single character matches half the catalog
 * and every keystroke would pay a round trip. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
/** Shortest string worth retrying as a barcode when the text search misses. */
const BARCODE_MIN = 6;
const RESULT_LIMIT = 12;

interface PriceCheckItem {
	item_code: string;
	item_name?: string;
	rate?: number;
	stock_uom?: string;
	actual_qty?: number | null;
}

const eventBus = (inject("eventBus", null) as typeof eventBusPlugin | null) || eventBusPlugin;
const uiStore = useUIStore();

const visible = ref(false);
const query = ref("");
const results = ref<PriceCheckItem[]>([]);
const loading = ref(false);

const priceList = computed(() => (uiStore.posProfile as any)?.selling_price_list || "");
const currency = computed(() => (uiStore.posProfile as any)?.currency || "MXN");

const showEmpty = computed(
	() => !loading.value && (query.value || "").trim().length >= MIN_QUERY && !results.value.length,
);

/** Intl rather than the app's formatter: this dialog is deliberately
 * dependency-free so it can be mounted and asserted without a POS shell. */
const formatMoney = (value?: number) => {
	const amount = Number(value || 0);
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: currency.value,
		}).format(amount);
	} catch {
		return amount.toFixed(2);
	}
};

let timer: ReturnType<typeof setTimeout> | null = null;
let requestSeq = 0;

const runLookup = async (raw: string) => {
	const term = (raw || "").trim();
	if (term.length < MIN_QUERY) {
		results.value = [];
		loading.value = false;
		return;
	}
	const profile = (uiStore.posProfile as any)?.name;
	if (!profile) {
		results.value = [];
		return;
	}

	const seq = ++requestSeq;
	loading.value = true;
	try {
		const found = await itemService.getItemsData({
			pos_profile: profile,
			price_list: priceList.value,
			search_value: term,
			limit: RESULT_LIMIT,
		});
		// A slower earlier query must never overwrite a newer answer — the
		// cashier is typing while the customer waits.
		if (seq !== requestSeq) return;
		let rows = (found || []) as PriceCheckItem[];

		if (!rows.length && term.length >= BARCODE_MIN && !term.includes(" ")) {
			// Text search does not match barcodes; a scan that misses is the
			// most likely reason we are here at all.
			const byBarcode = await itemService.getItemsFromBarcodeData({
				selling_price_list: priceList.value,
				currency: currency.value,
				barcode: term,
			});
			if (seq !== requestSeq) return;
			rows = byBarcode ? [byBarcode as unknown as PriceCheckItem] : [];
		}
		results.value = rows;
	} catch {
		if (seq === requestSeq) results.value = [];
	} finally {
		if (seq === requestSeq) loading.value = false;
	}
};

const lookupNow = () => {
	if (timer) clearTimeout(timer);
	void runLookup(query.value);
};

watch(query, (value) => {
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => void runLookup(value), DEBOUNCE_MS);
});

const open = () => {
	// Fresh every time: the previous customer's lookup lingering on screen
	// invites quoting the wrong price for the next one.
	query.value = "";
	results.value = [];
	visible.value = true;
};

const onToggle = (value: boolean) => {
	if (!value && timer) clearTimeout(timer);
};

onMounted(() => {
	eventBus.on("show_price_check", open);
});

onBeforeUnmount(() => {
	eventBus.off("show_price_check", open);
	if (timer) clearTimeout(timer);
});

defineExpose({ open, runLookup, results, query, visible });
</script>

<style scoped>
.price-check-title {
	display: flex;
	flex-direction: column;
	gap: 2px;
	font-size: 1.05rem;
	font-weight: 600;
}

.price-check-readonly {
	font-size: 0.72rem;
	font-weight: 400;
	opacity: 0.65;
}

.price-check-state {
	padding: 18px 2px;
	opacity: 0.7;
	font-size: 0.85rem;
}

.price-check-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 10px 0;
	border-bottom: 1px solid rgba(148, 163, 184, 0.25);
}

.price-check-identity {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.price-check-name {
	font-weight: 600;
}

.price-check-meta {
	font-size: 0.75rem;
	opacity: 0.65;
}

/* The number is the whole point of the surface — a cashier reads it out
   loud across a counter, so it outranks everything else on the row. */
.price-check-price {
	font-size: 1.5rem;
	font-weight: 700;
	white-space: nowrap;
}

.price-check-list {
	font-size: 0.72rem;
	opacity: 0.6;
	padding-inline-start: 12px;
}
</style>
