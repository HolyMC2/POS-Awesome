<template>
	<section
		class="closing-readiness"
		:class="{ 'closing-readiness--ready': ready }"
		data-testid="closing-readiness"
		aria-live="polite"
	>
		<p v-if="busy">{{ __("Checking this browser and the open shift…") }}</p>
		<p v-else-if="ready">{{ __("This browser is ready to close the shift.") }}</p>
		<template v-else>
			<strong>{{ __("Review saved sales before closing") }}</strong>
			<p v-if="status?.recovery_pending">
				{{
					__(
						"This browser is registered. A supervisor still needs to record how sales from previous browsers were checked.",
					)
				}}
			</p>
			<p v-else-if="status?.terminal_id">
				{{
					__(
						"Another browser owns this shift. Finish syncing there, or have a supervisor review its saved sales and authorize this browser here. The previous browser will no longer be able to submit sales.",
					)
				}}
			</p>
			<p v-else-if="canRegisterReleased">{{ __("The previous browser released this shift after syncing. You can register this browser and continue closing.") }}</p>
			<p v-else-if="status">
				{{
					__(
						"This older shift has no registered browser. A supervisor can check previous-browser sales and register this browser here, in one step.",
					)
				}}
			</p>
			<template v-if="status?.can_manage">
				<label
					><input v-model="reviewed" type="checkbox" data-testid="closing-recovery-reviewed" />{{
						__(
							"I checked previous browsers and accounted for their saved sales and cash movements.",
						)
					}}</label
				>
				<label
					>{{ __("How was the saved work checked?")
					}}<textarea
						v-model="reason"
						rows="2"
						maxlength="1000"
						data-testid="closing-recovery-reason"
						:placeholder="__('Describe the review (at least 8 characters)')"
					/>
				</label>
				<button
					type="button"
					@click="recover"
					:disabled="busy || !reviewed || reason.trim().length < 8"
					data-testid="closing-recover"
				>
					{{ __("Record review and prepare this browser") }}
				</button>
			</template>
			<template v-else-if="status && !canRegisterReleased">
				<p>{{ __("A supervisor must authorize a transfer or review saved sales. Your cashier account cannot approve that review.") }}</p>
				<p><strong>{{ __("Shift") }}: {{ status.opening_shift }}</strong></p>
				<ol>
					<li>{{ __("If the original browser is available, sync and review its saved work there, then release the terminal. Return here and check again.") }}</li>
					<li>{{ __("Otherwise, ask a supervisor to sign in on this same browser, open Offline Status, and select this cashier’s shift under replacement-browser authorization.") }}</li>
					<li>{{ __("After the supervisor authorizes this browser and records the saved-sales review, sign back in as the original cashier and return to Close Shift.") }}</li>
				</ol>
				<button type="button" @click="openTerminalHelp" data-testid="closing-terminal-help">{{ __("Open terminal recovery") }}</button>
			</template>
			<button v-if="canRegisterReleased" type="button" :disabled="busy" @click="registerReleased" data-testid="closing-register-released">{{ __("Register this browser and continue") }}</button>
		</template>
		<p v-if="error" role="alert">{{ error }}</p>
		<button v-if="!ready && !busy" type="button" @click="refresh" data-testid="closing-recheck">
			{{ __("Check again") }}
		</button>
	</section>
</template>

<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useClosingRecovery } from "../../../composables/pos/closing/useClosingRecovery";
import { useOfflineSyncStore } from "../../../stores/offlineSyncStore";
const sync = useOfflineSyncStore();
function openTerminalHelp() { sync.setPanelOpen(true); }
const emit = defineEmits<{ ready: [boolean] }>();
const { status, busy, error, reviewed, reason, ready, refresh, recover, canRegisterReleased, registerReleased } = useClosingRecovery();
const __ = (text: string) => (window as any).__?.(text) || text;
watch([ready, busy, error], () => emit("ready", ready.value && !busy.value && !error.value), {
	immediate: true,
});
watch(() => sync.panelOpen, (open, wasOpen) => { if (wasOpen && !open) void refresh(); });
onMounted(refresh);
</script>

<style scoped>
.closing-readiness {
	display: grid;
	gap: 10px;
	padding: 16px;
	border: 1px solid rgb(var(--v-theme-warning));
	border-radius: 8px;
	font-size: 14px;
	line-height: 1.5;
}
.closing-readiness--ready {
	border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}
p {
	margin: 0;
	max-width: 80ch;
}
label {
	display: grid;
	gap: 6px;
}
label:has(input) {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}
input {
	margin-top: 4px;
}
textarea {
	padding: 8px;
	border: 1px solid var(--pos-border);
	border-radius: 6px;
	color: inherit;
	background: var(--pos-card-bg);
}
button {
	justify-self: start;
	padding: 8px 12px;
	min-height: 44px;
	border: 1px solid currentColor;
	border-radius: 6px;
}
button:disabled {
	opacity: 0.5;
}
:is(button, textarea, input):focus-visible {
	outline: 2px solid rgb(var(--v-theme-primary));
	outline-offset: 3px;
}
</style>
