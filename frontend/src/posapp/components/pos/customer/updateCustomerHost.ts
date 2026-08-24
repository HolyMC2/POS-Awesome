/**
 * Who is currently HOSTING the update-customer dialog.
 *
 * `UpdateCustomer.vue` is driven by one store flag (`isUpdateCustomerDialogOpen`)
 * and drawn by whichever component happens to have mounted it. On the desktop
 * sale that is `Customer.vue`, reached through `InvoiceCustomerSection` — which
 * is mounted with `v-show`, so it is in the DOM even while «Sale details» is
 * collapsed. The mobile sale screen has no such host at all.
 *
 * That asymmetry is why this counter exists. A caller like the contact view
 * cannot simply mount its own copy: on desktop BOTH copies would answer the
 * same flag and the operator would get two identical dialogs stacked on each
 * other. Nor can it simply raise the flag and hope: on a phone there would be
 * nobody listening, and «Editar datos» would be a button that does nothing —
 * which is the failure mode a counter cannot diagnose and will not report.
 *
 * So a host declares itself while it is mounted, and a caller that needs the
 * dialog to exist asks first. One line each side, and neither has to know
 * about the other.
 *
 * A plain module-level ref rather than a store: this is a fact about what is
 * on screen right now, not application state anybody persists, restores or
 * inspects — the same reasoning `crmService` applies to its session probe.
 */
import { computed, ref, type ComputedRef } from "vue";

const hosts = ref(0);

/**
 * Declare this component a host for the duration of its life. Returns the
 * release function, so a caller wires it in two lines:
 *
 *     const release = registerUpdateCustomerHost();
 *     onBeforeUnmount(release);
 *
 * Release is idempotent — an `onBeforeUnmount` that fires twice (HMR does it)
 * must not drive the count negative and leave the app believing there is no
 * host while one is on screen.
 */
export function registerUpdateCustomerHost(): () => void {
	hosts.value += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		hosts.value = Math.max(0, hosts.value - 1);
	};
}

/** True while some component on screen is drawing the dialog. */
export const updateCustomerHasHost: ComputedRef<boolean> = computed(() => hosts.value > 0);

/** Forget what is mounted. Exported for tests, which mount nothing. */
export function resetUpdateCustomerHosts(): void {
	hosts.value = 0;
}
