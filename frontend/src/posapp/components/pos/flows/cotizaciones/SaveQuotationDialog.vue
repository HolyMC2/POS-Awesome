<template>
	<v-dialog v-model="open" max-width="440" data-testid="save-quotation-dialog">
		<v-card class="save-quotation pos-themed-card">
			<v-card-title class="save-quotation__title">
				{{ __("Save quotation") }}
			</v-card-title>

			<v-card-text class="save-quotation__body">
				<p v-if="blocker" class="save-quotation__blocker" data-testid="save-quotation-blocker">
					{{ blocker }}
				</p>

				<template v-else>
					<div class="save-quotation__summary" data-testid="save-quotation-summary">
						<div class="save-quotation__pair">
							<span>{{ __("Customer") }}</span>
							<strong>{{ customerLabel }}</strong>
						</div>
						<div class="save-quotation__pair">
							<span>{{ __("Items") }}</span>
							<strong>{{ items.length }}</strong>
						</div>
					</div>

					<v-text-field
						v-model.number="validityDays"
						type="number"
						min="1"
						max="180"
						density="compact"
						variant="outlined"
						:label="__('Valid for (days)')"
						data-testid="save-quotation-validity"
					/>
					<v-textarea
						v-model="note"
						rows="2"
						density="compact"
						variant="outlined"
						:label="__('Note (optional)')"
						data-testid="save-quotation-note"
					/>
				</template>
			</v-card-text>

			<v-card-actions class="save-quotation__actions">
				<v-spacer />
				<v-btn variant="text" data-testid="save-quotation-cancel" @click="open = false">
					{{ __("Cancel") }}
				</v-btn>
				<v-btn
					color="primary"
					variant="flat"
					:disabled="Boolean(blocker) || saving"
					:loading="saving"
					data-testid="save-quotation-confirm"
					@click="save"
				>
					{{ __("Save quotation") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * «Guardar cotización» — the cart, as a promise with a folio.
 *
 * Mounted LAZILY by `NavbarMenu.vue` behind `v-if`, and raised by its quick
 * action or by the `open_save_quotation` bus event — so anything that can reach
 * the bus can offer the gesture. The artboard's preferred home is a button
 * beside «Guardar y Limpiar» in `InvoiceSummary.vue`; that file belongs to
 * another lane this round, and the exact hunk for it is in the round's report —
 * it emits the same event and needs nothing else.
 *
 * Lazy on purpose: this component reads the CART, so its `setup` constructs the
 * invoice store. Mounted eagerly it did that on every navbar render, in every
 * layout, whether or not the register even quotes — and in a spec with no
 * `frappe.datetime` stub it took the whole navbar down with it. The listener
 * that raises it lives on the navbar, which is already always mounted.
 *
 * The CART is read from the invoice store rather than passed in: this dialog is
 * mounted in the navbar, which has no cart of its own, and the store is where
 * the live lines already are. Only what the server needs is sent — the rates
 * included, because the negotiated price at the counter IS the promise.
 *
 * Refusals are the server's. The walk-in check is repeated here only to gray
 * the button and say why before the round trip; `create_quotation_from_cart`
 * asserts it again and is the authority.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import { createQuotationFromCart } from "../../../../services/quotationService";
import { useCustomersStore } from "../../../../stores/customersStore";
import { useInvoiceStore } from "../../../../stores/invoiceStore";
import { useToastStore } from "../../../../stores/toastStore";
import { useUIStore } from "../../../../stores/uiStore";
import { printInvoiceByName } from "../../../../utils/printInvoiceByName";

interface BusLike {
	emit: (_event: string, _payload?: unknown) => void;
	on: (_event: string, _handler: (_payload?: unknown) => void) => void;
	off: (_event: string, _handler?: (_payload?: unknown) => void) => void;
}

const props = defineProps<{ modelValue?: boolean; eventBus?: BusLike | null }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const uiStore = useUIStore();
const invoiceStore = useInvoiceStore();
const customersStore = useCustomersStore();
const toastStore = useToastStore();
const { posProfile } = storeToRefs(uiStore);

// Raised the moment it exists: the navbar mounts this only when the operator
// has asked for it, so "mounted" IS the open request — the same contract
// `useHostedSheet` states for the rail's sheets.
const open = ref(true);
const saving = ref(false);
const validityDays = ref<number>(7);
const note = ref("");

const items = computed(() => invoiceStore.items ?? []);
const customer = computed(() => customersStore.selectedCustomer ?? null);
const customerLabel = computed(
	() => customersStore.customerInfo?.customer_name || customer.value || "—",
);

/** The one sentence that stops the save, or empty when it can go ahead. */
const blocker = computed(() => {
	if (!items.value.length) {
		return __("Add at least one item before saving a quotation.");
	}
	const walkIn = posProfile.value?.customer;
	if (!customer.value) {
		return __("Choose a customer first — a quotation is a promise to someone.");
	}
	if (walkIn && customer.value === walkIn) {
		return __(
			"The counter customer cannot hold a quotation. Choose a real customer — a quotation is a promise to someone who can come back for it.",
		);
	}
	return "";
});

const openDialog = () => {
	validityDays.value =
		Number(posProfile.value?.posa_quotation_validity_days) > 0
			? Number(posProfile.value?.posa_quotation_validity_days)
			: 7;
	note.value = "";
	open.value = true;
};

async function save() {
	const profile = posProfile.value?.name;
	if (!profile || blocker.value || saving.value) return;
	saving.value = true;
	try {
		const created = await createQuotationFromCart({
			posProfile: profile,
			payload: {
				customer: customer.value as string,
				currency: posProfile.value?.currency ?? null,
				selling_price_list: posProfile.value?.selling_price_list ?? null,
				items: items.value.map((line: any) => ({
					item_code: line.item_code,
					item_name: line.item_name,
					description: line.description,
					qty: Number(line.qty) || 0,
					uom: line.uom,
					conversion_factor: Number(line.conversion_factor) || 1,
					rate: Number(line.rate) || 0,
					price_list_rate: Number(line.price_list_rate) || Number(line.rate) || 0,
					warehouse: line.warehouse,
				})),
			},
			validityDays: validityDays.value,
			note: note.value,
		});
		toastStore.show({
			title: __("Quotation saved"),
			message: `${created.name} · ${__("valid until")} ${created.valid_till}`,
			color: "success",
		});
		open.value = false;
		// The paper is the point — the customer leaves with the folio on it.
		await printInvoiceByName(posProfile.value, "Quotation", created.name);
		// The register goes back to empty: the promise is filed, and a cart left
		// standing is the next customer's sale started by accident.
		props.eventBus?.emit("clear_invoice");
	} catch (error) {
		const failure = error as { serverMessage?: string; message?: string } | null;
		toastStore.show({
			title: failure?.serverMessage || failure?.message || __("Could not save the quotation."),
			color: "error",
		});
	} finally {
		saving.value = false;
	}
}

watch(open, (isOpen) => {
	if (!isOpen) saving.value = false;
	// The navbar owns the `v-if`; lowering our own overlay has to tell it, or
	// the component stays mounted with nothing on screen and never reopens.
	emit("update:modelValue", isOpen);
});

// Re-raised while already mounted (a second press of the quick action) — the
// navbar's flag is already true, so only this side has to answer.
onMounted(() => {
	openDialog();
	props.eventBus?.on("open_save_quotation", openDialog);
});

onBeforeUnmount(() => {
	props.eventBus?.off("open_save_quotation", openDialog);
});

defineExpose({ openDialog });
</script>

<style scoped>
.save-quotation__title {
	font-size: 17px;
	font-weight: 700;
}

.save-quotation__body {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.save-quotation__blocker {
	margin: 0;
	padding: 10px 12px;
	border-radius: 10px;
	background: var(--reg-warn-soft, #fdf9f0);
	border: 1px solid var(--reg-warn-edge, #f0dcae);
	color: var(--reg-warn-ink, #6b4a10);
	font-size: 12.5px;
	line-height: 1.45;
}

.save-quotation__summary {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border-radius: 10px;
	background: var(--reg-surface-sunken, #fafbfc);
	border: 1px solid var(--reg-border-light, #eff2f5);
}

.save-quotation__pair {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	font-size: 12.5px;
}

.save-quotation__actions {
	padding: 8px 16px 16px;
}
</style>
