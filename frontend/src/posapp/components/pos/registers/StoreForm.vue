<template>
	<form class="setup" data-test="store-form" @submit.prevent="save">
		<h3>{{ __("New store") }}</h3>
		<p class="setup__hint">{{ __("A store is a physical location with its own cajas. It is not created from a warehouse or profile name.") }}</p>
		<label>{{ __("Company") }}
			<select v-model="form.company" required>
				<option v-for="company in companies" :key="company" :value="company">{{ company }}</option>
			</select>
		</label>
		<label>{{ __("Store name") }}<input v-model.trim="form.store_name" required maxlength="120" :placeholder="__('Centro')" data-test="store-name" /></label>
		<label>{{ __("Short code") }}<input v-model.trim="form.store_code" required maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}" autocapitalize="characters" data-test="store-code" /></label>
		<label>{{ __("Timezone") }}<input v-model.trim="form.timezone" required maxlength="64" list="posa-store-timezones" /></label>
		<datalist id="posa-store-timezones"><option v-for="zone in zones" :key="zone" :value="zone" /></datalist>
		<label>{{ __("Business day starts at") }}<input v-model="form.business_day_cutoff" type="time" required /></label>
		<div v-if="error" class="setup__error" role="alert"><p>{{ error.message }}</p></div>
		<div class="setup__actions">
			<button class="setup__primary" type="submit" :disabled="saving">{{ saving ? __("Saving…") : __("Create store") }}</button>
			<button type="button" @click="emit('cancel')">{{ __("Cancel") }}</button>
		</div>
		<p class="setup__hint">{{ __("Add permitted warehouses and POS Profiles to the store in Desk before adding cajas.") }}</p>
	</form>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { createStore, type CommandError } from "./foundationApi";

const props = defineProps<{ companies: string[] }>();
const emit = defineEmits<{ (_e: "saved", _name: string): void; (_e: "cancel"): void }>();
const __ = (text: string) => (window as any).__?.(text) || text;
const zones = ["America/Mazatlan", "America/Mexico_City", "America/Tijuana", "America/Hermosillo", "America/Cancun", "America/Monterrey"];
const form = reactive({ company: props.companies[0] || "", store_name: "", store_code: "", timezone: "America/Mazatlan", business_day_cutoff: "00:00" });
const saving = ref(false);
const error = ref<CommandError | null>(null);

async function save() {
	saving.value = true;
	error.value = null;
	try {
		const result = await createStore({ ...form, warehouses: "[]", profiles: "[]" });
		emit("saved", result.name);
	} catch (err) {
		error.value = err as CommandError;
	} finally {
		saving.value = false;
	}
}
</script>

<style scoped>
.setup { display: grid; gap: 14px; }
.setup h3, .setup p { margin: 0; }
.setup label { display: grid; gap: 4px; font-weight: 600; min-width: 0; }
.setup__hint { color: var(--pos-text-secondary); font-size: 13px; }
.setup input, .setup select, .setup button { min-height: 44px; padding: 10px 14px; border: 1px solid var(--pos-border); border-radius: 10px; background: var(--pos-card-bg); color: inherit; font: inherit; width: 100%; max-width: 100%; box-sizing: border-box; }
.setup button { width: auto; cursor: pointer; font-weight: 600; }
.setup button.setup__primary { background: var(--reg-accent, #0097a7); color: var(--reg-on-accent, #fff); border-color: transparent; }
.setup :is(button, select, input):focus-visible { outline: 3px solid var(--reg-accent, #0097a7); outline-offset: 3px; }
.setup__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.setup__actions button { flex: 1 1 140px; }
.setup__error { border: 1px solid var(--reg-tone-warning-border, #e8c888); background: var(--reg-tone-warning-bg, #fff6e7); color: var(--reg-tone-warning-label, #754600); border-radius: 12px; padding: 10px 12px; }
</style>
