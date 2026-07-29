import {
	computed,
	onBeforeUnmount,
	onMounted,
	ref,
	type ComputedRef,
	type Ref,
} from "vue";

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

	const isFullscreenDialog = computed(() => windowWidth.value < breakpoint);
	const dialogProps = computed(() =>
		resolveDialogProps(isFullscreenDialog.value, geometry),
	);

	// For components owning more than one dialog (cashier switch + terminal lock,
	// or Invoice Management's sheet + its invoice-detail sheet). Each may set its
	// own breakpoint; all of them share this one resize listener.
	const dialogPropsFor = (other: DialogFullscreenOptions) => {
		const { breakpoint: ownBreakpoint = breakpoint, ...otherGeometry } =
			other;
		return computed(() =>
			resolveDialogProps(
				windowWidth.value < ownBreakpoint,
				otherGeometry,
			),
		);
	};

	return { windowWidth, isFullscreenDialog, dialogProps, dialogPropsFor };
}
