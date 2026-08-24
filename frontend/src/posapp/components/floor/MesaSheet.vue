<template>
	<section class="mesa-sheet" data-test="mesa-sheet">
		<header class="mesa-sheet__head">
			<span class="mesa-sheet__badge" aria-hidden="true">{{ shortLabel }}</span>
			<div class="mesa-sheet__identity">
				<h2 class="mesa-sheet__title">{{ table.table_label }}</h2>
				<p class="mesa-sheet__meta">{{ metaLine }}</p>
			</div>
			<span class="mesa-sheet__state" :class="`mesa-sheet__state--${stateTone}`">{{ stateLabel }}</span>
		</header>

		<!-- Split bills are the one place the floor is allowed to be loud: the
		     aggregate is NOT chargeable (UX map §5), so the sheet says so before
		     the operator reaches for a verb. -->
		<div v-if="orders.length > 1" class="mesa-sheet__warning" role="note" data-test="mesa-sheet-split">
			<v-icon icon="mdi-alert-circle-outline" size="16" />
			<p class="mesa-sheet__warning-text">{{ splitWarning }}</p>
		</div>

		<template v-if="orders.length">
			<p class="mesa-sheet__label">{{ accountsLabel }}</p>
			<div class="mesa-sheet__accounts">
				<button
					v-for="account in accountCards"
					:key="account.order.order_uid"
					type="button"
					class="mesa-sheet__account"
					:class="{ 'mesa-sheet__account--on': account.order.order_uid === selectedUid }"
					:aria-pressed="account.order.order_uid === selectedUid ? 'true' : 'false'"
					:data-test="`mesa-sheet-account-${account.order.order_uid}`"
					@click="emit('select', account.order)"
				>
					<span class="mesa-sheet__account-top">
						<span class="mesa-sheet__account-name">{{ account.name }}</span>
						<span class="mesa-sheet__account-total">{{ account.total }}</span>
					</span>
					<span class="mesa-sheet__account-meta">{{ account.meta }}</span>
					<span v-if="account.chips.length" class="mesa-sheet__chips">
						<span
							v-for="chip in account.chips"
							:key="chip.key"
							class="mesa-sheet__chip"
							:class="`mesa-sheet__chip--${chip.tone}`"
							>{{ chip.text }}</span
						>
					</span>
				</button>
			</div>

			<p class="mesa-sheet__label">{{ verbsLabel }}</p>
			<div class="mesa-sheet__verbs">
				<button
					v-for="verb in verbs"
					:key="verb.id"
					type="button"
					class="mesa-sheet__verb"
					:class="{ 'mesa-sheet__verb--primary': verb.primary }"
					:disabled="verb.disabled"
					:title="verb.hint || undefined"
					:data-test="`mesa-sheet-${verb.id}`"
					@click="runVerb(verb.id)"
				>
					<v-icon :icon="verb.icon" size="18" />
					<span class="mesa-sheet__verb-text">{{ verb.label }}</span>
					<span v-if="verb.badge" class="mesa-sheet__verb-badge">{{ verb.badge }}</span>
				</button>
			</div>
		</template>

		<!-- A free table has exactly one honest next action, and a dirty one has
		     a different single action. Neither gets a grid of greyed verbs. -->
		<div v-else class="mesa-sheet__verbs mesa-sheet__verbs--single">
			<button
				v-if="needsCleaning"
				type="button"
				class="mesa-sheet__verb mesa-sheet__verb--primary"
				data-test="mesa-sheet-clean"
				@click="emit('clean')"
			>
				<v-icon icon="mdi-broom" size="18" />
				<span class="mesa-sheet__verb-text">{{ cleanLabel }}</span>
			</button>
			<button
				v-else
				type="button"
				class="mesa-sheet__verb mesa-sheet__verb--primary"
				data-test="mesa-sheet-open"
				@click="emit('open')"
			>
				<v-icon icon="mdi-account-multiple-plus-outline" size="18" />
				<span class="mesa-sheet__verb-text">{{ openLabel }}</span>
			</button>
		</div>

		<div class="mesa-sheet__spacer"></div>

		<footer v-if="needsCleaning && orders.length" class="mesa-sheet__foot">
			<button type="button" class="mesa-sheet__foot-action" data-test="mesa-sheet-clean" @click="emit('clean')">
				{{ cleanLabel }}
			</button>
			<span class="mesa-sheet__foot-hint">{{ cleanHint }}</span>
		</footer>
	</section>
</template>

<script setup lang="ts">
/**
 * The mesa's action sheet as a COLUMN, not a modal (`Salon.dc.html`).
 *
 * The modal `TableActionSheet` still ships and is still what a phone gets: on a
 * 390px screen a 352px panel beside the room is not a layout. This is the same
 * question — "what can I do with this table" — answered where there is room to
 * answer it fully: every cuenta on the table with its OWN total, the split-bill
 * warning beside the totals it explains, and the verbs named rather than
 * squeezed behind a chevron.
 *
 * Presentational on purpose. It reads the table and its orders from props and
 * emits intents; `FloorView` owns which cuenta is selected, hydrates it and
 * routes the verb, because every one of those verbs has to resume the exact
 * order first and that is orchestration, not rendering.
 */
import { computed } from "vue";
import type { OrderRow, TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { formatIdleShort, idleMinutes, useFloorClock } from "./floorClock";

const props = defineProps<{
	table: TableRow;
	orders: OrderRow[];
	/** The cuenta the verbs act on. Never guessed here — see the module note. */
	selectedUid: string | null;
	firing?: boolean;
	releasing?: boolean;
}>();

const emit = defineEmits<{
	(event: "select", order: OrderRow): void;
	(event: "add-items"): void;
	(event: "fire"): void;
	(event: "view"): void;
	(event: "transfer"): void;
	(event: "release"): void;
	(event: "open"): void;
	(event: "clean"): void;
}>();

const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const t = (key: string) => verticalStore.t(key);

const needsCleaning = computed(() => Boolean(props.table.needs_cleaning));

const selectedOrder = computed(
	() => props.orders.find((order) => order.order_uid === props.selectedUid) || props.orders[0] || null,
);

/** The tile's own number, for the badge. Falls back to the whole label. */
const shortLabel = computed(() => {
	const match = /(\d+)\s*$/.exec(props.table.table_label || "");
	return match ? match[1] : (props.table.table_label || "").slice(0, 2);
});

const stateLabel = computed(() => {
	if (props.orders.length > 1) return `${props.orders.length} ${t("open accounts")}`;
	if (props.orders.length) return t("Occupied");
	if (needsCleaning.value) return t("Needs cleaning");
	// "Free table", not "Free": es.csv binds the bare key to «Gratis».
	return t("Free table");
});

const stateTone = computed(() => {
	if (props.orders.length) return "busy";
	if (needsCleaning.value) return "dirty";
	return "free";
});

/**
 * Guests · opened · age, from the OLDEST cuenta on the table — a party that
 * split its bill sat down once, and the second cuenta's clock says nothing
 * about how long they have been waiting.
 */
const metaLine = computed(() => {
	const parts: string[] = [];
	const guests = props.orders.reduce((sum, order) => sum + (Number(order.guest_count) || 0), 0);
	if (guests) parts.push(`${guests} ${t("Guests").toLowerCase()}`);
	else if (props.table.seats) parts.push(`${props.table.seats} ${t("seats")}`);
	const idle = props.orders.reduce<number | null>((oldest, order) => {
		const minutes = idleMinutes(order.modified, now.value);
		if (minutes === null) return oldest;
		return oldest === null || minutes > oldest ? minutes : oldest;
	}, null);
	if (idle !== null) parts.push(formatIdleShort(idle));
	return parts.join(" · ");
});

const splitWarning = computed(() =>
	`${t("This table has more than one account.")} ${t("They are charged separately — pick the one you mean.")}`,
);

const accountsLabel = computed(() => t("Accounts on this table"));
const cleanLabel = computed(() => t("Mark clean"));
const cleanHint = computed(() => t("Only once the table is empty"));
const openLabel = computed(() => t("Open table"));

// Static: the cuenta the verbs act on is the lit card directly above, and a
// caption that repeats its name is the sheet saying one fact twice.
const verbsLabel = computed(() => t("With the selected account"));

type VerbId = "add-items" | "fire" | "view" | "transfer" | "release";

/**
 * Written out rather than `emit(verb.id)`: a typed `defineEmits` is a set of
 * overloads, and TS cannot resolve one from a union argument — the template
 * would compile and `pnpm type-check` would not.
 */
const runVerb = (id: VerbId) => {
	if (id === "add-items") emit("add-items");
	else if (id === "fire") emit("fire");
	else if (id === "view") emit("view");
	else if (id === "transfer") emit("transfer");
	else emit("release");
};

const accountCards = computed(() =>
	props.orders.map((order) => {
		const chips: Array<{ key: string; text: string; tone: string }> = [];
		const unsent = Number(order.unsent_count) || 0;
		if (unsent) {
			chips.push({
				key: "unsent",
				text: `${unsent} ${t("not sent to the kitchen")}`,
				tone: "warn",
			});
		}
		if (order.pending_sync) {
			chips.push({ key: "pending", text: t("Queued on this device"), tone: "warn" });
		}
		if (order.status === "Settling") {
			chips.push({ key: "settling", text: t("Waiting to be charged"), tone: "warn" });
		}
		const lines = Number(order.items_count) || 0;
		const meta = [
			`${lines} ${t("Lines").toLowerCase()}`,
			order.guest_count ? `${order.guest_count} ${t("Guests").toLowerCase()}` : "",
			order.opened_by ? order.opened_by.split("@")[0] : "",
		]
			.filter(Boolean)
			.join(" · ");
		return {
			order,
			name: order.tab_name || order.order_uid.slice(0, 6),
			total: formatCurrency(Number(order.total) || 0),
			meta,
			chips,
		};
	}),
);

/**
 * The verbs, all live.
 *
 * «Imprimir cuenta» from the artboard is deliberately absent: nothing on the
 * server prints a bill for a table order today (`bill_printed_at` is only ever
 * CLEARED, by settle and by Mark clean), and the golden flow's first rule is no
 * dead verbs. «Ver cuenta» takes its place — a real verb from UX map §5 that
 * lands the operator on the ticket, which is where they were going anyway.
 */
const verbs = computed(() => {
	const order = selectedOrder.value;
	const lines = Number(order?.items_count) || 0;
	const unsent = Number(order?.unsent_count) || 0;
	const rows: Array<{
		id: VerbId;
		icon: string;
		label: string;
		primary?: boolean;
		disabled?: boolean;
		badge?: number;
		hint?: string;
	}> = [
		{ id: "add-items", icon: "mdi-plus-circle-outline", label: t("Add a round"), primary: true },
		// Enabled at zero unsent on purpose: the last line typed may still be
		// inside the cart-sync debounce, and `fireActiveCourse` flushes first.
		// Gating on the count would refuse the one press that matters.
		{
			id: "fire",
			icon: "mdi-silverware-variant",
			label: t("Send to kitchen"),
			disabled: Boolean(props.firing),
			badge: unsent || undefined,
		},
		{ id: "view", icon: "mdi-receipt-text-outline", label: t("View order") },
		{ id: "transfer", icon: "mdi-swap-horizontal", label: t("Transfer table") },
	];
	// Spec §3: releasing a table is cancelling its EMPTY order, so it is offered
	// only when there is nothing to lose and never needs a confirm.
	if (!lines) {
		rows.push({
			id: "release",
			icon: "mdi-close-circle-outline",
			label: t("Release table"),
			disabled: Boolean(props.releasing),
		});
	}
	return rows;
});
</script>

<style scoped src="./mesa-sheet.css"></style>
