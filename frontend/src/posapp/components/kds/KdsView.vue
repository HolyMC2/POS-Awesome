<template>
	<div class="kds" data-testid="kds-view">
		<!-- Boot: pick who and where. Remembered per tablet, so the screen on
		     the pass boots straight into its station tomorrow. -->
		<div v-if="!ready" class="kds__boot">
			<h1 class="kds__boot-title">{{ __("Kitchen display") }}</h1>
			<p v-if="bootError" class="kds__error">{{ bootError }}</p>
			<p v-else-if="!context">{{ __("Connecting…") }}</p>
			<template v-else-if="!context.profiles.length">
				<p class="kds__error">
					{{ __("This account has no table-service register to watch.") }}
				</p>
			</template>
			<template v-else>
				<div v-if="context.profiles.length > 1" class="kds__boot-row">
					<span>{{ __("Register") }}</span>
					<button
						v-for="profile in context.profiles"
						:key="profile.pos_profile"
						type="button"
						class="kds__chip"
						:class="{ 'kds__chip--on': chosenProfile === profile.pos_profile }"
						@click="chosenProfile = profile.pos_profile"
					>
						{{ profile.pos_profile }}
					</button>
				</div>
				<div class="kds__boot-row">
					<span>{{ __("Station") }}</span>
					<button
						type="button"
						class="kds__chip"
						:class="{ 'kds__chip--on': chosenStation === EXPO }"
						@click="chosenStation = EXPO"
					>
						{{ __("Expo — all stations") }}
					</button>
					<button
						v-for="station in stationsForChosen"
						:key="station"
						type="button"
						class="kds__chip"
						:class="{ 'kds__chip--on': chosenStation === station }"
						@click="chosenStation = station"
					>
						{{ station }}
					</button>
				</div>
				<button
					type="button"
					class="kds__start"
					:disabled="!chosenProfile || !chosenStation"
					data-testid="kds-start"
					@click="start"
				>
					{{ __("Watch the kitchen") }}
				</button>
			</template>
		</div>

		<!-- The pass. -->
		<template v-else>
			<header class="kds__head">
				<strong class="kds__station">{{ stationLabel }}</strong>
				<span class="kds__profile">{{ chosenProfile }}</span>
				<span class="kds__count">{{ activeTickets.length }}</span>
				<span v-if="errorMessage" class="kds__error kds__error--inline">{{ errorMessage }}</span>
				<button type="button" class="kds__chip" data-testid="kds-change" @click="ready = false">
					{{ __("Change") }}
				</button>
			</header>

			<div v-if="!activeTickets.length" class="kds__calm">
				{{ __("All quiet — nothing on the pass.") }}
			</div>

			<div v-else class="kds__grid">
				<article
					v-for="ticket in activeTickets"
					:key="ticket.name"
					class="kds__ticket"
					:class="`kds__ticket--${ageOf(ticket)}`"
					data-testid="kds-ticket"
				>
					<div class="kds__ticket-head">
						<strong>{{ ticket.table || ticket.tab_name || "—" }}</strong>
						<span class="kds__age reg-mono">{{ ageLabel(ticket) }}</span>
					</div>
					<div v-if="ticket.is_void" class="kds__void">{{ __("VOID — whole ticket") }}</div>
					<ul class="kds__lines">
						<li v-for="(line, idx) in stationLines(ticket)" :key="idx">
							<span class="reg-mono">{{ line.qty }}×</span> {{ line.item }}
						</li>
					</ul>
					<ul v-if="stationCancellations(ticket).length" class="kds__lines kds__lines--cancel">
						<li v-for="(line, idx) in stationCancellations(ticket)" :key="idx">
							<span class="reg-mono">−{{ line.qty }}×</span> {{ line.item }}
						</li>
					</ul>
					<div v-if="otherStations(ticket).length" class="kds__elsewhere">
						+ {{ otherStations(ticket).join(" · ") }}
					</div>
					<div v-if="isFailedPrint(ticket)" class="kds__paper">
						<v-icon icon="mdi-printer-off" size="14" />
						{{ __("no paper — cook from the screen") }}
					</div>
					<button
						v-if="!ticket.is_void"
						type="button"
						class="kds__bump"
						:disabled="busy.has(ticket.name)"
						data-testid="kds-bump"
						@click="bump(ticket)"
					>
						{{ __("SERVED") }}
					</button>
				</article>
			</div>

			<!-- The last few bumps stay reachable: the expo pulls plates back. -->
			<footer v-if="recentlyServed.length" class="kds__served">
				<span class="kds__served-label">{{ __("Served") }}:</span>
				<button
					v-for="ticket in recentlyServed"
					:key="ticket.name"
					type="button"
					class="kds__chip"
					:disabled="busy.has(ticket.name)"
					data-testid="kds-recall"
					@click="recall(ticket)"
				>
					{{ ticket.table || ticket.tab_name || "—" }} ↩
				</button>
			</footer>
		</template>
	</div>
</template>

<script setup lang="ts">
/**
 * The kitchen display (critique D1): a station-scoped screen on the bump
 * endpoint that already exists.
 *
 * Not a register — no shift, no cart, no rail. It boots from
 * `get_kds_context` (the profiles this login may watch, with their
 * stations), remembers its choice per tablet, and then it is a projection
 * of `list_kitchen_batches` filtered to its own station's lines, pressing
 * the SAME `bump_kitchen_ticket` the comandas board presses — one lifecycle,
 * two rooms. «Expo» watches every station and is where multi-station
 * tickets are naturally bumped; a station screen may bump too, and the
 * ticket names its other stations so the cook knows what else rides on it.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
	bumpKitchenTicket,
	getKdsContext,
	listKitchenBatches,
	recallKitchenTicket,
	type KdsProfileContext,
	type KitchenBatchRow,
} from "../../api/restaurant";
import { ageStep, idleMinutes, parseServerTime } from "../floor/floorClock";

declare const __: (_text: string) => string;

const EXPO = "__expo__";
const POLL_MS = 10_000;
const STORAGE_KEY = "posa_kds_screen";
const SERVED_STRIP = 8;
const FAILED_STATUSES = new Set(["failed", "partial", "cancelled"]);

const context = ref<{ profiles: KdsProfileContext[]; generalStation: string } | null>(null);
const bootError = ref("");
const chosenProfile = ref("");
const chosenStation = ref("");
const ready = ref(false);

const batches = ref<KitchenBatchRow[]>([]);
const errorMessage = ref("");
const serverOffset = ref(0);
const nowTick = ref(Date.now());
const busy = ref(new Set<string>());

let pollTimer: ReturnType<typeof setInterval> | null = null;

const stationsForChosen = computed(
	() =>
		context.value?.profiles.find((p) => p.pos_profile === chosenProfile.value)?.stations || [],
);
const stationLabel = computed(() =>
	chosenStation.value === EXPO ? __("Expo — all stations") : chosenStation.value,
);

const start = () => {
	ready.value = true;
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ profile: chosenProfile.value, station: chosenStation.value }),
		);
	} catch {
		/* a kiosk browser without storage still works, it just re-asks */
	}
	void refresh();
};

const refresh = async (silent = false) => {
	if (!ready.value || !chosenProfile.value) return;
	try {
		const result = await listKitchenBatches(chosenProfile.value, 50);
		batches.value = result.batches;
		const serverNow = parseServerTime(result.serverTime);
		if (serverNow !== null) serverOffset.value = serverNow - Date.now();
		errorMessage.value = "";
	} catch (err: any) {
		if (!silent) errorMessage.value = err?.message || String(err);
	}
};

onMounted(async () => {
	try {
		context.value = await getKdsContext();
	} catch (err: any) {
		bootError.value = err?.message || String(err);
		return;
	}
	const profiles = context.value.profiles;
	let saved: { profile?: string; station?: string } = {};
	try {
		saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
	} catch {
		saved = {};
	}
	const savedProfile = profiles.find((p) => p.pos_profile === saved.profile);
	chosenProfile.value = savedProfile?.pos_profile || profiles[0]?.pos_profile || "";
	const stations = savedProfile?.stations || profiles[0]?.stations || [];
	chosenStation.value =
		saved.station && (saved.station === EXPO || stations.includes(saved.station))
			? saved.station
			: EXPO;
	if (savedProfile && saved.station) start();

	pollTimer = setInterval(() => {
		nowTick.value = Date.now();
		void refresh(true);
	}, POLL_MS);
});

onBeforeUnmount(() => {
	if (pollTimer) clearInterval(pollTimer);
});

// ---- station scoping -------------------------------------------------------

const linesFor = (rows: KitchenBatchRow["lines"]) =>
	chosenStation.value === EXPO
		? rows
		: rows.filter((line) => line.station === chosenStation.value);

const stationLines = (ticket: KitchenBatchRow) => linesFor(ticket.lines);
const stationCancellations = (ticket: KitchenBatchRow) => linesFor(ticket.cancellations);

const concernsStation = (ticket: KitchenBatchRow) =>
	stationLines(ticket).length > 0 || stationCancellations(ticket).length > 0;

const otherStations = (ticket: KitchenBatchRow) => {
	if (chosenStation.value === EXPO) return [];
	const others = new Set<string>();
	for (const line of ticket.lines) {
		if (line.station !== chosenStation.value) others.add(line.station);
	}
	return [...others];
};

const activeTickets = computed(() =>
	batches.value.filter((t) => t.kitchen_state !== "Bumped" && concernsStation(t)),
);
const recentlyServed = computed(() =>
	batches.value
		.filter((t) => t.kitchen_state === "Bumped" && concernsStation(t))
		.slice(0, SERVED_STRIP),
);

// ---- age & state -----------------------------------------------------------

const minutesOf = (ticket: KitchenBatchRow) =>
	idleMinutes(ticket.fired_at, nowTick.value + serverOffset.value);
const ageOf = (ticket: KitchenBatchRow) => ageStep(minutesOf(ticket));
const ageLabel = (ticket: KitchenBatchRow) => {
	const minutes = minutesOf(ticket);
	return minutes === null ? "" : `${minutes}′`;
};

const isFailedPrint = (ticket: KitchenBatchRow) =>
	FAILED_STATUSES.has(String(ticket.status || "").toLowerCase());

const withTicket = async (
	ticket: KitchenBatchRow,
	call: () => Promise<{ kitchenState: string }>,
	optimistic: string,
) => {
	busy.value = new Set(busy.value).add(ticket.name);
	const previous = ticket.kitchen_state;
	ticket.kitchen_state = optimistic;
	try {
		await call();
	} catch (err: any) {
		ticket.kitchen_state = previous;
		errorMessage.value = err?.message || String(err);
	} finally {
		const next = new Set(busy.value);
		next.delete(ticket.name);
		busy.value = next;
		void refresh(true);
	}
};

const bump = (ticket: KitchenBatchRow) =>
	withTicket(ticket, () => bumpKitchenTicket(chosenProfile.value, ticket.name), "Bumped");
const recall = (ticket: KitchenBatchRow) =>
	withTicket(ticket, () => recallKitchenTicket(chosenProfile.value, ticket.name), "");
</script>

<style scoped>
/* A pass screen: read from two metres, tap with a wet thumb. */
.kds {
	display: flex;
	flex-direction: column;
	height: 100%;
	padding: 16px;
	gap: 14px;
	font-size: 18px;
}
.kds__boot {
	margin: auto;
	display: grid;
	gap: 18px;
	max-width: 640px;
	text-align: center;
}
.kds__boot-title {
	font-size: 30px;
	margin: 0;
}
.kds__boot-row {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
	justify-content: center;
}
.kds__chip {
	border: 1px solid var(--pos-border-light);
	border-radius: 999px;
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	padding: 6px 14px;
	font-size: 15px;
	cursor: pointer;
}
.kds__chip--on {
	border-color: var(--pos-primary);
	color: var(--pos-primary);
	font-weight: 700;
}
.kds__start {
	border: none;
	border-radius: 12px;
	background: var(--pos-primary);
	color: #fff;
	font-size: 20px;
	font-weight: 700;
	padding: 14px 26px;
	cursor: pointer;
}
.kds__start:disabled {
	opacity: 0.4;
}
.kds__head {
	display: flex;
	align-items: center;
	gap: 12px;
}
.kds__station {
	font-size: 24px;
}
.kds__profile,
.kds__count {
	color: var(--pos-text-secondary);
}
.kds__count {
	font-variant-numeric: tabular-nums;
	margin-left: auto;
	font-size: 22px;
}
.kds__error {
	color: var(--pos-error);
}
.kds__error--inline {
	font-size: 14px;
}
.kds__calm {
	margin: auto;
	color: var(--pos-text-secondary);
	font-size: 24px;
}
.kds__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 12px;
	overflow-y: auto;
	min-height: 0;
	align-content: start;
}
.kds__ticket {
	border: 2px solid var(--pos-border-light);
	border-radius: 12px;
	background: var(--pos-surface-raised);
	padding: 12px 14px;
	display: grid;
	gap: 8px;
}
.kds__ticket--warm {
	border-color: var(--pos-warning, #b26a00);
}
.kds__ticket--late {
	border-color: var(--pos-error);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--pos-error) 35%, transparent);
}
.kds__ticket-head {
	display: flex;
	align-items: baseline;
	gap: 10px;
	font-size: 22px;
}
.kds__age {
	margin-left: auto;
	font-size: 22px;
	font-variant-numeric: tabular-nums;
}
.kds__ticket--late .kds__age {
	color: var(--pos-error);
	font-weight: 700;
}
.kds__void {
	color: var(--pos-error);
	font-weight: 700;
	letter-spacing: 0.04em;
	font-size: 14px;
}
.kds__lines {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 4px;
	font-size: 19px;
}
.kds__lines--cancel {
	color: var(--pos-error);
	text-decoration: line-through;
	font-size: 16px;
}
.kds__elsewhere,
.kds__paper {
	font-size: 13.5px;
	color: var(--pos-text-secondary);
}
.kds__paper {
	color: var(--pos-warning, #b26a00);
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-weight: 700;
}
.kds__bump {
	border: none;
	border-radius: 10px;
	background: var(--pos-success, #1b7d4f);
	color: #fff;
	font-size: 19px;
	font-weight: 800;
	letter-spacing: 0.06em;
	padding: 12px;
	cursor: pointer;
}
.kds__bump:disabled {
	opacity: 0.5;
}
.kds__served {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
	border-top: 1px solid var(--pos-border-light);
	padding-top: 10px;
}
.kds__served-label {
	color: var(--pos-text-secondary);
	font-size: 14px;
}
</style>
