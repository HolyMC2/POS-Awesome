<template>
	<!--
		The wiring half: reads the real queue, and owns the one side effect on
		this screen.

		Split from `MovilOfflineView.vue` so the view stays a pure function of its
		props — the same split `OfflineQueueView` + `useOfflineQueue` already
		make on the desktop, where the shell does this job inside `Pos.vue`. The
		phone gets a component instead because the offline surface is opened as a
		screen of its own, and a spec that presses Reintentar must be able to
		prove WHICH drain ran without mounting the whole register.
	-->
	<MovilOfflineView
		:rows="queue.rows.value"
		:online="online"
		:offline-since="offlineSince"
		:now="now"
		:format-currency="formatCurrency"
		:retrying="queue.retrying.value"
		:max-rows="maxRows"
		:surfaces="surfaces"
		@retry="queue.retry"
	/>
</template>

<script setup lang="ts">
import { onMounted, watch } from "vue";

import {
	useOfflineQueue,
	type UseOfflineQueueOptions,
} from "../../offline/useOfflineQueue";
import {
	OFFLINE_SURFACES,
	type OfflineSurface,
} from "../../shell/mobile/offlineSurfaceManifest";
import MovilOfflineView from "./MovilOfflineView.vue";

defineOptions({ name: "MovilOfflineSurface" });

const props = withDefaults(
	defineProps<{
		/**
		 * The three seams `useOfflineQueue` already exposes, forwarded rather
		 * than re-invented. The shell passes none of them and gets the real
		 * queue and the real drain by lazy default; a spec passes all three and
		 * never touches Dexie.
		 */
		readHeld?: UseOfflineQueueOptions["readHeld"];
		drain?: UseOfflineQueueOptions["drain"];
		probe?: UseOfflineQueueOptions["probe"];
		locale?: string | null;
		online?: boolean;
		offlineSince?: string | null;
		now?: Date | null;
		formatCurrency?: (value: number) => string;
		maxRows?: number;
		surfaces?: readonly OfflineSurface[];
	}>(),
	{
		locale: null,
		online: false,
		offlineSince: null,
		now: null,
		formatCurrency: (value: number) => String(value),
		maxRows: 5,
		surfaces: () => OFFLINE_SURFACES,
	},
);

const queue = useOfflineQueue({
	readHeld: props.readHeld,
	drain: props.drain,
	probe: props.probe,
	locale: props.locale,
});

onMounted(() => {
	void queue.refresh();
});

// The queue drains itself when the signal returns, and the rows on screen are
// a snapshot taken before that happened. Re-read rather than leave a
// shopkeeper looking at money that has already been banked.
watch(
	() => props.online,
	() => {
		void queue.refresh();
	},
);
</script>
