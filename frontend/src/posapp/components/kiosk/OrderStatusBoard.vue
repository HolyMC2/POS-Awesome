<template>
	<div class="board" data-testid="order-status-board">
		<!-- Staff-only face: pick which register this wall projects. -->
		<div v-if="!ready" class="board__boot">
			<h1>{{ __("Pickup board") }}</h1>
			<p v-if="bootError" class="board__error">{{ bootError }}</p>
			<p v-else-if="!context">{{ __("Connecting…") }}</p>
			<p v-else-if="!context.profiles.length" class="board__error">
				{{ __("This account has no register with an order queue.") }}
			</p>
			<template v-else>
				<button
					v-for="profile in context.profiles"
					:key="profile.pos_profile"
					type="button"
					class="board__chip"
					@click="armProfile(profile.pos_profile)"
				>
					{{ profile.pos_profile }}
				</button>
			</template>
		</div>

		<!-- The wall. Read from across the shop, touched by nobody. -->
		<template v-else>
			<header class="board__head">
				<h1 class="board__title">{{ __("Ready — come to the counter") }}</h1>
				<span v-if="errorMessage" class="board__error board__error--inline">{{
					errorMessage
				}}</span>
				<span class="board__clock reg-mono">{{ clock }}</span>
			</header>

			<div v-if="!readyCards.length" class="board__calm">
				{{ __("Nothing waiting — your order will appear here.") }}
			</div>

			<div v-else class="board__grid" data-testid="board-ready">
				<article v-for="card in readyCards" :key="card.name" class="board__card">
					<span class="board__folio reg-mono">{{ displayFolio(card) }}</span>
					<span class="board__who">{{ maskedName(card) }}</span>
					<span class="board__what">{{ card.title }}</span>
				</article>
			</div>

			<footer v-if="deliveredCards.length" class="board__delivered" data-testid="board-delivered">
				<span class="board__delivered-label">{{ __("Delivered") }}:</span>
				<span v-for="card in deliveredCards" :key="card.name" class="board__delivered-chip reg-mono">
					{{ displayFolio(card) }}
				</span>
			</footer>
		</template>
	</div>
</template>

<script setup lang="ts">
/**
 * The pickup board (critique D4): the third screen in the display family —
 * the KDS watches the kitchen, the kiosk takes orders, this wall answers
 * the question every counter hears all day: «¿ya está lo mío?».
 *
 * It is a pure projection of the hub's OWN scoped reads (the same
 * get_service_order_queue the Orden surface uses): the «ready» bucket is
 * every promise waiting at the counter — a finished repair, a kiosk
 * ticket, an apartado — and the recent «delivered» bucket is the quiet
 * strip of what already left. Nothing new is exposed; the only new server
 * surface is the boot read that says which registers this login may
 * project. Money never appears on a public wall, and names are masked to
 * first name + initial.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
	fetchServiceOrderQueue,
	type ServiceOrderCard,
} from "../../services/serviceOrderService";
import { parseServerTime } from "../floor/floorClock";

declare const __: (_text: string) => string;

const STORAGE_KEY = "posa_status_board";
const POLL_MS = 15_000;
const DELIVERED_WINDOW_MS = 60 * 60_000;
const MAX_DELIVERED = 12;

const context = ref<{ profiles: { pos_profile: string }[] } | null>(null);
const bootError = ref("");
const profileName = ref("");
const ready = ref(false);
const errorMessage = ref("");
const readyCards = ref<ServiceOrderCard[]>([]);
const deliveredCards = ref<ServiceOrderCard[]>([]);
const nowTick = ref(Date.now());

let pollTimer: ReturnType<typeof setInterval> | null = null;
// The context is fetched with an await in onMounted; if the operator leaves
// during that fetch, onBeforeUnmount runs with pollTimer still null and the
// continuation would then arm an interval on a dead component — a poll that
// runs for the life of the tab (audit RUNTIME-F7). `alive` gates the arm.
let alive = true;

const call = async (method: string, args: Record<string, unknown> = {}) => {
	const response = await (window as any).frappe.call({ method, args });
	return response?.message;
};

const clock = computed(() =>
	new Date(nowTick.value).toLocaleTimeString("es-MX", {
		hour: "2-digit",
		minute: "2-digit",
	}),
);

/** «#RO-2026-00048» stays a folio; a kiosk PCR shows its short number. */
const displayFolio = (card: ServiceOrderCard) => {
	const folio = String(card.folio || card.name || "");
	if (/^PCR-/.test(folio)) {
		const digits = folio.replace(/\D/g, "");
		return digits.slice(-3).replace(/^0+/, "") || folio;
	}
	return folio;
};

/** «María P.» — a public wall never spells a whole customer out. */
const maskedName = (card: ServiceOrderCard) => {
	const parts = String(card.customer_name || "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (!parts.length) return "";
	const first = parts[0] ?? "";
	const initial = parts.length > 1 ? ` ${(parts[1] ?? "").slice(0, 1)}.` : "";
	return `${first}${initial}`;
};

const refresh = async (silent = false) => {
	if (!profileName.value) return;
	try {
		const [pending, delivered] = await Promise.all([
			fetchServiceOrderQueue(profileName.value, "ready"),
			fetchServiceOrderQueue(profileName.value, "delivered"),
		]);
		readyCards.value = pending || [];
		// Only the last hour's departures — the strip is a courtesy, not an
		// archive, and an evening wall full of morning numbers reads stale.
		const cutoff = Date.now() - DELIVERED_WINDOW_MS;
		deliveredCards.value = (delivered || [])
			.filter((card) => {
				const at = parseServerTime(card.charged_at);
				return at === null || at >= cutoff;
			})
			.slice(0, MAX_DELIVERED);
		errorMessage.value = "";
	} catch (err: any) {
		if (!silent) errorMessage.value = err?.message || String(err);
	}
};

const armProfile = (name: string) => {
	profileName.value = name;
	ready.value = true;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: name }));
	} catch {
		/* storage-less browsers just re-ask */
	}
	void refresh();
};

onMounted(async () => {
	try {
		context.value = await call(
			"posawesome.posawesome.api.charge_requests.get_status_board_context",
		);
	} catch (err: any) {
		bootError.value = err?.message || String(err);
		return;
	}
	let saved: { profile?: string } = {};
	try {
		saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
	} catch {
		saved = {};
	}
	const remembered = context.value?.profiles.find((p) => p.pos_profile === saved.profile);
	if (remembered) armProfile(remembered.pos_profile);
	else if (context.value?.profiles.length === 1) {
		const only = context.value.profiles[0];
		if (only) armProfile(only.pos_profile);
	}
	if (!alive) return; // unmounted during the await — do not arm a poll on a dead component
	pollTimer = setInterval(() => {
		nowTick.value = Date.now();
		void refresh(true);
	}, POLL_MS);
});

onBeforeUnmount(() => {
	alive = false;
	if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
/* A wall: read from metres away, touched by nobody. */
.board {
	height: 100%;
	display: flex;
	flex-direction: column;
	padding: 22px 28px;
	gap: 18px;
}
.board__boot {
	margin: auto;
	display: grid;
	gap: 14px;
	text-align: center;
}
.board__chip {
	border: 1px solid var(--pos-border-light);
	border-radius: 999px;
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	padding: 10px 20px;
	font-size: 18px;
	cursor: pointer;
}
.board__error {
	color: var(--pos-error);
}
.board__error--inline {
	font-size: 14px;
}
.board__head {
	display: flex;
	align-items: baseline;
	gap: 16px;
}
.board__title {
	font-size: clamp(28px, 4vw, 44px);
	font-weight: 800;
	margin: 0;
}
.board__clock {
	margin-left: auto;
	font-size: 26px;
	color: var(--pos-text-secondary);
	font-variant-numeric: tabular-nums;
}
.board__calm {
	margin: auto;
	font-size: 28px;
	color: var(--pos-text-secondary);
}
.board__grid {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 16px;
	align-content: start;
}
.board__card {
	border: 2px solid var(--pos-border-light);
	border-radius: 16px;
	background: var(--pos-surface-raised);
	padding: 18px;
	display: grid;
	gap: 6px;
	text-align: center;
}
.board__folio {
	font-size: clamp(40px, 5vw, 64px);
	font-weight: 800;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}
.board__who {
	font-size: 20px;
	font-weight: 600;
}
.board__what {
	font-size: 15px;
	color: var(--pos-text-secondary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.board__delivered {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	border-top: 1px solid var(--pos-border-light);
	padding-top: 12px;
}
.board__delivered-label {
	color: var(--pos-text-secondary);
	font-size: 16px;
}
.board__delivered-chip {
	border: 1px solid var(--pos-border-light);
	border-radius: 999px;
	padding: 2px 12px;
	font-size: 18px;
	color: var(--pos-text-secondary);
	font-variant-numeric: tabular-nums;
}
</style>
