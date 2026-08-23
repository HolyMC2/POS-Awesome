import {
	computed,
	inject,
	onBeforeUnmount,
	onMounted,
	ref,
	type ComputedRef,
	type Ref,
} from "vue";

import {
	DESTINATION_SURFACE,
	type DestinationSurface,
} from "../../components/pos/shell/destinations/surfaceContext";

/**
 * Vuetify's `sm` floor. Under it a centred dialog is left with ~24px of gutter
 * per side and still has to fit its own padding, so any dialog holding a real
 * form ends up scrolling in two axes. These go fullscreen instead.
 */
export const DIALOG_FULLSCREEN_BREAKPOINT = 600;

export interface DialogGeometry {
	width?: string | number;
	maxWidth?: string | number;
	minWidth?: string | number;
	maxHeight?: string | number;
}

export interface DialogFullscreenOptions extends DialogGeometry {
	/**
	 * Width under which the dialog goes fullscreen. Defaults to the `sm` floor;
	 * the flows sheets (Drafts, Returns, Sales Orders, Invoice Management) go
	 * fullscreen from 1100 down, where they also swap to their list layout.
	 */
	breakpoint?: number;
}

export interface DialogFullscreenProps extends DialogGeometry {
	fullscreen: boolean;
	/** Teleport target — set only when hosted as a destination surface. */
	attach?: HTMLElement | string;
	/** Hosted surfaces carry no scrim: there is nothing behind them to dim. */
	scrim?: boolean | string;
	/** A surface is not dismissed by clicking beside it; the rail moves on. */
	persistent?: boolean;
	/**
	 * Hosted surfaces are `contained`: Vuetify then positions the overlay
	 * `absolute` inside the attach target instead of `fixed` over the viewport,
	 * which is what keeps the rail and the band on screen beside a hosted sheet.
	 */
	contained?: boolean;
}

/**
 * `v-dialog--fullscreen` sizes the overlay from a stylesheet rule, but VOverlay
 * writes width/min-width/max-width/max-height as INLINE styles on the same
 * element — which outrank it. So the geometry props have to be dropped on xs,
 * not merely widened: Mpesa's `min-width="800px"` survived `fullscreen` and
 * kept the sheet 800px wide on a 390px phone.
 */
function resolveDialogProps(
	fullscreen: boolean,
	geometry: DialogGeometry,
): DialogFullscreenProps {
	return fullscreen
		? { fullscreen: true }
		: { fullscreen: false, ...geometry };
}

/**
 * Re-shape a dialog that is being rendered as a rail DESTINATION rather than as
 * a modal (roadmap §17.7).
 *
 * Every flows sheet — Drafts, Returns, Sales Orders, Invoice Management — owns
 * its own `v-dialog` driven by a store flag, so `DestinationHost` cannot reach
 * inside and re-chrome it from outside. Instead the host provides
 * `DESTINATION_SURFACE` and this function answers it: teleport into the
 * destination area beside the rail, drop the scrim (nothing behind it needs
 * dimming), and stop closing on an outside click — a surface is left by
 * choosing another destination, not by tapping next to it.
 *
 * A component that never injects the key is returned its object UNCHANGED, by
 * identity. That is what makes the migration incremental instead of a flag day:
 * a dialog nobody hosts behaves exactly as it does today.
 */
function applyDestinationSurface(
	props: DialogFullscreenProps,
	surface: DestinationSurface | null,
): DialogFullscreenProps {
	const attach = surface?.attachTo.value;
	if (!attach) {
		return props;
	}
	// Geometry is dropped for the same reason `fullscreen` drops it: VOverlay
	// writes width/min-width as INLINE styles that outrank any stylesheet, so a
	// sheet carrying `min-width: 800px` would stay 800px wide inside a 520px
	// destination area.
	//
	// `contained` is the half that was missing: `attach` alone only moves the
	// overlay's DOM node, and VOverlay still paints it `position: fixed` over
	// the whole viewport — the hosted corte covered the rail, the navbar and
	// the band (see `docs/design-evidence/destinations/closing.png`). With
	// `contained` Vuetify adds `v-overlay--absolute`, and the overlay fills its
	// positioned ancestor — `.destination-host` — and nothing beyond it.
	return {
		fullscreen: false,
		attach,
		contained: true,
		scrim: false,
		persistent: true,
	};
}

export function useDialogFullscreen(options: DialogFullscreenOptions = {}): {
	windowWidth: Ref<number>;
	isFullscreenDialog: ComputedRef<boolean>;
	dialogProps: ComputedRef<DialogFullscreenProps>;
	dialogPropsFor: (
		_options: DialogFullscreenOptions,
	) => ComputedRef<DialogFullscreenProps>;
} {
	const { breakpoint = DIALOG_FULLSCREEN_BREAKPOINT, ...geometry } = options;
	const windowWidth = ref(
		typeof window === "undefined"
			? DIALOG_FULLSCREEN_BREAKPOINT
			: window.innerWidth,
	);

	const handleResize = () => {
		windowWidth.value = window.innerWidth;
	};

	onMounted(() => {
		handleResize();
		window.addEventListener("resize", handleResize);
	});

	onBeforeUnmount(() => {
		window.removeEventListener("resize", handleResize);
	});

	// `inject` outside a component setup returns undefined and warns; every
	// caller of this composable is a setup, and the default keeps the composable
	// usable from a plain unit test that mounts nothing.
	const surface = inject<DestinationSurface | null>(DESTINATION_SURFACE, null);

	const isFullscreenDialog = computed(() => windowWidth.value < breakpoint);
	const dialogProps = computed(() =>
		applyDestinationSurface(
			resolveDialogProps(isFullscreenDialog.value, geometry),
			surface,
		),
	);

	// For components owning more than one dialog (cashier switch + terminal lock,
	// or Invoice Management's sheet + its invoice-detail sheet). Each may set its
	// own breakpoint; all of them share this one resize listener.
	const dialogPropsFor = (other: DialogFullscreenOptions) => {
		const { breakpoint: ownBreakpoint = breakpoint, ...otherGeometry } =
			other;
		return computed(() =>
			applyDestinationSurface(
				resolveDialogProps(
					windowWidth.value < ownBreakpoint,
					otherGeometry,
				),
				surface,
			),
		);
	};

	return { windowWidth, isFullscreenDialog, dialogProps, dialogPropsFor };
}
