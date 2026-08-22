/**
 * The seam between a hosted flow and the destination hosting it.
 *
 * Every flows sheet (Drafts, Returns, Sales Orders, Invoice Management) owns
 * its own `v-dialog` and drives it from a store flag. That is why this is an
 * INJECTION and not a prop: `DestinationHost` cannot reach inside a component
 * it refuses to fork and rewrite its overlay, but it can declare "you are
 * being rendered as a surface, not as a modal" and let the shared
 * `useDialogFullscreen` composable answer.
 *
 * A component that never injects this keeps behaving exactly as it does today,
 * which is what makes the migration incremental instead of a flag day.
 *
 * ⚠ Wiring pending: `composables/core/useDialogFullscreen.ts` must inject this
 * key and, when a surface is present, return `{ attach, scrim: false,
 * persistent: true, fullscreen: false }` alongside its geometry. Until it does,
 * a hosted sheet still renders as a centred modal — correct behaviour, wrong
 * chrome. The registry, the gating and the routing do not depend on it.
 */

import type { InjectionKey, Ref } from "vue";

export interface DestinationSurface {
	/**
	 * Element the hosted dialog should teleport into, so it fills the
	 * destination area beside the rail instead of the whole viewport.
	 */
	attachTo: Ref<HTMLElement | null>;
	/** The destination currently occupying this surface. */
	destinationId: Ref<string>;
}

export const DESTINATION_SURFACE: InjectionKey<DestinationSurface> =
	Symbol("posa:destination-surface");
