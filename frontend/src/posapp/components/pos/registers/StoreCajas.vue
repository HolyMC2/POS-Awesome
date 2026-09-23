<template>
	<section class="cajas" :class="{ 'cajas--detail': !!selected || !!panel }" data-test="store-cajas">
		<div class="cajas__bar">
			<label class="cajas__store">
				<span>{{ __("Store") }}</span>
				<select v-model="store" :disabled="!stores.length" data-test="store-select" @change="changeStore">
					<option v-if="!stores.length" value="">{{ __("No stores yet") }}</option>
					<option v-for="row in stores" :key="row.name" :value="row.name">{{ row.store_name }} · {{ row.store_code }}</option>
				</select>
			</label>
			<div class="cajas__bar-actions">
				<button v-if="currentStore?.can_configure" data-test="add-caja" @click="startCreate">{{ __("Add caja") }}</button>
				<button v-if="canCreateStore" data-test="add-store" @click="panel = 'store'; selected = ''">{{ __("New store") }}</button>
				<button :disabled="loading" data-test="refresh-cajas" @click="reload">{{ __("Refresh") }}</button>
			</div>
		</div>
		<div v-if="page" class="cajas__summary" aria-live="polite">
			<span><strong>{{ page.summary.total }}</strong> {{ __("Cajas") }}</span>
			<span><strong>{{ page.summary.open }}</strong> {{ __("Open") }}</span>
			<span :class="{ attention: page.summary.attention }"><strong>{{ page.summary.attention }}</strong> {{ __("Need attention") }}</span>
			<span><strong>{{ page.summary.setup }}</strong> {{ __("In setup") }}</span>
			<small>{{ __("Updated") }} {{ stamp(page.as_of) }}</small>
		</div>
		<div class="cajas__layout">
			<section class="cajas__queue" :aria-label="__('Cajas')">
				<div class="cajas__filters" role="group" :aria-label="__('Caja filter')">
					<button v-for="item in filters" :key="item.id" :aria-pressed="filter === item.id" :data-test="`caja-filter-${item.id}`" @click="setFilter(item.id)">{{ __(item.label) }}</button>
				</div>
				<div v-if="listError" class="cajas__notice" role="alert">
					<p>{{ listError.message }}</p>
					<small v-if="listError.correlationId">{{ __("Reference") }} {{ listError.correlationId }}</small>
					<button @click="reload">{{ __("Try again") }}</button>
				</div>
				<p v-if="loading" class="cajas__empty" role="status">{{ __("Loading cajas…") }}</p>
				<div v-else-if="!stores.length && !listError" class="cajas__empty" data-test="no-stores">
					<h2>{{ __("No stores are set up for you") }}</h2>
					<p>{{ __("Shifts keep working as before. An administrator creates a store and its cajas, then grants access.") }}</p>
					<button v-if="canCreateStore" @click="panel = 'store'">{{ __("Create the first store") }}</button>
					<button @click="emit('show-shifts')">{{ __("Review shifts") }}</button>
				</div>
				<div v-else-if="!rows.length && !listError" class="cajas__empty">
					<h2>{{ filter === 'all' ? __("This store has no cajas yet") : __("No cajas match this filter") }}</h2>
					<button v-if="currentStore?.can_configure && filter === 'all'" @click="startCreate">{{ __("Add caja") }}</button>
					<button v-else-if="filter !== 'all'" @click="setFilter('all')">{{ __("Show all cajas") }}</button>
				</div>
				<ul v-else class="cajas__list">
					<li v-for="row in rows" :key="row.name">
						<button class="cajas__row" :class="{ selected: selected === row.name }" :aria-pressed="selected === row.name" :data-caja="row.name" @click="select(row.name)">
							<strong>{{ row.label }}<template v-if="row.cashier_name || row.cashier"> · {{ row.cashier_name || row.cashier }}</template></strong>
							<span>{{ stateLine(row) }}</span>
							<span class="cajas__badges">
								<span class="badge" :class="`badge--${row.connectivity.toLowerCase()}`">{{ connectivityText(row.connectivity) }}</span>
								<span v-if="row.lifecycle !== 'Ready'" class="badge badge--info">{{ lifecycleText(row.lifecycle) }}</span>
								<span v-for="flag in row.attention" :key="flag" class="badge attention">{{ attentionText(flag) }}</span>
								<span v-if="row.is_mine" class="badge">{{ __("You") }}</span>
							</span>
						</button>
					</li>
				</ul>
				<button v-if="page?.next_cursor && !loading" class="cajas__more" :disabled="loadingMore" data-test="more-cajas" @click="load(true)">{{ loadingMore ? __("Loading cajas…") : __("Load more cajas") }}</button>
			</section>

			<section class="cajas__detail" :aria-label="__('Caja details')" :aria-busy="detailLoading">
				<div v-if="selected || panel" class="cajas__toolbar">
					<button ref="backButton" data-test="back-cajas" @click="back">← {{ __("Back to cajas") }}</button>
				</div>

				<StoreForm v-if="panel === 'store'" :companies="canCreateIn" @saved="storeCreated" @cancel="panel = ''" />
				<CajaSetupForm v-else-if="panel === 'create' && store" :store="store" @saved="cajaSaved" @cancel="panel = ''" />

				<div v-else-if="!selected" class="cajas__empty cajas__welcome">
					<h2>{{ __("Each caja has its own drawer") }}</h2>
					<p>{{ __("Choose a caja to see who is responsible, its device and what it needs next.") }}</p>
				</div>
				<p v-else-if="detailLoading && !detail" class="cajas__empty" role="status">{{ __("Loading caja…") }}</p>
				<div v-else-if="detailError && !detail" class="cajas__notice" role="alert">
					<p>{{ detailError.message }}</p>
					<button @click="select(selected, false)">{{ __("Try again") }}</button>
				</div>
				<article v-else-if="detail" :key="detail.name" class="cajas__story" data-test="caja-detail">
					<header>
						<p class="eyebrow">{{ detail.store_name }} · {{ detail.register_code }}</p>
						<h2>{{ detail.label }}</h2>
						<p>{{ stateText(detail) }}</p>
					</header>
					<dl class="cajas__facts">
						<div><dt>{{ __("Mode") }}</dt><dd>{{ detail.mode === "Cash" ? __("Cash drawer") : __("Cashless") }}</dd></div>
						<div><dt>{{ __("Setup") }}</dt><dd>{{ lifecycleText(detail.lifecycle) }}</dd></div>
						<div><dt>{{ __("Last contact") }}</dt><dd>{{ contactText(detail) }}</dd></div>
						<div><dt>{{ __("Device") }}</dt><dd>{{ detail.device ? detail.device.label : __("Not connected") }}</dd></div>
						<div><dt>{{ __("POS Profile") }}</dt><dd>{{ detail.pos_profile }}</dd></div>
						<div v-if="detail.drawer_account"><dt>{{ __("Drawer account") }}</dt><dd>{{ detail.drawer_account }}</dd></div>
					</dl>
					<div v-if="detail.shift" class="cajas__shift">
						<strong>{{ detail.shift.is_mine ? __("Your shift") : detail.shift.cashier_name || detail.shift.cashier }}</strong>
						<span>{{ __("Open since") }} {{ stamp(detail.shift.opened_at) }} · {{ __("Business day") }} {{ detail.shift.business_date }}</span>
						<span v-if="detail.shift.recovery_pending" class="attention">{{ __("Previous-device sales need supervisor review before closing.") }}</span>
					</div>
					<div v-if="detail.pending_configuration" class="cajas__notice">{{ __("A routing change is waiting for the next opening. The open shift keeps its current drawer.") }}</div>

					<section v-if="detail.readiness.length" class="cajas__readiness" data-test="caja-readiness">
						<h3>{{ __("Before this caja can open") }}</h3>
						<ul>
							<li v-for="item in detail.readiness" :key="item.key">
								<span>{{ __(item.message) }}</span>
								<button v-if="item.owner === 'register' && can('configure')" @click="startConfigure">{{ __("Fix setup") }}</button>
								<button v-else-if="item.owner === 'device' && can('connect_device')" @click="connectDevice('Enroll')">{{ __("Connect device") }}</button>
								<small v-else-if="item.owner === 'custody'">{{ __("Keep using this profile's current single drawer until shared safes are enabled.") }}</small>
								<small v-else-if="item.owner === 'store'">{{ __("Ask the store administrator.") }}</small>
							</li>
						</ul>
					</section>

					<div v-if="error" class="cajas__notice" role="alert" data-test="caja-error">
						<p>{{ error.message }}</p>
						<small v-if="error.correlationId">{{ __("Reference") }} {{ error.correlationId }}</small>
						<button v-if="error.code === 'revision_conflict'" @click="select(detail.name, false)">{{ __("Reload caja") }}</button>
					</div>

					<CajaSetupForm v-if="panel === 'configure'" :store="detail.store" :caja="detail" @saved="cajaSaved" @cancel="panel = ''" />

					<form v-else-if="reasonAction" class="cajas__form" data-test="reason-form" @submit.prevent="runReason">
						<h3>{{ reasonTitle }}</h3>
						<label>{{ __("Reason") }}<textarea v-model="reason" required minlength="8" maxlength="2000" rows="3" /></label>
						<template v-if="reasonAction === 'replace_device'">
							<label class="cajas__check"><input v-model="acknowledged" type="checkbox" required /> {{ __("The previous device may still hold unsynced sales; they will stay with this shift for review.") }}</label>
							<label>{{ __("Your password") }}<input v-model="password" type="password" autocomplete="current-password" required /></label>
						</template>
						<div class="cajas__actions">
							<button class="cajas__primary" type="submit" :disabled="busy">{{ busy ? __("Saving…") : __("Confirm") }}</button>
							<button type="button" @click="cancelReason">{{ __("Cancel") }}</button>
						</div>
					</form>

					<div v-else-if="code" class="cajas__code" data-test="device-code" aria-live="polite">
						<p>{{ code.purpose === "Replace" ? __("Replacement code for") : __("Connection code for") }} {{ code.label }}</p>
						<strong>{{ code.code }}</strong>
						<small>{{ __("Enter it on the caja's device from “Open my shift”. Valid once, until") }} {{ stamp(code.expires_at) }}</small>
						<button @click="code = null; select(detail.name, false)">{{ __("Done") }}</button>
					</div>

					<div v-else class="cajas__actions" data-test="caja-actions">
						<button v-for="action in visibleActions" :key="action.action_id" :class="{ 'cajas__primary': action.action_id === primaryAction }" :disabled="!action.enabled || busy" :title="action.blocking_reason || ''" :data-test="`caja-action-${action.action_id}`" @click="run(action.action_id)">{{ actionText(action.action_id) }}</button>
					</div>
					<footer class="hint">{{ __("Updated") }} {{ stamp(detail.as_of) }}</footer>
				</article>
			</section>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import CajaSetupForm from "./CajaSetupForm.vue";
import StoreForm from "./StoreForm.vue";
import {
	approveRoute, cajaDetail, commandError, issueChallenge, listCajas, listStores, setLifecycle,
	type CajaDetail, type CajaFilter, type CajaPage, type CajaRow, type CommandError, type StoreRow,
} from "./foundationApi";

const emit = defineEmits<{ (_e: "show-shifts"): void; (_e: "open-shift"): void; (_e: "review-shift", _shift: string): void; (_e: "resume"): void }>();
const __ = (text: string) => (window as any).__?.(text) || text;
const user = (window as any).frappe?.session?.user;
const navKey = user && user !== "Guest" ? `posa:cajas:navigation:${user}` : null;
const saved = (() => {
	try { return JSON.parse((navKey && sessionStorage.getItem(navKey)) || "{}") || {}; } catch { return {}; }
})();

const stores = ref<StoreRow[]>([]);
const canCreateIn = ref<string[]>([]);
const store = ref<string>(String(saved.store || ""));
const filter = ref<CajaFilter>(["all", "attention", "open", "available", "setup"].includes(saved.filter) ? saved.filter : "all");
const page = ref<CajaPage | null>(null);
const rows = ref<CajaRow[]>([]);
const selected = ref<string>(String(saved.selected || ""));
const detail = ref<CajaDetail | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const detailLoading = ref(false);
const listError = ref<CommandError | null>(null);
const detailError = ref<CommandError | null>(null);
const error = ref<CommandError | null>(null);
const panel = ref<"" | "store" | "create" | "configure">("");
const reasonAction = ref("");
const reason = ref("");
const password = ref("");
const acknowledged = ref(false);
const busy = ref(false);
const code = ref<null | { code: string; expires_at: string; label: string; purpose: string }>(null);
const backButton = ref<HTMLButtonElement | null>(null);
let listRequest = 0;
let detailRequest = 0;

const filters: { id: CajaFilter; label: string }[] = [
	{ id: "all", label: "All" }, { id: "attention", label: "Needs attention" }, { id: "open", label: "Open" },
	{ id: "available", label: "Available" }, { id: "setup", label: "In setup" },
];
const currentStore = computed(() => stores.value.find((row) => row.name === store.value) || null);
const canCreateStore = computed(() => canCreateIn.value.length > 0);
const stamp = (value?: string | null) => (value ? String(value).replace("T", " ").slice(0, 16) : "—");
const can = (actionId: string) => Boolean(detail.value?.actions.some((a) => a.action_id === actionId));
const HIDDEN = new Set(["configure"]);
const visibleActions = computed(() => (detail.value?.actions || []).filter((a) => !HIDDEN.has(a.action_id) || panel.value !== "configure"));
const primaryAction = computed(() => {
	const ids = visibleActions.value.filter((a) => a.enabled).map((a) => a.action_id);
	return ["resume_shift", "open_shift", "activate", "connect_device", "review_browser_access"].find((id) => ids.includes(id)) || "";
});
const reasonTitle = computed(() => ({
	suspend: __("Suspend this caja"), retire: __("Retire this caja"), replace_device: __("Replace this caja's device"),
	approve_route_change: __("Approve the drawer route change"),
} as Record<string, string>)[reasonAction.value] || "");

function connectivityText(value: string) {
	return value === "Fresh" ? __("Connected") : value === "Stale" ? __("No contact") : __("Contact unknown");
}
function lifecycleText(value: string) {
	return ({ Draft: __("Setup in progress"), Ready: __("Ready"), Suspended: __("Suspended"), Retired: __("Retired") } as Record<string, string>)[value] || value;
}
function attentionText(flag: string) {
	return ({ recovery: __("Recovery review"), older_shift: __("From an earlier day"), pending_configuration: __("Change pending"), setup_incomplete: __("Setup incomplete") } as Record<string, string>)[flag] || flag;
}
function stateLine(row: CajaRow) {
	if (row.opening_shift) return `${__("Open since")} ${stamp(row.opened_at).slice(11)}`;
	if (row.lifecycle !== "Ready") return lifecycleText(row.lifecycle);
	return __("Available");
}
function stateText(value: CajaDetail) {
	if (value.work_state === "Recovery") return __("Open — device recovery pending");
	if (value.shift) return value.shift.is_mine ? __("Open — your shift") : __("Open");
	return value.lifecycle === "Ready" ? __("Available to open") : lifecycleText(value.lifecycle);
}
function contactText(value: CajaDetail) {
	if (value.connectivity === "Unknown") return __("Never observed");
	return `${connectivityText(value.connectivity)} · ${stamp(value.last_seen_at)}`;
}
function actionText(id: string) {
	return ({
		open_shift: __("Open shift here"), resume_shift: __("Resume my sale"), activate: __("Activate caja"),
		suspend: __("Suspend"), retire: __("Retire"), connect_device: __("Connect device"),
		replace_device: __("Replace device"), configure: __("Edit setup"),
		review_browser_access: __("Review shift recovery"), approve_route_change: __("Approve route change"),
	} as Record<string, string>)[id] || id;
}

function remember() {
	try {
		if (navKey) sessionStorage.setItem(navKey, JSON.stringify({ store: store.value, filter: filter.value, selected: selected.value }));
	} catch { /* navigation still works without storage */ }
}

async function loadStores() {
	try {
		const result = await listStores();
		stores.value = result.stores;
		canCreateIn.value = result.can_create_in;
		if (!stores.value.some((row) => row.name === store.value)) store.value = stores.value[0]?.name || "";
	} catch (err) {
		listError.value = commandError(err);
	}
}

async function load(append = false) {
	if (!store.value) { rows.value = []; page.value = null; return; }
	if (append && (!page.value?.next_cursor || loadingMore.value)) return;
	const request = ++listRequest;
	if (append) loadingMore.value = true; else { loading.value = true; rows.value = []; }
	listError.value = null;
	try {
		const result = await listCajas(store.value, filter.value, "", append ? page.value?.next_cursor : null);
		if (request !== listRequest) return;
		page.value = result;
		const merged = append ? [...rows.value, ...result.registers] : result.registers;
		rows.value = [...new Map(merged.map((row) => [row.name, row])).values()];
	} catch (err) {
		if (request === listRequest) listError.value = commandError(err);
	} finally {
		if (request === listRequest) { loading.value = false; loadingMore.value = false; }
	}
}

async function select(name: string, focus = true) {
	const request = ++detailRequest;
	selected.value = name;
	panel.value = "";
	reasonAction.value = "";
	code.value = null;
	error.value = null;
	detailError.value = null;
	detailLoading.value = true;
	if (detail.value?.name !== name) detail.value = null;
	remember();
	if (focus) { await nextTick(); backButton.value?.focus({ preventScroll: true }); }
	try {
		const result = await cajaDetail(name);
		if (request === detailRequest) detail.value = result;
	} catch (err) {
		if (request === detailRequest) detailError.value = commandError(err);
	} finally {
		if (request === detailRequest) detailLoading.value = false;
	}
}

function back() {
	const previous = selected.value;
	++detailRequest;
	selected.value = "";
	detail.value = null;
	panel.value = "";
	remember();
	void nextTick(() => Array.from(document.querySelectorAll<HTMLButtonElement>("[data-caja]")).find((el) => el.dataset.caja === previous)?.focus({ preventScroll: true }));
}

function setFilter(value: CajaFilter) { filter.value = value; remember(); void load(); }
function changeStore() { selected.value = ""; detail.value = null; remember(); void load(); }
function reload() { void loadStores().then(() => load()); if (selected.value) void select(selected.value, false); }
function startCreate() { selected.value = ""; detail.value = null; panel.value = "create"; }
function startConfigure() { panel.value = "configure"; }
function cancelReason() { reasonAction.value = ""; reason.value = ""; password.value = ""; acknowledged.value = false; }

async function connectDevice(purpose: "Enroll" | "Replace" = "Enroll") {
	if (!detail.value) return;
	busy.value = true;
	error.value = null;
	try {
		code.value = await issueChallenge(detail.value.name, purpose, purpose === "Replace"
			? { reason: reason.value, password: password.value, acknowledge_recovery: acknowledged.value ? 1 : 0 } : {});
		cancelReason();
	} catch (err) {
		error.value = commandError(err);
	} finally {
		password.value = "";
		busy.value = false;
	}
}

async function lifecycle(target: "Ready" | "Suspended" | "Retired", why?: string) {
	if (!detail.value) return;
	busy.value = true;
	error.value = null;
	try {
		detail.value = await setLifecycle(detail.value.name, target, detail.value.revision, why);
		cancelReason();
		void load();
	} catch (err) {
		error.value = err as CommandError;
	} finally {
		busy.value = false;
	}
}

async function runReason() {
	const action = reasonAction.value;
	if (action === "suspend") return lifecycle("Suspended", reason.value);
	if (action === "retire") return lifecycle("Retired", reason.value);
	if (action === "replace_device") return connectDevice("Replace");
	if (action === "approve_route_change" && detail.value) {
		busy.value = true;
		try {
			detail.value = await approveRoute(detail.value.name, detail.value.revision, reason.value);
			cancelReason();
		} catch (err) {
			error.value = err as CommandError;
		} finally {
			busy.value = false;
		}
	}
}

function run(actionId: string) {
	error.value = null;
	if (["suspend", "retire", "replace_device", "approve_route_change"].includes(actionId)) { reasonAction.value = actionId; return; }
	if (actionId === "activate") return lifecycle("Ready");
	if (actionId === "connect_device") return connectDevice();
	if (actionId === "configure") return startConfigure();
	if (actionId === "open_shift") return emit("open-shift");
	if (actionId === "resume_shift") return emit("resume");
	if (actionId === "review_browser_access" && detail.value?.shift) return emit("review-shift", detail.value.shift.name);
}

function cajaSaved(result: CajaDetail) {
	panel.value = "";
	detail.value = result;
	selected.value = result.name;
	remember();
	void load();
}

function storeCreated(name: string) {
	panel.value = "";
	store.value = name;
	void loadStores().then(() => load());
}

onMounted(() => {
	void loadStores().then(() => load());
	if (selected.value) void select(selected.value, false);
});
onBeforeUnmount(() => { ++listRequest; ++detailRequest; remember(); });
</script>

<style scoped>
.cajas { display: grid; gap: 16px; min-width: 0; }
.cajas :is(h2, h3, p, dl, dd, ul) { margin: 0; }
.cajas button, .cajas select, .cajas input, .cajas textarea { min-height: 44px; padding: 10px 14px; border: 1px solid var(--pos-border); border-radius: 10px; background: var(--pos-card-bg); color: inherit; font: inherit; max-width: 100%; }
.cajas button { cursor: pointer; font-weight: 600; transition: background 140ms, border-color 140ms; }
.cajas button:hover:not(:disabled) { background: var(--pos-hover-bg); }
.cajas button:disabled { opacity: .55; cursor: not-allowed; }
.cajas button.cajas__primary { background: var(--reg-accent, #0097a7); color: var(--reg-on-accent, #fff); border-color: transparent; }
.cajas :is(button, select, input, textarea):focus-visible { outline: 3px solid var(--reg-accent, #0097a7); outline-offset: 3px; }
.cajas__bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; justify-content: space-between; }
.cajas__store { display: grid; gap: 4px; min-width: min(100%, 280px); flex: 1 1 280px; font-weight: 600; }
.cajas__store select { width: 100%; }
.cajas__bar-actions, .cajas__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cajas__summary { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; padding: 12px 0; border-block: 1px solid var(--pos-border); }
.cajas__summary strong { font-size: 20px; margin-right: 4px; }
.cajas__summary small { margin-left: auto; color: var(--pos-text-secondary); }
.cajas__layout { display: grid; grid-template-columns: minmax(270px, .85fr) minmax(0, 1.4fr); gap: 24px; align-items: start; }
.cajas__queue, .cajas__detail { min-width: 0; }
.cajas__filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.cajas__filters button { padding: 8px 12px; font-size: 13px; }
.cajas__filters button[aria-pressed="true"] { border-color: var(--pos-primary); color: var(--pos-primary); background: var(--pos-hover-bg); }
.cajas__list { list-style: none; padding: 0; display: grid; gap: 8px; }
.cajas button.cajas__row { width: 100%; text-align: left; display: grid; gap: 4px; padding: 14px 16px; font-weight: 400; }
.cajas__row strong { font-size: 16px; }
.cajas button.cajas__row.selected { border-color: var(--pos-primary); box-shadow: inset 3px 0 var(--pos-primary); background: var(--pos-hover-bg); }
.cajas__badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge { font-size: 11px; font-weight: 600; border-radius: 6px; padding: 3px 7px; background: var(--pos-hover-bg); }
.badge--fresh { color: var(--reg-tone-success-label, #1b5e20); }
.badge--stale, .attention { color: var(--reg-tone-warning-label, #754600); }
.badge.attention, .cajas__notice { background: var(--reg-tone-warning-bg, #fff6e7); color: var(--reg-tone-warning-label, #754600); }
.cajas__notice { border: 1px solid var(--reg-tone-warning-border, #e8c888); border-radius: 12px; padding: 12px 14px; display: grid; gap: 8px; }
.cajas__notice button { color: var(--pos-text-primary); justify-self: start; }
.cajas__empty { padding: 24px 8px; display: grid; gap: 12px; color: var(--pos-text-secondary); justify-items: start; }
.cajas__welcome { padding: 40px 24px; }
.cajas__more { width: 100%; margin-top: 12px; }
.cajas__toolbar { margin-bottom: 12px; }
.cajas__story { display: grid; gap: 18px; padding: clamp(14px, 2vw, 22px); border: 1px solid var(--pos-border); border-radius: 16px; background: var(--pos-card-bg); animation: caja-arrive 150ms ease-out; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .05em; color: var(--pos-text-secondary); }
.cajas__facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 20px; }
.cajas dt, .hint { color: var(--pos-text-secondary); font-size: 13px; }
.cajas dd { font-weight: 600; }
.cajas__shift { display: grid; gap: 4px; padding: 12px 14px; border-radius: 12px; background: var(--pos-hover-bg); }
.cajas__readiness ul { list-style: none; padding: 0; display: grid; gap: 8px; margin-top: 8px; }
.cajas__readiness li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--pos-border); }
.cajas__form { display: grid; gap: 12px; }
.cajas__form label { display: grid; gap: 4px; font-weight: 600; }
.cajas__check { display: flex !important; gap: 10px; align-items: flex-start; font-weight: 400 !important; }
.cajas__check input { min-height: 24px; width: 24px; }
.cajas__code { display: grid; gap: 8px; padding: 16px; border-radius: 12px; border: 2px dashed var(--pos-primary); text-align: center; justify-items: center; }
.cajas__code strong { font-size: 32px; letter-spacing: .2em; font-variant-numeric: tabular-nums; }
@keyframes caja-arrive { from { opacity: .4; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (max-width: 800px) {
	.cajas__layout { display: block; }
	.cajas__detail { display: none; }
	.cajas--detail .cajas__queue, .cajas--detail .cajas__summary, .cajas--detail .cajas__bar { display: none; }
	.cajas--detail .cajas__detail { display: block; }
	.cajas__summary small { margin-left: 0; width: 100%; }
	.cajas__bar-actions button, .cajas__actions button { flex: 1 1 140px; }
}
@media (prefers-reduced-motion: reduce) { .cajas *, .cajas *::before { animation: none !important; transition: none !important; } }
</style>
