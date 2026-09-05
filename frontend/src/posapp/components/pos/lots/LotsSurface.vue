<template>
	<section class="lots" :class="{ 'lots--story': storyFronted }" data-testid="lots-surface">
		<header class="lots__bar">
			<div class="lots__kinds" role="tablist" :aria-label="__('Serials & batches')">
				<button
					v-for="option in kindOptions"
					:key="option.id"
					type="button"
					role="tab"
					class="lots__kind"
					:class="{ 'lots__kind--on': option.id === kind }"
					:aria-selected="option.id === kind"
					:data-testid="`lots-kind-${option.id}`"
					@click="chooseKind(option.id)"
				>
					<v-icon size="16">{{ option.icon }}</v-icon>
					<span>{{ __(option.label) }}</span>
				</button>
			</div>
			<label class="lots__search" data-testid="lots-search-wrap">
				<v-icon size="17" class="lots__search-glyph">mdi-magnify</v-icon>
				<input
					ref="searchRef"
					v-model="query"
					class="lots__search-input"
					type="search"
					enterkeyhint="search"
					autocomplete="off"
					inputmode="search"
					:placeholder="searchPlaceholder"
					:aria-label="searchPlaceholder"
					data-testid="lots-search"
					@keydown.enter.prevent="searchNow"
				/>
				<button
					v-if="query"
					type="button"
					class="lots__clear"
					:aria-label="__('Clear')"
					data-testid="lots-clear"
					@click="clearQuery"
				>
					<v-icon size="16">mdi-close</v-icon>
				</button>
			</label>
		</header>

		<v-alert
			v-if="errorMessage"
			type="error"
			variant="tonal"
			density="compact"
			class="lots__error"
			data-testid="lots-error"
		>
			{{ errorMessage }}
		</v-alert>

		<div class="lots__body">
			<div class="lots__list" data-testid="lots-list">
				<div class="lots__tabs" role="tablist">
					<button
						v-for="tab in tabs"
						:key="tab.id"
						type="button"
						role="tab"
						class="lots__tab"
						:class="{ 'lots__tab--on': tab.active }"
						:aria-selected="tab.active"
						:data-testid="`lots-tab-${tab.id}`"
						@click="chooseTab(tab.id)"
					>
						{{ __(tab.label) }}
						<span class="reg-mono lots__tab-count">{{ tab.count }}</span>
					</button>
				</div>

				<div
					v-if="kind === 'serial' && warehouseChips.length > 1"
					class="lots__chips"
					data-testid="lots-warehouses"
				>
					<button
						v-for="chip in warehouseChips"
						:key="chip.id ?? '*'"
						type="button"
						class="lots__chip"
						:class="{ 'lots__chip--on': chip.id === warehouseFilter }"
						:aria-pressed="chip.id === warehouseFilter"
						@click="chooseWarehouse(chip.id)"
					>
						{{ chip.label }}<span v-if="chip.n !== null" class="reg-mono lots__chip-n">{{ chip.n }}</span>
					</button>
				</div>

				<div
					ref="tableRef"
					class="lots__table"
					tabindex="0"
					role="listbox"
					:aria-label="__(kind === 'serial' ? 'Serial numbers' : 'Batches')"
					@keydown="onKeydown"
				>
					<div v-if="kind === 'serial'" class="lots__row lots__row--head lots__row--serial">
						<span>{{ __("Serial") }}</span>
						<span>{{ __("Item") }}</span>
						<span>{{ __("Status") }}</span>
						<span>{{ __("Where · when") }}</span>
					</div>
					<div v-else class="lots__row lots__row--head lots__row--batch">
						<span>{{ __("Batch") }}</span>
						<span>{{ __("Item") }}</span>
						<span>{{ __("Expiry") }}</span>
						<span class="lots__cell--right">{{ __("Total") }}</span>
						<span class="lots__cell--right">{{ __("Here") }}</span>
					</div>

					<div v-if="loading && !visibleRows.length" class="lots__empty">{{ __("Loading…") }}</div>
					<div v-else-if="!visibleRows.length" class="lots__empty" data-testid="lots-empty">
						{{ emptyLabel }}
					</div>

					<template v-if="kind === 'serial'">
						<button
							v-for="(row, index) in serialRows"
							:key="row.serial_no"
							type="button"
							role="option"
							class="lots__row lots__row--item lots__row--serial"
							:class="{ 'lots__row--sel': row.serial_no === selectedKey }"
							:aria-selected="row.serial_no === selectedKey"
							:data-testid="`lots-serial-${row.serial_no}`"
							@click="select(index)"
						>
							<span class="reg-mono lots__code">{{ row.serial_no }}</span>
							<span class="lots__item">
								<span class="lots__item-name">{{ row.item_name }}</span>
								<span class="reg-mono lots__muted">{{ row.item_code }}</span>
							</span>
							<span>
								<span class="lots__status" :data-tone="serialTone(row.status)">
									{{ __(serialStatusLabel(row.status)) }}
								</span>
							</span>
							<span class="lots__where">{{ whereabouts(row) }}</span>
						</button>
					</template>
					<template v-else>
						<button
							v-for="(row, index) in batchRows"
							:key="row.batch_no"
							type="button"
							role="option"
							class="lots__row lots__row--item lots__row--batch"
							:class="{ 'lots__row--sel': row.batch_no === selectedKey }"
							:aria-selected="row.batch_no === selectedKey"
							:data-testid="`lots-batch-${row.batch_no}`"
							@click="select(index)"
						>
							<span class="reg-mono lots__code">{{ row.batch_no }}</span>
							<span class="lots__item">
								<span class="lots__item-name">{{ row.item_name }}</span>
								<span class="reg-mono lots__muted">{{ row.item_code }}</span>
							</span>
							<span>
								<span class="lots__status" :data-tone="batchTone(row)">{{ batchChip(row) }}</span>
							</span>
							<span class="reg-mono lots__cell--right">{{ formatFloat(row.total_qty) }}</span>
							<span class="reg-mono lots__cell--right lots__here" :data-here="row.qty_here > 0 ? 'true' : 'false'">
								{{ formatFloat(row.qty_here) }}
							</span>
						</button>
					</template>

					<button
						v-if="kind === 'serial' && canLoadMore"
						type="button"
						class="lots__more"
						data-testid="lots-more"
						:disabled="loading"
						@click="loadMore"
					>
						{{ __("Showing {0} of {1} · load more", [serialRows.length, serialTotal]) }}
					</button>

					<div class="lots__hint">
						{{ __("↑↓ moves · Enter opens · type an IMEI, a batch, an item or a customer") }}
					</div>
				</div>
			</div>

			<LotStory
				:kind="kind"
				:serial-story="serialStory"
				:batch-story="batchStory"
				:loading="loadingStory"
				:offline="offline"
				:fronted="storyFronted"
				:format-currency="formatCurrency"
				:format-float="formatFloat"
				@back="backToList"
				@sell-serial="sellSerial"
				@sell-batch="sellBatch"
				@lookup="lookupSerial"
			/>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * SERIES Y LOTES as a rail DESTINATION — a view straight into the host, the
 * quotations pattern (no `v-dialog`, no store flag).
 *
 * Two lists, one search box. The kind toggle swaps which ledger the box asks
 * (`search_serials` / `search_batches`); the tabs are the server's counts
 * for the current question; the story panel to the right (or, on a phone,
 * in FRONT of the list) is one row read whole. Every fact drawn here was
 * shaped on the server (`lot_read_model`) — this component holds selection,
 * paging and the one add it can perform.
 *
 * «Sell this one» is the money seam: the row's catalogue entry + the chosen
 * unit become ONE `lot:confirm` intent, the same event the lot picker emits,
 * so the add rides `ItemsSelector.add_item` exactly as a picked unit does.
 * Then the surface closes and the cashier is back on the sale with the line
 * in the cart.
 */
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import LotStory from "./LotStory.vue";
import "./lots.css";
import {
	batchStatusKey,
	batchTone,
	buildBatchAdd,
	buildSerialAdd,
	describeBatchTabs,
	describeSerialTabs,
	describeSerialWhereabouts,
	emptyBatchCounts,
	emptySerialCounts,
	lotKindFromSearch,
	lotQueryFromSearch,
	normalizeLotQuery,
	serialStatusLabel,
	serialTone,
	type BatchBucket,
	type BatchRow,
	type BatchStory,
	type LotKind,
	type SerialBucket,
	type SerialRow,
	type SerialSibling,
	type SerialStory,
} from "./lotsModel";
import { nextIndex } from "../flows/ledger/ledgerModel";
import { useFormat } from "../../../format";
import { useOnlineStatus } from "../../../composables/core/useOnlineStatus";
import { useResponsive } from "../../../composables/core/useResponsive";
import {
	fetchBatchStory,
	fetchSerialStory,
	searchBatches,
	searchSerials,
} from "../../../services/lotLookupService";
import { useItemsStore } from "../../../stores/itemsStore";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";

interface BusLike {
	emit: (event: string, payload?: unknown) => void;
}

const SEARCH_DEBOUNCE_MS = 260;
const PAGE = 60;

const emit = defineEmits<{ close: [] }>();

const __ = (window as Record<string, any>).__ || ((value: string, args?: any[]) => {
	if (!args?.length) return value;
	return args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), value);
});

const eventBus = inject<BusLike | null>("eventBus", null);
const uiStore = useUIStore();
const itemsStore = useItemsStore();
const toastStore = useToastStore();
const { posProfile } = storeToRefs(uiStore);
const { formatCurrency, formatFloat } = useFormat();
const { isOnline } = useOnlineStatus();
const { isPhone } = useResponsive();

const searchRef = ref<HTMLInputElement | null>(null);
const tableRef = ref<HTMLElement | null>(null);

const kind = ref<LotKind>(lotKindFromSearch(window.location?.search));
const query = ref(lotQueryFromSearch(window.location?.search));
const serialBucket = ref<SerialBucket>("all");
const batchBucket = ref<BatchBucket>("available");
const warehouseFilter = ref<string | null>(null);

const serialRows = ref<SerialRow[]>([]);
const serialCounts = ref(emptySerialCounts());
const serialTotal = ref(0);
const warehouses = ref<Array<{ warehouse: string; n: number }>>([]);
const batchRows = ref<BatchRow[]>([]);
const batchCounts = ref(emptyBatchCounts());

const selectedKey = ref<string | null>(null);
const serialStory = ref<SerialStory | null>(null);
const batchStory = ref<BatchStory | null>(null);
const loading = ref(false);
const loadingStory = ref(false);
const errorMessage = ref("");

const kindOptions: ReadonlyArray<{ id: LotKind; label: string; icon: string }> = [
	{ id: "serial", label: "Serials", icon: "mdi-cellphone" },
	{ id: "batch", label: "Batches", icon: "mdi-package-variant-closed" },
];

const profileName = computed(() => posProfile.value?.name ?? null);
const offline = computed(() => !isOnline.value);
const tabs = computed(() =>
	kind.value === "serial"
		? describeSerialTabs(serialCounts.value, serialBucket.value)
		: describeBatchTabs(batchCounts.value, batchBucket.value),
);
const visibleRows = computed(() => (kind.value === "serial" ? serialRows.value : batchRows.value));
const canLoadMore = computed(() => serialRows.value.length < serialTotal.value);
const storyFronted = computed(() => isPhone.value && !!selectedKey.value);
const searchPlaceholder = computed(() =>
	kind.value === "serial" ? __("IMEI, serial, item or customer…") : __("Batch, item…"),
);
const emptyLabel = computed(() =>
	normalizeLotQuery(query.value)
		? __("Nothing matches «{0}» in this list.", [normalizeLotQuery(query.value)])
		: __("Nothing in this list yet."),
);
const warehouseChips = computed(() => [
	{ id: null as string | null, label: __("All warehouses"), n: null as number | null },
	...warehouses.value.map((w) => ({ id: w.warehouse, label: w.warehouse, n: w.n })),
]);

const whereabouts = (row: SerialRow) => {
	const { key, args } = describeSerialWhereabouts(row);
	return __(key, args);
};
const batchChip = (row: BatchRow) => {
	const { key, count } = batchStatusKey(row);
	return count === null ? __(key) : __(key, [count]);
};

const reportFailure = (error: unknown, fallback: string) => {
	const failure = error as { serverMessage?: string; message?: string } | null;
	errorMessage.value = failure?.serverMessage || failure?.message || fallback;
};

let searchSeq = 0;
async function load(options: { append?: boolean } = {}) {
	const profile = profileName.value;
	if (!profile) return;
	const token = ++searchSeq;
	loading.value = true;
	try {
		if (kind.value === "serial") {
			const payload = await searchSerials(profile, {
				query: query.value,
				status: serialBucket.value,
				warehouse: warehouseFilter.value,
				limit: PAGE,
				offset: options.append ? serialRows.value.length : 0,
			});
			if (token !== searchSeq) return;
			const rows = Array.isArray(payload?.rows) ? payload.rows : [];
			serialRows.value = options.append ? [...serialRows.value, ...rows] : rows;
			serialCounts.value = payload?.counts ?? emptySerialCounts();
			serialTotal.value = Number(payload?.total) || 0;
			warehouses.value = Array.isArray(payload?.warehouses) ? payload.warehouses : [];
		} else {
			const payload = await searchBatches(profile, {
				query: query.value,
				bucket: batchBucket.value,
				limit: 200,
			});
			if (token !== searchSeq) return;
			batchRows.value = Array.isArray(payload?.rows) ? payload.rows : [];
			batchCounts.value = payload?.counts ?? emptyBatchCounts();
		}
		errorMessage.value = "";
		if (!options.append && !visibleRows.value.some((row) => keyOf(row) === selectedKey.value)) {
			clearStory();
		}
	} catch (error) {
		if (token !== searchSeq) return;
		if (!options.append) {
			serialRows.value = [];
			batchRows.value = [];
		}
		reportFailure(error, __("Could not search serials and batches."));
	} finally {
		if (token === searchSeq) loading.value = false;
	}
}

const keyOf = (row: SerialRow | BatchRow): string =>
	"serial_no" in row ? row.serial_no : (row as BatchRow).batch_no;

const clearStory = () => {
	selectedKey.value = null;
	serialStory.value = null;
	batchStory.value = null;
};

let storySeq = 0;
async function openStory(key: string) {
	const profile = profileName.value;
	if (!profile) return;
	const token = ++storySeq;
	selectedKey.value = key;
	loadingStory.value = true;
	try {
		if (kind.value === "serial") {
			const story = await fetchSerialStory(profile, key);
			if (token !== storySeq) return;
			serialStory.value = story;
			batchStory.value = null;
		} else {
			const story = await fetchBatchStory(profile, key);
			if (token !== storySeq) return;
			batchStory.value = story;
			serialStory.value = null;
		}
		errorMessage.value = "";
	} catch (error) {
		if (token !== storySeq) return;
		reportFailure(error, __("Could not open this record."));
	} finally {
		if (token === storySeq) loadingStory.value = false;
	}
}

const select = (index: number) => {
	const row = visibleRows.value[index];
	if (!row) return;
	void openStory(keyOf(row));
};

const backToList = () => {
	clearStory();
	nextTick(() => tableRef.value?.focus?.());
};

const chooseKind = (next: LotKind) => {
	if (next === kind.value) return;
	kind.value = next;
	clearStory();
	void load();
};

const chooseTab = (id: string) => {
	if (kind.value === "serial") {
		if (id === serialBucket.value) return;
		serialBucket.value = id as SerialBucket;
	} else {
		if (id === batchBucket.value) return;
		batchBucket.value = id as BatchBucket;
	}
	void load();
};

const chooseWarehouse = (id: string | null) => {
	if (id === warehouseFilter.value) return;
	warehouseFilter.value = id;
	void load();
};

const loadMore = () => void load({ append: true });
const searchNow = () => void load();
const clearQuery = () => {
	query.value = "";
	searchRef.value?.focus?.();
};

/** A serial named inside a story (a sibling, a movement) — look it up. */
const lookupSerial = (serialNo: string) => {
	kind.value = "serial";
	query.value = serialNo;
	void openStory(serialNo);
	void load();
};

const onKeydown = (event: KeyboardEvent) => {
	if (event.key === "Enter") {
		event.preventDefault();
		const current = visibleRows.value.findIndex((row) => keyOf(row) === selectedKey.value);
		if (current >= 0) select(current);
		return;
	}
	const current = visibleRows.value.findIndex((row) => keyOf(row) === selectedKey.value);
	const next = nextIndex(event.key, current, visibleRows.value.length);
	if (next === null) return;
	event.preventDefault();
	select(next);
};

/**
 * The catalogue row the add is built from. The register's store already
 * holds it on a full-catalogue profile; on a limit-search profile the item
 * may never have been paged in, so the store's own search is asked once.
 */
async function catalogueRow(itemCode: string): Promise<Record<string, any> | null> {
	const direct = itemsStore.getItemByCode?.(itemCode);
	if (direct) return direct as Record<string, any>;
	try {
		await itemsStore.searchItems?.(itemCode);
	} catch {
		/* the lookup below answers either way */
	}
	return (itemsStore.getItemByCode?.(itemCode) as Record<string, any>) || null;
}

async function pushAdd(add: Record<string, any> | null, label: string) {
	if (!add || !eventBus) {
		toastStore.show({
			title: __("Not sellable here"),
			message: __("{0} is not in this register's warehouse or catalogue.", [label]),
			color: "warning",
		});
		return;
	}
	eventBus.emit("lot:confirm", { adds: [add] });
	toastStore.show({
		title: __("Added to the sale"),
		message: __("{0} is on the ticket.", [label]),
		color: "success",
	});
	emit("close");
}

async function sellSerial(target: SerialRow | SerialSibling) {
	if (offline.value) return;
	const itemCode = "item_code" in target ? target.item_code : serialStory.value?.serial.item_code;
	if (!itemCode) return;
	const row = {
		serial_no: target.serial_no,
		item_code: itemCode,
		sellable_here: target.sellable_here,
		batch_no: target.batch_no ?? null,
	};
	await pushAdd(buildSerialAdd(await catalogueRow(itemCode), row), target.serial_no);
}

async function sellBatch(target: BatchRow, qty = 1) {
	if (offline.value) return;
	await pushAdd(buildBatchAdd(await catalogueRow(target.item_code), target, qty), target.batch_no);
}

let debounce: ReturnType<typeof setTimeout> | null = null;
watch(query, () => {
	if (debounce) clearTimeout(debounce);
	debounce = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS);
});

watch(profileName, () => {
	clearStory();
	void load();
});

onMounted(() => {
	void load();
	// A deep link with `?q=` opens straight onto that record.
	if (query.value && kind.value === "serial") void openStory(query.value);
	if (!isPhone.value) searchRef.value?.focus?.();
});
</script>
