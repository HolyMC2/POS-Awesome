<!-- eslint-disable vue/multi-word-component-names -->
<template>
	<div class="pay-actions">
		<v-row>
			<v-col cols="12" sm="6">
				<v-btn
					data-testid="pay-submit"
					block
					size="large"
					color="primary"
					theme="dark"
					@click="$emit('submit')"
					:disabled="disabled || loading"
					:loading="loading"
				>
					{{ __("Submit") }}
				</v-btn>
			</v-col>
			<v-col cols="12" sm="6">
				<v-btn
					data-testid="pay-submit-print"
					block
					size="large"
					color="success"
					theme="dark"
					@click="$emit('submit-and-print')"
					:disabled="disabled || loading"
					:loading="loading"
				>
					{{ __("Submit & Print") }}
				</v-btn>
			</v-col>
		</v-row>
	</div>
</template>

<script setup>
defineProps({
	loading: Boolean,
	disabled: Boolean,
});

defineEmits(["submit", "submit-and-print"]);
</script>

<style scoped>
.pay-actions {
	padding: 24px 12px 12px;
}
.pay-actions :deep(.v-btn) {
	min-height: 48px;
	height: auto;
	padding-block: 12px;
}
.pay-actions :deep(.v-btn__content) {
	white-space: normal;
}
</style>
