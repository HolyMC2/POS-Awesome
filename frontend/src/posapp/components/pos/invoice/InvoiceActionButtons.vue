<template>
	<v-row dense>
		<!-- PAY moved to the top of the action grid. With every secondary
		     button rendered (Save&Clear, Drafts, Select S.O, Invoice Mgmt,
		     Cancel, Sales Return, Print Draft, Customer Screen) the grid
		     totals 5 rows + PAY; on a 1440x900 viewport at 100% zoom the
		     trailing PAY landed 5-7 px below the fold and operators had to
		     scroll for the primary checkout action. Putting PAY first
		     guarantees it stays in view regardless of which optional
		     buttons the profile enables. -->
		<v-col cols="12">
			<v-btn
				block
				color="success"
				theme="dark"
				size="large"
				prepend-icon="mdi-credit-card"
				@click="$emit('show-payment')"
				class="summary-btn pay-btn"
				:loading="paymentLoading"
			>
				{{ __("PAY") }}
			</v-btn>
		</v-col>
		<!-- SALDO-INTEGRATION-POINT — launcher for the 3-step picker.
		     Gated on the per-profile `saldo_enabled` flag (saldo Custom Field
		     on POS Profile, default OFF, doco tenants only). -->
		<v-col cols="12" v-if="showSaldoButton">
			<v-btn
				block
				color="primary"
				theme="dark"
				prepend-icon="mdi-cellphone-arrow-down"
				@click="$emit('open-saldo-picker')"
				class="summary-btn"
			>
				{{ __("Recarga / Servicio") }}
			</v-btn>
		</v-col>
		<!-- /SALDO-INTEGRATION-POINT -->
		<v-col cols="12" sm="6">
			<v-btn
				block
				color="accent"
				theme="dark"
				prepend-icon="mdi-content-save"
				@click="$emit('save-and-clear')"
				class="summary-btn"
				:loading="saveLoading"
			>
				{{ __("Save & Clear") }}
			</v-btn>
		</v-col>
		<v-col cols="12" sm="6">
			<v-btn
				block
				color="warning"
				theme="dark"
				prepend-icon="mdi-tray-full"
				@click="$emit('load-drafts')"
				class="white-text-btn summary-btn"
				:loading="loadDraftsLoading"
			>
				{{ __("Drafts") }}
			</v-btn>
		</v-col>
		<v-col cols="12" sm="6" v-if="pos_profile.custom_allow_select_sales_order == 1">
			<v-btn
				block
				color="info"
				theme="dark"
				prepend-icon="mdi-book-search"
				@click="$emit('select-order')"
				class="summary-btn"
				:loading="selectOrderLoading"
			>
				{{ __("Select S.O") }}
			</v-btn>
		</v-col>
		<v-col cols="12" sm="6">
			<v-btn
				block
				color="deep-purple"
				theme="dark"
				prepend-icon="mdi-folder-search-outline"
				@click="$emit('open-invoice-management')"
				class="summary-btn"
				:loading="invoiceManagementLoading"
			>
				{{ __("Invoice Mgmt") }}
			</v-btn>
		</v-col>
		<v-col cols="12" sm="6">
			<v-btn
				block
				color="error"
				theme="dark"
				prepend-icon="mdi-close-circle"
				@click="$emit('cancel-sale')"
				class="summary-btn"
				:loading="cancelLoading"
			>
				{{ __("Cancel Sale") }}
			</v-btn>
		</v-col>

		<v-col cols="12" sm="6" v-if="pos_profile.posa_allow_return == 1">
			<v-btn
				block
				color="secondary"
				theme="dark"
				prepend-icon="mdi-backup-restore"
				@click="$emit('open-returns')"
				class="summary-btn"
				:loading="returnsLoading"
			>
				{{ __("Sales Return") }}
			</v-btn>
		</v-col>
		<v-col cols="12" sm="6" v-if="pos_profile.posa_allow_print_draft_invoices">
			<v-btn
				block
				color="primary"
				theme="dark"
				prepend-icon="mdi-printer"
				@click="$emit('print-draft')"
				class="summary-btn"
				:loading="printLoading"
			>
				{{ __("Print Draft") }}
			</v-btn>
		</v-col>
		<v-col cols="12" sm="6" v-if="showCustomerDisplayButton">
			<v-btn
				block
				color="indigo"
				theme="dark"
				prepend-icon="mdi-monitor"
				@click="$emit('open-customer-display')"
				class="summary-btn"
				:loading="customerDisplayLoading"
			>
				{{ __("Customer Screen") }}
			</v-btn>
		</v-col>
	</v-row>
</template>

<script setup>
import { computed } from "vue";
import { parseBooleanSetting } from "../../../utils/stock";

const props = defineProps({
	pos_profile: {
		type: Object,
		required: true,
		default: () => ({}),
	},
	saveLoading: Boolean,
	loadDraftsLoading: Boolean,
	selectOrderLoading: Boolean,
	cancelLoading: Boolean,
	invoiceManagementLoading: Boolean,
	returnsLoading: Boolean,
	printLoading: Boolean,
	paymentLoading: Boolean,
	customerDisplayLoading: Boolean,
});

defineEmits([
	"save-and-clear",
	"load-drafts",
	"select-order",
	"cancel-sale",
	"open-invoice-management",
	"open-returns",
	"print-draft",
	"show-payment",
	"open-customer-display",
	"open-saldo-picker",
]);

const __ = window.__;
const showCustomerDisplayButton = computed(() =>
	parseBooleanSetting(props.pos_profile?.posa_enable_customer_display),
);
// SALDO-INTEGRATION-POINT — only show the saldo launcher when the profile
// opts in (saldo_enabled Custom Field on POS Profile, default OFF).
const showSaldoButton = computed(() =>
	parseBooleanSetting(props.pos_profile?.saldo_enabled),
);
</script>

<style scoped>
.white-text-btn {
	color: var(--pos-text-primary) !important;
}

.white-text-btn :deep(.v-btn__content) {
	color: var(--pos-text-primary) !important;
}

/* Enhanced button styling with better performance */
.summary-btn {
	transition: all 0.2s ease !important;
	position: relative;
	overflow: hidden;
	/* Bumped 46 → 34 px so the 5-row x 2-col grid + PAY fit in the
	   right-hand column without pushing PAY below the fold on a
	   1440 x 900 viewport at 100 % zoom. Tested on lab: PAY bottom
	   was at y=949 (vh=900) — operator had to scroll. New row pitch
	   keeps PAY visible. */
	min-height: 34px !important;
	text-transform: none !important;
}

/* Vuetify v-row[dense] still leaves 4 px top + 4 px bottom on each
   v-col. Across 6 rows that's ~48 px the action grid doesn't need.
   Tighten it so the PAY button stays above the fold at 100 % zoom. */
.v-row.v-row--dense > .v-col {
	padding-top: 2px !important;
	padding-bottom: 2px !important;
}

.summary-btn :deep(.v-btn__content) {
	white-space: normal !important;
	transition: all 0.2s ease;
}

.summary-btn:hover {
	transform: translateY(-1px);
	box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15) !important;
}

.summary-btn:active {
	transform: translateY(0);
}

/* Special styling for the PAY button */
.pay-btn {
	font-weight: 600 !important;
	font-size: 1.1rem !important;
	/* PAY is the primary action — keep it tall enough to look
	   important against the 36 px secondary buttons but still
	   shorter than the previous 46 px so the whole grid fits. */
	min-height: 44px !important;
	background: linear-gradient(135deg, #4caf50, #45a049) !important;
	box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3) !important;
}

.pay-btn:hover {
	background: linear-gradient(135deg, #45a049, #3d8b40) !important;
	box-shadow: 0 6px 16px rgba(76, 175, 80, 0.4) !important;
	transform: translateY(-2px);
}

/* Responsive optimizations */
@media (max-width: 768px) {
	.summary-btn {
		font-size: 0.8rem !important;
		padding: 4px 8px !important;
		min-height: 42px !important;
	}

	.pay-btn {
		font-size: 0.95rem !important;
		min-height: 48px !important;
	}
}

@media (max-width: 480px) {
	.summary-btn {
		font-size: 0.74rem !important;
		padding: 3px 6px !important;
		min-height: 34px !important;
	}

	.pay-btn {
		font-size: 0.85rem !important;
		min-height: 40px !important;
	}
}

/* Loading state animations */
.summary-btn:deep(.v-btn__loader) {
	opacity: 0.8;
}

/* Dark theme enhancements */
:deep([data-theme="dark"]) .summary-btn,
:deep(.v-theme--dark) .summary-btn {
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

:deep([data-theme="dark"]) .summary-btn:hover,
:deep(.v-theme--dark) .summary-btn:hover {
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
</style>
