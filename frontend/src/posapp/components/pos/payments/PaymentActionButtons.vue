<template>
	<v-card flat :class="['cards mb-0 mt-2 pa-0', { compact }]">
		<!-- Submit + Submit&Print share ONE row on every width (phone included)
		     so the footer stays ~one thumb-row tall instead of three stacked
		     full-width bars that float over the numpad on a phone. Cancel is
		     de-emphasised to a slim text row — it is the rare exit, not a peer
		     of the money buttons. -->
		<v-row align="center" no-gutters class="payment-action-row">
			<v-col cols="6" class="pr-1">
				<v-btn
					ref="submitButton"
					block
					size="large"
					color="primary"
					variant="flat"
					class="payment-submit-btn payment-footer-btn"
					data-pos-keyboard-target="payment-submit"
					@click="$emit('submit')"
					:loading="loading"
					:disabled="loading || validatePayment"
					:class="{ 'submit-highlight': highlightSubmit }"
				>
					{{ __("Submit") }}
				</v-btn>
			</v-col>
			<v-col cols="6" class="pl-1">
				<v-btn
					block
					size="large"
					color="success"
					variant="flat"
					class="payment-submit-print-btn payment-footer-btn"
					data-pos-keyboard-target="payment-submit-print"
					@click="$emit('submit-and-print')"
					:loading="loading"
					:disabled="loading || validatePayment"
				>
					{{ __("Submit & Print") }}
				</v-btn>
			</v-col>
			<v-col cols="12">
				<v-btn
					block
					size="small"
					color="error"
					variant="text"
					class="mt-1 payment-cancel-btn payment-cancel-btn--slim"
					data-pos-keyboard-target="payment-cancel"
					@click="$emit('cancel')"
				>
					{{ __("Cancel Payment") }}
				</v-btn>
			</v-col>
		</v-row>
	</v-card>
</template>

<script setup>
defineProps({
	loading: Boolean,
	validatePayment: Boolean,
	highlightSubmit: Boolean,
	compact: Boolean,
});

defineEmits(["submit", "submit-and-print", "cancel"]);

const __ = window.__;
</script>

<style scoped>
.cards {
	background: transparent !important;
}

/* `.compact` sits on THIS component's root, so it is reachable as a scoped
   descendant selector. The mirrored `:deep(.compact .v-btn)` that used to sit
   here compiled to `[data-v-x] .compact .v-btn` and matched nothing — the root
   is the only element carrying the scope id, and it cannot be its own
   descendant. */
.compact :deep(.v-btn) {
	min-height: 42px;
}

.payment-footer-btn {
	--v-theme-overlay-multiplier: 0 !important;
	transition:
		box-shadow 0.18s ease,
		background-color 0.18s ease,
		transform 0.18s ease !important;
	color: #ffffff !important;
	min-height: 48px !important;
}

.payment-submit-btn {
	background-color: rgb(var(--v-theme-primary)) !important;
}

.payment-submit-print-btn {
	background-color: rgb(var(--v-theme-success)) !important;
}

/* Slim, low-emphasis exit — a text row, not a full red bar competing with the
   two money buttons above it. */
.payment-cancel-btn--slim {
	/* Slim visually (text variant, no bar) but hold the 40px touch line the
	   rest of this file settled on — 32px was below the coarse-pointer floor. */
	min-height: 40px !important;
	font-size: 0.8rem !important;
	letter-spacing: 0;
	opacity: 0.85;
}

/* Long locales ("Enviar e Imprimir") must WRAP in the cols=6 money button
   rather than clip — Vuetify's btn content is nowrap by default. */
:deep(.payment-footer-btn .v-btn__content) {
	white-space: normal;
	line-height: 1.12;
}

.payment-cancel-btn--slim:hover,
.payment-cancel-btn--slim:focus-visible {
	opacity: 1;
}

.payment-footer-btn:hover,
.payment-footer-btn:focus,
.payment-footer-btn:focus-visible,
.payment-footer-btn:active {
	box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18) !important;
	transform: translateY(-1px);
}

.payment-submit-btn:hover,
.payment-submit-btn:focus,
.payment-submit-btn:focus-visible,
.payment-submit-btn:active {
	background-color: rgba(var(--v-theme-primary), 0.9) !important;
}

.payment-submit-print-btn:hover,
.payment-submit-print-btn:focus,
.payment-submit-print-btn:focus-visible,
.payment-submit-print-btn:active {
	background-color: rgba(var(--v-theme-success), 0.9) !important;
}

.payment-footer-btn:active {
	transform: translateY(0);
}

:deep(.payment-footer-btn .v-btn__overlay),
:deep(.payment-footer-btn .v-btn__underlay) {
	opacity: 0 !important;
	background: transparent !important;
}

@media (max-width: 768px) {
	.cards {
		margin-top: 0 !important;
	}

	.payment-footer-btn {
		font-size: 0.82rem !important;
	}

	/* These are the money buttons — same thumb sizing as the invoice
	   action grid (InvoiceActionButtons.vue), where 40px secondary /
	   46px primary was already settled. Submit is the primary. */
	:deep(.payment-footer-btn.v-btn) {
		min-height: 40px !important;
	}

	:deep(.payment-submit-btn.v-btn) {
		min-height: 46px !important;
	}

	:deep(.payment-footer-btn .v-btn__content) {
		font-size: 0.82rem !important;
		line-height: 1.15;
	}
}

@media (max-width: 480px) {
	.payment-footer-btn {
		font-size: 0.78rem !important;
	}

	/* The phone used to get SMALLER targets than the tablet (34px);
	   hold the 40/46 line all the way down. */
	:deep(.payment-footer-btn.v-btn) {
		min-height: 40px !important;
	}

	:deep(.payment-submit-btn.v-btn) {
		min-height: 46px !important;
	}

	:deep(.payment-footer-btn .v-btn__content) {
		font-size: 0.78rem !important;
	}
}
</style>
