<template>
	<button
		type="button"
		class="movil-line"
		:class="{ 'movil-line--combo': line.isCombo }"
		data-testid="movil-cart-line"
		:data-line-kind="line.isCombo ? 'combo' : 'item'"
		:data-availability="line.stock.reason"
		@click="onSelect"
	>
		<!-- The thumbnail is a SLOT, not an <img>. The phone's cart is the
		     narrowest surface in the product and the register has no image read
		     model it can promise; the shell fills this where it has one and the
		     empty box keeps the row's rhythm where it does not. -->
		<span class="movil-line__thumb" aria-hidden="true"><slot name="thumb" /></span>

		<span class="movil-line__body">
			<span class="movil-line__name">{{ line.itemName }}</span>

			<!-- A combo spends the subtitle row on its badges: what the bundle
			     holds and what it saves. It has no `quedan` of its own — a
			     bundle's availability is min(components) and that figure lives
			     on `ComboCartLine`'s own chip on the desk, which is a column
			     this row does not have. Absent beats a number computed a second
			     way. -->
			<span v-if="line.isCombo" class="movil-line__chips">
				<span class="movil-line__chip movil-line__chip--combo" data-testid="movil-combo-badge">
					{{ comboBadge }}
				</span>
				<span
					v-if="line.saving > 0"
					class="movil-line__chip movil-line__chip--saving reg-mono"
					data-testid="movil-combo-saving"
					data-money-role="line-saving"
				>
					{{ savingLabel }}
				</span>
			</span>

			<span
				v-else-if="subtitleParts.length"
				class="movil-line__subtitle reg-mono"
				:class="{ 'movil-line__subtitle--low': line.stock.isLow }"
				data-testid="movil-line-subtitle"
			>
				<!-- Rendered as parts so the unit rate can declare itself as
				     money while the code and the stock count — which are not
				     money — do not. One <span> per fact, joined by the same
				     middot the artboard draws. -->
				<template v-for="(part, index) in subtitleParts" :key="part.key">
					<span v-if="index" class="movil-line__sep" aria-hidden="true"> · </span>
					<span :data-money-role="part.moneyRole" :data-part="part.key">{{ part.text }}</span>
				</template>
			</span>
		</span>

		<span class="movil-line__amount reg-mono" data-money-role="line">{{
			formatCurrency(line.amount)
		}}</span>
	</button>
</template>

<script setup lang="ts">
/**
 * One cart line on the phone (`MovilVenta.dc.html`, nodes 24–44).
 *
 * WHY THIS IS NOT `CartItemRow.vue`. The desktop row is a `<tr>` that renders a
 * `<td>` per entry in `visibleColumns` — five columns, a `− 1 +` stepper, four
 * inline editors and a Vuetify chip rack. It cannot be lifted out of its table,
 * and at 390 px there is no room for the columns it exists to draw. What IS
 * shared is the part that decides what the figures MEAN: `cartLineStock.ts` for
 * `quedan N` and its absence rule, and `payments/saleSummary.ts` for the amount
 * and the combo badge — both reached through `mobileSaleLines.ts`, so the phone
 * cannot disagree with the desk about a peso.
 *
 * The row is a `<button>` because on a phone the row IS the control: there is
 * no hover, no right-click and nowhere to put a per-line toolbar. It emits
 * `select` and decides nothing.
 */
import { computed } from "vue";

import type { MobileSaleLine } from "./mobileSaleLines";

const props = withDefaults(
	defineProps<{
		line: MobileSaleLine;
		formatCurrency?: (_value: number) => string;
	}>(),
	{ formatCurrency: (value: number) => value.toFixed(2) },
);

const emit = defineEmits<{ (_event: "select", _line: MobileSaleLine): void }>();

/** Named, not inline: in `<script setup>` the template's `$emit` is not bound
 *  on the setup proxy, so `@click="$emit(...)"` compiles and never fires. */
const onSelect = () => emit("select", props.line);

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

/** "COMBO · 3" — the count is components, not quantity, as on the desk. */
const comboBadge = computed(() => `${__("COMBO")} · ${props.line.componentCount}`);

/**
 * "−$41". The artboard writes the saving as a negative on the phone rather than
 * the desk's "ahorra $41": at this width the row has no space for a verb, and a
 * signed figure beside an amount reads without one.
 */
const savingLabel = computed(() => `−${props.formatCurrency(props.line.saving)}`);

interface SubtitlePart {
	key: string;
	text: string;
	/** Only a figure that is MONEY declares a role; a code and a count are not. */
	moneyRole?: string;
}

/**
 * `IPN001880 · 2 × 120.00 · quedan 3`.
 *
 * The artboard draws two of these three at a time — it spends the row on the
 * multiplier where qty > 1 and on the stock figure otherwise. This draws all
 * three when all three exist, on the brief's explicit instruction that `quedan
 * N` appears on EVERY line: at 9.5 px mono the full string is ~175 px inside a
 * ~290 px slot, so the artboard's choice was an editorial one rather than a
 * width constraint, and the stock figure is the one a cashier cannot get any
 * other way while the phone's catalogue is behind a dock tab.
 *
 * `2 × 120.00` is present only above one unit, for the reason `saleSummary`
 * states: on a single-qty line the unit rate restates the amount already on the
 * row, and the register does not say a fact twice.
 */
const subtitleParts = computed<SubtitlePart[]>(() => {
	const parts: SubtitlePart[] = [];
	if (props.line.itemCode) parts.push({ key: "code", text: props.line.itemCode });
	if (props.line.showsUnitRate) {
		parts.push({
			key: "unit-rate",
			text: `${props.line.qty} × ${props.formatCurrency(props.line.rate)}`,
			moneyRole: "unit-rate",
		});
	}
	if (props.line.stock.show) {
		parts.push({ key: "stock", text: `${__("left")} ${props.line.stock.value}` });
	}
	return parts;
});
</script>

<style scoped>
/* Every colour is a token. A literal hex here is what left the register's
 * primary navigation rendering as a light column beside a #121212 shell
 * (wave 3, A1), and the phone is the surface most likely to be read at
 * night. */
.movil-line {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	width: 100%;
	padding: 8px 0;
	border: 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
	background: none;
	font: inherit;
	text-align: start;
	cursor: pointer;
}

.movil-line:last-child {
	border-bottom: 0;
}

/* 3px edge, not a background tint: it survives the pressed state and does not
 * compete with the card it sits in. Amber is STATE here — "this row is not an
 * item, it is several" — and never emphasis, so the accent stays on the one
 * primary button this screen owns. */
.movil-line--combo {
	border-left: 3px solid var(--reg-tone-warning-label, #8a5a0d);
	padding-left: 8px;
	margin-left: -8px;
}

.movil-line__thumb {
	width: 38px;
	height: 38px;
	flex: none;
	display: grid;
	place-items: center;
	overflow: hidden;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-muted, #f2f4f7);
}

.movil-line__body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.movil-line__name {
	font-size: 12.5px;
	line-height: 1.25;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.movil-line--combo .movil-line__name {
	font-weight: 500;
}

.movil-line__subtitle {
	font-size: 9.5px;
	line-height: 1.2;
	color: var(--reg-text-muted, #667085);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* Amber rides the register's own posa_low_stock_alert_threshold. The artboard
 * hand-picked which rows glow; the shipped rule honours the shop's setting,
 * the same trade ComboCartLine.vue made for the desk. */
.movil-line__subtitle--low {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-line__chips {
	display: flex;
	gap: var(--reg-space-xs, 5px);
	min-width: 0;
}

.movil-line__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	font-size: 9px;
	font-weight: 700;
	padding: 1px 6px;
	white-space: nowrap;
}

.movil-line__chip--combo {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-line__chip--saving {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.movil-line__amount {
	flex: none;
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

/* A phone is a coarse pointer by definition, but the two are asserted
 * separately: a narrow window on a laptop gets this layout too, and a tablet
 * with a stylus reports `pointer: fine` while its owner still uses a thumb. */
@media (pointer: coarse) {
	.movil-line {
		min-height: var(--reg-touch-min, 44px);
	}
}

@media (max-width: 480px) {
	.movil-line {
		min-height: var(--reg-touch-min, 44px);
	}
}
</style>
