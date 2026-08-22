<template>
	<v-card-title class="closing-header pa-6 d-flex align-center">
		<div class="header-content">
			<div class="header-icon-wrapper">
				<v-icon class="header-icon" size="40">mdi-store-clock-outline</v-icon>
			</div>
			<div class="header-text">
				<h3 class="header-title">{{ __("Closing POS Shift") }}</h3>
				<p class="header-subtitle">
					{{ __("Reconcile payment methods and close shift") }}
				</p>
			</div>
		</div>
		<v-spacer></v-spacer>
		<!-- The shift's own facts, on the header where the artboard puts them:
		     how long the drawer has been open, how many tickets went through it
		     and what is still unfinished. A corte is judged against the shift,
		     and the shift was previously nowhere on this screen. -->
		<div class="header-facts">
			<span v-if="shiftSpan" class="header-fact" data-testid="closing-shift-span">
				{{ shiftSpan }}
			</span>
			<span v-if="ticketCount !== null" class="header-fact" data-testid="closing-ticket-count">
				{{ __("{0} tickets", [ticketCount]) }}
			</span>
			<span
				v-if="openDrafts !== null"
				class="header-fact"
				:class="{ 'header-fact--attention': openDrafts > 0 }"
				data-testid="closing-open-drafts"
			>
				{{ __("{0} open drafts", [openDrafts]) }}
			</span>
		</div>
		<v-btn
			icon="mdi-close"
			variant="text"
			density="comfortable"
			class="header-close-btn"
			:title="__('Close')"
			:aria-label="__('Close closing shift dialog')"
			@click="$emit('close')"
		></v-btn>
	</v-card-title>
	<v-divider class="header-divider"></v-divider>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
	/** Frappe datetimes ("YYYY-MM-DD HH:mm:ss") from the closing shift doc. */
	periodStart: { type: String, default: "" },
	periodEnd: { type: String, default: "" },
	/** Nulls, not zeroes: "not loaded yet" and "none" are different facts. */
	ticketCount: { type: Number, default: null },
	openDrafts: { type: Number, default: null },
});

const __ = (text, args) => {
	const translate = window.__;
	if (translate) return translate(text, args);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) =>
		args[Number(index)] === undefined ? match : String(args[Number(index)]),
	);
};

defineEmits(["close"]);

/**
 * Frappe hands these over as "YYYY-MM-DD HH:mm:ss" in SITE time. `new Date()`
 * on that string is parsed as LOCAL time by every current engine, which is what
 * we want here — but only for the clock digits, never for a timezone claim, so
 * the digits are read straight off the string rather than reformatted.
 */
const clockOf = (value) => {
	const match = /(\d{1,2}):(\d{2})/.exec(String(value || ""));
	return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
};

const minutesOf = (value) => {
	const parsed = Date.parse(String(value || "").replace(" ", "T"));
	return Number.isFinite(parsed) ? parsed / 60000 : NaN;
};

const shiftSpan = computed(() => {
	const from = clockOf(props.periodStart);
	const to = clockOf(props.periodEnd);
	if (!from) return "";

	const span = to ? `${from} → ${to}` : from;
	const elapsed = minutesOf(props.periodEnd) - minutesOf(props.periodStart);
	// A shift that crossed midnight, or a doc missing an end, gets the clock
	// pair without a duration rather than a negative one.
	if (!Number.isFinite(elapsed) || elapsed < 0) return span;

	const hours = Math.floor(elapsed / 60);
	const minutes = Math.round(elapsed % 60);
	return `${span} · ${hours} h ${String(minutes).padStart(2, "0")} m`;
});
</script>

<style scoped>
.closing-header {
	border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
	padding: 24px !important;
}

.header-content {
	display: flex;
	align-items: center;
	gap: 20px;
	width: 100%;
}

.header-icon-wrapper {
	background: rgba(var(--v-theme-primary), 0.1);
	padding: 16px;
	border-radius: 16px;
}

.header-icon {
	color: rgb(var(--v-theme-primary));
}

.header-text {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.header-title {
	font-size: 1.5rem;
	font-weight: 700;
	letter-spacing: -0.5px;
	margin: 0;
	line-height: 1.2;
}

.header-subtitle {
	font-size: 0.875rem;
	font-weight: 500;
	margin: 0;
	line-height: 1.4;
	opacity: 0.7;
}

.header-facts {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.header-fact {
	padding: 3px 9px;
	border-radius: 999px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	font-size: 11.5px;
	font-weight: 500;
	white-space: nowrap;
}

/* Amber is STATE, and an unfinished draft at close is exactly that: it blocks
   the close server-side. Tinting it is not emphasis. */
.header-fact--attention {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.header-close-btn {
	opacity: 0.7;
	margin-left: 12px;
}

.header-close-btn:hover {
	background-color: rgba(var(--v-theme-on-surface), 0.04);
	opacity: 1;
}

.header-divider {
	border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
