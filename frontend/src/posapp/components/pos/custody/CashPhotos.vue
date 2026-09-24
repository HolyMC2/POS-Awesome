<template><div ref="host" data-testid="cash-photo-evidence"></div></template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { mountCashPhotos, type CashPhotoTarget } from "./photos";
const props = defineProps<CashPhotoTarget>();
const host = ref<HTMLElement>();
let panel: ReturnType<typeof mountCashPhotos> | undefined;
onMounted(() => { if (host.value) panel = mountCashPhotos(host.value, { doctype: props.doctype, name: props.name }); });
onBeforeUnmount(() => panel?.destroy());
</script>
