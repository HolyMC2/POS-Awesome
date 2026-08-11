<template>
	<div class="cfdi-stamp-form">
		<!-- Invoice summary -->
		<div class="cfdi-invoice-summary">
			<div>
				<div class="text-subtitle-1 font-weight-bold">{{ invoice.name }}</div>
				<div class="text-body-2 text-medium-emphasis">
					{{ invoice.customer_name }} · {{ invoice.posting_date }}
				</div>
			</div>
			<div class="text-h6 cfdi-total">{{ formatCurrency(invoice.grand_total) }}</div>
		</div>

		<!-- Stamped: recovery / delivery panel -->
		<template v-if="invoice.is_stamped">
			<v-alert type="success" variant="tonal" density="comfortable" class="mb-3">
				<div class="font-weight-bold">{{ __("CFDI timbrado") }}</div>
				<div v-if="invoice.mx_uuid" class="cfdi-uuid">{{ __("Folio fiscal") }}: {{ invoice.mx_uuid }}</div>
				<div v-if="invoice.sat_status">{{ __("SAT status") }}: {{ invoice.sat_status }}</div>
			</v-alert>
			<div class="cfdi-actions-row">
				<v-btn
					v-if="files.pdf"
					color="primary"
					variant="tonal"
					prepend-icon="mdi-file-pdf-box"
					@click="download('pdf')"
				>
					PDF
				</v-btn>
				<v-btn
					v-if="files.xml"
					color="primary"
					variant="tonal"
					prepend-icon="mdi-file-document-outline"
					@click="download('xml')"
				>
					XML
				</v-btn>
				<v-btn
					v-if="!files.pdf || !files.xml"
					color="secondary"
					variant="tonal"
					:loading="attaching"
					prepend-icon="mdi-refresh"
					@click="regenerateFiles"
				>
					{{ __("Generate files") }}
				</v-btn>
				<v-btn color="secondary" variant="tonal" prepend-icon="mdi-printer" @click="printInvoice">
					{{ __("Print") }}
				</v-btn>
			</div>
			<div class="cfdi-email-row">
				<v-text-field
					v-model="email"
					density="compact"
					class="pos-themed-input"
					:label="__('Send by email')"
					type="email"
					hide-details
				/>
				<v-btn
					color="primary"
					variant="tonal"
					:loading="emailing"
					:disabled="!email"
					@click="sendEmail"
				>
					{{ __("Send") }}
				</v-btn>
			</div>
		</template>

		<!-- Unstamped: preflight + fiscal form + stamp action -->
		<template v-else>
			<v-alert
				v-if="invoice.stamp_error"
				type="warning"
				variant="tonal"
				density="comfortable"
				class="mb-3"
			>
				<div class="font-weight-bold">{{ __("Last stamp attempt failed") }}</div>
				<div class="cfdi-error-text">{{ invoice.stamp_error }}</div>
			</v-alert>

			<div v-if="failingChecks.length" class="cfdi-checks mb-3">
				<div
					v-for="check in failingChecks"
					:key="check.code + check.field"
					class="cfdi-check-row"
					:class="check.level === 'error' ? 'cfdi-check-error' : 'cfdi-check-warn'"
				>
					<v-icon size="18" :icon="check.level === 'error' ? 'mdi-alert-circle' : 'mdi-alert'" />
					<span>{{ check.message }}</span>
				</div>
			</div>

			<CustomerFiscalFields
				v-model="fiscal"
				:catalogs="catalogs"
				:uses-for-regime="usesForRegime"
				@select-existing="useExistingCustomer"
			/>

			<v-row dense class="mt-1">
				<v-col cols="12" sm="6">
					<v-select
						v-model="mxPaymentOption"
						density="compact"
						class="pos-themed-input"
						:label="__('Método de pago (PUE/PPD)')"
						:items="paymentOptionItems"
						item-title="title"
						item-value="value"
					/>
				</v-col>
				<v-col cols="12" sm="6">
					<v-select
						v-model="mxPaymentMode"
						density="compact"
						class="pos-themed-input"
						:label="__('Forma de pago (SAT)')"
						:items="paymentMethodItems"
						item-title="title"
						item-value="value"
					/>
				</v-col>
			</v-row>

			<v-alert
				v-if="cfdiStore.stampError"
				type="error"
				variant="tonal"
				density="comfortable"
				class="mt-2"
			>
				<div class="font-weight-bold">{{ __("The PAC rejected the stamp") }}</div>
				<div class="cfdi-error-text">{{ cfdiStore.stampError }}</div>
			</v-alert>

			<v-btn
				block
				color="primary"
				size="large"
				class="mt-3 cfdi-stamp-btn"
				:loading="cfdiStore.stampPhase === 'stamping'"
				:disabled="!canStamp"
				prepend-icon="mdi-text-box-check-outline"
				@click="doStamp"
			>
				{{ __("Timbrar CFDI") }}
			</v-btn>
		</template>
	</div>
</template>

<script>
/**
 * Fiscal completion + stamp action for one submitted Sales Invoice.
 *
 * Reads the open invoice from cfdiStore.detail; prefills fiscal fields from
 * the customer record, falling back to invoice-level values. The stamp call
 * carries the fields the operator confirmed; the server revalidates all of
 * them before the PAC is touched. A successful stamp flips this panel into
 * the delivery view (same markup as an already-stamped invoice).
 */
import { attachCfdiFiles, cfdiFileUrl, emailCfdi } from "../../../api/cfdi";
import { useCfdiStore } from "../../../stores/cfdiStore";
import { useToastStore } from "../../../stores/toastStore";
import { printInvoiceByName } from "../../../utils/printInvoiceByName";
import { isGenericRfc, isValidRfc } from "../../../utils/rfc";
import CustomerFiscalFields from "./CustomerFiscalFields.vue";

export default {
	name: "CfdiStampForm",
	components: { CustomerFiscalFields },
	props: {
		posProfile: { type: Object, required: true },
	},
	setup() {
		const cfdiStore = useCfdiStore();
		const toastStore = useToastStore();
		return { cfdiStore, toastStore };
	},
	data() {
		return {
			fiscal: {
				customer: "",
				customer_name: "",
				tax_id: "",
				tax_regime: "",
				mx_cfdi_use: "",
				zip_code: "",
			},
			mxPaymentOption: "PUE",
			mxPaymentMode: "",
			email: "",
			emailing: false,
			attaching: false,
		};
	},
	computed: {
		invoice() {
			return this.cfdiStore.detail?.invoice ?? {};
		},
		files() {
			return this.cfdiStore.detail?.files ?? {};
		},
		catalogs() {
			return this.cfdiStore.catalogs;
		},
		usesForRegime() {
			return this.cfdiStore.usesForRegime;
		},
		failingChecks() {
			const checks = this.cfdiStore.detail?.preflight?.checks ?? [];
			// Customer-data errors are fixable right here in the form, so show
			// them as guidance, not blockers; item/company errors need Desk.
			return checks.filter((check) => !check.ok);
		},
		paymentOptionItems() {
			return (this.catalogs.payment_options || []).map((row) => ({
				value: row.key,
				title: `${row.key} — ${row.description}`,
			}));
		},
		paymentMethodItems() {
			return (this.catalogs.payment_methods || []).map((row) => ({
				value: row.key,
				title: `${row.key} — ${row.description}`,
			}));
		},
		canStamp() {
			return (
				this.cfdiStore.stampPhase !== "stamping" &&
				isValidRfc(this.fiscal.tax_id) &&
				Boolean(this.fiscal.customer_name) &&
				Boolean(this.fiscal.tax_regime) &&
				Boolean(this.fiscal.mx_cfdi_use) &&
				/^\d{5}$/.test(this.fiscal.zip_code || "")
			);
		},
	},
	watch: {
		"cfdiStore.detail": {
			immediate: true,
			handler(detail) {
				if (detail) this.prefill(detail);
			},
		},
	},
	methods: {
		prefill(detail) {
			const customer = detail.customer_fiscal || {};
			const invoice = detail.invoice || {};
			this.fiscal = {
				customer: customer.customer || invoice.customer || "",
				customer_name: customer.customer_name || invoice.customer_name || "",
				tax_id: customer.tax_id || "",
				tax_regime: customer.mx_tax_regime || "",
				mx_cfdi_use: invoice.mx_cfdi_use || customer.mx_cfdi_use || "",
				zip_code: customer.zip_code || "",
			};
			// SAT pins the generic RFC to régimen 616 + uso S01 — apply the
			// pairing on prefill too, not only when the RFC is typed.
			if (isGenericRfc(this.fiscal.tax_id)) {
				this.fiscal.tax_regime = "616";
				this.fiscal.mx_cfdi_use = "S01";
			}
			this.mxPaymentOption = invoice.mx_payment_option || "PUE";
			this.mxPaymentMode = invoice.mx_payment_mode || "";
			this.email = customer.email_id || "";
		},
		useExistingCustomer(owner) {
			// Re-point the stamp at the RFC's real owner; the server refreshes
			// name/régimen/address from that customer record.
			this.fiscal = { ...this.fiscal, customer: owner.customer, customer_name: owner.customer_name };
		},
		formatCurrency(value) {
			const num = Number(value || 0);
			const currency = this.invoice.currency || "MXN";
			try {
				return num.toLocaleString(undefined, { style: "currency", currency });
			} catch {
				return `${currency} ${num.toFixed(2)}`;
			}
		},
		async doStamp() {
			const result = await this.cfdiStore.stamp({
				customer: this.fiscal.customer || undefined,
				customer_name: this.fiscal.customer_name,
				tax_id: this.fiscal.tax_id,
				tax_regime: this.fiscal.tax_regime,
				mx_cfdi_use: this.fiscal.mx_cfdi_use,
				zip_code: this.fiscal.zip_code,
				mx_payment_option: this.mxPaymentOption,
				mx_payment_mode: this.mxPaymentMode || undefined,
			});
			if (result) {
				this.toastStore.show({
					title: result.already_stamped
						? __("This invoice was already stamped")
						: __("CFDI timbrado correctamente"),
					message: result.uuid ? `${__("Folio fiscal")}: ${result.uuid}` : "",
					color: "success",
				});
			}
		},
		download(kind) {
			window.open(cfdiFileUrl(this.invoice.name, kind), "_blank", "noopener");
		},
		async regenerateFiles() {
			this.attaching = true;
			try {
				const result = await attachCfdiFiles(this.invoice.name, this.posProfile?.name);
				if (this.cfdiStore.detail) this.cfdiStore.detail.files = result.files;
			} catch (error) {
				console.error("cfdi: attach files failed", error);
				this.toastStore.show({ title: __("Could not generate the CFDI files"), color: "error" });
			} finally {
				this.attaching = false;
			}
		},
		async sendEmail() {
			this.emailing = true;
			try {
				await emailCfdi(this.invoice.name, this.email, this.posProfile?.name);
				this.toastStore.show({
					title: `${__("CFDI sent to")} ${this.email}`,
					color: "success",
				});
			} catch (error) {
				console.error("cfdi: email failed", error);
				this.toastStore.show({ title: __("Could not send the CFDI"), color: "error" });
			} finally {
				this.emailing = false;
			}
		},
		printInvoice() {
			void printInvoiceByName(this.posProfile, "Sales Invoice", this.invoice.name);
		},
	},
};
</script>

<style scoped>
.cfdi-stamp-form {
	color: rgb(var(--v-theme-on-surface));
}

.cfdi-invoice-summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 0 12px;
}

.cfdi-total {
	white-space: nowrap;
}

.cfdi-uuid {
	font-family: monospace;
	font-size: 0.8rem;
	overflow-wrap: anywhere;
}

.cfdi-error-text {
	overflow-wrap: anywhere;
	white-space: pre-line;
}

.cfdi-checks {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.cfdi-check-row {
	display: flex;
	align-items: flex-start;
	gap: 6px;
	font-size: 0.85rem;
	border-radius: 6px;
	padding: 4px 8px;
}

.cfdi-check-error {
	color: rgb(var(--v-theme-error));
	background: rgba(var(--v-theme-error), 0.08);
}

.cfdi-check-warn {
	color: rgb(var(--v-theme-warning));
	background: rgba(var(--v-theme-warning), 0.08);
}

.cfdi-actions-row {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 12px;
}

.cfdi-actions-row .v-btn {
	min-height: 40px;
}

.cfdi-email-row {
	display: flex;
	gap: 8px;
	align-items: center;
}

.cfdi-email-row .v-btn {
	min-height: 40px;
}

.cfdi-stamp-btn {
	min-height: 48px;
}
</style>
