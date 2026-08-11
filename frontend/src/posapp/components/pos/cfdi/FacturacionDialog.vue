<template>
	<v-dialog
		v-model="dialogModel"
		:fullscreen="isMobile"
		:max-width="isMobile ? undefined : 760"
		:transition="isMobile ? 'dialog-bottom-transition' : 'dialog-transition'"
		scrollable
	>
		<v-card class="cfdi-dialog-card">
			<v-card-title class="cfdi-dialog-header">
				<v-btn
					v-if="cfdiStore.detail || cfdiStore.detailLoading"
					icon="mdi-arrow-left"
					variant="text"
					density="comfortable"
					:aria-label="__('Back to invoice list')"
					@click="backToList"
				/>
				<v-icon v-else start color="primary">mdi-text-box-check-outline</v-icon>
				<span class="text-h6">{{ headerTitle }}</span>
				<v-spacer />
				<v-btn
					icon="mdi-close"
					variant="text"
					density="comfortable"
					:aria-label="__('Close')"
					@click="dialogModel = false"
				/>
			</v-card-title>

			<!-- ONE scrollport: the card text. Header and footer stay fixed. -->
			<v-card-text class="cfdi-dialog-body">
				<template v-if="showList">
					<div class="cfdi-search-row">
						<v-text-field
							v-model="cfdiStore.searchTerm"
							density="compact"
							class="pos-themed-input cfdi-search-input"
							:label="__('Folio, customer or RFC')"
							prepend-inner-icon="mdi-magnify"
							hide-details
							clearable
							@keyup.enter="cfdiStore.search()"
							@click:clear="clearSearch"
						/>
						<v-btn
							color="primary"
							variant="tonal"
							class="cfdi-search-btn"
							:loading="cfdiStore.searching"
							@click="cfdiStore.search()"
						>
							{{ __("Search") }}
						</v-btn>
					</div>

					<v-chip-group
						v-model="statusFilter"
						class="cfdi-status-chips"
						mandatory
						selected-class="cfdi-chip-selected"
					>
						<v-chip value="all" size="small" variant="tonal">{{ __("All") }}</v-chip>
						<v-chip value="unstamped" size="small" variant="tonal">{{ __("Sin timbrar") }}</v-chip>
						<v-chip value="stamped" size="small" variant="tonal">{{ __("Timbradas") }}</v-chip>
						<v-chip value="error" size="small" variant="tonal">{{ __("Con error") }}</v-chip>
					</v-chip-group>

					<v-alert
						v-if="cfdiStore.searchError"
						type="error"
						variant="tonal"
						density="comfortable"
						class="mb-2"
					>
						{{ cfdiStore.searchError }}
					</v-alert>

					<div v-if="cfdiStore.searching" class="cfdi-center-state">
						<v-progress-circular indeterminate color="primary" />
					</div>
					<template v-else>
						<v-list v-if="cfdiStore.rows.length" density="comfortable" lines="two" class="cfdi-invoice-list">
							<v-list-item
								v-for="row in cfdiStore.rows"
								:key="row.name"
								class="cfdi-invoice-item"
								@click="openInvoice(row)"
							>
								<v-list-item-title class="cfdi-invoice-title">
									{{ row.name }}
									<span v-if="row.is_return" class="cfdi-return-tag">{{ __("Return") }}</span>
								</v-list-item-title>
								<v-list-item-subtitle>
									{{ row.customer_name }} · {{ row.posting_date }}
								</v-list-item-subtitle>
								<template #append>
									<div class="cfdi-item-append">
										<span class="text-subtitle-2">{{ formatAmount(row) }}</span>
										<v-chip
											size="x-small"
											:color="statusColor(row.stamp_status)"
											variant="flat"
											class="cfdi-status-chip"
										>
											{{ statusLabel(row.stamp_status) }}
										</v-chip>
									</div>
								</template>
							</v-list-item>
						</v-list>
						<div v-else class="cfdi-center-state text-body-2 text-medium-emphasis">
							{{ __("No submitted invoices match this filter.") }}
						</div>
					</template>
				</template>

				<template v-else>
					<div v-if="cfdiStore.detailLoading" class="cfdi-center-state">
						<v-progress-circular indeterminate color="primary" />
					</div>
					<v-alert
						v-else-if="cfdiStore.detailError"
						type="error"
						variant="tonal"
						density="comfortable"
					>
						{{ cfdiStore.detailError }}
					</v-alert>
					<CfdiStampForm v-else-if="cfdiStore.detail" :pos-profile="posProfile" />
				</template>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script>
/**
 * Facturación surface: search submitted Sales Invoices, complete their
 * fiscal data and stamp them (timbrar) — the POS-side face of emc.
 *
 * Two panes inside one dialog: the list (search + status chips) and the
 * stamp form for the opened invoice. Fullscreen on phones; the card text
 * is the single scrollport (fixed header, no nested height:100% chains).
 */
import { useCfdiStore } from "../../../stores/cfdiStore";
import CfdiStampForm from "./CfdiStampForm.vue";

export default {
	name: "FacturacionDialog",
	components: { CfdiStampForm },
	props: {
		modelValue: { type: Boolean, default: false },
		posProfile: { type: Object, default: () => ({}) },
	},
	emits: ["update:modelValue"],
	setup() {
		const cfdiStore = useCfdiStore();
		return { cfdiStore };
	},
	data() {
		return {
			windowWidth: typeof window !== "undefined" ? window.innerWidth : 1024,
		};
	},
	computed: {
		dialogModel: {
			get() {
				return this.modelValue;
			},
			set(value) {
				this.$emit("update:modelValue", value);
			},
		},
		isMobile() {
			return this.windowWidth < 768;
		},
		showList() {
			return !this.cfdiStore.detail && !this.cfdiStore.detailLoading && !this.cfdiStore.detailError;
		},
		headerTitle() {
			if (this.showList) return __("Facturación");
			return this.cfdiStore.detail?.invoice?.name || __("Facturación");
		},
		statusFilter: {
			get() {
				return this.cfdiStore.statusFilter;
			},
			set(value) {
				this.cfdiStore.statusFilter = value || "all";
				void this.cfdiStore.search();
			},
		},
	},
	watch: {
		modelValue(open) {
			if (open) {
				void this.cfdiStore.loadBootstrap(this.posProfile?.name);
				void this.cfdiStore.search();
			} else {
				this.cfdiStore.closeInvoice();
			}
		},
	},
	mounted() {
		window.addEventListener("resize", this.onResize);
	},
	beforeUnmount() {
		window.removeEventListener("resize", this.onResize);
	},
	methods: {
		onResize() {
			this.windowWidth = window.innerWidth;
		},
		clearSearch() {
			this.cfdiStore.searchTerm = "";
			void this.cfdiStore.search();
		},
		openInvoice(row) {
			void this.cfdiStore.openInvoice(row.name);
		},
		backToList() {
			this.cfdiStore.closeInvoice();
		},
		formatAmount(row) {
			const num = Number(row.grand_total || 0);
			try {
				return num.toLocaleString(undefined, {
					style: "currency",
					currency: row.currency || "MXN",
				});
			} catch {
				return String(num.toFixed(2));
			}
		},
		statusColor(status) {
			if (status === "stamped") return "success";
			if (status === "error") return "error";
			return "warning";
		},
		statusLabel(status) {
			if (status === "stamped") return __("Timbrada");
			if (status === "error") return __("Error");
			return __("Sin timbrar");
		},
	},
};
</script>

<style scoped>
.cfdi-dialog-card {
	display: flex;
	flex-direction: column;
	background: rgb(var(--v-theme-surface));
	color: rgb(var(--v-theme-on-surface));
}

.cfdi-dialog-header {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 0 0 auto;
}

/* The one scrollport. flex + min-height:0 so it never grows past the card
   and never hands scrolling to an auto-height ancestor. */
.cfdi-dialog-body {
	flex: 1 1 0;
	min-height: 0;
	overflow-y: auto;
	-webkit-overflow-scrolling: touch;
}

.cfdi-search-row {
	display: flex;
	gap: 8px;
	align-items: center;
	margin-bottom: 8px;
}

.cfdi-search-input {
	flex: 1 1 auto;
}

.cfdi-search-btn {
	min-height: 40px;
}

.cfdi-status-chips {
	margin-bottom: 4px;
}

.cfdi-invoice-item {
	min-height: 48px;
	border-radius: 8px;
}

.cfdi-invoice-title {
	font-weight: 600;
}

.cfdi-return-tag {
	font-size: 0.7rem;
	color: rgb(var(--v-theme-error));
	margin-inline-start: 6px;
}

.cfdi-item-append {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4px;
}

.cfdi-center-state {
	display: flex;
	justify-content: center;
	padding: 32px 0;
}
</style>
