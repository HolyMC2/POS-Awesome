<template>
	<section
		ref="surfaceEl"
		class="destination-host"
		:class="{ 'destination-host--page': surfaceKind === 'page' }"
		:data-testid="testId"
		:data-destination-surface="surfaceKind"
		:data-destination="destinationId"
		:data-destination-state="state"
		:aria-label="label"
	>
		<!-- Refusals render as a surface, not as a toast. A cashier who deep-links
		     into Devolución on a dead network needs the reason to stay on screen
		     while they go and fix it, and a toast is gone by the time they look
		     up from the router. -->
		<div v-if="refusal" class="destination-host__refusal" data-testid="destination-refusal">
			<v-icon :icon="refusalIcon" size="34" class="destination-host__refusal-icon" />
			<h2 class="destination-host__refusal-title">{{ refusalTitle }}</h2>
			<p class="destination-host__refusal-body">{{ refusalBody }}</p>
			<v-btn variant="flat" color="primary" @click="$emit('dismiss')">
				{{ t("Back to sale") }}
			</v-btn>
		</div>

		<!-- The hosted flow renders itself. We do not wrap, clone or restyle it;
		     it keeps its own dialog, its own store flag and all of its logic.

		     `@close` is the one thing we do listen for: a flow that closes its
		     own overlay would otherwise leave this host on screen showing
		     nothing, with the rail beside it and no way out. It becomes a
		     `dismiss`, which returns to the PREVIOUS destination rather than a
		     hardcoded sale. A flow that never emits it behaves exactly as it
		     does today. -->
		<component
			:is="sheetComponent"
			v-else-if="sheetComponent"
			v-bind="$attrs"
			@close="$emit('dismiss')"
			@band="$emit('band', $event)"
		/>

		<div v-else class="destination-host__loading">
			<v-progress-circular indeterminate color="primary" size="28" />
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Renders one destination in the shell's main area (roadmap §17.7).
 *
 * It ADAPTS the existing flows components rather than forking them: each one
 * still owns its `v-dialog` and its store flag, and this host only supplies the
 * surface they render into (see `surfaceContext.ts`) plus the refusal states
 * the rail cannot show on its own.
 *
 * Deliberately dumb about WHICH destination is right — that decision belongs to
 * `useDestinationRouting`, which the shell owns, so the rail, the URL and the
 * keyboard cannot disagree about it.
 */
import { computed, defineAsyncComponent, provide, ref, shallowRef, watch } from "vue";

import {
	destinationTestId,
	getDestination,
	SHEET_COMPONENTS,
	type DestinationId,
	type DestinationState,
} from "../../../../composables/pos/shell/destinationRegistry";
import type { BandState } from "../../../../composables/pos/shell/bandState";
import type { RefusalReason } from "../../../../composables/pos/shell/useDestinationRouting";
import { DESTINATION_SURFACE } from "./surfaceContext";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
	destinationId: DestinationId;
	/** Set when the shell refused this destination; null when it allowed it. */
	refusal?: RefusalReason | null;
	/** verticalStore.t — the preset renames these nouns. */
	t: (key: string) => string;
}>();

/**
 * `band` relays a hosted surface's own band state up to the shell.
 *
 * `ClosingDialog` already publishes one — *"published upward whether or not we
 * render a band ourselves, so a shell hosting this surface can feed its own
 * band from the same state"* — and until now that promise dead-ended here,
 * because the host dropped the event. It no longer does. The shell is free to
 * ignore it, which is what it does today: the corte keeps its own Submit and
 * prints the difference on its own surface (see `closing-difference`).
 */
defineEmits<{ dismiss: []; band: [BandState] }>();

const surfaceEl = ref<HTMLElement | null>(null);
const destinationIdRef = computed(() => String(props.destinationId));

provide(DESTINATION_SURFACE, {
	attachTo: surfaceEl,
	destinationId: destinationIdRef,
});

const def = computed(() => getDestination(props.destinationId) ?? null);
/** `page` for the tools views (they scroll as a page); `sheet` otherwise. */
const surfaceKind = computed(() => (def.value?.surface === "page" ? "page" : "sheet"));
const label = computed(() => (def.value ? props.t(def.value.labelKey) : ""));

// Derived from the registry, never hand-written here: the rail stamps
// `rail-<id>` from the same source, and the evidence lane pairs them.
const testId = computed(() => destinationTestId(props.destinationId));

const state = computed<DestinationState>(() => {
	if (props.refusal === "offline") return "offline-blocked";
	if (props.refusal) return "gated";
	return "ready";
});

// shallowRef: an async component definition is not reactive data, and letting
// Vue deep-proxy a component object is pure overhead on every destination swap.
const sheetComponent = shallowRef<ReturnType<typeof defineAsyncComponent> | null>(null);

watch(
	() => [props.destinationId, props.refusal] as const,
	([id, refusal]) => {
		const loader = refusal ? undefined : SHEET_COMPONENTS[id];
		sheetComponent.value = loader ? defineAsyncComponent(loader as never) : null;
	},
	{ immediate: true },
);

const refusalIcon = computed(() => {
	if (props.refusal === "offline") return "mdi-wifi-off";
	if (props.refusal === "shift_closed") return "mdi-cash-register";
	return "mdi-lock-outline";
});

const refusalTitle = computed(() => {
	switch (props.refusal) {
		case "offline":
			return props.t("Needs a connection");
		case "shift_closed":
			return props.t("Open the register first");
		case "gated":
			return props.t("Not enabled on this register");
		default:
			return props.t("Unavailable");
	}
});

const refusalBody = computed(() => {
	switch (props.refusal) {
		case "offline":
			// Naming the destination matters: the same screen appears for
			// Devolución, Recarga and Corte, and they fail for different reasons.
			return props.t(
				"{0} talks to the server every time it runs, so it stays closed until this register is back online.",
			).replace("{0}", label.value);
		case "shift_closed":
			return props.t(
				"The shift is the envelope around everything else. Open it and the whole rail comes alive.",
			);
		case "gated":
			return props.t("This register's profile does not include {0}.").replace("{0}", label.value);
		default:
			return props.t("This destination does not exist.");
	}
});
</script>

<style scoped>
.destination-host {
	display: flex;
	flex-direction: column;
	/* Same height-chain discipline as the register columns: fill the parent,
	 * refuse to grow past it, and let the hosted flow own the only scrollport
	 * inside. `min-height: 0` is the half that actually does the work. */
	flex: 1 1 auto;
	min-height: 0;
	position: relative;
	overflow: hidden;
}

/* A hosted PAGE keeps its own height (PayView sizes itself to the viewport,
 * the dashboard stacks cards) and the host becomes its scrollport. The sheet
 * discipline — one inner scrollport, the host clips — stays for the flows. */
.destination-host--page {
	overflow: auto;
	overscroll-behavior: contain;
}

.destination-host__refusal,
.destination-host__loading {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	padding: 32px;
	text-align: center;
}

.destination-host__refusal-icon {
	color: #9aa2ae;
}

.destination-host__refusal-title {
	font-size: 18px;
	font-weight: 700;
	color: #212121;
	margin: 0;
}

.destination-host__refusal-body {
	font-size: 13.5px;
	line-height: 1.5;
	color: #667085;
	max-width: 46ch;
	margin: 0 0 8px;
}
</style>
