<template>
	<v-row justify="center">
		<v-dialog v-model="isOpen" persistent v-bind="dialogProps">
			<v-card elevation="8" class="opening-dialog-card">
				<!-- Header Section - White Background with Blue Text -->
				<v-card-title class="opening-dialog-header">
					<div class="header-content">
						<div class="header-icon-wrapper">
							<v-icon class="header-icon">mdi-cash-plus</v-icon>
						</div>
						<div class="header-text">
							<h5 class="header-title">{{ __("Create POS Opening Shift") }}</h5>
							<p class="header-subtitle">
								{{ __("Initialize your shift with opening balances") }}
							</p>
						</div>
					</div>
				</v-card-title>

				<!-- Content Section - Optimized for minimal scrolling -->
				<v-card-text class="opening-dialog-content">
					<v-container class="pa-0">
						<v-row>
							<!-- Company and POS Profile in same row for space efficiency -->
							<v-col cols="12" md="6" class="form-field">
								<v-autocomplete
									:items="companies"
									:label="frappe._('Company')"
									v-model="company"
									required
									variant="outlined"
									color="primary"
									density="compact"
									prepend-inner-icon="mdi-domain"
									class="enhanced-field"
									:class="{ 'field-focused': company }"
								/>
							</v-col>

							<v-col cols="12" md="6" class="form-field">
								<v-autocomplete
									:items="pos_profiles"
									:label="frappe._('POS Profile')"
									v-model="pos_profile"
									required
									variant="outlined"
									color="primary"
									density="compact"
									prepend-inner-icon="mdi-point-of-sale"
									class="enhanced-field"
									:class="{ 'field-focused': pos_profile }"
								/>
							</v-col>

							<!-- Payment Methods Section - Compact -->
							<v-col cols="12">
								<div class="section-header-compact">
									<h6 class="section-title-compact">
										<v-icon class="section-icon">mdi-credit-card-multiple</v-icon>
										{{ __("Payment Methods") }}
									</h6>
								</div>

								<v-data-table
									:headers="payments_methods_headers"
									:items="payments_methods"
									item-key="mode_of_payment"
									class="enhanced-table-compact"
									:items-per-page="itemsPerPage"
									hide-default-footer
									density="compact"
									:height="'300px'"
									fixed-header
								>
									<template v-slot:item.amount="{ item }">
										<v-text-field
											v-model="item.amount"
											:rules="[max25chars]"
											type="number"
											inputmode="decimal"
											enterkeyhint="done"
											density="compact"
											variant="outlined"
											color="primary"
											hide-details
											:prefix="currencySymbol(item.currency)"
											class="amount-input"
										/>
									</template>
								</v-data-table>
							</v-col>
						</v-row>
					</v-container>
				</v-card-text>

				<!-- Actions Section -->
				<v-card-actions class="dialog-actions-container">
					<v-btn
						theme="dark"
						@click="logout"
						class="pos-action-btn logout-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-logout</v-icon>
						<span>{{ __("Logout") }}</span>
					</v-btn>
					<v-spacer />
					<v-btn
						theme="dark"
						@click="go_desk"
						class="pos-action-btn cancel-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-close-circle-outline</v-icon>
						<span>{{ __("Close") }}</span>
					</v-btn>
					<v-btn
						theme="dark"
						:disabled="is_loading"
						:loading="is_loading"
						@click="submit_dialog"
						class="pos-action-btn submit-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-check-circle-outline</v-icon>
						<span>{{ __("Submit") }}</span>
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import {
	getOpeningDialogStorage,
	setOpeningDialogStorage,
	setOpeningStorage,
	getBootstrapSnapshot,
	setBootstrapSnapshot,
	initPromise,
	checkDbHealth,
} from "../../../../offline/index";
import { createBootstrapSnapshotFromRegisterData } from "../../../../offline/bootstrapSnapshot";
import authService from "../../../services/authService";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";

defineOptions({
	name: "OpeningDialog",
});

const props = defineProps({
	dialog: Boolean,
});

const emit = defineEmits(["close", "register"]);
const __ = window.__ || ((text) => text);
const get_currency_symbol = window.get_currency_symbol;
const BUILD_VERSION = typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : null;

const isOpen = ref(props.dialog ? props.dialog : false);
const is_loading = ref(false);
// First screen of the shift: it has to be usable on the phone the cashier
// opened the till with, not an 800px card cropped to a 360px viewport.
const { dialogProps } = useDialogFullscreen({ maxWidth: "800px", maxHeight: "90vh" });
const companies = ref([]);
const company = ref("");
const pos_profiles_data = ref([]);
const pos_profiles = ref([]);
const pos_profile = ref("");
const payments_method_data = ref([]);
const payments_methods = ref([]);
const payments_methods_headers = [
	{
		title: __("Mode of Payment"),
		align: "start",
		sortable: false,
		value: "mode_of_payment",
	},
	{
		title: __("Opening Amount"),
		value: "amount",
		align: "center",
		sortable: false,
	},
];
const itemsPerPage = ref(100);
const max25chars = (v) => v.length <= 12 || "Input too long!";

const currencySymbol = (currency) => get_currency_symbol?.(currency);

watch(
	() => props.dialog,
	(val) => {
		isOpen.value = val ? val : false;
	},
);

watch(company, (val) => {
	pos_profiles.value = [];
	pos_profiles_data.value.forEach((element) => {
		if (element.company === val) {
			pos_profiles.value.push(element.name);
		}
		if (pos_profiles.value.length) {
			pos_profile.value = pos_profiles.value[0];
		} else {
			pos_profile.value = "";
		}
	});
});

watch(pos_profile, (val) => {
	payments_methods.value = [];
	payments_method_data.value.forEach((element) => {
		if (element.parent === val) {
			payments_methods.value.push({
				mode_of_payment: element.mode_of_payment,
				amount: 0,
				currency: element.currency,
			});
		}
	});
});

async function get_opening_dialog_data() {
	await initPromise;
	await checkDbHealth();

	// Load cached data first for offline usage
	const cached = getOpeningDialogStorage();
	if (cached) {
		try {
			companies.value = cached.companies.map((c) => c.name);
			pos_profiles_data.value = cached.pos_profiles_data || [];
			payments_method_data.value = cached.payments_method || [];
			company.value = companies.value[0] || "";
		} catch (e) {
			console.error("Failed to parse opening dialog cache", e);
		}
	}

	frappe.call({
		method: "posawesome.posawesome.api.shifts.get_opening_dialog_data",
		args: {},
		callback: function (r) {
			if (r.message) {
				companies.value = r.message.companies.map((element) => element.name);
				pos_profiles_data.value = r.message.pos_profiles_data;
				payments_method_data.value = r.message.payments_method;
				company.value = companies.value[0] || "";
				try {
					setOpeningDialogStorage(r.message);
				} catch (e) {
					console.error("Failed to cache opening dialog data", e);
				}
			}
		},
	});
}

function submit_dialog() {
	if (!payments_methods.value.length || !company.value || !pos_profile.value) {
		return;
	}

	is_loading.value = true;

	return frappe
		.call("posawesome.posawesome.api.shifts.create_opening_voucher", {
			pos_profile: pos_profile.value,
			company: company.value,
			balance_details: payments_methods.value,
		})
		.then((r) => {
			if (r.message) {
				emit("register", r.message);
				try {
					setOpeningStorage(r.message);
					setBootstrapSnapshot(
						createBootstrapSnapshotFromRegisterData(r.message, getBootstrapSnapshot(), {
							buildVersion: BUILD_VERSION,
						}),
					);
				} catch (e) {
					console.error("Failed to cache opening data", e);
				}
				// Close handles hiding the dialog, parent handles logic
				emit("close");
				is_loading.value = false;
			}
		});
}

function go_desk() {
	// /posapp has no Desk router — set_route("/") mapped to nothing and
	// location.reload() just re-entered the SPA, which re-opened this
	// dialog. Hard-navigate to Desk (/desk on v16; /app 301s there).
	window.location.href = "/desk";
}

function logout() {
	// 2026-05-26: /posapp is the canonical operator entry. After
	// re-login the user should land back inside the SPA shell, not
	// the Desk-shell legacy boot path (which now auto-redirects
	// to /posapp anyway, but skip the bounce).
	const redirectTarget = "/posapp";
	const loginPath = `/login?redirect-to=${encodeURIComponent(redirectTarget)}`;
	authService.logout().finally(() => {
		const loginUrl =
			frappe?.utils?.get_url?.(loginPath) ??
			(frappe?.urllib?.get_base_url?.() ? `${frappe.urllib.get_base_url()}${loginPath}` : loginPath);
		window.location.href = loginUrl;
	});
}

onMounted(() => {
	get_opening_dialog_data();
});
</script>

<style scoped>
/* Main Dialog Card */
.opening-dialog-card {
	border-radius: 16px;
	overflow: hidden;
	background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
	border: 1px solid rgba(25, 118, 210, 0.1);
	transition: all 0.3s ease;
	max-height: 90vh;
	display: flex;
	flex-direction: column;
}

/* Header Section - White Background with Blue Text */
.opening-dialog-header {
	background: white;
	color: #1976d2;
	padding: 16px 24px;
	border-bottom: 2px solid rgba(25, 118, 210, 0.1);
	flex-shrink: 0;
}

.header-content {
	display: flex;
	align-items: center;
	gap: 12px;
}

.header-icon-wrapper {
	background: rgba(25, 118, 210, 0.1);
	border-radius: 50%;
	padding: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.3s ease;
}

.header-icon {
	font-size: 20px;
	color: #1976d2;
}

.header-text {
	flex: 1;
}

.header-title {
	font-size: 1.3rem;
	font-weight: 600;
	margin: 0;
	line-height: 1.2;
	color: #1976d2;
}

.header-subtitle {
	font-size: 0.85rem;
	opacity: 0.8;
	margin: 2px 0 0 0;
	line-height: 1.3;
	color: #1976d2;
}

/* Content Section - Optimized for minimal scrolling */
.opening-dialog-content {
	padding: 20px 24px;
	background: white;
	flex: 1;
	overflow-y: auto;
}

.section-header-compact {
	margin-bottom: 12px;
}

.section-title-compact {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 1rem;
	font-weight: 600;
	color: #1976d2;
	margin-bottom: 0;
}

.section-icon {
	color: #1976d2;
	font-size: 18px;
}

/* Form Fields - Compact */
.form-field {
	margin-bottom: 12px;
}

.enhanced-field {
	transition: all 0.3s ease;
}

.enhanced-field:hover {
	transform: translateY(-1px);
}

.field-focused {
	background: rgba(25, 118, 210, 0.02);
	border-radius: 8px;
}

/* Enhanced Table - Compact */
.enhanced-table-compact {
	border-radius: 8px;
	overflow: hidden;
	box-shadow: 0 1px 8px rgba(0, 0, 0, 0.06);
	border: 1px solid rgba(25, 118, 210, 0.1);
}

.enhanced-table-compact :deep(.v-data-table__wrapper) {
	border-radius: 8px;
}

.enhanced-table-compact :deep(th) {
	background: linear-gradient(135deg, #f8f9fa 0%, #e3f2fd 100%);
	color: #1976d2;
	font-weight: 600;
	border-bottom: 1px solid rgba(25, 118, 210, 0.1);
	padding: 8px 12px;
}

.enhanced-table-compact :deep(td) {
	padding: 6px 12px;
}

.enhanced-table-compact :deep(tr:hover) {
	background: rgba(25, 118, 210, 0.04);
}

.currency-symbol {
	font-weight: 600;
	color: #1976d2;
	font-size: 0.9rem;
}

.amount-value {
	font-weight: 500;
	color: #333;
	font-size: 0.9rem;
}

.amount-input {
	margin-top: 4px;
}

.action-btn-revamped {
	padding: 16px 24px !important;
	border-radius: 12px !important;
	font-weight: 700 !important;
	text-transform: uppercase !important;
	letter-spacing: 1px !important;
	font-size: 1.3rem !important;
	transition: all 0.3s ease !important;
	position: relative;
	overflow: hidden;
	min-width: 180px !important;
	border: none !important;
}

.action-btn-revamped .v-icon {
	font-size: 1.8rem !important;
}

/* Responsive Design */
@media (max-width: 768px) {
	.opening-dialog-header {
		padding: 12px 16px;
	}

	.header-content {
		gap: 8px;
	}

	.header-title {
		font-size: 1.2rem;
	}

	.opening-dialog-content {
		padding: 16px;
	}
}

@media (max-width: 480px) {
	.header-content {
		flex-direction: column;
		text-align: center;
		gap: 8px;
	}

	.opening-dialog-content {
		padding: 12px;
	}
}

/* Under sm the dialog is fullscreen (useDialogFullscreen), so the card owns
   the viewport and its floating-card geometry has to give way. Three 120px
   actions plus a spacer do not fit one phone-width row either. */
@media (max-width: 599.98px) {
	.opening-dialog-card {
		max-height: 100%;
		border-radius: 0;
	}

	.dialog-actions-container {
		flex-wrap: wrap;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
	}

	.dialog-actions-container :deep(.v-spacer) {
		display: none;
	}

	.pos-action-btn {
		flex: 1 1 40%;
		min-width: 0;
		padding: 12px 16px;
	}
}

/* Animation Effects */
@keyframes slideInFromTop {
	from {
		opacity: 0;
		transform: translateY(-20px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

.opening-dialog-card {
	animation: slideInFromTop 0.4s ease-out;
}

/* Focus and Interaction States */
.enhanced-field :deep(.v-field--focused) {
	box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.enhanced-table-compact :deep(.v-data-table-row--clickable:hover) {
	background: rgba(25, 118, 210, 0.04) !important;
}

/* Enhanced focus states for form fields */
.enhanced-field :deep(.v-field--focused .v-field__outline) {
	border-color: rgba(25, 118, 210, 0.3) !important;
	border-width: 1px !important;
}

.enhanced-field :deep(.v-field--focused .v-field__overlay) {
	background: rgba(25, 118, 210, 0.02);
}

/* Action buttons with improved naming and styling */
.dialog-actions-container {
	background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
	border-top: 1px solid #e0e0e0;
	padding: 16px 24px;
	gap: 12px;
}

.pos-action-btn {
	border-radius: 12px;
	text-transform: none;
	font-weight: 600;
	padding: 12px 32px;
	min-width: 120px;
	transition: all 0.3s ease;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.pos-action-btn,
.pos-action-btn .v-icon,
.pos-action-btn span,
.pos-action-btn :deep(.v-btn__content) {
	color: white !important;
}

.cancel-action-btn {
	background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%) !important;
}

.cancel-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(211, 47, 47, 0.4);
}

.logout-action-btn {
	background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%) !important;
}

.logout-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(21, 101, 192, 0.4);
}

.submit-action-btn {
	background: linear-gradient(135deg, #388e3c 0%, #2e7d32 100%) !important;
}

.submit-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(46, 125, 50, 0.4);
}

.submit-action-btn:disabled {
	opacity: 0.6;
	transform: none;
}

/* Theme-aware dialog styling */
.opening-dialog-card,
.opening-dialog-header,
.opening-dialog-content,
.dialog-actions-container {
	background: var(--pos-card-bg) !important;
	color: var(--pos-text-primary) !important;
}

.opening-dialog-header {
	border-bottom: 1px solid var(--pos-border);
}

.dialog-actions-container {
	border-top: 1px solid var(--pos-border);
}
</style>
