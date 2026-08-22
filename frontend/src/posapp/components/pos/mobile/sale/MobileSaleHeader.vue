<template>
	<header class="movil-header" data-testid="movil-sale-header">
		<div class="movil-header__identity">
			<div class="movil-header__names">
				<div class="movil-header__ticket reg-mono" data-testid="movil-ticket">{{ title }}</div>
				<div v-if="subtitle" class="movil-header__where" data-testid="movil-where">
					{{ subtitle }}
				</div>
			</div>

			<span
				v-for="chip in line.chips"
				:key="chip.id"
				class="movil-header__chip"
				:class="[`movil-header__chip--${chip.tone}`, { 'reg-mono': chip.mono }]"
				:data-chip="chip.id"
				:data-money-role="chip.id === 'saldo' ? 'saldo' : undefined"
				>{{ __(chip.labelKey, chip.labelParams) }}</span
			>
		</div>

		<!-- THE scan field arrives through this slot; nothing here builds one.
		     `useScannerInput` attaches the keyboard wedge to the DOCUMENT behind
		     a `document._scannerAttached` singleton, so a second scan input on
		     the sale screen would count every barcode twice — or, depending on
		     mount order, kill the shop's gun outright. `Pos.vue` already
		     teleports `ItemsSelector`'s one header into `#register-scan-bar`;
		     the phone reuses that target rather than growing a rival. -->
		<div v-if="$slots['scan-bar']" class="movil-header__scan" data-testid="movil-scan-slot">
			<slot name="scan-bar" />
		</div>
	</header>
</template>

<script setup lang="ts">
/**
 * The phone's app bar (`MovilVenta.dc.html`, nodes 1–9).
 *
 *     B-04812                            [En línea]  [$1,240]
 *     Caja 2 · Jenni
 *     [ Escanear o buscar…                              ]
 *
 * REUSED WHOLE: `navbar/registerStatusLine.ts`, in its `compact` mode, which
 * exists for exactly this bar. It already drops the profile name and the
 * clock on a phone, already orders saldo before the connection chip (the
 * latent clipping bug wave 6 found), and already refuses to claim
 * "sincronizado" while the offline queue holds invoices — the one chip here
 * that can lie about money. Restating any of that in a template would put the
 * guard somewhere a later edit can delete without knowing what it was for.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE DESK, both because the phone's sale
 * screen has no navbar actions row:
 *
 *  - **The cashier is named.** `registerStatusLine.ts` omits `cashierName` on
 *    purpose — on the desk the avatar chip states it, as the label of the
 *    control that switches cashier. The phone's sale screen has no avatar
 *    control, so the module's reason ("a third restatement of a fact already
 *    on screen twice") does not hold here: without this the name appears
 *    zero times. Appended rather than interleaved, because the module returns
 *    the subtitle as one resolved string.
 *  - **No shift clock.** The artboard drops it on every mobile board, so the
 *    caller passes no `shiftStart` and the subtitle is `Caja 2 · Jenni`.
 *
 * No brand mark either: §17.4 makes the navbar the brand layer, and a second
 * wordmark on a 390 px bar spends the width the ticket folio needs.
 */
import { computed } from "vue";

import {
	resolveRegisterStatusLine,
	type RegisterStatusInput,
} from "../../../navbar/registerStatusLine";

const props = withDefaults(
	defineProps<{
		/**
		 * Everything `resolveRegisterStatusLine` reads. `compact` is forced on
		 * below, so a caller cannot accidentally ask the phone for the desk's
		 * clock and printer chips.
		 */
		status?: RegisterStatusInput;
	}>(),
	{ status: () => ({}) },
);

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = typeof window !== "undefined" ? (window as any).__ : undefined;
	if (translate) return translate(text, args);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const line = computed(() => resolveRegisterStatusLine({ ...props.status, compact: true }));

/** A folio is a literal and must not be looked up; a phrase must. */
const title = computed(() =>
	line.value.titleIsLiteral
		? line.value.titleKey
		: __(line.value.titleKey, line.value.titleParams),
);

const subtitle = computed(() => {
	const where = line.value.subtitleKey
		? __(line.value.subtitleKey, line.value.subtitleParams)
		: "";
	const cashier = String(props.status?.cashierName ?? "").trim();
	if (!cashier) return where;
	return where ? `${where} · ${cashier}` : cashier;
});
</script>

<style scoped>
.movil-header {
	flex: none;
	padding: 13px 14px 11px;
	background: var(--reg-surface, #ffffff);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

.movil-header__identity {
	display: flex;
	align-items: center;
	gap: 9px;
	min-width: 0;
}

.movil-header__names {
	flex: 1;
	min-width: 0;
	line-height: 1.15;
}

.movil-header__ticket {
	font-size: 12px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.movil-header__where {
	font-size: 9.5px;
	color: var(--reg-text-muted, #667085);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* Chips never shrink and never ellipse. `registerStatusLine.ts` drops whole
 * chips by priority when the bar runs out of room; a value cut mid-word
 * ("En líne") reads as a bug, and a half-rendered claim about money is worse
 * than an absent one. */
.movil-header__chip {
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	border-radius: 999px;
	padding: 3px 8px;
	font-size: 11px;
	font-weight: 500;
	white-space: nowrap;
}

.movil-header__chip--neutral {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

/* Green and amber are STATE — a connection, a float running low. Neither is
 * emphasis, and neither is the accent: this screen spends that on the one
 * primary button in the totals card. */
.movil-header__chip--positive {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.movil-header__chip--warning {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-header__scan {
	margin-top: 11px;
}

/* The scan field is somebody else's component arriving through a teleport, so
 * the floor is set on the slot's contents rather than on a class this file
 * owns — otherwise a 36px input would sit inside a 44px box and only the box
 * would be tappable. */
@media (pointer: coarse) {
	.movil-header__scan :deep(input),
	.movil-header__scan :deep(.v-field) {
		min-height: var(--reg-touch-min, 44px);
	}
}

@media (max-width: 480px) {
	.movil-header__scan :deep(input),
	.movil-header__scan :deep(.v-field) {
		min-height: var(--reg-touch-min, 44px);
	}
}
</style>
