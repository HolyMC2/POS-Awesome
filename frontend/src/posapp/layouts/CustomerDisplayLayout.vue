<template>
	<v-app class="customer-display-layout posapp pos-theme-root">
		<v-main class="customer-display-main">
			<slot />
		</v-main>
	</v-app>
</template>

<script setup></script>

<style scoped>
.customer-display-layout {
	height: 100dvh;
	/* Bound the chain so the slot's height:100% grid (screen → 1fr table →
	   overflow:auto) resolves: without overflow:hidden here + min-height:0 on
	   the main below, .customer-display-main grows to content and the table's
	   1fr track is unbounded — a long cart pushes the Total footer off the
	   customer screen and nothing scrolls. Mirrors DefaultLayout's working
	   .container1/.main-content chain; VMain renders the slot directly (no
	   scrollable prop), so no v-main inner wrapper is involved. */
	overflow: hidden;
	background:
		radial-gradient(
			circle at top,
			color-mix(in srgb, var(--pos-primary) 22%, transparent) 0%,
			transparent 42%
		),
		linear-gradient(180deg, var(--pos-bg-secondary) 0%, var(--pos-bg-primary) 100%);
	color: var(--pos-text-primary);
}

.customer-display-main {
	height: 100%;
	min-height: 0;
	display: flex;
	flex-direction: column;
	/* Scales with the panel rather than sitting at a fixed 12px. This window
	   runs on anything from a 1280x820 popup to a 24" screen bolted to the
	   counter, and a gutter that stays 12px on the big one crowds a figure the
	   customer is meant to read from two metres back. */
	padding: clamp(12px, 1.6vw, 28px);
}
</style>
