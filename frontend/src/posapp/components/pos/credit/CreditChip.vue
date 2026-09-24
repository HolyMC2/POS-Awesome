<template>
	<span class="credit-chip" :class="`credit-chip--${tone}`"><slot /></span>
</template>

<script setup lang="ts">
/**
 * A state label on the credit screens: tint, edge and label ink from the
 * register's tone tokens (the ledger chip's shape). A chip is a figure, never
 * an action, so it never takes the accent.
 */
import type { CreditTone } from "./creditFormat";

withDefaults(defineProps<{ tone?: CreditTone }>(), { tone: "neutral" });
</script>

<style scoped>
.credit-chip {
	display: inline-flex;
	align-items: center;
	gap: var(--reg-space-xs);
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 12px;
	font-weight: 600;
	line-height: 1.35;
	white-space: nowrap;
	border: 1px solid transparent;
}

.credit-chip--neutral {
	background: var(--reg-surface-muted);
	border-color: var(--reg-tone-neutral-border);
	color: var(--reg-text-secondary);
}

.credit-chip--positive {
	background: var(--reg-tone-positive-bg);
	border-color: var(--reg-tone-positive-border);
	color: var(--reg-tone-positive-label);
}

.credit-chip--warning {
	background: var(--reg-tone-warning-bg);
	border-color: var(--reg-tone-warning-border);
	color: var(--reg-tone-warning-label);
}

.credit-chip--negative {
	background: var(--reg-tone-negative-bg);
	border-color: var(--reg-tone-negative-border);
	color: var(--reg-tone-negative-label);
}
</style>
