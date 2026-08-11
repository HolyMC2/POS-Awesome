// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import NavbarMenu from "../src/posapp/components/navbar/NavbarMenu.vue";

const options = NavbarMenu as unknown as {
	computed: Record<string, (this: Record<string, unknown>) => unknown>;
};

type Action = { id: string; handler: string } | null;

function quickActions(posProfile: Record<string, unknown>): Action[] {
	return options.computed.quickActions.call({
		posProfile,
		cashierName: "",
		externalDocumentCheckout: false,
		verticalStore: { externalDocumentCheckout: false },
		isEnabledSetting: (value: unknown) => Boolean(Number(value)),
	}) as Action[];
}

describe("Facturación navbar gating", () => {
	beforeEach(() => {
		(globalThis as { __?: (t: string) => string }).__ = (text: string) => text;
	});

	it("shows the Facturación action only when the profile flag is on", () => {
		const withFlag = quickActions({ posa_cfdi_enable_stamping: 1 });
		expect(withFlag.some((action) => action?.id === "facturacion")).toBe(true);

		const withoutFlag = quickActions({ posa_cfdi_enable_stamping: 0 });
		expect(withoutFlag.some((action) => action?.id === "facturacion")).toBe(false);

		const missingFlag = quickActions({});
		expect(missingFlag.some((action) => action?.id === "facturacion")).toBe(false);
	});

	it("routes the action through the openFacturacion handler", () => {
		const actions = quickActions({ posa_cfdi_enable_stamping: 1 });
		const item = actions.find((action) => action?.id === "facturacion");
		expect(item?.handler).toBe("openFacturacion");
	});
});
