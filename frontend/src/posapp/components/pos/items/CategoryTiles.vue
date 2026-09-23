<template>
	<div class="category-tiles" data-testid="category-tiles" role="group" :aria-label="__('All categories')">
		<button
			v-for="category in categories"
			:key="category.id"
			type="button"
			class="category-tiles__tile"
			:data-category="category.id"
			@click="emit('select', category.id)"
		>
			<v-icon
				:icon="category.featured ? 'mdi-tag-outline' : 'mdi-folder-open-outline'"
				size="26"
				aria-hidden="true"
			/>
			<span class="category-tiles__name">{{ category.label }}</span>
			<v-icon icon="mdi-chevron-right" size="18" aria-hidden="true" />
		</button>
	</div>
</template>

<script setup lang="ts">
defineProps<{ categories: readonly { id: string; label: string; featured?: boolean }[] }>();
const emit = defineEmits<{ (_event: "select", _id: string): void }>();
const __ = window.__ ?? ((text: string) => text);
</script>

<style scoped>
.category-tiles {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
	align-content: start;
	gap: 10px;
	padding: 4px 0 12px;
}
.category-tiles__tile {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 12px 8px;
	align-items: center;
	min-width: 0;
	min-height: 112px;
	padding: 16px;
	border: 1px solid var(--reg-border, var(--pos-border-light, #dce3e8));
	border-radius: 12px;
	background: var(--reg-surface, var(--pos-card-bg, #fff));
	color: var(--reg-ink, var(--pos-text-primary, #263238));
	text-align: start;
	font: inherit;
	cursor: pointer;
	transition:
		background 140ms,
		border-color 140ms,
		transform 140ms;
}
.category-tiles__tile > :first-child {
	grid-column: 1 / -1;
	color: var(--reg-accent, #0097a7);
}
.category-tiles__name {
	font-weight: 650;
	line-height: 1.3;
	overflow-wrap: anywhere;
}
.category-tiles__tile:hover,
.category-tiles__tile:focus-visible {
	border-color: var(--reg-accent, #0097a7);
	background: var(--reg-accent-soft, #e0f7fa);
}
.category-tiles__tile:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 2px;
}
.category-tiles__tile:active {
	transform: scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
	.category-tiles__tile {
		transition: none;
		transform: none;
	}
}
</style>
