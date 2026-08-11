// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import FacturacionDialog, {
	CFDI_STALE_RESUME_MS,
} from "../src/posapp/components/pos/cfdi/FacturacionDialog.vue";

const options = FacturacionDialog as unknown as {
	methods: { onVisibilityChange(this: Record<string, unknown>): void };
};

function setVisibility(state: "visible" | "hidden") {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => state,
	});
}

function makeContext(overrides: Record<string, unknown> = {}) {
	return {
		hiddenAt: 0,
		modelValue: true,
		cfdiStore: {
			stampPhase: "idle",
			detail: null,
			search: vi.fn(),
			openInvoice: vi.fn(),
		},
		...overrides,
	} as Record<string, unknown> & {
		cfdiStore: {
			stampPhase: string;
			detail: unknown;
			search: ReturnType<typeof vi.fn>;
			openInvoice: ReturnType<typeof vi.fn>;
		};
	};
}

function resumeAfter(ctx: ReturnType<typeof makeContext>, hiddenForMs: number) {
	const t0 = 1_000_000;
	vi.spyOn(Date, "now").mockReturnValue(t0);
	setVisibility("hidden");
	options.methods.onVisibilityChange.call(ctx);
	vi.spyOn(Date, "now").mockReturnValue(t0 + hiddenForMs);
	setVisibility("visible");
	options.methods.onVisibilityChange.call(ctx);
}

describe("Facturación resume refetch (wake-from-sleep tolerance)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		setVisibility("visible");
	});

	it("a short tab switch does not refetch (protects a half-typed form)", () => {
		const ctx = makeContext();
		resumeAfter(ctx, CFDI_STALE_RESUME_MS - 1);
		expect(ctx.cfdiStore.search).not.toHaveBeenCalled();
		expect(ctx.cfdiStore.openInvoice).not.toHaveBeenCalled();
	});

	it("a stale resume on the list view refreshes the search", () => {
		const ctx = makeContext();
		resumeAfter(ctx, CFDI_STALE_RESUME_MS + 1);
		expect(ctx.cfdiStore.search).toHaveBeenCalledTimes(1);
	});

	it("a stale resume with an open invoice refetches its detail", () => {
		const ctx = makeContext();
		ctx.cfdiStore.detail = { invoice: { name: "ACC-SINV-0001" } };
		resumeAfter(ctx, CFDI_STALE_RESUME_MS + 1);
		expect(ctx.cfdiStore.openInvoice).toHaveBeenCalledWith("ACC-SINV-0001");
		expect(ctx.cfdiStore.search).not.toHaveBeenCalled();
	});

	it("never interrupts an in-flight stamp", () => {
		const ctx = makeContext();
		ctx.cfdiStore.stampPhase = "stamping";
		ctx.cfdiStore.detail = { invoice: { name: "ACC-SINV-0001" } };
		resumeAfter(ctx, CFDI_STALE_RESUME_MS + 1);
		expect(ctx.cfdiStore.openInvoice).not.toHaveBeenCalled();
		expect(ctx.cfdiStore.search).not.toHaveBeenCalled();
	});

	it("does nothing while the dialog is closed", () => {
		const ctx = makeContext({ modelValue: false });
		resumeAfter(ctx, CFDI_STALE_RESUME_MS + 1);
		expect(ctx.cfdiStore.search).not.toHaveBeenCalled();
		expect(ctx.cfdiStore.openInvoice).not.toHaveBeenCalled();
	});
});
