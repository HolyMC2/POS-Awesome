<!-- MP-INTEGRATION-POINT (sale checkout) — hard-gate modal.
     Presentational only; all logic lives in useMpPointSaleGate.ts. Driven by
     the `gate` composable handle: reads gate.state, calls gate.cancel/retry/
     override. Isolated MercadoPago component — will NOT be upstreamed. -->
<template>
	<v-dialog :model-value="gate.state.open" persistent max-width="420">
		<v-card>
			<v-card-title class="text-h6 d-flex align-center">
				<v-icon class="mr-2" color="primary">mdi-credit-card-wireless</v-icon>
				{{ __("Terminal MercadoPago") }}
			</v-card-title>
			<v-card-text class="text-center py-6">
				<v-progress-circular
					v-if="spinner"
					indeterminate
					color="primary"
					size="52"
					class="mb-4"
				/>
				<v-icon v-else-if="gate.state.phase === 'approved'" color="success" size="60" class="mb-3">
					mdi-check-circle
				</v-icon>
				<v-icon v-else-if="gate.state.phase === 'failed'" color="error" size="60" class="mb-3">
					mdi-close-circle
				</v-icon>
				<div class="text-body-1">{{ gate.state.message }}</div>
				<!-- Multiple enabled terminals, no default: cashier picks once
				     (remembered on this device for next sales) -->
				<v-list v-if="gate.state.phase === 'choosing'" class="mt-3 text-start" density="compact">
					<v-list-item
						v-for="t in gate.state.terminals"
						:key="t.terminal_id"
						rounded="lg"
						class="mb-1 border"
						@click="gate.chooseTerminal(t.terminal_id)"
					>
						<template #prepend>
							<v-icon color="primary">mdi-contactless-payment</v-icon>
						</template>
						<v-list-item-title>{{ terminalLabel(t) }}</v-list-item-title>
						<v-list-item-subtitle>{{ t.terminal_id }}</v-list-item-subtitle>
					</v-list-item>
				</v-list>
				<div v-if="gate.state.amount > 0" class="text-h6 font-weight-bold mt-3">
					{{ gate.state.currency }} {{ gate.state.amount.toFixed(2) }}
				</div>
				<div
					v-if="gate.state.phase === 'failed'"
					class="text-caption text-medium-emphasis mt-3"
				>
					{{ __("El cobro no se confirmó en la terminal. La venta no se finalizará hasta confirmar.") }}
				</div>
			</v-card-text>
			<v-card-actions>
				<!-- Abort the sale entirely -->
				<v-btn variant="text" color="error" @click="gate.cancel">
					{{ __("Cancelar venta") }}
				</v-btn>
				<v-spacer />
				<!-- Retry the terminal charge -->
				<v-btn
					v-if="gate.state.phase === 'failed'"
					variant="tonal"
					color="primary"
					@click="gate.retry"
				>
					{{ __("Reintentar") }}
				</v-btn>
				<!-- Supervisor-only override (terminal offline / already charged) -->
				<v-btn
					v-if="gate.state.phase === 'failed' && gate.state.canOverride"
					variant="text"
					color="warning"
					@click="gate.override"
				>
					{{ __("Autorizar sin terminal") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
	gate: { type: Object, required: true },
});

const __ = window.__ || ((s) => s);

const spinner = computed(() =>
	["sending", "waiting", "processing"].includes(props.gate.state.phase),
);

// "Sucursal 56029845 · …05159619" — store + device tail beats raw ids.
function terminalLabel(t) {
	const store = t.store_id ? `${__("Sucursal")} ${t.store_id}` : __("Terminal");
	const tail = (t.terminal_id || "").slice(-8);
	return `${store} · …${tail}`;
}
</script>
