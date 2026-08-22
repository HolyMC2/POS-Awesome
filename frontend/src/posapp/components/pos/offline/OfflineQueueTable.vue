<template>
	<!--
		The evidence: one row per sale the register is holding, in the order they
		will upload. Split out of `OfflineQueueView.vue` because the header and the
		rows share one `grid-template-columns` — separating them across files is
		how a five-column table silently becomes two four-column ones.
	-->
	<div class="offline-table" role="table" :aria-rowcount="rows.length">
		<div class="offline-table__row offline-table__row--head" role="row">
			<span class="offline-table__col" role="columnheader">{{ __("Ticket") }}</span>
			<span class="offline-table__col" role="columnheader">{{ __("Customer and contents") }}</span>
			<span class="offline-table__col" role="columnheader">{{ __("Payment") }}</span>
			<span class="offline-table__col offline-table__col--right" role="columnheader">
				{{ __("Total") }}
			</span>
			<span class="offline-table__col offline-table__col--right" role="columnheader">
				{{ __("Status") }}
			</span>
		</div>

		<div class="offline-table__scroll">
			<div
				v-for="row in visibleRows"
				:key="row.key"
				class="offline-table__row"
				:class="`offline-table__row--${row.state}`"
				:data-testid="`offline-row-${row.key}`"
				:data-held-state="row.state"
				role="row"
			>
				<div role="cell">
					<!-- `data-ticket-local` says whether this is a server name or the
					     register's own reference: offline there is no folio to print,
					     and inventing one would be the most reassuring possible lie. -->
					<div class="offline-table__ticket mono" :data-ticket-local="String(row.ticketIsLocal)">
						{{ row.ticket || "—" }}
					</div>
					<div class="offline-table__time mono">{{ row.timeLabel }}</div>
				</div>
				<div role="cell" class="offline-table__contents">
					<div class="offline-table__customer">{{ row.customer || __("No customer") }}</div>
					<div class="offline-table__lines">
						<span v-if="row.contents">{{ row.contents }} · </span>
						{{
							row.lineCount === 1
								? __("1 line")
								: __("{0} lines").replace("{0}", String(row.lineCount))
						}}
					</div>
				</div>
				<div role="cell">
					<span class="offline-table__chip">
						{{ row.tenderIsLiteral ? row.tenderLabel : __(row.tenderLabel) }}
					</span>
				</div>
				<div role="cell" class="offline-table__col--right">
					<!-- Every figure declares what it is. A queue table is many figures
					     and none of them is THE total: the band owns that one
					     (`queuedBandInput`). -->
					<span class="offline-table__amount mono" data-money-role="queued-ticket">
						{{ formatCurrency(row.amount) }}
					</span>
				</div>
				<div role="cell" class="offline-table__col--right">
					<span class="offline-table__chip" :class="`offline-table__chip--${row.tone}`">
						{{ statusLabel(row) }}
					</span>
				</div>
			</div>

			<div v-if="!rows.length" class="offline-table__empty" data-testid="offline-empty">
				<!--
					Honest empty state. It says the QUEUE is empty, which is a fact this
					component can see; it does not say the register is synced, which is a
					claim about a server it cannot reach.
				-->
				<div class="offline-table__empty-title">{{ __("Nothing is waiting to upload") }}</div>
				<div class="offline-table__empty-body">
					{{ __("Sales taken on this register stay in this list until the server confirms them.") }}
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { HeldSale } from "./offlineQueueModel";

defineOptions({ name: "OfflineQueueTable" });

const props = withDefaults(
	defineProps<{
		/** Already oldest-first; this component does not re-sort the promise. */
		rows?: readonly HeldSale[];
		formatCurrency?: (value: number) => string;
		/** Rows drawn before the rest is folded into a count by the parent. */
		maxRows?: number;
	}>(),
	{
		rows: () => [],
		formatCurrency: (value: number) => String(value),
		maxRows: 40,
	},
);

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

const rows = computed(() => props.rows ?? []);
const visibleRows = computed(() =>
	props.maxRows > 0 ? rows.value.slice(0, props.maxRows) : [...rows.value],
);

const statusLabel = (row: HeldSale) => {
	const label = __(row.statusKey);
	return row.statusParams?.length ? label.replace("{0}", String(row.statusParams[0])) : label;
};
</script>

<style scoped>
.offline-table {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

/* The only scrollport inside the card — the height chain (59c5fe1ad) depends
 * on every ancestor above it carrying `min-height: 0`. */
.offline-table__scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
}

.offline-table__row {
	display: grid;
	grid-template-columns: 104px 1fr 116px 108px 118px;
	gap: 12px;
	align-items: center;
	padding: 0 16px;
	min-height: var(--reg-row-height, 56px);
	border-bottom: 1px solid var(--reg-divider-soft, #f4f6f8);
}

.offline-table__row--head {
	min-height: 34px;
	background: var(--reg-surface-muted, #f7f8fa);
	border-top: 1px solid var(--reg-divider, #eceff3);
	position: sticky;
	top: 0;
	z-index: 1;
}

/* Already on the server: history, kept legible but visibly done. */
.offline-table__row--uploaded {
	opacity: 0.62;
}

.offline-table__col {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.offline-table__col--right {
	text-align: right;
}

.offline-table__ticket {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.offline-table__time {
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.offline-table__contents {
	min-width: 0;
}

.offline-table__customer {
	font-size: 13px;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.offline-table__lines {
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.offline-table__amount {
	font-size: 13.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.offline-table__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 500;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-tone-neutral-label, #667085);
}

.offline-table__chip--warning {
	background: var(--reg-tone-warning-bg, #fff3e0);
	color: var(--reg-tone-warning-heading, #a15200);
}

.offline-table__chip--positive {
	background: var(--reg-tone-positive-bg, #e8f5e8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

/* The stuck row — cash collected, no invoice — is the loudest thing here, and
 * it is deliberately NOT painted red. There is no AA-safe danger pair to
 * forward to: theme.css offers only `--pos-error` / `--pos-error-container`,
 * which measure 2.9:1 in light and 1.7:1 in dark against each other, and
 * `register-tokens.css` has no danger tone at all (reported). Inventing four
 * literals here is what broke the shell in dark mode (A1, wave 3). So it
 * borrows the warning tone and carries its weight in the ring, the type and —
 * the part that survives any palette — the words. */
.offline-table__chip--danger {
	background: var(--reg-tone-warning-bg, #fff3e0);
	color: var(--reg-tone-warning-strong, #6b4a10);
	box-shadow: inset 0 0 0 1px var(--reg-tone-warning-border, #f0dcae);
	font-weight: 700;
}

.offline-table__empty {
	padding: 42px 16px;
	text-align: center;
}

.offline-table__empty-title {
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.offline-table__empty-body {
	margin-top: 6px;
	font-size: 12.5px;
	color: var(--reg-text-muted, #667085);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
