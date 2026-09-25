<template>
	<!-- The amber left edge is the whole visual claim: this row is not an item,
	     it is several. It is STATE colour (§17.7 invariant 2) — the brand accent
	     stays on the primary button in the band and never appears here. -->
	<div
		class="combo-line"
		data-testid="cart-line-combo"
		:data-combo-components="componentCount"
	>
		<div class="combo-line__thumb">
			<slot name="thumb">
				<img v-if="line.image" :src="line.image" :alt="''" class="combo-line__img" />
			</slot>
		</div>

		<div class="combo-line__qty">
			<slot name="stepper" />
		</div>

		<!-- A paquete's body is its edit door: tapping the picks re-opens the
		     picker with them selected. A bundle's body stays plain text — its
		     parts are fixed, there is nothing to choose. -->
		<component
			:is="editable ? 'button' : 'div'"
			:type="editable ? 'button' : undefined"
			class="combo-line__body"
			:class="{ 'combo-line__body--editable': editable }"
			:data-testid="editable ? 'combo-edit' : undefined"
			:aria-label="editable ? editLabel : undefined"
			@click="editable ? emit('edit') : undefined"
		>
			<div class="combo-line__title">
				<span class="combo-line__name">{{ line.item_name }}</span>
				<span class="combo-line__chip combo-line__chip--combo" data-testid="combo-badge">
					{{ comboBadge }}
				</span>
				<span
					v-if="pricing.isDiscounted"
					class="combo-line__chip combo-line__chip--saving"
					data-testid="combo-saving"
				>
					{{ savingLabel }}
				</span>
				<v-icon
					v-if="editable"
					class="combo-line__edit-glyph"
					icon="mdi-pencil-outline"
					size="15"
					aria-hidden="true"
				/>
			</div>
			<div class="combo-line__components mono" data-testid="combo-components">
				{{ componentSummary }}
			</div>
		</component>

		<!-- The figure is drawn ONLY when it is bounded and known. An
		     all-labour combo is unbounded (POSITIVE_INFINITY) and an offline or
		     pre-field line is unknown; both render empty rather than "Infinity"
		     or a "0" that reads as out-of-stock. `availability.reason` says
		     which case this is and is asserted on directly.
		     Amber rides the register's own posa_low_stock_alert_threshold — the
		     artboard hand-picked its tint, the shipped rule honours the shop's
		     setting. -->
		<span
			class="combo-line__stock mono"
			:class="{ 'combo-line__stock--low': availability.isLow }"
			data-testid="combo-stock"
			:data-availability="availability.reason"
			:title="limitedByTitle"
		>{{ stockLabel }}</span>

		<span class="combo-line__rate mono">{{ formatCurrency(pricing.comboPrice) }}</span>
		<span class="combo-line__amount mono">{{ formatCurrency(lineAmount) }}</span>

		<button
			type="button"
			class="combo-line__remove"
			:aria-label="removeLabel"
			@click="onRemove"
		>
			×
		</button>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import {
	describeComponents,
	priceCombo,
	roundMoney,
	type ComboComponent,
} from "../../../composables/pos/combos/comboPricing";
import type { ComboAvailabilityContext } from "../../../composables/pos/combos/comboAvailability";
import {
	availabilityForLine,
	describeAvailability,
} from "../../../composables/pos/combos/comboAvailabilityDisplay";

const __ = window.__ || ((value: string) => value);

const props = withDefaults(
	defineProps<{
		line: {
			item_code: string;
			item_name: string;
			qty: number;
			rate: number;
			image?: string | null;
			components: ComboComponent[];
			/**
			 * Client-only display fields set by `comboLineAttachment.ts`. Read
			 * here, never written and never added to a payload — a figure for
			 * one warehouse at one instant does not belong on a document.
			 */
			_combo_available?: number | null;
			_combo_limited_by?: string | null;
		};
		formatCurrency?: (_value: number) => string;
		/** Passed to the resolver only when the line predates `_combo_available`. */
		availabilityContext?: ComboAvailabilityContext;
		/** POS Profile `posa_low_stock_alert_threshold` (Int, default 10). */
		lowStockThreshold?: number;
		/** A paquete whose picks can be changed: the body becomes a button. */
		editable?: boolean;
	}>(),
	{
		formatCurrency: (value: number) => value.toFixed(2),
		availabilityContext: () => ({}),
		lowStockThreshold: 0,
		editable: false,
	},
);

const emit = defineEmits<{ (_event: "remove"): void; (_event: "edit"): void }>();

const onRemove = () => emit("remove");

const pricing = computed(() => priceCombo(props.line.components ?? [], props.line.rate));

/**
 * Component count. Exposed as `data-combo-components` on the row so the e2e
 * and screenshot lane can assert the badge against a number rather than
 * parsing the label — the label is translated, the attribute is not.
 */
const componentCount = computed(() => (props.line.components ?? []).length);

/** "COMBO · 3" — the count is components, not quantity. */
const comboBadge = computed(() => `${__("COMBO")} · ${componentCount.value}`);

/**
 * "ahorra $41". The saving is per combo, matching the rate beside it: a line
 * of two combos shows the same per-combo saving as a line of one, because the
 * chip sits next to a per-combo price and mixing the two scopes on one row is
 * how a customer is quoted the wrong discount.
 */
const savingLabel = computed(
	() => `${__("saves")} ${props.formatCurrency(pricing.value.saving)}`,
);

/**
 * "Case negro + Mica Cristal + Instalación · lista $340.00". A paquete's pick
 * that costs extra says so beside it — «Latte +$10.00» — because that is
 * where the line's price differs from the menu board's.
 */
const componentSummary = computed(() => {
	const components = (props.line.components ?? []) as Array<ComboComponent & { extra_price?: number }>;
	const parts = components.some((component) => Number(component?.extra_price) > 0)
		? components
				.map((component) => {
					const qty = Number(component?.qty) || 0;
					const name = String(component?.item_name || component?.item_code || "").trim();
					const label = qty > 1 ? `${qty} × ${name}` : name;
					const extra = Number(component?.extra_price) || 0;
					return extra > 0 ? `${label} +${props.formatCurrency(extra)}` : label;
				})
				.filter(Boolean)
				.join(" + ")
		: describeComponents(components);
	const list = `${__("list")} ${props.formatCurrency(pricing.value.listPrice)}`;
	return parts ? `${parts} · ${list}` : list;
});

const lineAmount = computed(() =>
	roundMoney(pricing.value.comboPrice * (Number(props.line.qty) || 0)),
);

const availability = computed(() =>
	describeAvailability(
		availabilityForLine(props.line, props.line.components ?? [], props.availabilityContext),
		{ lowStockThreshold: props.lowStockThreshold },
	),
);

const stockLabel = computed(() =>
	availability.value.show ? `${__("left")} ${availability.value.value}` : "",
);

/**
 * "Limited: Mica Cristal" — the component that set the ceiling, named
 * because a bare number tells a cashier the combo is short but not which
 * shelf to go and check.
 */
const limitedByTitle = computed(() =>
	availability.value.show && availability.value.limitedBy
		? `${__("Limited")}: ${availability.value.limitedBy}`
		: undefined,
);

const removeLabel = computed(() => `${__("Remove")} ${props.line.item_name}`);
const editLabel = computed(() => `${__("Change picks")}: ${props.line.item_name}`);
</script>

<style scoped>
.combo-line {
	display: grid;
	grid-template-columns: 44px 54px 1fr 96px 92px 104px 30px;
	align-items: center;
	gap: 10px;
	padding: 0 16px;
	min-height: 56px;
	border-bottom: 1px solid var(--reg-divider-soft, #f4f6f8);
	/* 3px, not a background tint: the edge survives a row hover and does not
	   compete with the alternating row shading the cart already uses. */
	border-left: 3px solid var(--reg-tone-warning-border, #e9a13b);
}

.combo-line__thumb {
	width: 44px;
	height: 44px;
	border-radius: 9px;
	display: grid;
	place-items: center;
	overflow: hidden;
	background: var(--reg-surface-sunken, #f4f6f9);
}

.combo-line__img {
	max-width: 100%;
	max-height: 100%;
}

.combo-line__qty {
	display: grid;
	place-items: center;
}

.combo-line__body {
	min-width: 0;
}

/* The paquete's edit door: a plain-looking button, so the row keeps its
   rhythm, with the pencil saying the picks can change. */
.combo-line__body--editable {
	display: block;
	width: 100%;
	padding: 6px 8px;
	margin: 0 -8px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: start;
	cursor: pointer;
}

.combo-line__body--editable:hover,
.combo-line__body--editable:focus-visible {
	background: var(--reg-surface-muted, #f2f4f7);
}

.combo-line__body--editable:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}

.combo-line__edit-glyph {
	color: var(--reg-text-muted, #667085);
}

.combo-line__title {
	display: flex;
	align-items: center;
	gap: 7px;
}

.combo-line__name {
	font-size: 14px;
	font-weight: 500;
	color: var(--reg-text-primary, #212121);
}

.combo-line__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	font-size: 10px;
	font-weight: 700;
	padding: 2px 7px;
	white-space: nowrap;
}

.combo-line__chip--combo {
	background: var(--reg-tone-warning-bg, #fdf3df);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.combo-line__chip--saving {
	background: var(--reg-tone-positive-bg, #f0fbf4);
	color: var(--reg-tone-positive-label, #14603a);
}

.combo-line__components {
	font-size: 10.5px;
	color: var(--reg-text-muted, #9aa2ae);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.combo-line__stock {
	text-align: right;
	font-size: 12.5px;
	color: var(--reg-text-muted, #667085);
}

.combo-line__stock--low {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.combo-line__rate {
	text-align: right;
	font-size: 13.5px;
	color: var(--reg-text-secondary, #4a5260);
}

.combo-line__amount {
	text-align: right;
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.combo-line__remove {
	text-align: center;
	color: var(--reg-text-muted, #c3cbd5);
	font-size: 17px;
	background: none;
	border: 0;
	cursor: pointer;
	/* 44px is the §5 touch minimum; the glyph stays 17px so the artboard's
	   density is unchanged while the target is reachable on a tablet. */
	min-width: 30px;
	min-height: 44px;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
