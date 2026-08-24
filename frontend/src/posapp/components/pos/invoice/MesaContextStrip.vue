<template>
	<section v-if="order" class="mesa-strip" data-test="mesa-context-strip">
		<span class="mesa-strip__badge" aria-hidden="true">{{ shortLabel }}</span>

		<div class="mesa-strip__identity">
			<p class="mesa-strip__where">{{ whereLine }}</p>
			<p class="mesa-strip__meta">{{ metaLine }}</p>
		</div>

		<div class="mesa-strip__side">
			<!-- THE answer to "did my round land". `aria-live` because it changes
			     without the operator touching anything, and because it is the one
			     fact the debounce used to keep to itself. -->
			<span
				class="mesa-strip__sync"
				:class="`mesa-strip__sync--${syncTone}`"
				:data-sync-state="syncState"
				data-test="mesa-sync-state"
				role="status"
				aria-live="polite"
			>
				<v-icon :icon="syncIcon" size="13" />
				{{ syncLabel }}
			</span>
			<button
				type="button"
				class="mesa-strip__back"
				data-test="mesa-back-to-floor"
				@click="backToFloor"
			>
				{{ backLabel }}
			</button>
		</div>

		<!-- The band's breakdown column while a mesa owns the sale
		     (`SalonCuenta.dc.html`): the round's own facts, not Subtotal · IVA ·
		     Descuento. The summary stands its lanes down for exactly this — see
		     its `bandOwnedElsewhere` prop. -->
		<Teleport v-if="bandLaneActive" defer :to="bandBreakdownTarget">
			<span class="mesa-strip__band-divider" aria-hidden="true"></span>
			<div class="mesa-strip__band-col" data-testid="mesa-band-breakdown">
				<div v-for="row in bandRows" :key="row.key" class="mesa-strip__band-row">
					<span class="mesa-strip__band-term" :class="{ 'mesa-strip__band-term--warn': row.warn }">{{
						row.term
					}}</span>
					<span class="mesa-strip__band-value" :class="{ 'mesa-strip__band-value--warn': row.warn }">{{
						row.value
					}}</span>
				</div>
			</div>
		</Teleport>
	</section>
</template>

<script setup lang="ts">
/**
 * The sale is not anonymous — it belongs to Mesa 1, and this says so.
 *
 * Golden flow §3. Before this strip the only way to tell a mesa-owned ticket
 * from a walk-up one was that the cart happened to have food in it: the
 * customer row said the same generic thing either way, the round's only trace
 * was an 800 ms debounce with no UI, and the way back to the room was a rail
 * icon the waiter had to remember. Three sentences fix that — where this
 * ticket lives, whether the last round is safe, and how to get back.
 *
 * Mounted by `Invoice.vue` above the ticket, and only while
 * `floorStore.activeOrder` is set; a retail or counter register never renders
 * it, and never pays for the floor store either — the parent's `v-if` is what
 * gates the whole subtree.
 */
import { computed, inject } from "vue";
import { bus as importedBus } from "../../../bus";
import { useFloorStore } from "../../../stores/floorStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useVerticalStore } from "../../../stores/verticalStore";
import { useFormat } from "../../../format";
import { formatIdleShort, idleMinutes, useFloorClock } from "../../floor/floorClock";

const props = withDefaults(
	defineProps<{
		/**
		 * Selector for the shell band's breakdown lane. Empty means "no band to
		 * fill" — a phone, a lean-vertical preset, a unit mount — and the strip
		 * must be correct standing alone, so nothing renders there at all.
		 */
		bandBreakdownTarget?: string;
	}>(),
	{ bandBreakdownTarget: "" },
);

// The bus the SHELL listens on, by injection like every other component here.
// The module import is the fallback for tests that mount with no app.
const bus = inject<typeof importedBus>("eventBus", importedBus);

const floorStore = useFloorStore();
const invoiceStore = useInvoiceStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const t = (key: string) => verticalStore.t(key);

const order = computed(() => floorStore.activeOrder);

const tableRow = computed(() => {
	const name = order.value?.table;
	return name ? floorStore.tables.find((row) => row.name === name) || null : null;
});

const floorRow = computed(() => {
	const floor = tableRow.value?.floor;
	return floor ? floorStore.floors.find((row) => row.name === floor) || null : null;
});

/** The tile's own number for the badge; a named cup tab gets its initial. */
const shortLabel = computed(() => {
	const label = tableRow.value?.table_label || "";
	const match = /(\d+)\s*$/.exec(label);
	if (match) return match[1];
	if (label) return label.slice(0, 2);
	return (order.value?.tab_name || "·").slice(0, 1).toUpperCase();
});

/** «Mesa 1 · Interior», or the cup's name when there is no table. */
const whereLine = computed(() => {
	const parts = [tableRow.value?.table_label, floorRow.value?.floor_name].filter(Boolean);
	if (parts.length) return parts.join(" · ");
	return order.value?.tab_name || t("Tab");
});

/**
 * Guests and service read from the CART, not from the order row: those two
 * fields are edited in the identity row a few pixels below and sync back on
 * the same debounce, so reading the row would print a stale number the moment
 * the waiter corrects the party size.
 */
const metaLine = computed(() => {
	const current = order.value;
	if (!current) return "";
	const parts: string[] = [];
	const guests = invoiceStore.posaGuestCount ?? current.guest_count;
	if (guests) parts.push(`${guests} ${t("Guests").toLowerCase()}`);
	const service = invoiceStore.posaServiceType || current.service_type;
	if (service) parts.push(t(service));
	const idle = idleMinutes(current.modified, now.value);
	if (idle !== null) parts.push(`${t("Idle")} ${formatIdleShort(idle)}`);
	return parts.join(" · ");
});

const syncState = computed(() => floorStore.cartSyncState);

/**
 * Four store states, three things worth saying. `pending` and `saving` are one
 * sentence to the waiter — the round is on its way — while staying distinct in
 * `data-sync-state` for the tests and for anyone reading the DOM.
 */
const syncTone = computed(() => {
	if (syncState.value === "error") return "error";
	if (syncState.value === "pending" || syncState.value === "saving") return "busy";
	return "saved";
});

const syncLabel = computed(() => {
	if (syncTone.value === "error") return t("Not saved");
	if (syncTone.value === "busy") return t("Saving…");
	return t("Saved");
});

const syncIcon = computed(() => {
	if (syncTone.value === "error") return "mdi-alert-circle-outline";
	// The icon set is a GENERATED allowlist (`mdiIconPaths.ts`) carrying only
	// the glyphs this app renders; an unlisted token draws a blank box, and
	// `mdiIconCoverage.spec.ts` fails the build rather than let one ship. Pick
	// from what is already in the set.
	if (syncTone.value === "busy") return "mdi-progress-clock";
	return "mdi-check";
});

const backLabel = computed(() => t("Back to the floor"));

const bandLaneActive = computed(() => Boolean(order.value && props.bandBreakdownTarget));

const bandRows = computed(() => {
	const current = order.value;
	if (!current) return [];
	const unsent = Number(current.unsent_count) || 0;
	return [
		{
			key: "lines",
			term: t("Lines"),
			value: String(invoiceStore.itemsCount ?? 0),
			warn: false,
		},
		{
			key: "unsent",
			term: t("Not sent to the kitchen"),
			value: String(unsent),
			warn: unsent > 0,
		},
		{
			key: "floor",
			term: t("Open in the floor"),
			value: formatCurrency(floorStore.floorStats.openTotal),
			warn: false,
		},
	];
});

/**
 * The shell performs it: flush → detach → clear → land on the floor. That
 * ordering is the whole safety property (detaching before the clear is what
 * stops the emptied cart syncing itself back over the cuenta), and only the
 * shell can do the last step.
 */
function backToFloor() {
	bus.emit("floor_return_to_salon");
}
</script>

<style scoped>
.mesa-strip {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 8px;
	padding: 10px 12px;
	border: 1px solid var(--pos-primary);
	border-radius: 12px;
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

.mesa-strip__badge {
	display: grid;
	place-items: center;
	flex: 0 0 auto;
	width: 36px;
	height: 36px;
	border-radius: 11px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
	font-size: 15px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.mesa-strip__identity {
	flex: 1 1 auto;
	min-width: 0;
}

.mesa-strip__where {
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	background: transparent;
	color: var(--pos-text-primary);
	font-size: 14px;
	font-weight: 700;
	line-height: 1.25;
}

.mesa-strip__meta {
	margin: 1px 0 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 11px;
	line-height: 1.25;
}

.mesa-strip__side {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4px;
	flex: 0 0 auto;
}

.mesa-strip__sync {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 3px 9px;
	border-radius: 999px;
	background: var(--pos-surface);
	font-size: 11.5px;
	font-weight: 700;
	white-space: nowrap;
}

/* Each state pairs a word with an icon and a colour — never colour alone. */
.mesa-strip__sync.mesa-strip__sync--saved {
	color: var(--pos-success, #14603a);
}

.mesa-strip__sync.mesa-strip__sync--busy {
	color: var(--pos-button-warning-text, #8a5a0d);
}

.mesa-strip__sync.mesa-strip__sync--error {
	background: var(--pos-error);
	color: #ffffff;
}

.mesa-strip__back {
	min-height: 28px;
	padding: 0 6px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--pos-text-primary);
	font-size: 11.5px;
	font-weight: 700;
	text-decoration: underline;
	cursor: pointer;
	white-space: nowrap;
}

.mesa-strip__back:hover {
	background: var(--pos-hover-bg);
}

/* A coarse pointer gets the platform floor; the strip grows rather than the
   link becoming a 28px target under a thumb mid-service. */
@media (pointer: coarse) {
	.mesa-strip__back {
		min-height: 44px;
	}
}

/* ── the band's breakdown column, teleported into the shell's lane ────── */
.mesa-strip__band-divider {
	width: 1px;
	height: var(--reg-band-divider-height, 88px);
	flex: none;
	background: var(--pos-border);
}

.mesa-strip__band-col {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
	font-size: 12.5px;
}

.mesa-strip__band-row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16px;
	min-width: 230px;
}

.mesa-strip__band-term {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--pos-text-secondary);
}

.mesa-strip__band-value {
	flex: 0 0 auto;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary);
}

.mesa-strip__band-term.mesa-strip__band-term--warn,
.mesa-strip__band-value.mesa-strip__band-value--warn {
	color: var(--pos-error);
	font-weight: 700;
}
</style>
