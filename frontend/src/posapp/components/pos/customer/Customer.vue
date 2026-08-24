<template>
	<!-- ? Disable dropdown if either readonly or loadingCustomers is true -->
	<div class="customer-input-wrapper">
		<div class="customer-control-row">
			<!-- Nothing interactive lives inside the field any more, so a tap
			     anywhere on this box opens the list with the caret in it. Four
			     44px glyphs used to eat the whole input at phone width and the
			     clear-x was the only thing a cashier could reliably hit — which
			     is how "tap the x to search" became fleet folklore. -->
			<div class="customer-field-shell" @click="onCustomerFieldClick">
				<v-autocomplete
					ref="customerDropdown"
					class="customer-autocomplete sleek-field pos-themed-input"
					density="compact"
					clearable
					variant="solo"
					color="primary"
					prepend-inner-icon="mdi-magnify"
					:label="customerFieldLabel"
					:placeholder="customerFieldPlaceholder"
					:loading="isCustomerSearchLocked"
					v-model="internalCustomer"
					:items="filteredCustomers"
					item-title="customer_name"
					item-value="name"
					:no-data-text="customerNoDataText"
					hide-details
					:customFilter="() => true"
					:disabled="effectiveReadonly || isCustomerSearchLocked"
					:menu-props="{ closeOnContentClick: false }"
					@update:menu="onCustomerMenuToggle"
					@update:modelValue="onCustomerChange"
					@update:search="onCustomerSearch"
					@keydown.enter="handleEnter"
					:virtual-scroll="true"
					:virtual-scroll-item-height="48"
				>
					<!-- The only thing still riding inside the field is the
					     load readout, which is not a control. -->
					<template #append-inner>
						<span v-if="showCustomerLoadProgress" class="customer-load-percent">
							{{ customerLoadPercent }}%
						</span>
					</template>

					<!-- Named actions at the top of the open list. A cashier who
					     opens the field to search now also meets the two things
					     the bare + and ⟳ glyphs never managed to announce. -->
					<template #prepend-item>
						<v-list-item class="customer-menu-action" @click="new_customer">
							<template #prepend>
								<v-icon color="primary">mdi-plus</v-icon>
							</template>
							<v-list-item-title>{{ __("New Customer") }}</v-list-item-title>
						</v-list-item>
						<v-list-item
							class="customer-menu-action"
							:disabled="!networkOnline"
							@click="reload_customers"
						>
							<template #prepend>
								<v-icon>mdi-reload</v-icon>
							</template>
							<v-list-item-title>{{ __("Reload customers") }}</v-list-item-title>
						</v-list-item>
						<v-divider class="customer-menu-divider" />
					</template>

					<!-- Dropdown display -->
					<template #item="{ props, item }">
						<v-list-item v-bind="props">
							<v-list-item-subtitle v-if="item.raw.customer_name !== item.raw.name">
								<div>ID: {{ item.raw.name }}</div>
							</v-list-item-subtitle>
							<v-list-item-subtitle v-if="item.raw.tax_id">
								<div>TAX ID: {{ item.raw.tax_id }}</div>
							</v-list-item-subtitle>
							<v-list-item-subtitle v-if="item.raw.email_id">
								<div>Email: {{ item.raw.email_id }}</div>
							</v-list-item-subtitle>
							<v-list-item-subtitle v-if="item.raw.mobile_no">
								<div>Mobile No: {{ item.raw.mobile_no }}</div>
							</v-list-item-subtitle>
							<v-list-item-subtitle v-if="item.raw.primary_address">
								<div>Primary Address: {{ item.raw.primary_address }}</div>
							</v-list-item-subtitle>
						</v-list-item>
					</template>
				</v-autocomplete>
				<v-progress-linear
					v-if="showCustomerLoadProgress"
					:model-value="customerLoadPercent"
					height="4"
					color="primary"
					class="customer-load-bar"
					rounded
				/>
			</div>

			<!-- Labelled twins of the two glyphs that used to sit in the field.
			     Edit only exists while there is something to edit. -->
			<div class="customer-quick-actions">
				<v-btn
					class="customer-action-btn customer-action-btn--new"
					variant="tonal"
					color="primary"
					prepend-icon="mdi-plus"
					@click="new_customer"
				>
					{{ __("New Customer") }}
				</v-btn>
				<v-btn
					v-if="hasSelectedCustomer"
					class="customer-action-btn customer-action-btn--edit"
					variant="outlined"
					prepend-icon="mdi-account-edit"
					@click="edit_customer"
				>
					{{ __("Edit") }}
				</v-btn>
			</div>
		</div>

		<!-- Update customer modal. It teleports, so the host contributes no
		     layout — the old mt-4 spacer was 16px of nothing. -->
		<UpdateCustomer class="customer-dialog-host" />
	</div>
</template>

<style scoped>
.customer-input-wrapper {
	width: 100%;
	max-width: 100%;
	padding-right: 1.5rem;
	/* Elegant space at the right edge */
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	position: relative;
}

/* Field and its labelled actions share one line while there is room for
   both and wrap to two lines when there is not. The field never gives up
   width to the buttons on a phone — that squeeze is the whole bug. */
.customer-control-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	width: 100%;
}

.customer-autocomplete {
	width: 100%;
	box-sizing: border-box;
	border-radius: 12px;
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
	transition: box-shadow 0.3s ease;
	background-color: var(--pos-input-bg);
}

.customer-field-shell {
	position: relative;
	flex: 1 1 220px;
	min-width: 180px;
	/* The shell, not only the input, is what opens the search. */
	cursor: pointer;
}

.customer-load-bar {
	position: absolute;
	left: 10px;
	right: 10px;
	bottom: 6px;
	z-index: 2;
	opacity: 0.95;
}

.customer-load-percent {
	font-size: 0.72rem;
	font-weight: 700;
	margin-right: 8px;
	color: rgb(var(--v-theme-primary));
	min-width: 42px;
	text-align: right;
}

.customer-autocomplete:hover {
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

/* Theme-aware internal field colors */
.customer-autocomplete :deep(.v-field__input),
.customer-autocomplete :deep(input),
.customer-autocomplete :deep(.v-label) {
	color: var(--pos-text-primary) !important;
}

.customer-autocomplete :deep(.v-field__overlay) {
	background-color: var(--pos-input-bg) !important;
}

/* The two glyphs that used to live in the field, with their names
   attached. Icon-only + and pencil taught no cashier on the fleet what
   they did — Marco had to tell every one of them by hand. */
.customer-quick-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 0 0 auto;
}

.customer-action-btn {
	min-height: 36px;
	/* Uppercase costs ~15% width in Spanish and reads as a shout on a
	   control the cashier meets on every sale. */
	text-transform: none;
	letter-spacing: 0.01em;
	font-weight: 600;
}

.customer-action-btn--edit {
	color: var(--pos-text-primary);
	border-color: var(--pos-border);
}

/* Menu rows carry the same two actions inside the open list. theme.css
   owns overlay text colour (`.v-overlay__content .v-list-item-title`,
   with !important), so only the box is set here. */
.customer-menu-action {
	min-height: 48px;
}

.customer-menu-divider {
	margin-bottom: 4px;
}

/* The dialog teleports; neutralise the v-row's -12px so the host adds
   nothing to the column. */
.customer-dialog-host {
	margin: 0;
}

/* Touch: the field is the tap target now. Emptying it of controls is
   what buys the hit area — the 44px floor that theme.css used to hand
   the three glyphs was the thing squeezing the input to nothing. */
@media (pointer: coarse) {
	.customer-autocomplete :deep(.v-field) {
		min-height: 48px;
	}

	.customer-action-btn {
		min-height: 44px;
	}
}

@media (max-width: 599px) {
	/* Once the row has wrapped, the two labelled buttons split the width
	   rather than huddling against the left edge. */
	.customer-quick-actions {
		width: 100%;
	}

	.customer-action-btn {
		flex: 1 1 0;
	}
}

@media (max-width: 768px) {
	.customer-input-wrapper {
		padding-right: 0;
	}

	.customer-load-percent {
		min-width: 34px;
		margin-right: 4px;
	}
}
</style>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from "vue";
import { storeToRefs } from "pinia";
import _ from "lodash";
import UpdateCustomer from "../dialogs/customer/UpdateCustomer.vue";
// Extensionless, like Pos.vue and ItemsSelector.vue: these stores are .ts, and
// a literal `.js` specifier out of a plain-JS SFC block is unresolvable to
// vitest's transform — it is what kept this component un-mountable in a spec.
import { useCustomersStore } from "../../../stores/customersStore";
import { useOnlineStatus } from "../../../composables/core/useOnlineStatus";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";
import { ensureCustomersReady } from "../../../modules/customers/customerLoadingCoordinator";
import { registerUpdateCustomerHost } from "./updateCustomerHost";

export default {
	props: {
		pos_profile: Object,
	},
	components: {
		UpdateCustomer,
	},
	setup(props, { expose }) {
		const { proxy } = getCurrentInstance();
		const eventBus = proxy?.eventBus;
		const customersStore = useCustomersStore();
		const toastStore = useToastStore();
		const uiStore = useUIStore();
		const {
			customers,
			filteredCustomers,
			loadingCustomers,
			isCustomerBackgroundLoading,
			loadProgress,
			selectedCustomer,
			customerInfo,
		} = storeToRefs(customersStore);

		const internalCustomer = ref(null);
		const tempSelectedCustomer = ref(null);
		const isMenuOpen = ref(false);
		const customerDropdown = ref(null);
		const readonlyState = ref(false);

		let scrollContainer = null;

		const { isOnline: networkOnline } = useOnlineStatus();

		const effectiveReadonly = computed(() => readonlyState.value && networkOnline.value);
		const hasSelectedCustomer = computed(() => Boolean(selectedCustomer.value));
		const showCustomerLoadProgress = computed(
			() => loadingCustomers.value || isCustomerBackgroundLoading.value,
		);
		const isCustomerSearchLocked = computed(() => loadingCustomers.value && customers.value.length === 0);
		const customerLoadPercent = computed(() =>
			Math.max(0, Math.min(100, Math.round(loadProgress.value || 0))),
		);
		const customerFieldLabel = computed(() =>
			showCustomerLoadProgress.value
				? `${frappe._("Loading customers")} ${customerLoadPercent.value}%`
				: frappe._("Customer"),
		);
		const customerFieldPlaceholder = computed(() =>
			showCustomerLoadProgress.value
				? `${__("Loading customers...")} ${customerLoadPercent.value}%`
				: __("Search customer"),
		);
		const customerNoDataText = computed(() =>
			showCustomerLoadProgress.value
				? `${__("Loading customers...")} ${customerLoadPercent.value}%`
				: __("Customers not found"),
		);

		const formatCustomerMetric = (value) => {
			const numericValue = Number(value || 0);
			return new Intl.NumberFormat(undefined, {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
			}).format(numericValue);
		};

		const searchDebounce = _.debounce((term) => {
			customersStore.queueSearch(term || "");
		}, 300);

		const ensureCustomersForProfile = (profile) => {
			if (!profile) {
				return ensureCustomersReady({
					profile: null,
					online: networkOnline.value,
					manualOffline: false,
					setProfile: customersStore.setPosProfile,
					load: customersStore.get_customer_names,
				});
			}

			return ensureCustomersReady({
				profile,
				online: networkOnline.value,
				manualOffline: false,
				setProfile: customersStore.setPosProfile,
				load: customersStore.get_customer_names,
			});
		};

		watch(
			selectedCustomer,
			(value) => {
				if (!isMenuOpen.value) {
					internalCustomer.value = value || null;
				}
			},
			{ immediate: true },
		);

		watch(
			() => props.pos_profile,
			(profile) => {
				void ensureCustomersForProfile(profile);
			},
			{ immediate: true },
		);

		const detachScrollListener = () => {
			if (scrollContainer) {
				scrollContainer.removeEventListener("scroll", onCustomerScroll);
				scrollContainer = null;
			}
		};

		const onCustomerScroll = (event) => {
			const el = event.target;
			if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
				customersStore.loadMoreCustomers();
			}
		};

		const attachScrollListener = () => {
			const dropdown = customerDropdown.value?.$el?.querySelector(".v-overlay__content .v-select-list");
			if (dropdown) {
				scrollContainer = dropdown;
				scrollContainer.scrollTop = 0;
				scrollContainer.addEventListener("scroll", onCustomerScroll);
			}
		};

		const onCustomerMenuToggle = (isOpen) => {
			isMenuOpen.value = isOpen;
			if (isOpen) {
				internalCustomer.value = null;
				nextTick(() => {
					setTimeout(() => {
						attachScrollListener();
					}, 50);
				});
				return;
			}

			detachScrollListener();
			if (tempSelectedCustomer.value) {
				internalCustomer.value = tempSelectedCustomer.value;
				customersStore.setSelectedCustomer(tempSelectedCustomer.value);
			} else if (selectedCustomer.value) {
				internalCustomer.value = selectedCustomer.value;
			}
			tempSelectedCustomer.value = null;
		};

		const closeCustomerMenu = () => {
			const dropdown = customerDropdown.value;
			if (dropdown) {
				try {
					dropdown.menu = false;
				} catch {
					dropdown.$emit?.("update:menu", false);
				}
				const inputEl = dropdown.$el?.querySelector("input");
				if (inputEl) {
					inputEl.blur();
				}
			}
			isMenuOpen.value = false;
			detachScrollListener();
		};

		const onCustomerChange = (val) => {
			if (val && val === selectedCustomer.value) {
				internalCustomer.value = selectedCustomer.value;
				toastStore.show({
					title: __("Customer already selected"),
					color: "error",
				});
				return;
			}

			tempSelectedCustomer.value = val;

			if (isMenuOpen.value && val) {
				closeCustomerMenu();
			} else if (!isMenuOpen.value && val) {
				customersStore.setSelectedCustomer(val);
			}
		};

		const onCustomerSearch = (value) => {
			if (isCustomerSearchLocked.value) {
				return;
			}
			const term = value || "";
			searchDebounce(term);
		};

		const handleEnter = (event) => {
			const inputText = event.target.value?.toLowerCase() || "";
			const matched = customers.value.find((cust) => {
				return (
					cust.customer_name?.toLowerCase().includes(inputText) ||
					cust.name?.toLowerCase().includes(inputText)
				);
			});

			if (!matched) {
				return;
			}

			tempSelectedCustomer.value = matched.name;
			internalCustomer.value = matched.name;
			customersStore.setSelectedCustomer(matched.name);
			closeCustomerMenu();
			if (event?.target?.blur) {
				event.target.blur();
			}
		};

		const new_customer = () => {
			// Reachable from the open list as well as from the button, so the
			// menu has to get out of the dialog's way first.
			if (isMenuOpen.value) {
				closeCustomerMenu();
			}
			customersStore.openUpdateCustomerDialog(null);
		};

		const edit_customer = () => {
			customersStore.openUpdateCustomerDialog(customerInfo.value || {});
		};

		const reload_customers = async () => {
			if (!networkOnline.value) return;
			await customersStore.reloadCustomers();
		};

		const selectFirstCustomer = () => {
			const list =
				filteredCustomers.value && filteredCustomers.value.length
					? filteredCustomers.value
					: customers.value;

			if (!list || !list.length) {
				return;
			}

			const first = list[0];
			tempSelectedCustomer.value = first.name;
			internalCustomer.value = first.name;
			customersStore.setSelectedCustomer(first.name);
			closeCustomerMenu();
		};

		const openNewCustomer = () => {
			new_customer();
		};

		const focusCustomerSearch = async () => {
			const dropdown = customerDropdown.value;
			if (!dropdown) {
				return;
			}

			try {
				dropdown.menu = true;
			} catch {
				dropdown.$emit?.("update:menu", true);
			}

			isMenuOpen.value = true;

			if (typeof dropdown.focus === "function") {
				dropdown.focus();
			}

			await nextTick();

			const inputEl = dropdown.$el?.querySelector("input");
			if (inputEl) {
				inputEl.focus();
				inputEl.select?.();
			}
		};

		// A tap anywhere on the field's box is a search. Vuetify already opens
		// the menu from a mousedown on the control, but the label, the
		// magnifier and the shell's own padding are outside that box, and
		// those are exactly the places a thumb lands.
		const onCustomerFieldClick = () => {
			if (effectiveReadonly.value || isCustomerSearchLocked.value) {
				return;
			}
			// Never fight the close: reopening here would make the field
			// impossible to dismiss with a second tap.
			if (isMenuOpen.value) {
				return;
			}
			void focusCustomerSearch();
		};

		expose({ focusCustomerSearch, selectFirstCustomer, openNewCustomer });

		const busHandlers = [];

		const registerBus = (event, handler) => {
			if (eventBus && typeof eventBus.on === "function") {
				eventBus.on(event, handler);
				busHandlers.push({ event, handler });
			}
		};

		// This component is the app's HOST for the update-customer dialog — the
		// `<UpdateCustomer>` at the bottom of the template. Declaring it lets a
		// caller that needs the dialog (the contact view's «Editar datos») know
		// whether to mount its own copy or simply raise the store flag, instead
		// of guessing and getting either two dialogs or none. Registered in
		// setup rather than in `onMounted`, which is async here and would leave
		// a window where the host exists but has not said so.
		onBeforeUnmount(registerUpdateCustomerHost());

		onMounted(async () => {
			await customersStore.searchCustomers("");

			watch(
				// Drop deep:true — react to profile reassignment only.
				() => uiStore.posProfile,
				async (profile) => {
					await ensureCustomersForProfile(profile);
				},
				{ immediate: true },
			);

			// Locks the customer selector while a return invoice is loaded —
			// the returns flow emits true on load, false on clear. The
			// listener was lost in the Composition-API refactor and returns
			// silently allowed customer switching until 2026-08-09.
			registerBus("set_customer_readonly", (value) => {
				readonlyState.value = Boolean(value);
			});
		});

		onBeforeUnmount(() => {
			busHandlers.forEach(({ event, handler }) => {
				eventBus?.off(event, handler);
			});
			searchDebounce.cancel();
			detachScrollListener();
		});

		return {
			customerDropdown,
			filteredCustomers,
			loadingCustomers,
			isCustomerBackgroundLoading,
			showCustomerLoadProgress,
			isCustomerSearchLocked,
			customerLoadPercent,
			customerFieldLabel,
			customerFieldPlaceholder,
			customerNoDataText,
			internalCustomer,
			effectiveReadonly,
			hasSelectedCustomer,
			onCustomerFieldClick,
			onCustomerMenuToggle,
			onCustomerChange,
			onCustomerSearch,
			handleEnter,
			new_customer,
			edit_customer,
			selectFirstCustomer,
			openNewCustomer,
			focusCustomerSearch,
			reload_customers,
			networkOnline,
			customerInfo,
			formatCustomerMetric,
		};
	},
};
</script>
