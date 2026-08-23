<template>
	<div v-if="primaryInsights.length || secondaryInsights.length" class="insight-strip">
		<!--
			The corte's headline figures, as a strip rather than a row of
			Vuetify columns. This comment lives INSIDE the root on purpose: a
			top-level comment in a Vue template is itself a root node, and a
			two-root component silently drops the class its parent gives it —
			which is exactly how the strip lost its grid area.

			Why it left `ShiftOverview`: the tiles are the one part of the
			overview that has to stay ON SCREEN while the cashier counts the
			drawer, and a block inside a scrolling column cannot do that.
			Presentation only — it renders the two arrays the summary already
			builds, holds no state and asks nothing of the shift.

			Renders nothing at all while the overview is still loading: both
			arrays are empty then, and an empty strip with padding reads as a
			layout bug rather than as waiting.
		-->
		<div v-for="card in primaryInsights" :key="card.key" class="insight-card">
			<div class="insight-icon" :class="card.color">
				<v-icon size="22">{{ card.icon }}</v-icon>
			</div>
			<div class="insight-body">
				<div class="insight-label">{{ card.label }}</div>
				<div class="insight-value">{{ card.value }}</div>
				<div class="insight-caption">{{ card.caption }}</div>
			</div>
		</div>
		<div v-for="card in secondaryInsights" :key="card.key" class="insight-card compact">
			<div class="insight-icon" :class="card.color">
				<v-icon size="20">{{ card.icon }}</v-icon>
			</div>
			<div class="insight-body">
				<div class="insight-label">{{ card.label }}</div>
				<div class="insight-value">{{ card.value }}</div>
				<div class="insight-caption">{{ card.caption }}</div>
			</div>
		</div>
	</div>
</template>

<script setup>
defineProps({
	primaryInsights: { type: Array, default: () => [] },
	secondaryInsights: { type: Array, default: () => [] },
});
</script>

<style scoped>
/*
 * Auto-fit, so the strip answers to the WIDTH IT IS GIVEN rather than to the
 * window. The tiles used to be `cols="6" md="3"` — Vuetify breakpoints read the
 * viewport, and this strip lives inside a dialog that is 1100px wide on a 1920
 * screen and full-bleed inside the destination host. Same tiles, two very
 * different widths, one correct answer only by accident.
 */
.insight-strip {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
	gap: 8px;
}

.insight-card {
	background: rgb(var(--v-theme-surface));
	border-radius: 12px;
	padding: 16px;
	display: flex;
	align-items: flex-start;
	gap: 16px;
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	min-width: 0;
}

.insight-card.compact {
	padding: 12px 16px;
}

.insight-icon {
	width: 48px;
	height: 48px;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}

.insight-card.compact .insight-icon {
	width: 40px;
	height: 40px;
}

/* Accent colours for the icons — theme aware. */
.accent-primary {
	background-color: rgba(var(--v-theme-primary), 0.1);
	color: rgb(var(--v-theme-primary));
}
.accent-success {
	background-color: rgba(var(--v-theme-success), 0.1);
	color: rgb(var(--v-theme-success));
}
.accent-secondary {
	background-color: rgba(var(--v-theme-secondary), 0.1);
	color: rgb(var(--v-theme-secondary));
}
.accent-info {
	background-color: rgba(var(--v-theme-info), 0.1);
	color: rgb(var(--v-theme-info));
}
.accent-warning {
	background-color: rgba(var(--v-theme-warning), 0.1);
	color: rgb(var(--v-theme-warning));
}

.insight-body {
	flex: 1;
	min-width: 0;
}

.insight-label {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	opacity: 0.7;
	font-weight: 600;
	margin-bottom: 4px;
}

.insight-value {
	font-size: 1.25rem;
	font-weight: 700;
	line-height: 1.2;
}

.insight-card.compact .insight-value {
	font-size: 1.1rem;
}

.insight-caption {
	font-size: 0.75rem;
	opacity: 0.6;
	margin-top: 4px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/*
 * Phone: two up, stacked anatomy. The hover lift is dropped with the pointer
 * that could use it — on a touch screen it only ever fires as a tap artefact.
 */
@media (max-width: 600px) {
	.insight-strip {
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	}

	.insight-card,
	.insight-card.compact {
		padding: 10px;
		gap: 10px;
		flex-direction: column;
	}

	.insight-icon,
	.insight-card.compact .insight-icon {
		width: 32px;
		height: 32px;
	}

	.insight-label {
		font-size: 0.62rem;
		margin-bottom: 2px;
	}

	.insight-value,
	.insight-card.compact .insight-value {
		font-size: 0.95rem;
	}

	.insight-caption {
		font-size: 0.62rem;
	}
}
</style>
