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
			<v-btn
				v-if="modelValue"
				size="small"
				variant="tonal"
				color="secondary"
				data-test="split-clear"
				@click="$emit('clear')"
			>
				Quitar
			</v-btn>
		</div>

		<template v-if="modelValue">
			<!-- The quote, before anyone reaches for a wallet: «son $117.66
			     cada quien, $117.68 el último». -->
			<div v-if="!collected.length" class="split-evenly__quote" data-test="split-quote">
				{{ quoteLine }}
			</div>

			<div v-if="remainingCount > 0" class="split-evenly__collect" data-test="split-collect-row">
				<span class="split-evenly__who">
					Persona {{ collected.length + 1 }} de {{ modelValue }} ·
					<strong>{{ formatCurrency(nextShare) }}</strong>
				</span>
				<span class="split-evenly__methods">
					<v-btn
						v-for="method in methods"
						:key="method"
						size="small"
						variant="tonal"
						color="primary"
						:data-test="`split-collect-${method}`"
						@click="$emit('collect', { amount: nextShare, method })"
					>
						{{ method }}
					</v-btn>
				</span>
			</div>
			<div v-else class="split-evenly__done" data-test="split-done">
				Cuenta repartida — {{ modelValue }} personas cobradas.
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
import { computed } from "vue";
import { nextShareAmount, previewShares } from "../../../utils/splitEvenly";

const props = defineProps<{
	/** 0 = split off; 2..n = people. */
	modelValue: number;
	/** The settlement total the tenders target — reactive, tip included. */
	total: number;
	collected: { amount: number; method: string }[];
	methods: string[];
	label: string;
	formatCurrency: (value: number) => string;
}>();
const emit = defineEmits<{
	"update:modelValue": [value: number];
	collect: [share: { amount: number; method: string }];
	undo: [];
	clear: [];
}>();

// Once money moved, the headcount is history — changing 3 → 4 after two
// guests paid would re-divide receipts that already exist. Quitar (which
// backs every share out of the tenders) is the honest way to start over.
const locked = computed(() => props.collected.length > 0);

const choose = (count: number) => {
	if (locked.value) return;
	emit("update:modelValue", props.modelValue === count ? 0 : count);
};

const collectedTotal = computed(() =>
	props.collected.reduce((sum, share) => sum + (Number(share.amount) || 0), 0),
);
const remaining = computed(() => Math.max(props.total - collectedTotal.value, 0));
const remainingCount = computed(() =>
	Math.max(props.modelValue - props.collected.length, 0),
);
const nextShare = computed(() => nextShareAmount(remaining.value, remainingCount.value));

const quoteLine = computed(() => {
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
</style>
