<template>
	<section class="comandas" data-testid="comandas-board">
		<header class="comandas__head">
			<h2 class="comandas__title">{{ verticalStore.t("Comandas") }}</h2>
			<span class="comandas__meta" data-testid="comandas-count">
				{{ batches.length }} · {{ windowLabel }}
			</span>
			<a
				class="comandas__kds-link"
				:href="kdsHref"
				target="_blank"
				rel="noopener"
				data-testid="comandas-kds-link"
			>
				{{ __("Kitchen display") }} ↗
			</a>
			<button
				type="button"
				class="comandas__refresh"
				data-testid="comandas-refresh"
				:disabled="loading"
				@click="refresh()"
			>
				<v-icon icon="mdi-refresh" size="18" />
			</button>
		</header>

		<v-alert
			v-if="errorMessage"
			type="error"
			variant="tonal"
			density="compact"
			data-testid="comandas-error"
		>
			{{ errorMessage }}
		</v-alert>

		<div v-if="!batches.length && !loading && !errorMessage" class="comandas__empty">
			{{ __("Nothing fired in this service window.") }}
		</div>

		<div v-else class="comandas__lanes">
			<div
				v-for="lane in lanes"
				:key="lane.id"
				class="comandas__lane"
				:data-testid="`comandas-lane-${lane.id}`"
			>
				<h3 class="comandas__lane-title" :class="`comandas__lane-title--${lane.id}`">
					{{ lane.label }}
					<span class="comandas__lane-count">{{ lane.batches.length }}</span>
				</h3>
				<article
					v-for="batch in lane.batches"
					:key="batch.name"
					class="comandas__card"
					:class="[`comandas__card--${ageOf(batch)}`, { 'comandas__card--void': batch.is_void }]"
					data-testid="comandas-card"
				>
					<div class="comandas__card-head">
						<strong>{{ batch.table || batch.tab_name || "—" }}</strong>
						<span v-if="batch.table && batch.tab_name" class="comandas__tab">{{
							batch.tab_name
						}}</span>
						<span class="comandas__age reg-mono">{{ ageLabel(batch) }}</span>
					</div>
					<div v-if="batch.is_void" class="comandas__void">{{ __("VOID — whole ticket") }}</div>
					<ul class="comandas__lines">
						<li v-for="(line, idx) in visibleLines(batch)" :key="idx">
							<span class="reg-mono">{{ line.qty }}×</span> {{ line.item }}
						</li>
						<li v-if="hiddenLineCount(batch)" class="comandas__more">
							+{{ hiddenLineCount(batch) }} {{ __("more") }}
						</li>
					</ul>
					<ul v-if="batch.cancellations.length" class="comandas__lines comandas__lines--cancel">
						<li v-for="(line, idx) in batch.cancellations" :key="idx">
							<span class="reg-mono">−{{ line.qty }}×</span> {{ line.item }}
						</li>
					</ul>
					<div class="comandas__card-foot">
						<span v-for="station in stationsOf(batch)" :key="station" class="comandas__station">
							{{ station }}
						</span>
						<span v-if="batch.failed_count" class="comandas__failed">
							{{ batch.failed_count }}/{{ batch.job_count }} {{ __("failed") }}
						</span>
						<span class="comandas__by">{{ shortUser(batch.fired_by) }}</span>
					</div>
					<!-- The lifecycle verb (critique B3). A void has nothing to
					     serve; everything else can be bumped even off a failed
					     print — the kitchen may have cooked from the screen. -->
					<div v-if="!batch.is_void" class="comandas__actions">
						<button
							v-if="batch.kitchen_state !== 'Bumped'"
							type="button"
							class="comandas__bump"
							:disabled="busy.has(batch.name)"
							data-testid="comandas-bump"
							@click="bump(batch)"
						>
							<v-icon icon="mdi-check-bold" size="14" /> {{ __("Served") }}
						</button>
						<template v-else>
							<span class="comandas__bumped-by">
								{{ shortUser(batch.bumped_by) }} · {{ __("served") }}
							</span>
							<button
								type="button"
								class="comandas__recall"
								:disabled="busy.has(batch.name)"
								data-testid="comandas-recall"
								@click="recall(batch)"
							>
								{{ __("Recall") }}
							</button>
						</template>
					</div>
				</article>
				<p v-if="!lane.batches.length" class="comandas__lane-empty">·</p>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * The comandas board (critique B2): the management half of table service.
 *
 * The floor answers "which table do I open?"; this board answers "what is in
 * the kitchen and how old is it?". It reads the durable print batches every
 * fire already leaves behind (`list_kitchen_batches`) and lanes them by the
 * only truth that exists today — the print verdict. There is deliberately no
 * «servida» lane: serving is a KDS bump, and inventing it here would put a
 * lie on a management screen (critique B3 is where that truth gets built).
 *
 * Refresh: a poll while the board is on screen, plus the moment any register
 * fires (`floor_course_fired` rides the same bus the toast does).
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
	bumpKitchenTicket,
	listKitchenBatches,
	recallKitchenTicket,
	type KitchenBatchRow,
} from "../../../../api/restaurant";
import { ageStep, idleMinutes, parseServerTime } from "../../../floor/floorClock";
import { useVerticalStore } from "../../../../stores/verticalStore";
import { useUIStore } from "../../../../stores/uiStore";
import { bus } from "../../../../bus";

declare const __: (_text: string) => string;

const POLL_MS = 20_000;
const MAX_VISIBLE_LINES = 6;

// Print truth only. `sent` sits in «impresas» with `confirmed` because the
// verdict poll treats both as "the kitchen got paper" (FloorView, audit r2
// A6) — the board must not grade the same batch differently than the toast.
const FAILED_STATUSES = new Set(["failed", "partial", "cancelled"]);
const PRINTED_STATUSES = new Set(["sent", "confirmed"]);

const verticalStore = useVerticalStore();
const uiStore = useUIStore();

const batches = ref<KitchenBatchRow[]>([]);
const loading = ref(false);
const errorMessage = ref("");
// Ages are measured on the SERVER's clock: capture its offset at each load
// and tick locally, so a tablet with a wrong clock cannot age a fresh ticket.
const serverOffset = ref(0);
const nowTick = ref(Date.now());

let pollTimer: ReturnType<typeof setInterval> | null = null;

const profileName = computed(() => (uiStore.posProfile as any)?.name || "");

// The kitchen's own screen (D1) — same tickets, same bump, other room.
const router = useRouter();
const kdsHref = computed(() => router.resolve({ path: "/kds" }).href);

const refresh = async (silent = false) => {
	if (!profileName.value) return;
	if (!silent) loading.value = true;
	try {
		const result = await listKitchenBatches(profileName.value);
		batches.value = result.batches;
		const serverNow = parseServerTime(result.serverTime);
		if (serverNow !== null) serverOffset.value = serverNow - Date.now();
		errorMessage.value = "";
	} catch (err: any) {
		errorMessage.value = err?.message || String(err);
	} finally {
		loading.value = false;
	}
};

const onFired = () => void refresh(true);

onMounted(() => {
	void refresh();
	pollTimer = setInterval(() => {
		nowTick.value = Date.now();
		void refresh(true);
	}, POLL_MS);
	bus.on("floor_course_fired", onFired);
});

onBeforeUnmount(() => {
	if (pollTimer) clearInterval(pollTimer);
	bus.off("floor_course_fired", onFired);
});

const lanes = computed(() => {
	const pending: KitchenBatchRow[] = [];
	const printed: KitchenBatchRow[] = [];
	const served: KitchenBatchRow[] = [];
	const failed: KitchenBatchRow[] = [];
	for (const batch of batches.value) {
		// The human act outranks the printer's verdict: a bumped ticket is
		// SERVED even if its paper failed — the kitchen cooked it anyway.
		if (batch.kitchen_state === "Bumped") {
			served.push(batch);
			continue;
		}
		const status = String(batch.status || "").toLowerCase();
		if (FAILED_STATUSES.has(status)) failed.push(batch);
		else if (PRINTED_STATUSES.has(status)) printed.push(batch);
		else pending.push(batch);
	}
	return [
		{ id: "cocina", label: __("Printing"), batches: pending },
		{ id: "impresas", label: __("In the kitchen"), batches: printed },
		{ id: "servidas", label: __("Served"), batches: served },
		{ id: "fallidas", label: __("Print failed"), batches: failed },
	];
});

// Optimistic per-ticket state moves: flip locally, confirm with a silent
// refresh; on failure the refresh restores the server's truth either way.
const busy = ref(new Set<string>());

const withTicket = async (
	batch: KitchenBatchRow,
	call: () => Promise<{ kitchenState: string }>,
	optimistic: string,
) => {
	busy.value = new Set(busy.value).add(batch.name);
	const previous = batch.kitchen_state;
	batch.kitchen_state = optimistic;
	try {
		await call();
	} catch (err: any) {
		batch.kitchen_state = previous;
		errorMessage.value = err?.message || String(err);
	} finally {
		const next = new Set(busy.value);
		next.delete(batch.name);
		busy.value = next;
		void refresh(true);
	}
};

const bump = (batch: KitchenBatchRow) =>
	withTicket(batch, () => bumpKitchenTicket(profileName.value, batch.name), "Bumped");

const recall = (batch: KitchenBatchRow) =>
	withTicket(batch, () => recallKitchenTicket(profileName.value, batch.name), "");

const windowLabel = computed(() => __("last 12 h"));

const minutesOf = (batch: KitchenBatchRow) =>
	idleMinutes(batch.fired_at, nowTick.value + serverOffset.value);

const ageOf = (batch: KitchenBatchRow) => ageStep(minutesOf(batch));

const ageLabel = (batch: KitchenBatchRow) => {
	const minutes = minutesOf(batch);
	if (minutes === null) return "";
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
};

const visibleLines = (batch: KitchenBatchRow) => batch.lines.slice(0, MAX_VISIBLE_LINES);
const hiddenLineCount = (batch: KitchenBatchRow) =>
	Math.max(batch.lines.length - MAX_VISIBLE_LINES, 0);

const stationsOf = (batch: KitchenBatchRow) => {
	const stations = new Set<string>();
	for (const line of batch.lines) stations.add(line.station);
	for (const line of batch.cancellations) stations.add(line.station);
	return [...stations];
};

const shortUser = (user: string) => String(user || "").split("@")[0] || "";
</script>

<style scoped>
.comandas {
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-3);
	padding: var(--pos-space-3);
	flex: 1 1 auto;
	min-height: 0;
}
.comandas__head {
	display: flex;
	align-items: baseline;
	gap: var(--pos-space-2);
}
.comandas__title {
	font-size: 18px;
	font-weight: 700;
	margin: 0;
}
.comandas__meta {
	color: var(--pos-text-secondary);
	font-size: 13px;
	flex: 1;
}
.comandas__kds-link {
	font-size: 13px;
	color: var(--pos-primary);
	text-decoration: none;
	white-space: nowrap;
}
.comandas__refresh {
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-surface-raised);
	padding: 2px 8px;
	cursor: pointer;
}
.comandas__empty,
.comandas__lane-empty {
	color: var(--pos-text-secondary);
	font-size: 14px;
	padding: var(--pos-space-4) 0;
	text-align: center;
}
/* The one inner scrollport (flows-sheet discipline). */
.comandas__lanes {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: var(--pos-space-3);
	overflow-y: auto;
	min-height: 0;
	align-content: start;
	align-items: start;
}
.comandas__lane-title {
	font-size: 12px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--pos-text-secondary);
	margin: 0 0 var(--pos-space-2);
	display: flex;
	gap: var(--pos-space-2);
	align-items: center;
}
.comandas__lane-title--fallidas {
	color: var(--pos-error);
}
.comandas__lane-count {
	font-variant-numeric: tabular-nums;
}
.comandas__card {
	border: 1px solid var(--pos-border-light);
	border-left: 3px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md);
	background: var(--pos-surface-raised);
	padding: var(--pos-space-2) var(--pos-space-3);
	margin-bottom: var(--pos-space-2);
	display: grid;
	gap: 4px;
}
/* The floor's own age vocabulary, applied to tickets. */
.comandas__card--warm {
	border-left-color: var(--pos-warning, #b26a00);
}
.comandas__card--late {
	border-left-color: var(--pos-error);
}
.comandas__card--void {
	opacity: 0.75;
}
.comandas__card-head {
	display: flex;
	align-items: baseline;
	gap: var(--pos-space-2);
}
.comandas__tab {
	color: var(--pos-text-secondary);
	font-size: 12.5px;
}
.comandas__age {
	margin-left: auto;
	font-size: 12.5px;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-secondary);
}
.comandas__void {
	color: var(--pos-error);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.04em;
}
.comandas__lines {
	list-style: none;
	margin: 0;
	padding: 0;
	font-size: 13.5px;
	display: grid;
	gap: 2px;
}
.comandas__lines--cancel {
	color: var(--pos-error);
	text-decoration: line-through;
}
.comandas__more {
	color: var(--pos-text-secondary);
}
.comandas__card-foot {
	display: flex;
	flex-wrap: wrap;
	gap: var(--pos-space-2);
	align-items: center;
	font-size: 11.5px;
	color: var(--pos-text-secondary);
}
.comandas__station {
	border: 1px solid var(--pos-border-light);
	border-radius: 999px;
	padding: 0 8px;
	line-height: 18px;
}
.comandas__failed {
	color: var(--pos-error);
	font-weight: 700;
}
.comandas__by {
	margin-left: auto;
}
.comandas__actions {
	display: flex;
	align-items: center;
	gap: var(--pos-space-2);
	margin-top: 2px;
}
.comandas__bump,
.comandas__recall {
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-surface-raised);
	padding: 2px 10px;
	font-size: 12.5px;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.comandas__bump {
	color: var(--pos-success, #1b7d4f);
	border-color: currentColor;
	font-weight: 700;
}
.comandas__recall {
	color: var(--pos-text-secondary);
}
.comandas__bump:disabled,
.comandas__recall:disabled {
	opacity: 0.5;
	cursor: default;
}
.comandas__bumped-by {
	font-size: 12px;
	color: var(--pos-text-secondary);
}
.comandas__lane-title--servidas {
	color: var(--pos-success, #1b7d4f);
}
@media (max-width: 900px) {
	.comandas__lanes {
		grid-template-columns: 1fr;
	}
}
</style>
