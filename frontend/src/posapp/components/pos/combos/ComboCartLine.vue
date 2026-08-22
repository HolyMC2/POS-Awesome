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

		<div class="combo-line__body">
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
			</div>
			<div class="combo-line__components mono" data-testid="combo-components">
				{{ componentSummary }}
			</div>
		</div>

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
	}>(),
	{
		formatCurrency: (value: number) => value.toFixed(2),
		availabilityContext: () => ({}),
		lowStockThreshold: 0,
	},
);

const emit = defineEmits<{ (_event: "remove"): void }>();

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

/** "Case negro + Mica Cristal + Instalación · lista $340.00" */
const componentSummary = computed(() => {
	const parts = describeComponents(props.line.components ?? []);
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
</script>

<style scoped>
.combo-line {
	display: grid;
	grid-template-columns: 44px 54px 1fr 96px 92px 104px 30px;
	align-items: center;
	gap: 10px;
	padding: 0 16px;
	min-height: 56px;
	border-bottom: 1px solid #f4f6f8;
	/* 3px, not a background tint: the edge survives a row hover and does not
	   compete with the alternating row shading the cart already uses. */
	border-left: 3px solid #e9a13b;
}

.combo-line__thumb {
	width: 44px;
	height: 44px;
	border-radius: 9px;
	display: grid;
	place-items: center;
	overflow: hidden;
	background: radial-gradient(120% 90% at 50% 8%, #fff 0%, #f4f6f9 60%, #eaeef3 100%);
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

.combo-line__title {
	display: flex;
	align-items: center;
	gap: 7px;
}

.combo-line__name {
	font-size: 14px;
	font-weight: 500;
	color: #212121;
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
	background: #fdf3df;
	color: #8a5a0d;
}

.combo-line__chip--saving {
	background: #f0fbf4;
	color: #14603a;
}

.combo-line__components {
	font-size: 10.5px;
	color: #9aa2ae;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.combo-line__stock {
	text-align: right;
	font-size: 12.5px;
	color: #667085;
}

.combo-line__stock--low {
	color: #8a5a0d;
}

.combo-line__rate {
	text-align: right;
	font-size: 13.5px;
	color: #4a5260;
}

.combo-line__amount {
	text-align: right;
	font-size: 15px;
	font-weight: 700;
	color: #212121;
}

.combo-line__remove {
	text-align: center;
	color: #c3cbd5;
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
