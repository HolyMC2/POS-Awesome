<script setup lang="ts">
// CI stub of saldo/public/saldo_pos/SaldoHoldsBadge.vue — see README.md.
// The real badge lives in the private saldo repo. This stub mirrors just the
// behaviour the auto-print regression test asserts
// (tests/saldoHoldsBadgeAutoPrint.spec.ts): stay inert while the POS profile
// is unloaded, then — on the enabled→true transition — arm an immediate
// `list_printable` poll plus an 8s fallback tick, emitting `saldo:hold_print`
// once per printable ticket. It renders nothing.
import { computed, watch, onUnmounted } from "vue";
import { saldoBus } from "./useSaldoCapture";

const props = defineProps<{ posProfile?: Record<string, any> | null }>();

const enabled = computed(() => !!props.posProfile?.saldo_enabled);

const printed = new Set<string>();
let armed = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function pollPrints(): Promise<void> {
	const frappe = (globalThis as any).frappe;
	if (!frappe?.call) return;
	const res = await frappe.call({ method: "saldo.api.holds.list_printable" });
	const list = (res?.message ?? []) as Array<{ invoice?: string; doctype?: string }>;
	for (const p of list) {
		if (p?.invoice && !printed.has(p.invoice)) {
			printed.add(p.invoice);
			saldoBus.emit("saldo:hold_print", { invoice: p.invoice, doctype: p.doctype ?? "" });
		}
	}
}

function arm(): void {
	if (armed) return;
	armed = true;
	void pollPrints();
	timer = setInterval(() => void pollPrints(), 8000);
}

// Arm on the enabled→true transition (immediate covers the profile-at-mount
// case; the watcher covers the profile-hydrates-after-mount boot order).
watch(enabled, (v) => {
	if (v) arm();
}, { immediate: true });

onUnmounted(() => {
	if (timer) clearInterval(timer);
});
</script>

<template>
	<span style="display: none" />
</template>
