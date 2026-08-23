<template>
	<RegisterShell />
</template>

<script setup lang="ts">
/**
 * A deep link into a destination, landing IN the register shell.
 *
 * `/floor` set the precedent and its route comment states the rationale
 * plainly: *"the floor is a panel of the POS shell, not a screen of its own —
 * this route exists so it can be linked and bookmarked. It mounts the same
 * shell and asks it to open on the floor."* Both halves of that are true at
 * once, and that is the whole argument: a destination is worth a URL, and
 * following that URL must not cost the operator the rail.
 *
 * `/cash-movement` and `/closing` used to mount their own component instead,
 * which is how Gasto ended up on a page with no rail, no band and no way back
 * that is not the browser. They keep their paths — a support instruction, a
 * bookmark and a kiosk link all still work — and gain the shell.
 *
 * WHY A WRAPPER RATHER THAN A LINE IN `Pos.vue`: the shell already publishes
 * exactly one inbound channel for "go to this destination", and its own
 * comment names the three callers — *"one event carrying a destination id …
 * the rail, THE ROUTER and the chord all name the same thing, so a tenth
 * destination costs a registry entry and nothing else."* The router half was
 * designed and never wired. This is that wire, and it adds no fourth notion of
 * where-am-I: the event lands in `useDestinationRouting.activate`, the same
 * single writer the rail and the keyboard use.
 */
import { computed, inject, onMounted, watch } from "vue";
import { useRoute } from "vue-router";

// Static, not async: a child mounts BEFORE its parent, so this import is what
// guarantees the shell's `open_destination` listener is already registered by
// the time `onMounted` below fires. A `defineAsyncComponent` would mount the
// wrapper first and shout into an empty room.
import RegisterShell from "../Pos.vue";
import { useUIStore } from "../../../../stores/uiStore";
import { destinationForPath } from "../../../../composables/pos/shell/destinationRegistry";

const route = useRoute();
const uiStore = useUIStore();
const eventBus = inject<{ emit: (event: string, payload?: unknown) => void } | null>(
	"eventBus",
	null,
);

/**
 * The route names its destination in meta; the path is the fallback so a
 * hand-written route entry cannot silently lose it. Both answers come from the
 * registry, never from a literal here.
 */
const destinationId = computed(() => {
	const fromMeta = route?.meta?.initialDestination;
	if (typeof fromMeta === "string" && fromMeta) {
		return fromMeta;
	}
	return destinationForPath(String(route?.path || ""))?.id ?? "";
});

let handedOver = "";

/**
 * Hand the destination to the shell, once per arrival.
 *
 * Gated on the shift for the reason `useDestinationRouting` states in its own
 * header: *el turno es el sobre de todo lo demás*. Before the register has
 * answered, `resolveActivation` refuses with `shift_closed` and the shell
 * paints that refusal as a SURFACE — which would then still be sitting there
 * after the cashier opened the till. Waiting costs nothing: the opening dialog
 * is over the shell either way.
 */
function handOver() {
	const id = destinationId.value;
	if (!id || handedOver === id || !eventBus) {
		return;
	}
	if (!uiStore.posOpeningShift) {
		return;
	}
	handedOver = id;
	eventBus.emit("open_destination", id);
}

// vue-router REUSES this instance across two routes that share a component, so
// `/cash-movement` → `/closing` would otherwise arrive and do nothing.
watch(
	() => destinationId.value,
	() => {
		handedOver = "";
		handOver();
	},
);

watch(() => Boolean(uiStore.posOpeningShift), handOver);

onMounted(handOver);
</script>
