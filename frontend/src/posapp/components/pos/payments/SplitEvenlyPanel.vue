<template>
	<section class="split-evenly" data-test="split-evenly-panel">
		<div class="split-evenly__choices">
			<strong>{{ label }}</strong>
			<v-btn
				v-for="count in [2, 3, 4, 5, 6]"
				:key="count"
				size="small"
				:variant="modelValue === count ? 'flat' : 'tonal'"
				color="primary"
				:disabled="locked && modelValue !== count"
				@click="choose(count)"
			>
				{{ count }}
			</v-btn>
			<!-- B4's payoff: the mesa lines know who ordered what, so the bill
			     can split by SEAT — proportional shares, not equal ones. Only
			     offered when the order actually tagged 2+ seats. -->
			<v-btn
				v-if="seatChoiceVisible"
				size="small"
				:variant="seatMode ? 'flat' : 'tonal'"
				color="primary"
				:disabled="locked && !seatMode"
				data-test="split-by-seat"
				@click="chooseSeats()"
			>
				Por asiento
			</v-btn>
			<v-btn
				v-if="active"
				size="small"
				variant="tonal"
				color="secondary"
				data-test="split-clear"
				@click="$emit('clear')"
			>
				Quitar
			</v-btn>
		</div>

		<template v-if="active">
			<!-- The quote, before anyone reaches for a wallet: «son $117.66
			     cada quien, $117.68 el último» — or per seat, «A1 $330 · A2 $110». -->
			<div v-if="!collected.length" class="split-evenly__quote" data-test="split-quote">
				{{ quoteLine }}
			</div>

			<div v-if="remainingCount > 0" class="split-evenly__collect" data-test="split-collect-row">
				<span class="split-evenly__who">
					{{ nextPayerLabel }} ·
					<strong>{{ formatCurrency(nextShare) }}</strong>
					<template v-if="tipEnabled && Number(tipDraft) > 0">
						+ {{ formatCurrency(Number(tipDraft)) }}
					</template>
				</span>
				<label v-if="tipEnabled" class="split-evenly__tip" data-test="split-tip">
					<span class="split-evenly__tip-label">Propina</span>
					<input
						type="number"
						min="0"
						inputmode="decimal"
						class="split-evenly__tip-input"
						data-test="split-tip-input"
						:value="tipDraft"
						@input="tipDraft = Number(($event.target as HTMLInputElement).value) || 0"
					/>
				</label>
				<span class="split-evenly__methods">
					<v-btn
						v-for="method in methods"
						:key="method"
						size="small"
						variant="tonal"
						color="primary"
						:data-test="`split-collect-${method}`"
						@click="collectShare(method)"
					>
						{{ method }}
					</v-btn>
				</span>
			</div>
			<div v-else class="split-evenly__done" data-test="split-done">
				{{ doneLine }}
			</div>

			<div v-if="collected.length" class="split-evenly__ledger">
				<span v-for="(share, idx) in collected" :key="idx" class="split-evenly__paid">
					✓ {{ formatCurrency(share.amount) }} · {{ share.method }}
				</span>
				<v-btn size="x-small" variant="text" data-test="split-undo" @click="$emit('undo')">
					Deshacer última
				</v-btn>
			</div>
		</template>
	</section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { nextShareAmount, previewShares } from "../../../utils/splitEvenly";
import type { SeatShare } from "../../../utils/splitBySeat";

const props = defineProps<{
	/** 0 = even split off; 2..n = people. */
	modelValue: number;
	/** The settlement total the tenders target — reactive, tip included. */
	total: number;
	collected: { amount: number; method: string }[];
	methods: string[];
	label: string;
	formatCurrency: (value: number) => string;
	/** Remaining per-seat plan (paid seats already dropped, shares re-divided
	 *  over what is left). null = the order carries no usable seat tags. */
	seatPlan?: SeatShare[] | null;
	/** true = collecting by seat; the numbered buttons stand down. */
	seatMode?: boolean;
	/** Restaurant only: let each payer add their own tip to their share. */
	tipEnabled?: boolean;
}>();
const emit = defineEmits<{
	"update:modelValue": [value: number];
	"update:seatMode": [value: boolean];
	collect: [share: { amount: number; method: string; tip?: number }];
	undo: [];
	clear: [];
}>();

// This payer's tip, added on top of their share. Cleared after each collect so
// it never carries to the next person. The tip rides onto the invoice's PROPINA
// line and this payer's tender; because both the total and the collected amount
// grow by the same tip, the remaining share the others owe is unchanged.
const tipDraft = ref(0);
const collectShare = (method: string) => {
	emit("collect", {
		amount: nextShare.value,
		method,
		tip: Number(tipDraft.value) || 0,
	});
	tipDraft.value = 0;
};

// Once money moved, the headcount is history — changing 3 → 4 (or hopping
// between even and per-seat) after two guests paid would re-divide receipts
// that already exist. Quitar (which backs every share out of the tenders) is
// the honest way to start over.
const locked = computed(() => props.collected.length > 0);
const active = computed(() => props.modelValue > 0 || Boolean(props.seatMode));

const choose = (count: number) => {
	if (locked.value) return;
	emit("update:seatMode", false);
	emit("update:modelValue", props.modelValue === count ? 0 : count);
};

const chooseSeats = () => {
	if (locked.value) return;
	emit("update:modelValue", 0);
	emit("update:seatMode", !props.seatMode);
};

// Offered only while it means something: 2+ seats tagged (paid ones count —
// mid-collection the plan shrinks but the toggle must not vanish).
const seatCount = computed(() => props.collected.length + (props.seatPlan?.length ?? 0));
const seatChoiceVisible = computed(
	() => props.seatPlan !== null && props.seatPlan !== undefined && seatCount.value >= 2,
);

const collectedTotal = computed(() =>
	props.collected.reduce((sum, share) => sum + (Number(share.amount) || 0), 0),
);
const remaining = computed(() => Math.max(props.total - collectedTotal.value, 0));
const remainingCount = computed(() =>
	props.seatMode
		? (props.seatPlan?.length ?? 0)
		: Math.max(props.modelValue - props.collected.length, 0),
);
const nextShare = computed(() =>
	props.seatMode
		? (props.seatPlan?.[0]?.amount ?? 0)
		: nextShareAmount(remaining.value, remainingCount.value),
);

const nextPayerLabel = computed(() => {
	if (props.seatMode) {
		const seat = props.seatPlan?.[0]?.seat;
		return `Asiento A${seat ?? "?"} · ${props.collected.length + 1} de ${seatCount.value}`;
	}
	return `Persona ${props.collected.length + 1} de ${props.modelValue}`;
});

const doneLine = computed(() =>
	props.seatMode
		? `Cuenta repartida — ${seatCount.value} asientos cobrados.`
		: `Cuenta repartida — ${props.modelValue} personas cobradas.`,
);

const quoteLine = computed(() => {
	if (props.seatMode) {
		return (props.seatPlan ?? [])
			.map((share) => `A${share.seat} ${props.formatCurrency(share.amount)}`)
			.join(" · ");
	}
	const shares = previewShares(props.total, props.modelValue);
	if (!shares.length) return "";
	const base = shares[0] ?? 0;
	const last = shares[shares.length - 1] ?? base;
	if (base === last) return `${props.formatCurrency(base)} cada quien`;
	return `${props.formatCurrency(base)} cada quien · ${props.formatCurrency(last)} el último`;
});
</script>

<style scoped>
.split-evenly {
	display: grid;
	gap: var(--pos-space-2);
	padding: var(--pos-space-3);
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md);
	background: var(--pos-surface-raised);
}
.split-evenly__choices,
.split-evenly__collect,
.split-evenly__ledger,
.split-evenly__methods {
	display: flex;
	align-items: center;
	gap: var(--pos-space-2);
	flex-wrap: wrap;
}
.split-evenly__collect {
	justify-content: space-between;
}
.split-evenly__quote,
.split-evenly__done {
	font-size: 13px;
	color: var(--pos-text-secondary);
}
.split-evenly__paid {
	font-size: 12.5px;
	color: var(--pos-text-secondary);
	font-variant-numeric: tabular-nums;
}
.split-evenly__tip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	color: var(--pos-text-secondary);
}
.split-evenly__tip-input {
	width: 64px;
	padding: 4px 6px;
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-sm, 6px);
	background: var(--pos-surface, #fff);
	color: var(--pos-text-primary, #101828);
	font-variant-numeric: tabular-nums;
	text-align: right;
}
/* Dense desk tier (utils/itemSelectorLayout DENSE_DESK_*): ≥1100px wide,
 * ≤820px tall. On the hosted Cobro the split panel shares the tender column's
 * elastic height with the keypad; its two-row chip layout (90px) measured the
 * keys down to 36px at 1143×656 — under the 44px touch floor. One row of
 * chips on 8px of padding hands the keys their floor back. */
@media (min-width: 1100px) and (max-height: 820px) {
	.split-evenly {
		padding: 6px 8px;
		gap: 6px;
	}

	/* The label takes its own line as a micro-label and the five chips share
	   the one below it: «Dividir cuenta» + five 50px chips measured 339px in
	   a 276px column when forced onto one line. */
	.split-evenly__choices {
		row-gap: 4px;
	}

	.split-evenly__choices > strong {
		flex: 1 1 100%;
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--pos-text-secondary, #667085);
	}

	.split-evenly__choices > .v-btn {
		min-width: 44px;
		padding: 0 6px;
	}
}
</style>
