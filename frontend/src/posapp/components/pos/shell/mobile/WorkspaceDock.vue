<template>
	<nav class="workspace-dock" :aria-label="__('Workspace actions')" data-testid="workspace-dock">
		<button type="button" class="workspace-dock__back" data-testid="workspace-back" @click="emit('back')">
			<v-icon icon="mdi-arrow-left" size="20" />{{ __("Sale") }}
		</button>
		<div class="workspace-dock__context">
			<strong>{{ label }}</strong>
			<span v-if="primary && state">{{ formattedValue }}</span>
		</div>
		<v-menu location="top end">
			<template #activator="{ props: menuProps }">
				<button
					v-bind="menuProps"
					type="button"
					class="workspace-dock__switch"
					:aria-label="__('Switch workspace')"
					data-testid="workspace-switch"
				>
					<v-icon icon="mdi-dots-vertical" size="24" />
				</button>
			</template>
			<v-list class="workspace-dock__menu" :aria-label="__('Switch workspace')">
				<v-list-item
					v-for="entry in destinations"
					:key="entry.def.id"
					:title="__(entry.def.labelKey)"
					:active="entry.def.id === activeId"
					:disabled="!entry.enabled"
					@click="emit('navigate', entry.def.id)"
				/>
			</v-list>
		</v-menu>
		<button
			v-if="primary"
			type="button"
			class="workspace-dock__primary"
			:disabled="!state?.primaryEnabled"
			data-testid="workspace-primary"
			@click="emit('primary', primary.id)"
		>
			{{ __(primary.labelKey, primary.labelParams) }}
		</button>
	</nav>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { BandState } from "../../../../composables/pos/shell/bandState";
import type { RailEntry } from "../../../../composables/pos/shell/useDestinationRouting";
const props = defineProps<{
	label: string;
	activeId: string;
	destinations: RailEntry[];
	state: BandState | null;
	currency: string;
}>();
const emit = defineEmits<{ back: []; navigate: [id: string]; primary: [id: string] }>();
const __ = (text: string, args?: (string | number)[]) => window.__?.(text, args) || text;
const formattedValue = computed(() =>
	new Intl.NumberFormat(undefined, { style: "currency", currency: props.currency || "MXN" }).format(
		props.state?.value || 0,
	),
);
const primary = computed(() =>
	props.state?.primaryAction?.id !== "sale.return" ? props.state?.primaryAction : null,
);
</script>
<style scoped>
.workspace-dock {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	color: var(--pos-text-primary);
}
.workspace-dock button {
	min-width: 44px;
	min-height: 44px;
	border-radius: 10px;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 8px 12px;
	font-size: 14px;
}
.workspace-dock button:focus-visible {
	outline: 2px solid var(--pos-primary);
	outline-offset: 2px;
}
.workspace-dock button:active:not(:disabled) {
	transform: translateY(1px);
}
.workspace-dock__back {
	border: 1px solid var(--pos-border);
}
.workspace-dock__context {
	min-width: 0;
	display: grid;
	gap: 2px;
	text-align: center;
	overflow-wrap: anywhere;
	line-height: 1.3;
	font-size: 14px;
}
.workspace-dock__context span {
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-secondary);
}
.workspace-dock__primary {
	grid-column: 1 / -1;
	background: var(--pos-primary);
	color: var(--pos-on-primary, white);
	font-weight: 700;
}
.workspace-dock__primary:disabled {
	opacity: 0.5;
}
.workspace-dock__menu :deep(.v-list-item) {
	min-height: 48px;
}
@media (prefers-reduced-motion: reduce) {
	.workspace-dock button:active:not(:disabled) {
		transform: none;
	}
}
</style>
