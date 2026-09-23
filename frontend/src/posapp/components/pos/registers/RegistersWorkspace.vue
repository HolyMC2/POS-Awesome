<template>
	<section ref="workspace" class="registers" :class="{ 'registers--detail': selected }" data-test="registers-workspace">
		<header class="registers__header">
			<div>
				<p class="registers__eyebrow">{{ __("Daily operation") }}</p>
				<h1>{{ __("Registers & shifts") }}</h1>
				<p>{{ __("See who has an open shift and what needs attention.") }}</p>
			</div>
			<div class="registers__actions">
				<button :disabled="loading" @click="refresh" data-test="refresh-shifts">{{ __("Refresh") }}</button>
				<button v-if="!ui.posOpeningShift" class="registers__primary" @click="bus?.emit('registers:open-shift')" data-test="open-shift">{{ __("Open my shift") }}</button>
				<button v-else @click="reviewCurrent" data-test="my-shift">{{ __("My current shift") }}</button>
			</div>
		</header>
		<div class="registers__summary" aria-live="polite">
			<span><strong>{{ page?.summary.open ?? '—' }}</strong> {{ __("Open shifts") }}</span>
			<span :class="{ attention: page?.summary.attention }"><strong>{{ page?.summary.attention ?? '—' }}</strong> {{ __("Need attention") }}</span>
			<small v-if="page">{{ page.can_manage ? __("Your permitted profiles") : __("Your shifts only") }} · {{ __("Updated") }} {{ stamp(page.as_of) }}</small>
		</div>
		<div class="registers__layout">
			<section class="registers__queue" :aria-label="__('Shifts')">
				<div class="registers__tabs" role="group" :aria-label="__('Shift filter')">
					<button v-for="tab in tabs" :key="tab.id" :aria-pressed="queue === tab.id" @click="setQueue(tab.id)" :data-test="`queue-${tab.id}`">{{ __(tab.label) }}</button>
				</div>
				<form class="registers__search" @submit.prevent="load()">
					<label class="sr-only" for="shift-search">{{ __("Search cashier, profile or shift") }}</label>
					<input id="shift-search" v-model="search" type="search" maxlength="120" :placeholder="__('Cashier, profile or shift')" />
					<button type="submit">{{ __("Search") }}</button>
				</form>
				<div v-if="listError" class="registers__notice" role="alert">
					<p>{{ __("Could not update shifts. Check the connection and try again.") }}</p>
					<button @click="load()">{{ __("Try again") }}</button>
				</div>
				<p v-if="loading" class="registers__empty" role="status">{{ __("Loading shifts…") }}</p>
				<div v-else-if="!rows.length && !listError" class="registers__empty">
					<h2>{{ search ? __("No matching shifts") : queue === 'attention' ? __("No shifts need review") : queue === 'open' ? __("No open shifts") : __("No closed shifts") }}</h2>
					<p>{{ __("This list reflects server records. Saved work on other browsers must be checked separately.") }}</p>
					<button v-if="queue === 'attention'" @click="setQueue('open')">{{ __("View open shifts") }}</button>
				</div>
				<ul v-else class="registers__list" :aria-busy="loading">
					<li v-for="row in rows" :key="row.name">
						<button class="registers__row" :class="{ selected: selected === row.name }" :aria-pressed="selected === row.name" @click="select(row.name)" :data-shift="row.name">
							<div class="registers__row-top"><strong>{{ row.cashier_name || row.user }}</strong><span v-if="row.is_mine" class="registers__badge">{{ __("You") }}</span></div>
							<span>{{ row.pos_profile }}</span>
							<small>{{ stamp(row.period_start_date) }} · {{ row.name }}</small>
							<div class="registers__badges"><span v-if="row.recovery_pending" class="registers__badge attention">{{ __("Recovery review") }}</span><span v-if="row.older_shift" class="registers__badge attention">{{ __("From an earlier day") }}</span><span v-if="!row.recovery_pending && !row.older_shift" class="registers__badge">{{ __(row.status) }}</span></div>
						</button>
					</li>
				</ul>
				<button v-if="page?.next_cursor && !loading && !listError" class="registers__more" :disabled="loadingMore" @click="load(true)" data-test="more-shifts">{{ loadingMore ? __("Loading shifts…") : __("Load more shifts") }}</button>
			</section>
			<section class="registers__detail" :aria-label="__('Shift details')" :aria-busy="detailLoading">
				<div v-if="selected" class="registers__detail-toolbar"><button ref="backButton" @click="backToList" data-test="back-shifts">← {{ __("Back to shifts") }}</button><button class="registers__detail-refresh" :disabled="detailLoading" @click="refresh">{{ __("Refresh") }}</button></div>
				<div v-if="!selected" class="registers__empty registers__welcome"><v-icon icon="mdi-cash-register" size="40" /><h2>{{ __("A clear view of each shift") }}</h2><p>{{ __("Choose a shift to review its cash activity and next step.") }}</p><p>{{ __("Shifts are grouped by POS profile; a profile may be shared by several cashiers.") }}</p></div>
				<p v-else-if="detailLoading" class="registers__empty" role="status">{{ __("Loading shift details…") }}</p>
				<div v-else-if="detailError" class="registers__notice" role="alert"><p>{{ __("This shift could not be loaded. Refresh or check your access.") }}</p><button @click="select(selected)">{{ __("Try again") }}</button></div>
				<article v-else-if="detail" :key="detail.shift.name" class="registers__story" data-test="shift-detail">
					<header><p class="registers__eyebrow">{{ detail.shift.pos_profile }}</p><h2>{{ detail.shift.cashier_name || detail.shift.user }}</h2><p>{{ detail.shift.company }} · {{ detail.shift.warehouse }}</p><small>{{ detail.shift.name }}</small></header>
					<dl class="registers__facts"><div><dt>{{ __("Opened") }}</dt><dd>{{ stamp(detail.shift.period_start_date) }}</dd></div><div><dt>{{ __("Status") }}</dt><dd>{{ __(detail.shift.status) }}</dd></div><div v-if="detail.shift.period_end_date"><dt>{{ __("Closed at") }}</dt><dd>{{ stamp(detail.shift.period_end_date) }}</dd></div></dl>
					<div v-if="detail.shift.older_shift || detail.shift.recovery_pending" class="registers__notice"><strong>{{ __("Review before closing") }}</strong><p v-if="detail.shift.older_shift">{{ __("This shift started on an earlier day. Check saved sales, cash movements and the count before closing.") }}</p><p v-if="detail.shift.recovery_pending">{{ __("Previous-browser sales need manager review before this shift can close. Saved work has not been deleted or reassigned.") }}</p></div>
					<div class="registers__actions" v-if="isCurrent">
						<button class="registers__primary" @click="navigate('sale')" data-test="resume-sale">{{ __("Resume sale") }}</button>
						<button v-if="detail.cash_movements_enabled" @click="navigate('expense')" data-test="shift-cash">{{ __("Cash movements") }}</button>
						<button v-if="detail.closing_enabled" @click="navigate('closing')" data-test="shift-close">{{ __("Count and close shift") }}</button>
					</div>
					<p v-else-if="detail.shift.status === 'Open'" class="registers__hint">{{ __("Sales and cash actions stay with this shift's cashier and authorized browser.") }}</p>
					<section v-if="detail.shift.status === 'Open'" class="registers__money">
						<h3>{{ __("Cash and tenders") }}</h3>
						<p v-if="detail.amounts_hidden" data-test="blind-count">{{ __("Expected amounts are hidden by this profile's blind-count policy.") }}</p>
						<template v-else><p class="registers__hint">{{ __("Server expected amounts. Unsynced work is not included.") }}</p><dl><div v-for="tender in detail.tenders" :key="tender.mode_of_payment"><dt>{{ __(tender.mode_of_payment) }}</dt><dd>{{ money(tender.expected_amount) }}<small>{{ __("Opening") }} {{ money(tender.opening_amount) }}</small></dd></div></dl><p v-if="!detail.tenders.length">{{ __("No tender activity recorded.") }}</p></template>
					</section>
					<section v-if="detail.shift.status === 'Open' && !detail.amounts_hidden">
						<h3>{{ __("Recent submitted cash movements") }}</h3><p class="registers__hint">{{ __("Up to 20 most recently updated movements for this shift.") }}</p>
						<ul class="registers__movements"><li v-for="movement in detail.movements" :key="movement.name"><a :href="desk('pos-cash-movement', movement.name)" target="_blank" rel="noopener">{{ __(movement.movement_type) }} · {{ movement.name }} ↗</a><strong>{{ money(movement.amount) }}</strong><small>{{ movement.posting_date }}<template v-if="movement.remarks"> · {{ movement.remarks }}</template></small></li></ul><p v-if="!detail.movements.length">{{ __("No submitted cash movements recorded.") }}</p>
					</section>
					<div class="registers__actions" v-if="detail.shift.status === 'Open' && (isCurrent || detail.can_manage)"><button @click="showRecovery = !showRecovery" :aria-expanded="showRecovery" data-test="review-browser">{{ __("Review browser access") }}</button></div>
					<ShiftTerminalStatus v-if="showRecovery" :key="detail.shift.name" :initial-shift="detail.can_manage ? detail.shift.name : undefined" :management-only="!isCurrent" @changed="refresh" />
					<a v-if="detail.shift.pos_closing_shift" :href="desk('pos-closing-shift', detail.shift.pos_closing_shift)" target="_blank" rel="noopener">{{ __("Open closing record") }} · {{ detail.shift.pos_closing_shift }} ↗</a>
					<footer class="registers__hint">{{ __("Updated") }} {{ stamp(detail.as_of) }} · {{ __("Site time") }}</footer>
				</article>
			</section>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Emitter } from "mitt";
import type { Events } from "../../../bus";
import { useUIStore } from "../../../stores/uiStore";
import ShiftTerminalStatus from "../../navbar/ShiftTerminalStatus.vue";
import { listShifts, shiftDetail, type ShiftDetail, type ShiftPage, type ShiftQueue, type ShiftRow } from "./api";

const __ = window.__ || ((value: string) => value);
const ui = useUIStore();
const bus = inject<Emitter<Events> | null>("eventBus", null);
// Keep only navigation in this browser session. Money and permissions are always re-read.
const user = window.frappe?.session?.user;
const navigationKey = user && user !== "Guest" ? `posa:registers:navigation:${user}` : null;
function readNavigation(): { queue?: ShiftQueue; search?: string; selected?: string; scrollTop?: number } {
	try {
		const value = navigationKey ? JSON.parse(sessionStorage.getItem(navigationKey) || "null") : null;
		if (!value || !["attention", "open", "closed"].includes(value.queue)) return {};
		return { queue: value.queue, search: String(value.search || "").slice(0, 120), selected: String(value.selected || "").slice(0, 140), scrollTop: Math.max(0, Number(value.scrollTop) || 0) };
	} catch { return {}; }
}
const savedNavigation = readNavigation();
const page = ref<ShiftPage | null>(null);
const rows = ref<ShiftRow[]>([]);
const queue = ref<ShiftQueue>(savedNavigation.queue || "attention");
const search = ref(savedNavigation.search || "");
const selected = ref(savedNavigation.selected || "");
const detail = ref<ShiftDetail | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const detailLoading = ref(false);
const listError = ref(false);
const detailError = ref(false);
const showRecovery = ref(false);
const backButton = ref<HTMLButtonElement | null>(null);
const workspace = ref<HTMLElement | null>(null);
const scrollHost = () => workspace.value?.closest<HTMLElement>(".destination-host");
let queueScrollTop = savedNavigation.scrollTop || 0;
const tabs: { id: ShiftQueue; label: string }[] = [{ id: "attention", label: "Needs attention" }, { id: "open", label: "Open" }, { id: "closed", label: "Closed history" }];
let listRequest = 0;
let detailRequest = 0;
let appliedSearch = "";
const isCurrent = computed(() => detail.value?.shift.is_mine && detail.value.shift.status === "Open" && detail.value.shift.name === ui.posOpeningShift?.name);
const stamp = (value: string) => value?.replace("T", " ").slice(0, 16) || "—";
const desk = (doctype: string, name: string) => `/app/${doctype}/${encodeURIComponent(name)}`;
const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: detail.value?.currency || "MXN" }).format(Number(value || 0));

async function load(append = false) {
	if (append && (loading.value || loadingMore.value || !page.value?.next_cursor)) return;
	const request = ++listRequest;
	if (append) loadingMore.value = true;
	else { loading.value = true; loadingMore.value = false; rows.value = []; appliedSearch = search.value.trim(); }
	listError.value = false;
	try {
		const result = await listShifts(queue.value, appliedSearch, append ? page.value?.next_cursor : null);
		if (request !== listRequest) return;
		page.value = result;
		const existing = append ? rows.value : [];
		rows.value = [...new Map([...existing, ...result.shifts].map((row) => [row.name, row])).values()];
	} catch { if (request === listRequest) listError.value = true; }
	finally { if (request === listRequest) { loading.value = false; loadingMore.value = false; } }
}
async function select(name: string, focus = true) {
	const request = ++detailRequest;
	if (!selected.value) queueScrollTop = scrollHost()?.scrollTop || 0;
	selected.value = name;
	detail.value = null;
	detailLoading.value = true;
	detailError.value = false;
	showRecovery.value = false;
	if (focus) {
		await nextTick();
		if (request !== detailRequest) return;
		const host = scrollHost();
		if (host) host.scrollTop = 0;
		backButton.value?.focus({ preventScroll: true });
	}
	try { const result = await shiftDetail(name); if (request === detailRequest) detail.value = result; }
	catch { if (request === detailRequest) detailError.value = true; }
	finally { if (request === detailRequest) detailLoading.value = false; }
}
function backToList() {
	const previous = selected.value;
	++detailRequest;
	selected.value = "";
	detail.value = null;
	showRecovery.value = false;
	void nextTick(() => {
		const host = scrollHost();
		if (host) host.scrollTop = queueScrollTop;
		const row = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-shift]")).find((element) => element.dataset.shift === previous);
		row?.focus({ preventScroll: true });
	});
}
function setQueue(value: ShiftQueue) { queue.value = value; queueScrollTop = 0; backToList(); void load(); }
function refresh() { void load(); if (selected.value) void select(selected.value, false); }
function reviewCurrent() { if (ui.posOpeningShift?.name) void select(ui.posOpeningShift.name); }
function navigate(id: "sale" | "expense" | "closing") { if (isCurrent.value) bus?.emit("open_destination", id); }
onMounted(() => {
	void load().then(() => nextTick(() => { const host = scrollHost(); if (host && !selected.value) host.scrollTop = queueScrollTop; }));
	if (selected.value) void select(selected.value, false);
});
onBeforeUnmount(() => {
	++listRequest; ++detailRequest;
	try {
		if (navigationKey) sessionStorage.setItem(navigationKey, JSON.stringify({ queue: queue.value, search: appliedSearch, selected: selected.value, scrollTop: selected.value ? queueScrollTop : scrollHost()?.scrollTop || 0 }));
	} catch { /* Navigation remains usable when browser storage is unavailable. */ }
});
</script>

<style scoped>
.registers { width: 100%; min-width: 0; max-width: 1480px; margin: 0 auto; padding: clamp(12px, 2vw, 28px); color: var(--pos-text-primary); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.registers :is(h1,h2,h3,p,dl,dd,ul) { margin: 0; }
.registers h1 { font-size: clamp(22px, 2.4vw, 30px); letter-spacing: -.025em; }
.registers h2 { font-size: 20px; }
.registers h3 { font-size: 15px; margin-bottom: 8px; }
.registers small, .registers__hint, .registers__header p, .registers__story header p { color: var(--pos-text-secondary); }
.registers__eyebrow { font-weight: 700; font-size: 12px; letter-spacing: .06em; }
.registers__header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 20px; }
.registers__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.registers button, .registers input { min-height: 44px; padding: 10px 14px; border: 1px solid var(--pos-border); border-radius: 10px; background: var(--pos-card-bg); color: inherit; font: inherit; }
.registers button { cursor: pointer; font-weight: 600; transition: background 140ms, border-color 140ms; }
.registers button:hover { background: var(--pos-hover-bg); }
.registers button:disabled { opacity: .55; cursor: wait; }
.registers button.registers__primary { background: var(--reg-accent, #0097a7); color: var(--reg-on-accent, white); border-color: transparent; }
.registers :is(button,input,a):focus-visible { outline: 3px solid var(--reg-accent, #0097a7); outline-offset: 3px; }
.registers a { color: var(--pos-primary); text-underline-offset: 3px; }
.registers__summary { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; padding: 14px 0; border-block: 1px solid var(--pos-border); margin-bottom: 20px; }
.registers__summary strong { font-size: 22px; margin-right: 4px; }
.registers__summary small { margin-left: auto; }
.registers__layout { display: grid; grid-template-columns: minmax(270px, .85fr) minmax(0, 1.4fr); gap: 24px; align-items: start; }
.registers__queue, .registers__detail { min-width: 0; }
.registers__tabs { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 4px; padding: 4px; background: var(--pos-hover-bg); border-radius: 12px; }
.registers__tabs button { padding: 8px 4px; border-color: transparent; background: transparent; font-size: 12px; }
.registers__tabs button[aria-pressed="true"] { background: var(--pos-card-bg); color: var(--pos-primary); border-color: var(--pos-border); }
.registers__search { display: flex; gap: 6px; margin: 12px 0; }
.registers__search input { min-width: 0; width: 100%; }
.registers__search button { flex: 0 0 auto; white-space: nowrap; }
.registers__list, .registers__movements { list-style: none; padding: 0; display: grid; gap: 8px; }
.registers button.registers__row { text-align: left; width: 100%; display: grid; gap: 5px; padding: 16px; font-weight: 400; }
.registers__row strong { font-size: 16px; }
.registers button.registers__row.selected { border-color: var(--pos-primary); box-shadow: inset 3px 0 var(--pos-primary); background: var(--pos-hover-bg); }
.registers__row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.registers__badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; }
.registers__badge { font-size: 11px; border-radius: 6px; padding: 3px 7px; background: var(--pos-hover-bg); font-weight: 600; }
.attention { color: var(--reg-tone-warning-label, #9a5700); }
.registers__badge.attention, .registers__notice { background: var(--reg-tone-warning-bg, #fff6e7); color: var(--reg-tone-warning-label, #754600); }
.registers__notice { border: 1px solid var(--reg-tone-warning-border, #e8c888); padding: 14px; border-radius: 12px; display: grid; gap: 8px; }
.registers__notice button { color: var(--pos-text-primary); }
.registers__empty { padding: 26px 12px; display: grid; gap: 14px; color: var(--pos-text-secondary); }
.registers__welcome { padding: 48px 24px; text-align: center; justify-items: center; }
.registers__detail-toolbar { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
.registers__detail-refresh { display: none; }
.registers__story { display: grid; gap: 22px; padding: clamp(16px, 2vw, 24px); border: 1px solid var(--pos-border); background: var(--pos-card-bg); border-radius: 16px; animation: shift-arrive 150ms ease-out; }
.registers__facts { display: flex; flex-wrap: wrap; gap: 14px 30px; }
.registers dt { color: var(--pos-text-secondary); }
.registers dd { font-weight: 600; }
.registers__money dl > div { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--pos-border); }
.registers__money dd { text-align: right; font-size: 18px; font-variant-numeric: tabular-nums; }
.registers__money dd small { display: block; font-size: 12px; font-weight: 400; }
.registers__movements li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 12px 0; border-bottom: 1px solid var(--pos-border); }
.registers__movements small { flex-basis: 100%; }
.registers__more { width: 100%; margin-top: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes shift-arrive { from { opacity: .4; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (max-width: 800px) {
	.registers__layout { display: block; }
	.registers__detail { display: none; }
	.registers--detail .registers__queue, .registers--detail .registers__header, .registers--detail .registers__summary { display: none; }
	.registers__detail-refresh { display: block; }
	.registers--detail .registers__detail { display: block; }
	.registers__summary small { margin-left: 0; width: 100%; }
	.registers__header .registers__actions { width: 100%; }
	.registers__header .registers__actions button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .registers *, .registers *::before { animation: none !important; transition: none !important; } }
</style>
