<template>
	<form class="setup" data-test="caja-setup-form" @submit.prevent="save">
		<h3>{{ caja ? __("Edit caja setup") : __("Add caja") }}</h3>
		<p v-if="caja?.work_state === 'Open'" class="setup__hint">{{ __("This caja is open. Drawer and profile changes apply at its next opening; the current shift keeps its route.") }}</p>
		<p v-if="loadError" class="setup__error" role="alert">{{ loadError }} <button type="button" @click="loadOptions">{{ __("Try again") }}</button></p>
		<label>{{ __("Name employees recognize") }}
			<input v-model.trim="form.label" required maxlength="120" :placeholder="__('Caja Mostrador')" data-test="caja-label" />
		</label>
		<label>{{ __("Short code") }}
			<input v-model.trim="form.register_code" required maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}" :disabled="!!caja" autocapitalize="characters" data-test="caja-code" />
			<small>{{ __("Letters, digits, hyphen or underscore. It cannot be reused after sales.") }}</small>
		</label>
		<fieldset>
			<legend>{{ __("Type") }}</legend>
			<label class="setup__choice"><input v-model="form.mode" type="radio" value="Cash" /> {{ __("Cash drawer") }}</label>
			<label class="setup__choice"><input v-model="form.mode" type="radio" value="Cashless" /> {{ __("Cashless (cards, transfers, orders)") }}</label>
		</fieldset>
		<label>{{ __("POS Profile") }}
			<select v-model="form.pos_profile" required data-test="caja-profile">
				<option value="" disabled>{{ __("Choose a profile") }}</option>
				<option v-for="profile in options?.profiles || []" :key="profile" :value="profile">{{ profile }}</option>
			</select>
			<small v-if="options && !options.profiles.length">{{ __("Add a permitted POS Profile to the store first.") }}</small>
		</label>
		<label v-if="form.mode === 'Cash'">{{ __("Drawer cash account") }}
			<select v-model="form.drawer_account" required data-test="caja-drawer">
				<option value="" disabled>{{ __("Choose this drawer's own account") }}</option>
				<option v-for="account in options?.drawer_accounts || []" :key="account.name" :value="account.name" :disabled="account.conflicts.length > 0 && account.name !== caja?.drawer_account">
					{{ account.name }}{{ account.conflicts.length && account.name !== caja?.drawer_account ? ` — ${__("in use")}` : "" }}
				</option>
			</select>
			<small>{{ __("Each cash caja needs its own ledger account. Accounts already used by another drawer, safe or payment method are unavailable.") }}</small>
		</label>
		<label v-if="form.mode === 'Cash' && options?.safes.length">{{ __("Default safe (optional)") }}
			<select v-model="form.default_safe">
				<option value="">{{ __("None") }}</option>
				<option v-for="safe in options.safes" :key="safe.name" :value="safe.name">{{ safe.title || safe.name }}</option>
			</select>
		</label>
		<label class="setup__choice"><input v-model="form.requires_enrolled_device" type="checkbox" /> {{ __("Only a connected device may open this caja") }}</label>
		<div v-if="error" class="setup__error" role="alert">
			<p>{{ error.message }}</p>
			<small v-if="error.correlationId">{{ __("Reference") }} {{ error.correlationId }}</small>
		</div>
		<div class="setup__actions">
			<button class="setup__primary" type="submit" :disabled="saving" data-test="caja-save">{{ saving ? __("Saving…") : caja ? __("Save changes") : __("Save as draft") }}</button>
			<button type="button" @click="emit('cancel')">{{ __("Cancel") }}</button>
		</div>
		<p class="setup__hint">{{ caja ? "" : __("New cajas start as drafts. Connect a device and activate it when every requirement is met.") }}</p>
	</form>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { commandError, configureCaja, createCaja, setupOptions, type CajaDetail, type CommandError, type SetupOptions } from "./foundationApi";

const props = defineProps<{ store: string; caja?: CajaDetail | null }>();
const emit = defineEmits<{ (_e: "saved", _value: CajaDetail): void; (_e: "cancel"): void }>();
const __ = (text: string) => (window as any).__?.(text) || text;
const options = ref<SetupOptions | null>(null);
const loadError = ref("");
const error = ref<CommandError | null>(null);
const saving = ref(false);
const form = reactive({
	label: props.caja?.label || "",
	register_code: props.caja?.register_code || "",
	mode: props.caja?.mode || "Cash",
	pos_profile: props.caja?.pos_profile || "",
	drawer_account: props.caja?.drawer_account || "",
	default_safe: props.caja?.default_safe || "",
	requires_enrolled_device: props.caja ? props.caja.requires_enrolled_device : true,
});

async function loadOptions() {
	loadError.value = "";
	try {
		options.value = await setupOptions(props.store);
		if (!form.pos_profile && options.value.profiles.length === 1) form.pos_profile = options.value.profiles[0] ?? "";
	} catch (err) {
		loadError.value = commandError(err).message;
	}
}

async function save() {
	saving.value = true;
	error.value = null;
	const values: Record<string, unknown> = {
		label: form.label, pos_profile: form.pos_profile, mode: form.mode,
		drawer_account: form.mode === "Cash" ? form.drawer_account || null : null,
		default_safe: form.mode === "Cash" ? form.default_safe || null : null,
		requires_enrolled_device: form.requires_enrolled_device ? 1 : 0,
	};
	try {
		// Entered values stay in the form on any refusal, including revision conflicts.
		const result = props.caja
			? await configureCaja(props.caja.name, props.caja.revision, values)
			: await createCaja(props.store, { ...values, register_code: form.register_code });
		emit("saved", result);
	} catch (err) {
		error.value = (err as CommandError)?.message ? (err as CommandError) : commandError(err);
	} finally {
		saving.value = false;
	}
}

onMounted(loadOptions);
</script>

<style scoped>
.setup { display: grid; gap: 14px; }
.setup h3 { margin: 0; }
.setup label, .setup fieldset { display: grid; gap: 4px; font-weight: 600; min-width: 0; }
.setup fieldset { border: 1px solid var(--pos-border); border-radius: 10px; padding: 8px 12px; }
.setup small, .setup__hint { color: var(--pos-text-secondary); font-weight: 400; font-size: 13px; margin: 0; }
.setup input:not([type="radio"]):not([type="checkbox"]), .setup select, .setup button { min-height: 44px; padding: 10px 14px; border: 1px solid var(--pos-border); border-radius: 10px; background: var(--pos-card-bg); color: inherit; font: inherit; width: 100%; max-width: 100%; box-sizing: border-box; }
.setup button { width: auto; cursor: pointer; font-weight: 600; }
.setup button.setup__primary { background: var(--reg-accent, #0097a7); color: var(--reg-on-accent, #fff); border-color: transparent; }
.setup :is(button, select, input):focus-visible { outline: 3px solid var(--reg-accent, #0097a7); outline-offset: 3px; }
.setup .setup__choice { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
.setup .setup__choice input { width: 22px; height: 22px; }
.setup__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.setup__actions button { flex: 1 1 140px; }
.setup__error { border: 1px solid var(--reg-tone-warning-border, #e8c888); background: var(--reg-tone-warning-bg, #fff6e7); color: var(--reg-tone-warning-label, #754600); border-radius: 12px; padding: 10px 12px; margin: 0; }
.setup__error p { margin: 0; }
</style>
