<template>
	<div class="category-tiles" data-testid="category-tiles" role="group" :aria-label="__('All categories')">
		<!-- Compact rows, not posters: a cafeteria menu is 5–15 groups, and on
		     a 390px phone the old 112px tiles left part of it below the dock.
		     The name owns the tile; the glyph only gives the grid a rhythm. -->
		<button
			v-for="category in categories"
			:key="category.id"
			type="button"
			class="category-tiles__tile"
			:class="{ 'category-tiles__tile--featured': category.featured }"
			:data-category="category.id"
			@click="emit('select', category.id)"
		>
			<span class="category-tiles__glyph" aria-hidden="true">
				<v-icon
					:icon="category.featured ? 'mdi-package-variant-closed' : 'mdi-shape-outline'"
					size="20"
				/>
			</span>
			<span class="category-tiles__name">{{ category.label }}</span>
			<!-- Only a count the caller KNOWS. Groups read from the profile
			     arrive without one, because a paginated catalogue cannot count
			     them honestly. -->
			<span v-if="category.count != null" class="category-tiles__count reg-mono">{{
				category.count
			}}</span>
		</button>
	</div>
</template>

<script setup lang="ts">
defineProps<{
	categories: readonly { id: string; label: string; featured?: boolean; count?: number | null }[];
}>();
const emit = defineEmits<{ (_event: "select", _id: string): void }>();
const __ = window.__ ?? ((text: string) => text);
</script>

<style scoped>
.category-tiles {
	container-type: inline-size;
	display: grid;
	/* 136px keeps two columns on a 320px phone; the desk panel still gets three. */
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 136px), 1fr));
	align-content: start;
	gap: 10px;
	padding: 4px 0 12px;
}
.category-tiles__tile {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	min-height: 64px;
	padding: 10px 12px;
	border: 1px solid var(--reg-border, var(--pos-border-light, #dce3e8));
	border-radius: 12px;
	background: var(--reg-surface, var(--pos-card-bg, #fff));
	color: var(--reg-text-primary, var(--pos-text-primary, #263238));
	text-align: start;
	font: inherit;
	cursor: pointer;
	transition:
		transform var(--motion-fast, 120ms) var(--ease-out, ease-out),
		border-color var(--motion-fast, 120ms) var(--ease-out, ease-out),
		background-color var(--motion-fast, 120ms) var(--ease-out, ease-out);
	-webkit-tap-highlight-color: transparent;
}
/* Featured (Combos) takes the whole first row and the grid's combo tone —
   the same amber the combo cards wear, so the tile and what it opens onto
   read as one thing. A STATE tint, not a second accent. */
.category-tiles__tile--featured {
	grid-column: 1 / -1;
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
}
.category-tiles__glyph {
	flex: none;
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	border-radius: 10px;
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}
.category-tiles__tile--featured .category-tiles__glyph {
	background: var(--reg-tone-warning-glyph-bg, #f7ead2);
	color: var(--reg-tone-warning-label, #8a5a0d);
}
.category-tiles__name {
	flex: 1;
	min-width: 0;
	font-size: 15px;
	font-weight: 600;
	line-height: 1.25;
	overflow-wrap: anywhere;
	hyphens: auto;
}
.category-tiles__count {
	flex: none;
	min-width: 26px;
	padding: 2px 8px;
	border-radius: 999px;
	text-align: center;
	font-size: 12px;
	font-weight: 700;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #56606e);
}
.category-tiles__tile--featured .category-tiles__count {
	background: var(--reg-surface, #fff);
	color: var(--reg-tone-warning-label, #8a5a0d);
}
/* Hover only where a pointer can hover: on a phone `:hover` sticks to the
   last tile tapped. */
@media (hover: hover) {
	.category-tiles__tile:hover {
		border-color: var(--reg-accent-edge, #9fdde6);
		background: var(--reg-accent-soft, #e0f7fa);
	}
}
.category-tiles__tile:focus-visible {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 2px;
}
.category-tiles__tile:active {
	transform: scale(var(--press-scale, 0.98));
}
/* A 320px phone's two columns: give the name the room the glyph was using, so
   «Desayunos» stays one word. */
@container (max-width: 330px) {
	.category-tiles__tile {
		gap: 8px;
		padding: 10px;
	}
	.category-tiles__glyph {
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}
	.category-tiles__name {
		font-size: 14px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.category-tiles__tile {
		transition: none;
	}
	.category-tiles__tile:active {
		transform: none;
	}
}
</style>
