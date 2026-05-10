<script setup lang="ts">
/**
 * PerfBadge — fixed-position diagnostic overlay for low-end clients.
 *
 * Off by default. Enable per-device by running this in DevTools:
 *   localStorage.setItem('posa_perf_badge', '1'); location.reload()
 *
 * Disable: localStorage.removeItem('posa_perf_badge')
 *
 * Reads (every 2s):
 *   - JS heap (used / limit) via performance.memory (Chromium only).
 *   - DOM nodes — proxy for virtualization leaks.
 *   - Last sync age (ms) read off window.__posa_last_sync if present
 *     (set by useItemSync; falls back to '–' when absent).
 *
 * Tap the badge to expand the breakdown; long-press (300ms) to hide
 * for the rest of the session without touching localStorage.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const enabled = ref(false);
const expanded = ref(false);
const heapMB = ref<number | null>(null);
const heapLimitMB = ref<number | null>(null);
const domNodes = ref<number | null>(null);
const lastSyncAgeMs = ref<number | null>(null);
const fps = ref<number | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let rafTime = 0;
let rafFrames = 0;
let rafHandle: number | null = null;

function readMetrics() {
	const perf = (performance as any).memory;
	if (perf) {
		heapMB.value = Math.round(perf.usedJSHeapSize / 1048576);
		heapLimitMB.value = Math.round(perf.jsHeapSizeLimit / 1048576);
	}
	domNodes.value = document.getElementsByTagName("*").length;
	const last = (window as any).__posa_last_sync;
	if (last) {
		const t = typeof last === "string" ? Date.parse(last) : Number(last);
		if (Number.isFinite(t)) lastSyncAgeMs.value = Date.now() - t;
	}
}

function rafLoop(t: number) {
	rafFrames++;
	if (t - rafTime >= 1000) {
		fps.value = rafFrames;
		rafFrames = 0;
		rafTime = t;
	}
	rafHandle = requestAnimationFrame(rafLoop);
}

function hideForSession() {
	enabled.value = false;
}

let pressTimer: ReturnType<typeof setTimeout> | null = null;
function onTouchStart() {
	pressTimer = setTimeout(() => {
		hideForSession();
		pressTimer = null;
	}, 300);
}
function onTouchEnd() {
	if (pressTimer) {
		clearTimeout(pressTimer);
		pressTimer = null;
		expanded.value = !expanded.value;
	}
}

onMounted(() => {
	try {
		enabled.value = localStorage.getItem("posa_perf_badge") === "1";
	} catch {
		enabled.value = false;
	}
	if (!enabled.value) return;
	readMetrics();
	timer = setInterval(readMetrics, 2_000);
	rafTime = performance.now();
	rafHandle = requestAnimationFrame(rafLoop);
});

onBeforeUnmount(() => {
	if (timer) clearInterval(timer);
	if (rafHandle != null) cancelAnimationFrame(rafHandle);
});

const heapColor = computed(() => {
	if (heapMB.value == null || heapLimitMB.value == null) return "#888";
	const pct = heapMB.value / heapLimitMB.value;
	if (pct > 0.85) return "#ef4444";
	if (pct > 0.6) return "#f59e0b";
	return "#10b981";
});
const fpsColor = computed(() => {
	if (fps.value == null) return "#888";
	if (fps.value < 20) return "#ef4444";
	if (fps.value < 45) return "#f59e0b";
	return "#10b981";
});
const syncLabel = computed(() => {
	const ms = lastSyncAgeMs.value;
	if (ms == null) return "–";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
	return `${Math.floor(ms / 60_000)}m`;
});
</script>

<template>
	<div
		v-if="enabled"
		class="posa-perf-badge"
		@click="onTouchEnd"
		@touchstart.passive="onTouchStart"
		@touchend.passive="onTouchEnd"
	>
		<div class="row">
			<span class="dot" :style="{ background: heapColor }" />
			<span>{{ heapMB ?? "–" }}MB</span>
			<span class="dot" :style="{ background: fpsColor }" />
			<span>{{ fps ?? "–" }}fps</span>
			<span>{{ syncLabel }}</span>
		</div>
		<div v-if="expanded" class="detail">
			<div>heap: {{ heapMB }} / {{ heapLimitMB }} MB</div>
			<div>dom nodes: {{ domNodes }}</div>
			<div>last sync: {{ syncLabel }}</div>
			<div>fps (1s avg): {{ fps }}</div>
			<div class="hint">long-press to hide</div>
		</div>
	</div>
</template>

<style scoped>
.posa-perf-badge {
	position: fixed;
	bottom: 8px;
	right: 8px;
	z-index: 99999;
	padding: 6px 10px;
	border-radius: 12px;
	background: rgba(15, 23, 42, 0.85);
	color: #f1f5f9;
	font: 600 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
	pointer-events: auto;
	user-select: none;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
.row {
	display: flex;
	align-items: center;
	gap: 6px;
}
.dot {
	display: inline-block;
	width: 7px;
	height: 7px;
	border-radius: 50%;
}
.detail {
	margin-top: 6px;
	padding-top: 6px;
	border-top: 1px solid rgba(241, 245, 249, 0.15);
	font-weight: 400;
	display: grid;
	gap: 2px;
}
.hint {
	margin-top: 4px;
	color: #94a3b8;
	font-size: 9px;
}
</style>
