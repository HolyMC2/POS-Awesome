<template>
	<section class="order-story" data-testid="order-story">
		<header v-if="title" class="order-story__title">{{ title }}</header>

		<p v-if="loading" class="order-story__note">
			{{ __("Reading what happened…") }}
		</p>

		<p v-else-if="errorMessage" class="order-story__note" data-testid="order-story-error">
			{{ errorMessage }}
		</p>

		<p v-else-if="!days.length" class="order-story__note" data-testid="order-story-empty">
			{{ emptyMessage }}
		</p>

		<ol v-else class="order-story__days">
			<li v-for="group in days" :key="group.day" class="order-story__day">
				<h4 class="order-story__day-heading">{{ dayLabel(group) }}</h4>

				<ol class="order-story__rows">
					<li
						v-for="row in group.rows"
						:key="row.key"
						class="order-story__row"
						:data-kind="row.kind"
						:data-testid="`order-story-row-${row.kind}`"
					>
						<span class="order-story__time mono">{{ row.time || "—" }}</span>
						<span class="order-story__what">
							<span class="order-story__label">{{ __(row.labelKey) }}</span>
							<span v-if="row.detail" class="order-story__detail">{{ row.detail }}</span>
							<span v-if="row.name" class="order-story__ref mono">{{ row.name }}</span>
						</span>
						<span v-if="row.amount !== null" class="order-story__amount mono">{{
							formatCurrency(row.amount)
						}}</span>
					</li>
				</ol>
			</li>
		</ol>

		<p v-if="note" class="order-story__note order-story__note--cap" data-testid="order-story-cap">
			{{ noteText }}
		</p>
	</section>
</template>

<script setup lang="ts">
/**
 * One document's history, in plain language — the register's recyclable
 * timeline (brief §2, artboard `Orden.dc.html`'s detail column).
 *
 * The same component tells three stories: a Repair Order's on the Orden
 * surface, a Sales Order's in the «Select S.O» picker, and a customer's from
 * the ticket. That is why it takes a `doctype`/`name` pair and fetches for
 * itself rather than being handed rows: the three callers have nothing else in
 * common, and threading a loader through each of them would put three copies
 * of the same request in three files.
 *
 * A caller that already HOLDS the payload passes `payload` instead and no
 * request is made — the customer story does exactly that, because it fetches
 * a different endpoint.
 *
 * It renders WHAT HAPPENED and nothing else. No buttons, no links that
 * navigate away mid-sale, no totals of its own: a cashier reading this is
 * answering a customer's question with the ticket still open, and the one
 * thing that must not happen is losing the sale to a curiosity click.
 */
import { computed, ref, watch } from "vue";

import {
	groupByDay,
	truncationNote,
	type OrderStoryDay,
	type OrderStoryPayload,
} from "./orderStory";
import { fetchOrderStory } from "../../../../services/serviceOrderService";

const props = withDefaults(
	defineProps<{
		/** "Repair Order" or "Sales Order". Ignored when `payload` is given. */
		doctype?: string | null;
		name?: string | null;
		/** A story the caller already has; skips the fetch entirely. */
		payload?: OrderStoryPayload | null;
		title?: string;
		emptyKey?: string;
		formatCurrency: (value: number) => string;
	}>(),
	{
		doctype: null,
		name: null,
		payload: null,
		title: "",
		emptyKey: "Nothing has happened on this document yet.",
	},
);

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const fetched = ref<OrderStoryPayload | null>(null);
const loading = ref(false);
const errorMessage = ref("");

const story = computed<OrderStoryPayload | null>(() => props.payload ?? fetched.value);

const days = computed<OrderStoryDay[]>(() => groupByDay(story.value?.events ?? []));

const note = computed(() => truncationNote(story.value));

const noteText = computed(() => {
	const current = note.value;
	if (!current) return "";
	return current.labelParams.reduce<string>(
		(text, value, index) => text.replace(`{${index}}`, String(value)),
		__(current.labelKey),
	);
});

const emptyMessage = computed(() => __(props.emptyKey));

const dayLabel = (group: OrderStoryDay): string => {
	if (!group.heading) return group.day;
	return `${group.heading.dayNumber} ${__(group.heading.monthKey)} ${group.heading.year}`;
};

async function load(doctype: string, name: string) {
	loading.value = true;
	errorMessage.value = "";
	try {
		const loaded = await fetchOrderStory(doctype, name);
		// The caller may have moved on while this was in flight. A timeline
		// that fills in with the PREVIOUS document is worse than an empty one,
		// because it looks authoritative.
		if (props.doctype === doctype && props.name === name) fetched.value = loaded;
	} catch (error) {
		const failure = error as { serverMessage?: string; message?: string } | null;
		fetched.value = null;
		errorMessage.value =
			failure?.serverMessage || failure?.message || __("Could not read what happened here.");
	} finally {
		loading.value = false;
	}
}

watch(
	() => [props.doctype, props.name, Boolean(props.payload)] as const,
	([doctype, name, hasPayload]) => {
		if (hasPayload) {
			fetched.value = null;
			errorMessage.value = "";
			return;
		}
		if (!doctype || !name) {
			fetched.value = null;
			return;
		}
		void load(doctype, name);
	},
	{ immediate: true },
);
</script>

<style scoped>
.order-story {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 6px);
	min-height: 0;
	min-width: 0;
}

.order-story__title {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #8b93a0);
	flex: none;
}

.order-story__days,
.order-story__rows {
	list-style: none;
	margin: 0;
	padding: 0;
}

.order-story__days {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	overflow-y: auto;
	overscroll-behavior: contain;
	min-height: 0;
}

.order-story__day-heading {
	margin: 0 0 3px;
	font-size: 11px;
	font-weight: 700;
	color: var(--reg-text-secondary, #4a5260);
}

.order-story__row {
	display: flex;
	align-items: baseline;
	gap: var(--reg-space-md, 10px);
	padding: 5px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f4f6f8);
	font-size: 12.5px;
}

.order-story__time {
	flex: none;
	width: 42px;
	font-size: 11px;
	color: var(--reg-text-muted, #9aa2ae);
}

.order-story__what {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 6px;
	flex: 1;
	min-width: 0;
}

.order-story__label {
	color: var(--reg-text-primary, #212121);
}

.order-story__detail,
.order-story__ref {
	font-size: 11px;
	color: var(--reg-text-muted, #9aa2ae);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}

.order-story__amount {
	flex: none;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

/* Money that came IN reads calm; the register's amber is reserved for things
   the cashier has to act on, and a paid advance is not one of them. */
.order-story__row[data-kind="payment"] .order-story__amount {
	color: var(--reg-tone-positive-number, #157a48);
}

.mono {
	font-variant-numeric: tabular-nums;
}

.order-story__note {
	margin: 0;
	padding: 8px 0;
	font-size: 12px;
	color: var(--reg-text-muted, #9aa2ae);
}

.order-story__note--cap {
	flex: none;
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
}
</style>
