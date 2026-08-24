<template>
	<v-dialog v-model="open" fullscreen :scrim="false" transition="dialog-bottom-transition">
		<v-card class="cliente-view pos-themed-card" data-testid="cliente-view">
			<!-- The surface header. This view opens OVER the sale, one tap from
			     the customer strip, and «volver» closes back onto the same
			     ticket — nothing about the cart is touched in between. -->
			<header class="cliente-view__head">
				<button
					type="button"
					class="cliente-view__back"
					data-testid="cliente-view-back"
					:aria-label="__('Back to sale')"
					@click="open = false"
				>
					<v-icon icon="mdi-chevron-left" size="20" />
				</button>

				<div class="cliente-view__identity">
					<span class="cliente-view__name" data-testid="cliente-view-name">{{ displayName }}</span>
					<span v-if="subline" class="cliente-view__subline" data-testid="cliente-view-subline">{{
						subline
					}}</span>
				</div>

				<span v-if="phone" class="cliente-view__chip mono" data-testid="cliente-view-phone">{{
					phone
				}}</span>

				<!-- Absence, not zeros: a register with no card programme says
				     nothing here rather than «Sin tarjeta», which would read as
				     a state this shop can change. -->
				<span
					v-if="cardChip"
					class="cliente-view__chip"
					:class="{ 'cliente-view__chip--card': wallet?.enrolled }"
					data-testid="cliente-view-card-chip"
					>{{ cardChip }}</span
				>

				<!-- The CRM strip, whole. It already draws the back office's
				     facts about this customer AND «Seguimiento», it already
				     gates itself on a session probe, and re-reading its data
				     here would be a second request for the same answer. -->
				<CustomerCrmStrip v-if="contactable" class="cliente-view__crm" />

				<div class="cliente-view__spacer" />

				<button
					type="button"
					class="cliente-view__chip cliente-view__chip--action"
					data-testid="cliente-view-edit"
					@click="editDetails"
				>
					{{ __("Edit details") }}
				</button>
			</header>

			<!-- «Público en General» is the register's DEFAULT customer, not a
			     person: a file on it would show one shop's whole counter
			     traffic under one name. The refusal names the next safe act. -->
			<div v-if="!contactable" class="cliente-view__refusal" data-testid="cliente-view-refusal">
				<!-- An icon already in `mdiIconPaths`. The app ships SVG paths, not
				     the webfont, so an unregistered name draws nothing at all —
				     and the registry is a shared generated file two other tasks
				     are writing to this week. -->
				<v-icon icon="mdi-account-outline" size="34" class="cliente-view__refusal-icon" />
				<h2 class="cliente-view__refusal-title">{{ __("The walk-in customer is not a contact.") }}</h2>
				<p class="cliente-view__refusal-body">{{ __("Choose a customer on the ticket first.") }}</p>
				<v-btn variant="flat" color="primary" @click="open = false">{{ __("Back to sale") }}</v-btn>
			</div>

			<div v-else class="cliente-view__body">
				<aside v-if="wallet" class="cliente-view__aside">
					<ClienteWallet
						:wallet="wallet"
						:customer="customerId"
						:customer-label="displayName"
						:company="company"
						:pos-profile="profileName"
						:tenders="tenders"
						:format-currency="formatCurrency"
						@refresh="loadWallet"
					/>
				</aside>

				<ClienteStory
					class="cliente-view__story"
					:customer="customerId"
					:pos-profile="profileName"
					:format-currency="formatCurrency"
				/>
			</div>

			<!-- «Editar datos» raises ONE store flag, and whoever has mounted
			     the editor answers it. On the desktop sale that is already
			     `Customer.vue`, through the Sale details disclosure; the mobile
			     sale screen mounts no such host, and there this view supplies
			     one. Mounting unconditionally would give the desktop two
			     identical dialogs on the same flag — see `updateCustomerHost`. -->
			<UpdateCustomer v-if="editorMounted" />
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * «Cliente» — one surface answering «¿quién es esta persona y qué tiene con
 * nosotros?» (`CUSTOMER_CARDS_GOLDEN_FLOW.md` §3, artboard `Cliente.dc.html`).
 *
 * ## Why a fullscreen dialog and not a rail destination
 *
 * The rail is a list of PLACES a register goes — Venta, Explorar, Salón,
 * Corte. Every one of them means something with an empty cart and no customer,
 * and every one of them is reachable at any moment. This is not one of those:
 * it is about the person on the current ticket, it is meaningless without one,
 * and the artboard says so in its own comment — "this view opens OVER the
 * sale, one tap from the customer strip, and closes back to it".
 *
 * A rail entry would have put a permanently visible destination on every
 * register for a screen that is empty most of the time, and `destinationRail`
 * would then have needed a gate for "no customer chosen" that no other
 * destination has. A fullscreen dialog opened from the strip gives the
 * artboard's full-stage feel, one tap in and one tap back, and touches neither
 * `Pos.vue` nor the rail — which also means a register that never opens it
 * pays nothing for it, because `CustomerStrip` mounts this chunk lazily on the
 * first open exactly as it already does for «historial».
 *
 * ## What is gated on what
 *
 * The view exists for EVERY register: the story and the CRM strip need no
 * programme and no flag. The monedero card is the part that needs both
 * `posa_use_customer_cards` AND an endpoint that answers — and when either is
 * missing the card is simply not drawn. §5 of the golden flow is explicit that
 * a register without the flags gets "no wallet card … and no dead links to any
 * of it"; a card that rendered zeros, or a «Depositar» that threw, would be
 * exactly the dead link it forbids.
 */
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import { useFormat } from "../../../format";
import { useCustomersStore } from "../../../stores/customersStore";
import { useUIStore } from "../../../stores/uiStore";
import ClienteStory from "./ClienteStory.vue";
import ClienteWallet from "./ClienteWallet.vue";
import { isContactableCustomer, type CustomerWallet } from "./customerCard";
import { fetchCustomerWallet } from "./customerCardService";
import { updateCustomerHasHost } from "./updateCustomerHost";

// Async and mounted with the view rather than eagerly: the strip's own copy is
// a different instance with a different lifetime, and this one has to ASK
// before it can know whether to draw anything.
const CustomerCrmStrip = defineAsyncComponent(() => import("./CustomerCrmStrip.vue"));
// Only ever reached on a layout with no editor of its own — see `editorMounted`
// and the template comment beside it. Async so the desktop, which never needs
// it, does not carry the form's chunk into this view.
const UpdateCustomer = defineAsyncComponent(
	() => import("../dialogs/customer/UpdateCustomer.vue"),
);

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const customersStore = useCustomersStore();
const uiStore = useUIStore();
const { selectedCustomer, customerInfo } = storeToRefs(customersStore);
const { posProfile } = storeToRefs(uiStore);
const { formatCurrency } = useFormat();

const open = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const wallet = ref<CustomerWallet | null>(null);

const info = computed(() => (customerInfo.value ?? {}) as Record<string, unknown>);

const text = (key: string): string => {
	const value = info.value[key];
	return typeof value === "string" ? value.trim() : "";
};

/** The customer ID, which is what every endpoint takes — not the display name. */
const customerId = computed(() => selectedCustomer.value || text("name") || "");
const displayName = computed(() => text("customer_name") || customerId.value || __("Customer"));
const phone = computed(() => text("mobile_no"));

const profileName = computed(() => String(posProfile.value?.name ?? ""));
const company = computed(() => String(posProfile.value?.company ?? ""));

const contactable = computed(() =>
	isContactableCustomer(customerId.value, posProfile.value?.customer as string | undefined),
);

/**
 * «cliente desde mar 2025 · Escuinapa».
 *
 * The territory is on the payload; the SINCE half is not — `get_customer_info`
 * has never returned `Customer.creation`, and inventing a date on a screen
 * whose whole job is to be trusted about this person would be the same defect
 * `CustomerStrip` refuses for its own purchase provenance. So the half that
 * exists renders and the half that does not is absent, and the moment
 * `customers.py` adds `creation` this line grows the phrase with no change
 * here. The one-line server change is in this task's report.
 */
const subline = computed(() => {
	const parts: string[] = [];
	const since = text("creation");
	if (since) parts.push(__("Customer since {0}").replace("{0}", since.split(" ")[0] ?? since));
	const territory = text("territory");
	if (territory) parts.push(territory);
	return parts.join(" · ");
});

const cardChip = computed(() => {
	if (!wallet.value) return "";
	return wallet.value.enrolled ? __("Active card") : __("No card");
});

const cardsEnabled = computed(() => Boolean(posProfile.value?.posa_use_customer_cards));

/** Mode-of-payment names from the profile — the only tenders a deposit may use. */
const tenders = computed(() => {
	const rows = posProfile.value?.payments;
	if (!Array.isArray(rows)) return [];
	return rows
		.map((row: Record<string, unknown>) => String(row?.mode_of_payment ?? "").trim())
		.filter((mode: string) => mode.length > 0);
});

/**
 * Read the wallet, or leave it absent.
 *
 * `fetchCustomerWallet` never throws — see its module header. A register with
 * no endpoint, no programme, no company or a refusal all land on the same
 * `null`, and `null` means the card is not drawn. The story column and the CRM
 * strip do not go through here and keep working either way, which is the whole
 * reason this view is worth opening on a shop with no cards at all.
 */
async function loadWallet() {
	if (!cardsEnabled.value || !contactable.value || !company.value) {
		wallet.value = null;
		return;
	}
	wallet.value = await fetchCustomerWallet(customerId.value, company.value);
}

/**
 * Whether THIS view has to draw the editor.
 *
 * Read once, when «Editar datos» is first pressed, and then latched: the
 * answer must not flip while the dialog is open — the sale's own host is
 * mounted with `v-show` and could in principle unmount underneath it — and a
 * component that appeared or vanished mid-edit would take the operator's
 * half-typed form with it.
 */
const editorMounted = ref(false);

function editDetails() {
	if (!updateCustomerHasHost.value) editorMounted.value = true;
	// The existing editor, opened through the store exactly as `Customer.vue`
	// and the payments path already do. Passing the current customer opens the
	// EDIT form; `null` would open a blank new-customer form and lose the
	// person whose file is on screen.
	customersStore.openUpdateCustomerDialog(info.value as never);
}

// Read on every open rather than caching: the balance changes while the
// register is open — this very sale is about to change it — and a cached one
// would be wrong in the direction that matters, with the customer standing
// there.
watch(
	() => [props.modelValue, customerId.value, company.value, cardsEnabled.value] as const,
	([isOpen]) => {
		if (isOpen) void loadWallet();
	},
	{ immediate: true },
);
</script>

<style scoped>
.cliente-view {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: var(--reg-surface-sunken, #f8f9fa);
	border-radius: 0;
}

.cliente-view__head {
	display: flex;
	align-items: center;
	gap: var(--reg-space-lg, 14px);
	flex: none;
	flex-wrap: wrap;
	min-height: 56px;
	padding: 8px 18px;
	background: var(--reg-surface, #fff);
	border-bottom: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.07));
}

.cliente-view__back {
	flex: none;
	display: grid;
	place-items: center;
	width: 34px;
	height: 34px;
	border: 0;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #5c6673);
	cursor: pointer;
}

.cliente-view__back:hover,
.cliente-view__back:focus-visible {
	color: var(--reg-text-primary, #212121);
}

.cliente-view__identity {
	display: flex;
	flex-direction: column;
	line-height: 1.2;
	min-width: 0;
}

.cliente-view__name {
	font-size: 0.95rem;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cliente-view__subline {
	font-size: 0.7rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-view__chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	flex: none;
	border: 0;
	border-radius: 999px;
	padding: 3px 9px;
	font: inherit;
	font-size: 0.72rem;
	font-weight: 500;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
}

/* The card state is the one chip on this row that is a STATE rather than a
 * fact, so it is the one that carries a tint — the pale accent wash, never the
 * saturated accent, which on this surface belongs to «Depositar» alone. */
.cliente-view__chip--card {
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.cliente-view__chip--action {
	cursor: pointer;
}

.cliente-view__chip--action:hover,
.cliente-view__chip--action:focus-visible {
	color: var(--reg-text-primary, #212121);
}

.cliente-view__crm {
	flex: 0 1 auto;
	min-width: 0;
}

.cliente-view__spacer {
	flex: 1 1 auto;
}

.cliente-view__body {
	flex: 1 1 auto;
	display: flex;
	gap: 12px;
	padding: 16px;
	min-height: 0;
}

.cliente-view__aside {
	width: 400px;
	flex: none;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.cliente-view__story {
	flex: 1;
	min-width: 0;
}

/* Under the flows sheets' own fullscreen floor the two columns stop being two
 * columns: 400px of wallet beside a timeline leaves the timeline unreadable
 * long before the viewport gets narrow enough for Vuetify to care. */
@media (max-width: 1100px) {
	.cliente-view__body {
		flex-direction: column;
		overflow-y: auto;
	}

	.cliente-view__aside {
		width: auto;
	}
}

.cliente-view__refusal {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	padding: 32px;
	text-align: center;
}

.cliente-view__refusal-icon {
	color: var(--reg-text-muted, #9aa2ae);
}

.cliente-view__refusal-title {
	margin: 0;
	font-size: 1.1rem;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cliente-view__refusal-body {
	margin: 0 0 8px;
	max-width: 46ch;
	font-size: 0.84rem;
	line-height: 1.5;
	color: var(--reg-text-muted, #667085);
}

.mono {
	font-variant-numeric: tabular-nums;
}
</style>
