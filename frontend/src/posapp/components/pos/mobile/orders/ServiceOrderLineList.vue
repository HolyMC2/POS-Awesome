<template>
	<section class="movil-orden__card movil-orden__lines" data-testid="orden-lines">
		<div class="movil-orden__lines-head">
			<span class="movil-orden__label">{{ __("Labour and parts") }}</span>
			<span v-if="technician" class="movil-orden__tech" data-testid="orden-technician">
				{{ technician }}
			</span>
		</div>

		<!--
			Every line the workshop wrote down, including the ones worth nothing.
			`toServiceOrderLines` does not filter and neither does this: the
			customer's own glass is in their phone, and a ticket that omits it
			reads as though the shop supplied it.
		-->
		<div class="movil-orden__rows">
			<div
				v-for="line in lines"
				:key="line.key"
				class="movil-orden__row"
				:class="{ 'movil-orden__row--free': !line.chargeable }"
				:data-testid="`orden-line-${line.key}`"
				:data-line-kind="line.kind"
				:data-line-bills-to="line.billsTo"
				:data-line-chargeable="String(line.chargeable)"
			>
				<div class="movil-orden__row-copy">
					<div class="movil-orden__row-name">{{ line.description }}</div>
					<div class="movil-orden__row-meta reg-mono" :data-testid="`orden-line-meta-${line.key}`">
						{{ metaOf(line) }}
					</div>
				</div>
				<span
					class="movil-orden__row-amount reg-mono"
					:class="{ 'movil-orden__row-amount--free': !line.chargeable }"
					data-money-role="line"
					:data-testid="`orden-line-amount-${line.key}`"
					>{{ formatAmount(line.amount) }}</span
				>
			</div>
		</div>

		<div class="movil-orden__evidence" data-testid="orden-evidence">
			<div
				v-for="chip in evidence"
				:key="chip.id"
				class="movil-orden__evidence-line"
				:class="`movil-orden__evidence-line--${chip.state}`"
				:data-testid="`orden-evidence-${chip.id}`"
				:data-evidence-state="chip.state"
			>
				<v-icon :icon="evidenceIcon(chip.state)" size="13" aria-hidden="true" />
				{{ __(chip.labelKey, chip.labelParams) }}
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * What the customer is being charged for, and what was checked before
 * charging it (artboard `MovilOrden.dc.html`, the "Mano de obra y
 * refacciones" card).
 *
 * Split from `MovilOrdenView.vue` rather than nested in it because the two
 * answer different questions — this one "what is on the ticket?", the parent
 * "what is owed?" — and because the sale screen next door is already three
 * files for the same reason.
 *
 * It renders; it does not decide. Kinds, amounts and evidence states all
 * arrive resolved from `serviceOrderLines.ts`, so there is one place where a
 * customer's part can be made chargeable and it is not here.
 */
import type { EvidenceState, ServiceOrderEvidenceChip, ServiceOrderLine } from "./serviceOrderLines";

defineOptions({ name: "ServiceOrderLineList" });

defineProps<{
	lines: readonly ServiceOrderLine[];
	evidence: readonly ServiceOrderEvidenceChip[];
	technician?: string;
	/** Resolved by the parent, which owns the tenant's currency. */
	formatAmount: (_value: number) => string;
}>();

/** Mirrors `frappe-shim`'s `__`, as ActionBand.vue does — same reasoning. */
const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

/** `IPN002218 · refacción · no se cobra` — whichever of the three exist. */
const metaOf = (line: ServiceOrderLine) =>
	[line.itemCode, line.kindLabelKey ? __(line.kindLabelKey) : "", line.noteKey ? __(line.noteKey) : ""]
		.filter(Boolean)
		.join(" · ");

const evidenceIcon = (state: EvidenceState) =>
	state === "ok" ? "mdi-check" : state === "attention" ? "mdi-alert-circle-outline" : "mdi-help-circle";
</script>

<style scoped>
/* Artboard values carried as fallbacks, as the band does. */
.movil-orden__card {
	background: var(--reg-surface, #ffffff);
	margin: 0 11px;
	border-radius: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	padding: 12px;
	flex: none;
}

.movil-orden__lines {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 3px 12px 8px;
}

.movil-orden__lines-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding: 10px 0 2px;
	gap: 10px;
}

.movil-orden__label {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.movil-orden__tech {
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.movil-orden__row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.movil-orden__row:last-child {
	border-bottom: 0;
}

.movil-orden__row-copy {
	flex: 1;
	min-width: 0;
}

.movil-orden__row-name {
	font-size: 12.5px;
	line-height: 1.25;
	color: var(--reg-text-primary, #212121);
}

/* A line at no charge is quieter, not absent. The customer's own part has to
 * be legible on the ticket they are handed. */
.movil-orden__row--free .movil-orden__row-name {
	color: var(--reg-text-secondary, #56606e);
}

.movil-orden__row-meta {
	font-size: 9.5px;
	color: var(--reg-text-muted, #667085);
	margin-top: 2px;
}

.movil-orden__row-amount {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__row-amount--free {
	color: var(--reg-text-muted, #667085);
}

.movil-orden__evidence {
	margin-top: 8px;
	padding: 10px 11px;
	border-radius: 10px;
	background: var(--reg-surface-sunken, #fafbfc);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
}

.movil-orden__evidence-line {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 0;
	font-size: 11.5px;
	color: var(--reg-text-secondary, #4a5260);
}

.movil-orden__evidence-line--ok {
	color: var(--reg-tone-positive-number, #157a48);
}

.movil-orden__evidence-line--attention {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

/* Unknown is grey and says so. A tick for a check nobody ran is worse than a
 * blank, because it tells the cashier the check happened. */
.movil-orden__evidence-line--unknown {
	color: var(--reg-text-muted, #667085);
}
</style>
