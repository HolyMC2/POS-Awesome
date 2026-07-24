<template>
	<v-card class="qz-telemetry-card" elevation="2">
		<v-card-title class="d-flex align-center justify-space-between">
			<span class="text-h6">QZ Tray — Print Telemetry</span>
			<v-btn
				size="small"
				variant="text"
				:loading="loading"
				prepend-icon="mdi-refresh"
				@click="refresh"
			>
				{{ __("Refresh") }}
			</v-btn>
		</v-card-title>

		<v-card-subtitle v-if="windowLabel" class="qz-telemetry-card__sub">
			{{ windowLabel }}
		</v-card-subtitle>

		<v-card-text>
			<div v-if="error" class="qz-telemetry-card__error">
				{{ error }}
			</div>

			<template v-else>
				<!-- Rollup stats: perf:qz_print -->
				<div class="qz-stat-grid qz-stat-grid--rollup">
					<div
						v-for="stat of rollupStats"
						:key="stat.key"
						class="qz-stat-tile"
					>
						<div class="qz-stat-tile__label">{{ stat.label }}</div>
						<div class="qz-stat-tile__value">{{ stat.value }}</div>
					</div>
				</div>

				<!-- Per-stage p95 — fetch_html / inline / send -->
				<div class="qz-stage-row">
					<h4 class="qz-stage-row__title">
						{{ __("Per-stage p95 (ms)") }}
					</h4>
					<div class="qz-stage-grid">
						<div
							v-for="stage of stageStats"
							:key="stage.key"
							class="qz-stage-tile"
						>
							<div class="qz-stage-tile__label">{{ stage.label }}</div>
							<div class="qz-stage-tile__value">{{ stage.value }}</div>
							<div class="qz-stage-tile__bar">
								<div
									class="qz-stage-tile__bar-fill"
									:style="{ width: stage.barPct + '%' }"
								></div>
							</div>
						</div>
					</div>
				</div>

				<!-- Failure summary -->
				<div class="qz-failure-row">
					<h4 class="qz-failure-row__title">
						{{ __("Failures") }}
					</h4>
					<div class="qz-failure-grid">
						<div class="qz-stat-tile">
							<div class="qz-stat-tile__label">
								{{ __("warn:qz_failure count") }}
							</div>
							<div
								class="qz-stat-tile__value"
								:class="{ 'qz-stat-tile__value--bad': failureCount > 0 }"
							>
								{{ failureCount }}
							</div>
						</div>
						<div class="qz-stat-tile">
							<div class="qz-stat-tile__label">
								{{ __("Failure rate") }}
							</div>
							<div
								class="qz-stat-tile__value"
								:class="{ 'qz-stat-tile__value--bad': failureRate > 1 }"
							>
								{{ failureRate.toFixed(1) }}%
							</div>
						</div>
						<div class="qz-stat-tile qz-stat-tile--wide">
							<div class="qz-stat-tile__label">
								{{ __("Last failure") }}
							</div>
							<div class="qz-stat-tile__value qz-stat-tile__value--small">
								{{ lastFailureLabel }}
							</div>
						</div>
					</div>
				</div>

				<div v-if="!hasAnyData" class="qz-telemetry-card__empty">
					{{
						__(
							"No QZ telemetry events in the window. Print a receipt with QZ Tray active to populate the dashboard.",
						)
					}}
				</div>

				<!-- Printer fleet — one row per terminal (get_qz_fleet, 7d) -->
				<div class="qz-fleet-row">
					<h4 class="qz-fleet-row__title">
						{{ __("Printer fleet") }}
						<span v-if="fleetWindowLabel" class="qz-fleet-row__window">
							{{ fleetWindowLabel }}
						</span>
					</h4>

					<div v-if="fleetError" class="qz-telemetry-card__error">
						{{ fleetError }}
					</div>

					<div
						v-else-if="!fleetTerminals.length"
						class="qz-telemetry-card__empty"
					>
						{{ __("No terminals reported QZ activity in the window.") }}
					</div>

					<div v-else class="qz-fleet-table-wrap">
						<v-table density="compact" class="qz-fleet-table">
							<thead>
								<tr>
									<th>{{ __("Terminal") }}</th>
									<th>{{ __("Last seen") }}</th>
									<th>{{ __("QZ version") }}</th>
									<th>{{ __("Printers") }}</th>
									<th>{{ __("Selected") }}</th>
									<th>{{ __("Default") }}</th>
									<th>{{ __("Cert") }}</th>
									<th>{{ __("Failures") }}</th>
									<th>{{ __("Flags") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="t of fleetTerminals" :key="t.terminal">
									<td class="qz-fleet-cell--id">{{ t.terminal }}</td>
									<td>{{ t.last_seen || "—" }}</td>
									<td>{{ t.qz_version || "—" }}</td>
									<td>
										<v-tooltip
											v-if="t.printers && t.printers.length"
											location="top"
										>
											<template #activator="{ props }">
												<span v-bind="props" class="qz-fleet-printers">
													{{ t.printer_count ?? t.printers.length }}
												</span>
											</template>
											<span>{{ t.printers.join(", ") }}</span>
										</v-tooltip>
										<span v-else>{{ t.printer_count ?? 0 }}</span>
									</td>
									<td>{{ t.selected_printer || "—" }}</td>
									<td>{{ t.default_printer || "—" }}</td>
									<td>{{ t.cert || "—" }}</td>
									<td
										:class="{ 'qz-fleet-cell--bad': (t.failures ?? 0) > 0 }"
									>
										{{ t.failures ?? 0 }}
									</td>
									<td>
										<span v-if="!t.flags || !t.flags.length">—</span>
										<v-chip
											v-for="flag of t.flags"
											v-else
											:key="flag"
											size="x-small"
											variant="tonal"
											:color="flagColor(flag)"
											class="qz-fleet-chip"
										>
											{{ flag }}
										</v-chip>
									</td>
								</tr>
							</tbody>
						</v-table>
					</div>
				</div>
			</template>
		</v-card-text>
	</v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

declare const frappe: any;
const __ = (s: string) => (typeof frappe?._ === "function" ? frappe._(s) : s);

type SummaryRow = {
	count?: number;
	p50?: number;
	p95?: number;
	p99?: number;
	max?: number;
	last_seen?: string;
};

// Backend shape: `{ window: {...}, crashes: N, events: { event_name: row } }`
// (Earlier hand-spec was flat; the actual `get_pos_telemetry_summary`
// returns events nested under `.events`.)
type SummaryPayload = {
	window?: { since?: string; until?: string; profile?: string | null; terminal?: string | null; row_count?: number };
	crashes?: number;
	events?: Record<string, SummaryRow>;
};

type FailureRow = {
	name: string;
	event_name: string;
	event_timestamp: string;
	metadata: string | null;
};

// Contract for posawesome.posawesome.api.telemetry.get_qz_fleet.
type FleetTerminal = {
	terminal: string;
	last_seen?: string;
	qz_version?: string;
	printer_count?: number;
	printers?: string[];
	default_printer?: string;
	selected_printer?: string;
	cert?: string;
	failures?: number;
	flags?: string[];
};

type FleetPayload = {
	window?: { days?: number; since?: string };
	terminals?: FleetTerminal[];
	flag_totals?: Record<string, number>;
};

// Flags whose meaning is "receipts are silently not printing" get the error
// tone; the rest (stale heartbeat, non-zero failures) are advisory warnings.
const FLEET_FLAG_ERROR = new Set([
	"no_printers",
	"selected_missing",
	"cert_untrusted",
]);

const loading = ref(false);
const error = ref<string | null>(null);
const summary = ref<SummaryPayload>({});
const lastFailure = ref<FailureRow | null>(null);
const fleet = ref<FleetPayload>({});
const fleetError = ref<string | null>(null);

const sinceISO = computed(() => {
	// 24h window
	const d = new Date();
	d.setHours(d.getHours() - 24);
	return d.toISOString();
});

function row(eventName: string): SummaryRow {
	return summary.value?.events?.[eventName] || {};
}

const rollupStats = computed(() => {
	const r = row("perf:qz_print");
	return [
		{ key: "count", label: __("Prints (24h)"), value: String(r.count ?? 0) },
		{ key: "p50", label: __("p50 (ms)"), value: String(Math.round(Number(r.p50 ?? 0))) },
		{ key: "p95", label: __("p95 (ms)"), value: String(Math.round(Number(r.p95 ?? 0))) },
		{ key: "p99", label: __("p99 (ms)"), value: String(Math.round(Number(r.p99 ?? 0))) },
	];
});

const stageStats = computed(() => {
	const stages: Array<{ key: string; label: string; eventName: string }> = [
		{ key: "fetch", label: __("Fetch HTML"), eventName: "perf:qz_fetch_html_ms" },
		{ key: "inline", label: __("Inline images"), eventName: "perf:qz_inline_ms" },
		{ key: "send", label: __("QZ send"), eventName: "perf:qz_send_ms" },
	];
	const p95Values = stages.map((s) => Number(row(s.eventName).p95 ?? 0));
	const maxP95 = Math.max(1, ...p95Values);
	return stages.map((s, i) => {
		const p95 = p95Values[i] ?? 0;
		return {
			key: s.key,
			label: s.label,
			value: String(Math.round(p95)),
			barPct: Math.round((p95 / maxP95) * 100),
		};
	});
});

const failureCount = computed(() => Number(row("warn:qz_failure").count ?? 0));
const printCount = computed(() => Number(row("perf:qz_print").count ?? 0));
const failureRate = computed(() => {
	const total = printCount.value + failureCount.value;
	if (total === 0) return 0;
	return (failureCount.value / total) * 100;
});

const lastFailureLabel = computed(() => {
	const f = lastFailure.value;
	if (!f) return __("None in window");
	let stageStr = "";
	if (f.metadata) {
		try {
			const meta = JSON.parse(f.metadata);
			stageStr = meta?.stage ? ` (${meta.stage})` : "";
		} catch {
			// Malformed metadata — ignore.
		}
	}
	return `${f.event_timestamp}${stageStr}`;
});

const hasAnyData = computed(
	() => printCount.value > 0 || failureCount.value > 0,
);

const windowLabel = computed(() => {
	const w = summary.value?.window;
	if (!w?.since || !w?.until) {
		return __("Window: last 24 hours");
	}
	return `${__("Window")}: ${w.since} → ${w.until}`;
});

const fleetTerminals = computed<FleetTerminal[]>(
	() => fleet.value?.terminals ?? [],
);

const fleetWindowLabel = computed(() => {
	const days = fleet.value?.window?.days;
	if (!days) return "";
	return `${__("last")} ${days} ${__("days")}`;
});

function flagColor(flag: string): string {
	return FLEET_FLAG_ERROR.has(flag) ? "error" : "warning";
}

// Isolated from refresh's try/catch: get_qz_fleet is a separate contract, so
// its failure surfaces on its own error line and never blanks the rollup panel.
async function loadFleet() {
	try {
		const resp = await frappe.call({
			method: "posawesome.posawesome.api.telemetry.get_qz_fleet",
			args: { days: 7 },
		});
		fleet.value = (resp?.message || resp || {}) as FleetPayload;
	} catch (e: any) {
		fleet.value = {};
		fleetError.value =
			(e && e.message) || String(e) || __("Failed to load QZ fleet");
	}
}

async function refresh() {
	loading.value = true;
	error.value = null;
	fleetError.value = null;
	try {
		const resp = await frappe.call({
			method: "posawesome.posawesome.api.telemetry.get_pos_telemetry_summary",
			args: { since: sinceISO.value, limit: 50000 },
		});
		summary.value = (resp?.message || resp) as SummaryPayload;

		const failResp = await frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "POS Telemetry Event",
				filters: [
					["event_name", "=", "warn:qz_failure"],
					["event_timestamp", ">", sinceISO.value],
				],
				fields: ["name", "event_name", "event_timestamp", "metadata"],
				order_by: "event_timestamp desc",
				limit_page_length: 1,
			},
		});
		const list = (failResp?.message || []) as FailureRow[];
		lastFailure.value = list[0] || null;
	} catch (e: any) {
		error.value =
			(e && e.message) || String(e) || __("Failed to load QZ telemetry");
	} finally {
		// Runs regardless of the summary fetch outcome; loadFleet swallows its
		// own errors so the fleet section stands alone.
		await loadFleet();
		loading.value = false;
	}
}

onMounted(() => {
	refresh();
});
</script>

<style scoped>
.qz-telemetry-card {
	margin-top: 16px;
}
.qz-telemetry-card__sub {
	opacity: 0.7;
	font-size: 12px;
}
.qz-telemetry-card__error {
	color: rgb(var(--v-theme-error));
	font-size: 13px;
	padding: 8px 0;
}
.qz-telemetry-card__empty {
	font-size: 13px;
	opacity: 0.7;
	padding: 12px 0 0;
}

.qz-stat-grid,
.qz-stage-grid,
.qz-failure-grid {
	display: grid;
	gap: 8px;
	grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.qz-stat-tile {
	background: rgb(var(--v-theme-surface-variant), 0.4);
	border-radius: 8px;
	padding: 10px 12px;
}
.qz-stat-tile--wide {
	grid-column: span 2;
	min-width: 0;
}
.qz-stat-tile__label {
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	opacity: 0.65;
}
.qz-stat-tile__value {
	font-size: 22px;
	font-weight: 600;
	margin-top: 2px;
}
.qz-stat-tile__value--small {
	font-size: 13px;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.qz-stat-tile__value--bad {
	color: rgb(var(--v-theme-error));
}

.qz-stage-row,
.qz-failure-row,
.qz-fleet-row {
	margin-top: 16px;
}
.qz-stage-row__title,
.qz-failure-row__title,
.qz-fleet-row__title {
	font-size: 13px;
	font-weight: 600;
	opacity: 0.8;
	margin: 0 0 8px;
}
.qz-fleet-row__window {
	font-weight: 400;
	opacity: 0.7;
	margin-left: 6px;
}

.qz-fleet-table-wrap {
	overflow-x: auto;
}
.qz-fleet-table {
	font-size: 12px;
}
.qz-fleet-table :deep(th) {
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	white-space: nowrap;
}
.qz-fleet-cell--id {
	font-weight: 600;
}
.qz-fleet-cell--bad {
	color: rgb(var(--v-theme-error));
	font-weight: 600;
}
.qz-fleet-printers {
	text-decoration: underline dotted;
	cursor: help;
}
.qz-fleet-chip {
	margin: 2px 4px 2px 0;
}

.qz-stage-tile {
	background: rgb(var(--v-theme-surface-variant), 0.3);
	border-radius: 8px;
	padding: 8px 10px;
}
.qz-stage-tile__label {
	font-size: 11px;
	opacity: 0.7;
}
.qz-stage-tile__value {
	font-size: 18px;
	font-weight: 600;
}
.qz-stage-tile__bar {
	height: 4px;
	background: rgb(var(--v-theme-on-surface), 0.1);
	border-radius: 4px;
	overflow: hidden;
	margin-top: 4px;
}
.qz-stage-tile__bar-fill {
	height: 100%;
	background: rgb(var(--v-theme-primary));
	transition: width 0.2s ease;
}
</style>
