// @vitest-environment jsdom
/**
 * The surface seam (roadmap §17.7).
 *
 * `DestinationHost` refuses to fork the flows dialogs, so it cannot re-chrome
 * them from outside. Instead it PROVIDES `DESTINATION_SURFACE` and
 * `useDialogFullscreen` answers: teleport beside the rail, drop the scrim, stop
 * closing on an outside click.
 *
 * The load-bearing assertion here is the NEGATIVE one. A dialog that nobody
 * hosts must behave exactly as it does today — that is what makes this
 * migration incremental rather than a flag day, and it is the property a future
 * edit is most likely to break while all the positive tests stay green.
 */
import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { mount } from "@vue/test-utils";

import { useDialogFullscreen } from "../src/posapp/composables/core/useDialogFullscreen";
import { DESTINATION_SURFACE } from "../src/posapp/components/pos/shell/destinations/surfaceContext";

/**
 * Captured out of setup rather than read off `wrapper.vm`. This repo's VTU
 * does not surface `expose()`d refs on the instance proxy (the same dual-Vue
 * symptom `tests/changeDueDialog.spec.ts:93` documents for `emitted()`), so a
 * capture object is the reliable way to see what a composable returned.
 */
type Captured = ReturnType<typeof useDialogFullscreen> | null;
let captured: Captured = null;

const Sheet = defineComponent({
	setup() {
		captured = useDialogFullscreen({
			minWidth: "800px",
			maxWidth: "1200px",
			breakpoint: 1100,
		});
		return () => h("div");
	},
});

const props = () => {
	if (!captured) throw new Error("Sheet did not mount");
	return captured.dialogProps.value as unknown as Record<string, unknown>;
};

const Host = defineComponent({
	props: { attach: { type: Object, default: null } },
	setup(props) {
		provide(DESTINATION_SURFACE, {
			attachTo: ref(props.attach as HTMLElement | null),
			destinationId: ref("drafts"),
		});
		return () => h(Sheet, { ref: "sheet" });
	},
});

const mountSheet = (width: number) => {
	captured = null;
	Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
	return mount(Sheet);
};

const mountHosted = (width: number, attach: HTMLElement | null) => {
	captured = null;
	Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
	return mount(Host, { props: { attach } });
};

describe("useDialogFullscreen without a destination surface", () => {
	it("keeps its geometry above the breakpoint", () => {
		mountSheet(1440);
		expect(props()).toEqual({
			fullscreen: false,
			minWidth: "800px",
			maxWidth: "1200px",
		});
	});

	it("still goes fullscreen below it, dropping geometry", () => {
		mountSheet(390);
		// Geometry must be DROPPED, not widened: VOverlay writes width as an
		// inline style that outranks the fullscreen stylesheet rule.
		expect(props()).toEqual({ fullscreen: true });
	});

	it("carries no surface keys at all", () => {
		mountSheet(1440);
		for (const key of ["attach", "scrim", "persistent"]) {
			expect(Object.hasOwn(props(), key)).toBe(false);
		}
	});
});

describe("useDialogFullscreen hosted as a destination surface", () => {
	it("teleports, drops the scrim and stops closing on an outside click", () => {
		const target = document.createElement("div");
		mountHosted(1440, target);
		expect(props().attach).toBe(target);
		expect(props().scrim).toBe(false);
		expect(props().persistent).toBe(true);
		expect(props().fullscreen).toBe(false);
	});

	it("drops geometry, so an 800px sheet cannot overflow a narrower surface", () => {
		const target = document.createElement("div");
		mountHosted(1440, target);
		expect(Object.hasOwn(props(), "minWidth")).toBe(false);
		expect(Object.hasOwn(props(), "maxWidth")).toBe(false);
	});

	it("applies to every dialog a component owns, not only its first", () => {
		const target = document.createElement("div");
		mountHosted(1440, target);
		const second = captured!.dialogPropsFor({ maxWidth: "600px" })
			.value as unknown as Record<string, unknown>;
		expect(second.attach).toBe(target);
		expect(second.scrim).toBe(false);
	});

	it("is inert while the host has not resolved its element yet", () => {
		// `attachTo` starts null for one tick while the host mounts. Teleporting
		// into null would throw inside VOverlay; behaving as an ordinary dialog
		// for that tick is the safe reading.
		mountHosted(1440, null);
		expect(Object.hasOwn(props(), "attach")).toBe(false);
		expect(props().minWidth).toBe("800px");
	});
});
