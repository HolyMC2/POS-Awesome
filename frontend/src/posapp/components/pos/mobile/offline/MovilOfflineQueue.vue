<template>
	<!--
		The evidence, phone-shaped: one row per sale this register is holding,
		in the order they will upload.

		Split out of `MovilOfflineView.vue` for the reason `OfflineQueueTable`
		is split out of `OfflineQueueView` — the header and every row share one
		`grid-template-columns`, and separating them across files is how a
		three-column list silently becomes two two-column ones.

		Not a table role: at 390 px this is a stack of three-line entries, and
		announcing "column 2 of 3" over `Alejandra Ríos · Combo + 5 líneas ·
		efectivo` helps nobody. It is a `list` of `listitem`s, which is what a
		screen reader user actually gets read to them.
	-->
	<div class="movil-offline-queue" data-testid="movil-offline-queue">
		<div class="movil-offline-queue__head">
			<span class="movil-offline-queue__label">{{ __("Sales saved on this register") }}</span>
			<!-- The ordering rule, stated on screen because it is a promise:
			     `buildMobileOfflinePage` sorts oldest-first to keep it. -->
			<span class="movil-offline-queue__rule" data-testid="movil-offline-order-rule">
				{{ __("oldest first") }}
			</span>
		</div>

		<ul v-if="rows.length" class="movil-offline-queue__list">
			<li
				v-for="row in rows"
				:key="row.key"
				class="movil-offline-queue__row"
				:class="`movil-offline-queue__row--${row.state}`"
				:data-testid="`movil-offline-row-${row.key}`"
				:data-held-state="row.state"
			>
				<div>
					<!-- `data-ticket-local` says whether this is a server name or the
					     register's own reference. Offline there is no folio to print
					     and inventing one would be the most reassuring possible lie. -->
					<div
						class="movil-offline-queue__ticket mono"
						:data-ticket-local="String(row.ticketIsLocal)"
					>
						{{ row.ticket || "—" }}
					</div>
					<div class="movil-offline-queue__time mono">{{ row.timeLabel }}</div>
				</div>

				<div class="movil-offline-queue__what">
					<div class="movil-offline-queue__customer">
						{{ row.customer || __("No customer") }}
					</div>
					<!-- Contents and tender share one line here, unlike the desktop's
					     separate Payment column: the phone has one column to say what
					     the sale WAS, and `Combo + 5 líneas · efectivo` is what makes
					     a cashier recognise a transaction they remember making. -->
					<div class="movil-offline-queue__lines">{{ subline(row) }}</div>
				</div>

				<div class="movil-offline-queue__money">
					<!-- Every figure declares what it is. A queue is many figures and
					     none of them is the held total; the banner owns that one. -->
					<span class="movil-offline-queue__amount mono" data-money-role="queued-ticket">
						{{ formatCurrency(row.amount) }}
					</span>
					<span
						class="movil-offline-queue__chip"
						:class="`movil-offline-queue__chip--${row.tone}`"
						:data-held-tone="row.tone"
					>
						{{ statusLabel(row) }}
					</span>
				</div>
			</li>
		</ul>

		<div v-else class="movil-offline-queue__empty" data-testid="movil-offline-empty">
			<!--
				Honest empty state. It says the QUEUE is empty, which is a fact this
				component can see; it does not say the register is synced, which is a
				claim about a server it cannot reach.
			-->
			<div class="movil-offline-queue__empty-title">{{ __("Nothing is waiting to upload") }}</div>
			<div class="movil-offline-queue__empty-body">
				{{ __("Sales taken on this register stay in this list until the server confirms them.") }}
			</div>
		</div>

		<div v-if="hiddenHeldCount" class="movil-offline-queue__more" data-testid="movil-offline-more">
			{{ __("and {0} more tickets in the queue").replace("{0}", String(hiddenHeldCount)) }}
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { HeldSale } from "../../offline/offlineQueueModel";

defineOptions({ name: "MovilOfflineQueue" });

const props = withDefaults(
	defineProps<{
		/** Already chosen and ordered by `buildMobileOfflinePage`. */
		rows?: readonly HeldSale[];
		/** Held sales that did not fit — never uploaded history. */
		hiddenHeldCount?: number;
		formatCurrency?: (value: number) => string;
	}>(),
	{
		rows: () => [],
		hiddenHeldCount: 0,
		formatCurrency: (value: number) => String(value),
	},
);

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

const rows = computed(() => props.rows ?? []);

const statusLabel = (row: HeldSale) => {
	const label = __(row.statusKey);
	return row.statusParams?.length ? label.replace("{0}", String(row.statusParams[0])) : label;
};

/**
 * `Combo + 5 líneas · efectivo`.
 *
 * `tenderLabel` is tenant data when `tenderIsLiteral` — a mode of payment
 * already reads in the operator's language — and a translation key only for
 * the two derived cases (several tenders, or none).
 */
const subline = (row: HeldSale) => {
	const lines =
		row.lineCount === 1
			? __("1 line")
			: __("{0} lines").replace("{0}", String(row.lineCount));
	const tender = row.tenderIsLiteral ? row.tenderLabel : __(row.tenderLabel);
	return [row.contents, lines, tender].filter(Boolean).join(" · ");
};
</script>

<style scoped>
.movil-offline-queue {
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: 12px;
	padding: 3px 12px 8px;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.movil-offline-queue__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	padding: 9px 0 2px;
	flex: none;
}

.movil-offline-queue__label {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #8b93a0);
}

.movil-offline-queue__rule {
	font-size: 10px;
	color: var(--reg-text-muted, #9aa2ae);
}

.movil-offline-queue__list {
	list-style: none;
	margin: 0;
	padding: 0;
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
}

.movil-offline-queue__row {
	display: grid;
	grid-template-columns: 74px 1fr 84px;
	gap: 9px;
	align-items: center;
	padding: 9px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.movil-offline-queue__row:last-child {
	border-bottom: 0;
}

/* Already on the server: history, kept legible but visibly done. */
.movil-offline-queue__row--uploaded {
	opacity: 0.6;
}

.movil-offline-queue__ticket {
	font-size: 12px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-offline-queue__time {
	font-size: 9.5px;
	color: var(--reg-text-muted, #9aa2ae);
}

.movil-offline-queue__what {
	min-width: 0;
}

.movil-offline-queue__customer {
	font-size: 12px;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.movil-offline-queue__lines {
	font-size: 9.5px;
	color: var(--reg-text-muted, #9aa2ae);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.movil-offline-queue__money {
	text-align: right;
}

.movil-offline-queue__amount {
	display: block;
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-offline-queue__chip {
	display: inline-flex;
	align-items: center;
	white-space: nowrap;
	border-radius: 999px;
	padding: 1px 6px;
	margin-top: 2px;
	font-size: 9px;
	font-weight: 500;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-tone-neutral-label, #667085);
}

/* Amber is STATE here, never emphasis (§17.7 invariant 2): `espera` spends no
 * accent, and the one saturated colour on the phone stays on the dock's
 * primary action. */
.movil-offline-queue__chip--warning {
	background: var(--reg-tone-warning-bg, #fff3e0);
	color: var(--reg-tone-warning-heading, #a15200);
}

.movil-offline-queue__chip--positive {
	background: var(--reg-tone-positive-bg, #e8f5e8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

/* The stuck row — cash collected, no invoice — is the loudest thing here and
 * deliberately NOT red: `register-tokens.css` has no danger tone, and the four
 * literals that would be needed here are what broke the shell in dark mode
 * (A1, wave 3). It borrows the warning tone and carries its weight in the
 * ring, the type and — the part that survives any palette — the words. */
.movil-offline-queue__chip--danger {
	background: var(--reg-tone-warning-bg, #fff3e0);
	color: var(--reg-tone-warning-strong, #6b4a10);
	box-shadow: inset 0 0 0 1px var(--reg-tone-warning-border, #f0dcae);
	font-weight: 700;
}

.movil-offline-queue__empty {
	padding: 26px 4px;
	text-align: center;
}

.movil-offline-queue__empty-title {
	font-size: 13.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-offline-queue__empty-body {
	margin-top: 5px;
	font-size: 11px;
	line-height: 1.45;
	color: var(--reg-text-muted, #667085);
}

.movil-offline-queue__more {
	flex: none;
	padding-top: 9px;
	font-size: 10.5px;
	color: var(--reg-text-muted, #9aa2ae);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
