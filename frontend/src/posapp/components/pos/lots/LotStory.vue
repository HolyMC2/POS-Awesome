<template>
	<aside class="lots-story" :class="{ 'lots-story--fronted': fronted }" data-testid="lots-story">
		<button
			v-if="fronted"
			type="button"
			class="lots-story__back"
			data-testid="lots-story-back"
			@click="emit('back')"
		>
			<v-icon size="18">mdi-arrow-left</v-icon>
			<span>{{ __("Back to the list") }}</span>
		</button>

		<div v-if="loading" class="lots-story__empty">{{ __("Loading…") }}</div>

		<!-- ───────────── SERIAL ───────────── -->
		<template v-else-if="kind === 'serial' && serialStory">
			<header class="lots-story__head">
				<div class="lots-story__ident">
					<p class="reg-mono lots-story__code" data-testid="lots-story-code">{{ serial.serial_no }}</p>
					<p class="lots-story__name">{{ serial.item_name }}</p>
					<p class="reg-mono lots-story__muted">{{ serial.item_code }}</p>
				</div>
				<div class="lots-story__side">
					<span class="lots__status lots__status--lg" :data-tone="serialTone(serial.status)" data-testid="lots-story-status">
						{{ __(serialStatusLabel(serial.status)) }}
					</span>
					<button type="button" class="lots-story__icon" :aria-label="__('Copy')" data-testid="lots-copy" @click="copy(serial.serial_no)">
						<v-icon size="17">mdi-content-copy</v-icon>
					</button>
				</div>
			</header>

			<!-- The sale that took it: the answer to «who has this phone». -->
			<div v-if="serialStory.sold_on" class="lots-story__sold" data-testid="lots-story-sold">
				<p class="lots-story__sold-title">
					{{ __("Sold on {0}", [shortStamp(serialStory.sold_on.posting_datetime)]) }}
				</p>
				<p class="lots-story__sold-line">
					<span class="reg-mono">{{ serialStory.sold_on.voucher_no }}</span>
					<span v-if="serialStory.sold_on.party"> · {{ serialStory.sold_on.party }}</span>
					<span v-if="serialStory.sold_on.grand_total !== null"> · {{ formatCurrency(serialStory.sold_on.grand_total) }}</span>
				</p>
				<p v-if="serialStory.sold_on.owner" class="lots-story__muted">{{ __("Cashier") }}: {{ serialStory.sold_on.owner }}</p>
				<button type="button" class="lots-story__link" data-testid="lots-open-sale" @click="openVoucher(serialStory.sold_on)">
					<v-icon size="15">mdi-open-in-new</v-icon>
					<span>{{ __("Open document") }}</span>
				</button>
			</div>

			<dl class="lots-story__facts">
				<template v-if="serial.warehouse">
					<dt>{{ __("Warehouse") }}</dt>
					<dd>{{ serial.warehouse }}</dd>
				</template>
				<template v-if="serial.customer">
					<dt>{{ __("Customer") }}</dt>
					<dd>{{ serial.customer }}</dd>
				</template>
				<template v-if="serial.batch_no">
					<dt>{{ __("Batch") }}</dt>
					<dd class="reg-mono">{{ serial.batch_no }}</dd>
				</template>
				<template v-if="serial.purchase_document_no">
					<dt>{{ __("Purchased") }}</dt>
					<dd class="reg-mono">{{ serial.purchase_document_no }}</dd>
				</template>
				<template v-if="serial.warranty_expiry_date">
					<dt>{{ __("Warranty") }}</dt>
					<dd class="reg-mono">{{ serial.warranty_expiry_date }}</dd>
				</template>
				<template v-if="serial.last_moved_at">
					<dt>{{ __("Last movement") }}</dt>
					<dd class="reg-mono">{{ shortStamp(serial.last_moved_at) }}</dd>
				</template>
			</dl>

			<div class="lots-story__actions">
				<button
					v-if="serial.sellable_here"
					type="button"
					class="lots-story__primary"
					data-testid="lots-sell-serial"
					:disabled="offline"
					@click="emit('sell-serial', serial)"
				>
					<v-icon size="18">mdi-cart-plus</v-icon>
					<span>{{ __("Sell this unit") }}</span>
				</button>
				<p v-else-if="serial.status === 'Active'" class="lots-story__note" data-testid="lots-elsewhere">
					{{ __("In {0} — this register sells from {1}.", [serial.warehouse || "—", serialStory.profile_warehouse || "—"]) }}
				</p>
			</div>

			<!-- The units of the SAME item still on a shelf — the fix, one tap away. -->
			<section class="lots-story__section" data-testid="lots-siblings">
				<h3 class="lots-story__h">
					{{ __("Same item in stock") }}
					<span class="reg-mono lots-story__count">{{ serialStory.siblings.length }}</span>
				</h3>
				<p v-if="!serialStory.siblings.length" class="lots-story__muted">{{ __("No other unit of this item is in stock.") }}</p>
				<ul v-else class="lots-story__rows">
					<li v-for="sib in serialStory.siblings" :key="sib.serial_no" class="lots-story__row">
						<button type="button" class="reg-mono lots-story__row-code" :data-testid="`lots-sibling-${sib.serial_no}`" @click="emit('lookup', sib.serial_no)">
							{{ sib.serial_no }}
						</button>
						<span class="lots-story__row-meta">{{ sib.warehouse || "—" }}</span>
						<button
							v-if="sib.sellable_here"
							type="button"
							class="lots-story__mini"
							:data-testid="`lots-sell-sibling-${sib.serial_no}`"
							:disabled="offline"
							@click="emit('sell-serial', sib)"
						>
							{{ __("Sell") }}
						</button>
					</li>
				</ul>
			</section>

			<section class="lots-story__section">
				<h3 class="lots-story__h">
					{{ __("Movements") }}
					<span class="reg-mono lots-story__count">{{ serialStory.movements.length }}</span>
				</h3>
				<MovementList :movements="serialStory.movements" :format-float="formatFloat" @open="openVoucher" />
			</section>
		</template>

		<!-- ───────────── BATCH ───────────── -->
		<template v-else-if="kind === 'batch' && batchStory">
			<header class="lots-story__head">
				<div class="lots-story__ident">
					<p class="reg-mono lots-story__code" data-testid="lots-story-code">{{ batch.batch_no }}</p>
					<p class="lots-story__name">{{ batch.item_name }}</p>
					<p class="reg-mono lots-story__muted">{{ batch.item_code }}</p>
				</div>
				<div class="lots-story__side">
					<span class="lots__status lots__status--lg" :data-tone="batchTone(batch)" data-testid="lots-story-status">{{ batchChip }}</span>
					<button type="button" class="lots-story__icon" :aria-label="__('Copy')" data-testid="lots-copy" @click="copy(batch.batch_no)">
						<v-icon size="17">mdi-content-copy</v-icon>
					</button>
				</div>
			</header>

			<dl class="lots-story__facts">
				<dt>{{ __("Expiry") }}</dt>
				<dd class="reg-mono" :data-tone="batch.tone">{{ batch.expiry_date || "—" }}<span v-if="batch.days_to_expiry !== null"> · {{ __("{0} days", [batch.days_to_expiry]) }}</span></dd>
				<template v-if="batch.manufacturing_date">
					<dt>{{ __("Manufactured") }}</dt>
					<dd class="reg-mono">{{ batch.manufacturing_date }}</dd>
				</template>
				<template v-if="batch.supplier">
					<dt>{{ __("Supplier") }}</dt>
					<dd>{{ batch.supplier }}</dd>
				</template>
				<dt>{{ __("Total") }}</dt>
				<dd class="reg-mono">{{ formatFloat(batch.total_qty) }} {{ batch.stock_uom || "" }}</dd>
				<dt>{{ __("Here") }}</dt>
				<dd class="reg-mono">{{ formatFloat(batch.qty_here) }}</dd>
			</dl>

			<div class="lots-story__actions">
				<button
					v-if="batch.sellable_here"
					type="button"
					class="lots-story__primary"
					data-testid="lots-sell-batch"
					:disabled="offline"
					@click="emit('sell-batch', batch, 1)"
				>
					<v-icon size="18">mdi-cart-plus</v-icon>
					<span>{{ __("Sell one from this batch") }}</span>
				</button>
				<p v-else-if="batch.tone === 'expired'" class="lots-story__note">{{ __("Expired lot") }}</p>
				<p v-else-if="batch.total_qty > 0" class="lots-story__note">
					{{ __("None in {0}.", [batchStory.profile_warehouse || "—"]) }}
				</p>
			</div>

			<section class="lots-story__section" data-testid="lots-batch-stock">
				<h3 class="lots-story__h">{{ __("Where the units are") }}</h3>
				<p v-if="!batch.stock.length" class="lots-story__muted">{{ __("No units on any shelf.") }}</p>
				<ul v-else class="lots-story__rows">
					<li v-for="part in batch.stock" :key="part.warehouse || '-'" class="lots-story__row">
						<span class="lots-story__row-meta lots-story__row-meta--grow">{{ part.warehouse || "—" }}</span>
						<span class="reg-mono">{{ formatFloat(part.qty) }}</span>
					</li>
				</ul>
			</section>

			<section class="lots-story__section">
				<h3 class="lots-story__h">
					{{ __("Movements") }}
					<span class="reg-mono lots-story__count">{{ batchStory.movements.length }}</span>
				</h3>
				<MovementList :movements="batchStory.movements" :format-float="formatFloat" @open="openVoucher" />
			</section>
		</template>

		<div v-else class="lots-story__empty" data-testid="lots-story-empty">
			<v-icon size="28" class="lots-story__empty-glyph">mdi-magnify-scan</v-icon>
			<p>{{ __("Pick a serial or a batch to read where it is and where it went.") }}</p>
			<p class="lots-story__muted">{{ __("A sold unit shows its ticket and the customer; an in-stock one can go straight onto the sale.") }}</p>
		</div>
	</aside>
</template>

<script setup lang="ts">
/**
 * One record, read whole — the right column of the SERIES Y LOTES surface.
 *
 * Draws only what the server shaped; the two actions it can raise (sell a
 * unit, look another serial up) are EMITTED so the surface, which owns the
 * bus and the catalogue, performs them. On a phone the surface fronts this
 * panel over the list and the back chip returns.
 */
import { computed, defineComponent, h, type PropType } from "vue";

import {
	batchStatusKey,
	batchTone,
	movementLabel,
	movementTone,
	serialStatusLabel,
	serialTone,
	shortStamp,
	voucherDeskPath,
	type BatchRow,
	type BatchStory,
	type LotKind,
	type LotMovement,
	type SerialRow,
	type SerialSibling,
	type SerialStory,
} from "./lotsModel";
import { useToastStore } from "../../../stores/toastStore";

const props = defineProps<{
	kind: LotKind;
	serialStory: SerialStory | null;
	batchStory: BatchStory | null;
	loading: boolean;
	offline: boolean;
	fronted: boolean;
	formatCurrency: (value: any, precision?: number) => string;
	formatFloat: (value: any, precision?: number) => string;
}>();

const emit = defineEmits<{
	back: [];
	"sell-serial": [target: SerialRow | SerialSibling];
	"sell-batch": [target: BatchRow, qty: number];
	lookup: [serialNo: string];
}>();

const __ = (window as Record<string, any>).__ || ((value: string, args?: any[]) => {
	if (!args?.length) return value;
	return args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), value);
});

const toastStore = useToastStore();

const serial = computed(() => props.serialStory?.serial as SerialRow);
const batch = computed(() => props.batchStory?.batch as BatchRow);
const batchChip = computed(() => {
	if (!batch.value) return "";
	const { key, count } = batchStatusKey(batch.value);
	return count === null ? __(key) : __(key, [count]);
});

const openVoucher = (move: Pick<LotMovement, "voucher_type" | "voucher_no">) => {
	if (!move?.voucher_no) return;
	const base = (window as any).frappe?.urllib?.get_base_url?.() ?? "";
	window.open(`${base}${voucherDeskPath(move.voucher_type, move.voucher_no)}`, "_blank", "noopener");
};

const copy = async (text: string) => {
	try {
		await navigator.clipboard?.writeText(text);
		toastStore.show({ title: __("Copied"), message: text, color: "info" });
	} catch {
		toastStore.show({ title: __("Could not copy"), message: text, color: "warning" });
	}
};

/** The movement timeline, shared by both stories. Render function rather
 *  than a fourth file: it is one list and has no state of its own. */
const MovementList = defineComponent({
	name: "LotMovementList",
	props: {
		movements: { type: Array as PropType<LotMovement[]>, required: true },
		formatFloat: { type: Function as PropType<(v: any) => string>, required: true },
	},
	emits: ["open"],
	setup(listProps, { emit: listEmit }) {
		return () => {
			if (!listProps.movements.length) {
				return h("p", { class: "lots-story__muted" }, __("No movements recorded."));
			}
			return h(
				"ol",
				{ class: "lots-story__timeline", "data-testid": "lots-movements" },
				listProps.movements.map((move) =>
					h(
						"li",
						{
							class: ["lots-story__move", { "lots-story__move--cancelled": move.cancelled }],
							"data-tone": movementTone(move),
							"data-testid": `lots-move-${move.voucher_no}`,
						},
						[
							h("span", { class: "reg-mono lots-story__move-when" }, shortStamp(move.posting_datetime)),
							h("span", { class: "lots-story__move-what" }, [
								h("span", { class: "lots-story__move-verb" }, __(movementLabel(move))),
								move.cancelled ? h("span", { class: "lots-story__move-flag" }, __("Cancelled")) : null,
								move.party ? h("span", { class: "lots-story__move-party" }, move.party) : null,
								move.warehouse ? h("span", { class: "lots-story__muted" }, move.warehouse) : null,
							]),
							h("span", { class: "reg-mono lots-story__move-qty" }, `${move.qty > 0 ? "+" : ""}${listProps.formatFloat(move.qty)}`),
							h(
								"button",
								{
									type: "button",
									class: "reg-mono lots-story__move-doc",
									onClick: () => listEmit("open", move),
								},
								move.voucher_no,
							),
						],
					),
				),
			);
		};
	},
});
</script>
