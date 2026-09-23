<template>
	<section v-if="loaded && (cajas.length || canConnect || connecting)" class="my-caja" data-test="my-caja-picker">
		<h6>{{ __("Your caja") }}</h6>
		<p v-if="error" class="my-caja__error" role="alert">{{ error }}</p>
		<p v-if="notice" class="my-caja__notice" role="status" data-test="my-caja-notice">{{ notice }}</p>
		<div class="my-caja__list" role="radiogroup" :aria-label="__('Your caja')">
			<button v-for="caja in cajas" :key="caja.name" type="button" role="radio" :aria-checked="modelValue?.name === caja.name"
				class="my-caja__option" :class="{ selected: modelValue?.name === caja.name }" :disabled="!!caja.opening_shift && !caja.is_mine"
				:data-caja-option="caja.name" @click="choose(caja)">
				<strong>{{ caja.label }}</strong>
				<span>{{ caja.store_name }}</span>
				<small v-if="caja.opening_shift && !caja.is_mine">{{ __("Open by") }} {{ caja.cashier_name || caja.cashier }} · {{ __("Ask a supervisor for help") }}</small>
				<small v-else-if="caja.this_device">{{ __("This device") }} · {{ caja.mode === "Cash" ? __("Cash drawer") : __("Cashless") }}</small>
				<small v-else class="my-caja__warn">{{ __("This device is not connected to this caja") }}</small>
			</button>
		</div>
		<button type="button" class="my-caja__link" data-test="connect-this-device" @click="connecting = !connecting">{{ connecting ? __("Cancel") : __("Connect this device with a code") }}</button>
		<form v-if="connecting" class="my-caja__connect" @submit.prevent="preview ? confirm() : check()">
			<label>{{ __("Connection code from your supervisor") }}
				<input v-model="code" required maxlength="12" autocomplete="one-time-code" autocapitalize="characters" data-test="device-code-input" />
			</label>
			<div v-if="preview" class="my-caja__preview" data-test="device-code-preview" aria-live="polite">
				<strong>{{ preview.store_name }} · {{ preview.label }}</strong>
				<span>{{ preview.purpose === "Replace" ? __("This device will replace the caja's previous device.") : __("This device will become the caja's device.") }}</span>
			</div>
			<label v-if="preview">{{ __("Device name") }}<input v-model.trim="label" required maxlength="120" /></label>
			<button type="submit" class="my-caja__primary" :disabled="busy">{{ busy ? __("Checking…") : preview ? __("Confirm and connect") : __("Check code") }}</button>
		</form>
		<button v-if="modelValue" type="button" class="my-caja__link" data-test="use-legacy-profile" @click="emit('update:modelValue', null)">{{ __("Open with a POS profile instead") }}</button>
	</section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { commandError, enrollDevice, myCajas, previewChallenge, type CajaRow } from "../registers/foundationApi";
import { getTerminalCredentials } from "../../../../offline/shiftTerminal";

defineProps<{ modelValue: CajaRow | null }>();
const emit = defineEmits<{ (_e: "update:modelValue", _value: CajaRow | null): void }>();
const __ = (text: string) => (window as any).__?.(text) || text;
const cajas = ref<CajaRow[]>([]);
const loaded = ref(false);
const connecting = ref(false);
const code = ref("");
const label = ref(__("Caja tablet"));
const preview = ref<null | { label: string; store_name: string; purpose: string }>(null);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const canConnect = ref(false);

async function load(selectRegister?: string) {
	try {
		const credentials = getTerminalCredentials();
		const result = await myCajas(credentials.terminal_id);
		cajas.value = result.registers;
		canConnect.value = Boolean(result.can_connect);
		// Preselect only without ambiguity: the caja just connected, the cashier's
		// own open caja, or the single caja this device can open right now.
		const openable = cajas.value.filter((c) => c.can_open);
		const preferred = cajas.value.find((c) => c.name === selectRegister) || cajas.value.find((c) => c.is_mine)
			|| (openable.length === 1 ? openable[0] : null);
		if (preferred && (!preferred.opening_shift || preferred.is_mine)) emit("update:modelValue", preferred);
	} catch {
		// No store access or offline: the legacy profile opening remains available.
		cajas.value = [];
	} finally {
		loaded.value = true;
	}
}

function choose(caja: CajaRow) {
	error.value = "";
	emit("update:modelValue", caja);
	if (!caja.this_device && !caja.can_open) connecting.value = true;
}

async function check() {
	busy.value = true;
	error.value = "";
	try {
		preview.value = await previewChallenge(code.value);
	} catch (err) {
		error.value = commandError(err).message;
	} finally {
		busy.value = false;
	}
}

async function confirm() {
	busy.value = true;
	error.value = "";
	try {
		const result = await enrollDevice(code.value, label.value, getTerminalCredentials());
		connecting.value = false;
		preview.value = null;
		code.value = "";
		await load(result.register);
		// A draft caja is not listed until a supervisor activates it.
		notice.value = cajas.value.some((c) => c.name === result.register)
			? ""
			: `${__("This device is now connected to")} ${result.store_name} · ${result.label}. ${__("A supervisor must activate the caja before it can open.")}`;
	} catch (err) {
		error.value = (err as any)?.message || commandError(err).message;
	} finally {
		busy.value = false;
	}
}

onMounted(() => load());
defineExpose({ reload: load });
</script>

<style scoped>
.my-caja { display: grid; gap: 10px; margin-bottom: 16px; }
.my-caja h6 { margin: 0; font-size: 1rem; }
.my-caja__list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
.my-caja button, .my-caja input { min-height: 44px; border-radius: 10px; border: 1px solid var(--pos-border, rgba(0,0,0,.2)); background: var(--pos-card-bg, #fff); color: inherit; font: inherit; padding: 10px 14px; max-width: 100%; box-sizing: border-box; }
.my-caja__option { display: grid; gap: 2px; text-align: left; cursor: pointer; }
.my-caja__option.selected { border-color: var(--pos-primary, #1976d2); box-shadow: inset 3px 0 var(--pos-primary, #1976d2); }
.my-caja__option:disabled { opacity: .65; cursor: not-allowed; }
.my-caja__option small { color: var(--pos-text-secondary, #555); }
.my-caja__warn, .my-caja__error { color: var(--reg-tone-warning-label, #754600); }
.my-caja__error, .my-caja__notice { margin: 0; }
.my-caja__notice { padding: 10px 12px; border-radius: 10px; background: var(--pos-hover-bg, #f4f6f8); }
.my-caja__link { justify-self: start; background: transparent !important; border-color: transparent !important; color: var(--pos-primary, #1976d2) !important; cursor: pointer; font-weight: 600; }
.my-caja__connect { display: grid; gap: 10px; }
.my-caja__connect label { display: grid; gap: 4px; font-weight: 600; }
.my-caja__preview { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; background: var(--pos-hover-bg, #f4f6f8); }
.my-caja button.my-caja__primary { background: var(--reg-accent, #0097a7); color: var(--reg-on-accent, #fff); border-color: transparent; cursor: pointer; font-weight: 600; }
.my-caja :is(button, input):focus-visible { outline: 3px solid var(--reg-accent, #0097a7); outline-offset: 2px; }
</style>
