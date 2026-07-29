// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import Navbar from "../src/posapp/components/Navbar.vue";

const options = Navbar as unknown as {
	computed: Record<string, (this: Record<string, unknown>) => unknown>;
};

const evaluate = (name: string, context: Record<string, unknown>) =>
	options.computed[name].call(context);

describe("Navbar snackbar placement", () => {
	it("keeps the desktop toast in the top corner, mirrored for RTL", () => {
		expect(
			evaluate("snackbarLocation", {
				isPhoneViewport: false,
				isRtl: false,
			}),
		).toBe("top right");
		expect(
			evaluate("snackbarLocation", {
				isPhoneViewport: false,
				isRtl: true,
			}),
		).toBe("top left");
	});

	it("moves the phone toast off the sticky search header, both directions", () => {
		expect(
			evaluate("snackbarLocation", {
				isPhoneViewport: true,
				isRtl: false,
			}),
		).toBe("bottom center");
		expect(
			evaluate("snackbarLocation", {
				isPhoneViewport: true,
				isRtl: true,
			}),
		).toBe("bottom center");
	});

	it("lifts the phone toast clear of the mobile dock", () => {
		expect(
			evaluate("snackbarOffsetStyle", { isPhoneViewport: true }),
		).toEqual({
			paddingBottom: "calc(var(--pos-dock-height, 0px) + 12px)",
		});
	});

	it("leaves the desktop toast unoffset", () => {
		expect(
			evaluate("snackbarOffsetStyle", { isPhoneViewport: false }),
		).toBeNull();
	});
});
