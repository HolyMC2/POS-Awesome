<template>
	<div class="closing-review">
		<p v-if="flow.preparing" role="status">{{ __("Loading shift totals and checking saved work…") }}</p>
		<div v-if="flow.error" class="closing-review__error" role="alert" data-testid="closing-error">
			<strong>{{ __("Closing needs attention") }}</strong>
			<p>{{ flow.error }}</p>
			<p>{{ __("Your entered amounts stay here. Resolve the problem, then try closing again.") }}</p>
			<div class="closing-review__actions">
				<button type="button" :disabled="flow.submitting" @click="$emit('sync')">
					{{ __("Sync saved work") }}
				</button>
				<button type="button" :disabled="flow.preparing || flow.submitting" @click="$emit('retry')">
					{{ __("Reload closing details") }}
				</button>
			</div>
		</div>
		<ClosingRecovery v-if="!flow.preparing" @ready="flow.terminalReady = $event" />
		<section v-if="flow.reviewRequired" class="closing-review__drafts" data-testid="closing-review">
			<strong>{{ __("Unfinished sales") }}</strong>
			<p v-if="flow.pendingDrafts.length">
				{{
					flow.deletesDrafts
						? __(
								"These unprinted drafts will be deleted only when the shift closes successfully:",
							)
						: __(
								"Finish or delete these drafts before closing. They cannot be left on a closed shift:",
							)
				}}
			</p>
			<ul v-if="flow.pendingDrafts.length">
				<li v-for="draft in flow.pendingDrafts" :key="draft.name">
					{{ draft.name }}<span v-if="draft.owner"> — {{ draft.owner }}</span>
				</li>
			</ul>
			<p v-if="flow.skippedInvoices.length">
				{{
					__("These printed invoices were excluded from closing and will remain drafts for review:")
				}}
			</p>
			<ul v-if="flow.skippedInvoices.length">
				<li v-for="invoice in flow.skippedInvoices" :key="invoice.invoice">{{ invoice.invoice }}</li>
			</ul>
			<button v-if="flow.reviewBlocked" type="button" @click="$emit('drafts')">
				{{ __("Review drafts") }}
			</button>
			<label v-else
				><input v-model="flow.reviewAccepted" type="checkbox" data-testid="closing-review-accept" />{{
					__("I reviewed these sales and agree to the changes listed above when closing.")
				}}</label
			>
		</section>
	</div>
</template>

<script setup lang="ts">
import ClosingRecovery from "./ClosingRecovery.vue";
import { useClosingFlowStore } from "../../../stores/closingFlowStore";
defineProps<{ prepared: boolean }>();
defineEmits<{ retry: []; drafts: []; sync: [] }>();
const flow = useClosingFlowStore();
const __ = (text: string) => (window as any).__?.(text) || text;
</script>

<style scoped>
.closing-review {
	display: grid;
	gap: 12px;
	padding: 0;
	font-size: 14px;
	line-height: 1.5;
}
.closing-review__error,
.closing-review__drafts {
	display: grid;
	gap: 8px;
	padding: 16px;
	border: 1px solid rgb(var(--v-theme-warning));
	border-radius: 8px;
}
.closing-review__error {
	border-color: rgb(var(--v-theme-error));
}
.closing-review__actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
p {
	margin: 0;
	max-width: 80ch;
}
ul {
	padding-left: 20px;
	max-height: 140px;
	overflow-y: auto;
}
label {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}
input {
	margin-top: 4px;
}
button {
	justify-self: start;
	min-height: 44px;
	padding: 8px 12px;
	border: 1px solid currentColor;
	border-radius: 6px;
}
:is(button, input):focus-visible {
	outline: 2px solid rgb(var(--v-theme-primary));
	outline-offset: 3px;
}
</style>
