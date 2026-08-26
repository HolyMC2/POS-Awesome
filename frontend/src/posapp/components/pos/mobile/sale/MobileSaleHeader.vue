<template>
	<header class="movil-header" data-testid="movil-sale-header">
		<!-- Warnings only (owner, 2026-08-26): the navbar right above this
		     screen already states the folio, the shift and the connection, so
		     a nominal identity row here («Venta nueva · En Línea») restated
		     the bar over it and cost the cart a row. What survives is what
		     the navbar does NOT say: warning-tone chips (no connection,
		     pending sync, a float running low) and the saldo balance — the
		     chips that guard money keep their seat; the pleasantries lose
		     theirs. -->
		<div v-if="alertChips.length" class="movil-header__identity" data-testid="movil-alert-chips">
			<span
				v-for="chip in alertChips"
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
 * SINCE 2026-08-26 the identity itself (folio, register, cashier, the
 * nominal «En línea» chip) is NOT drawn here: the navbar directly above this
 * screen already states all of it, and the restatement cost the cart a row
 * (owner: live phone test). The strip's resolution still runs — what renders
 * is its warning-tone chips and the saldo balance, the two things the navbar
 * does not say.
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

/**
 * Only the chips the navbar does not already state: warnings (the connection
 * chip goes warning-tone exactly when it stops being redundant) and saldo,
 * which is a balance no other element on this screen carries.
 */
const alertChips = computed(() =>
	line.value.chips.filter((chip) => chip.tone === "warning" || chip.id === "saldo"),
);
</script>

<style scoped>
.movil-header {
	flex: none;
	padding: 9px 14px;
	background: var(--reg-surface, #ffffff);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

.movil-header__identity {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 6px;
	min-width: 0;
	margin-bottom: 9px;
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
	margin-top: 0;
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
