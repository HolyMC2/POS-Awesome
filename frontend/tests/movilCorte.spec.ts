// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * The corte on a phone (`MovilCorte.dc.html`).
 *
 * `movilCorteNoteGate.spec.ts` owns the two RULES — when a note is mandatory
 * and what the difference is as a share of the day. This file owns the SCREEN,
 * and specifically the four joins where a rule could quietly become something
 * else on the way to the glass:
 *
 *   1. the counted figure is derived from the ten steppers in integers, not
 *      asserted — the same property `corteDenominations.spec.ts` holds for the
 *      desktop card, re-checked here because this screen is where the count is
 *      actually done;
 *   2. the expected-cash derivation is the artboard's identity, to the peso;
 *   3. the difference reaches the hero through `resolveBandState`, so the
 *      screen carries no competing total;
 *   4. the gate blocks the close when it should and does not when it should not
 *      — asserted on the BUTTON and on the emitted event, because a disabled
 *      attribute is a rendering and the refusal has to be real.
 */

import MovilCorte from "../src/posapp/components/pos/mobile/closing/MovilCorte.vue";

/** A marker no formatter would produce, so counting it counts money figures. */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${Number(value).toFixed(2)}`;

/** The artboard's own shift (build plan §8 R7 — the artboards win over `_rail.txt`). */
const ARTBOARD = {
	expected: 5391,
	counted: 5366,
	takings: 10670,
	breakdown: { openingFloat: 1500, cashSales: 5120, advances: 600, withdrawals: 1829 },
	/** face minor → how many, exactly as drawn. */
	count: [
		[100_000, 2],
		[50_000, 3],
		[20_000, 4],
		[10_000, 6],
		[5_000, 5],
		[2_000, 8],
		[1_000, 3],
		[500, 3],
		[200, 3],
		[100, 5],
	] as const,
	note: "Faltan $25 de la venta B-04801: se dio cambio de más al cerrar con prisa.",
};

let wrapper: ReturnType<typeof mount> | null = null;

const listeners = () => ({
	// VTU does not record component emits in this repo (build plan §10), so the
	// assertions run off listener props rather than `wrapper.emitted()`.
	"onUpdate:counted": vi.fn(),
	"onUpdate:note": vi.fn(),
	onCloseShift: vi.fn(),
});

const mountCorte = (overrides: Record<string, unknown> = {}) => {
	const on = listeners();
	wrapper = mount(MovilCorte, {
		props: {
			registerLabel: "Caja 2",
			cashierName: "Jenni",
			periodStart: "2026-08-22 09:02:00",
			periodEnd: "",
			currency: "MXN",
			expected: ARTBOARD.expected,
			breakdown: ARTBOARD.breakdown,
			takings: ARTBOARD.takings,
			ticketsUploaded: 31,
			openDrafts: 0,
			formatCurrency: (value: number) => money(value),
			...overrides,
			...on,
		},
	});
	return { wrapper, on };
};

const setCount = async (faceMinor: number, count: number) => {
	const row = wrapper!.element.querySelector(`[data-face-minor="${faceMinor}"]`);
	const input = row?.querySelector('[data-testid="denomination-count"]') as HTMLInputElement;
	if (!input) throw new Error(`no stepper for face ${faceMinor}`);
	input.value = String(count);
	input.dispatchEvent(new Event("input"));
	await nextTick();
};

const enterArtboardCount = async () => {
	for (const [face, count] of ARTBOARD.count) await setCount(face, count);
};

const typeNote = async (text: string) => {
	const field = wrapper!.get('[data-testid="movil-corte-note-input"]');
	(field.element as HTMLTextAreaElement).value = text;
	await field.trigger("input");
};

const text = (selector: string) =>
	wrapper!.element.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

beforeEach(() => {
	vi.stubGlobal("__", (value: string, args?: (string | number)[]) =>
		args && args.length
			? value.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m))
			: value,
	);
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
	vi.unstubAllGlobals();
});

describe("the header carries the shift", () => {
	it("names the register, the cashier and the span the artboard draws", () => {
		mountCorte();
		expect(text('[data-testid="movil-corte-subtitle"]')).toBe("Caja 2 · Jenni · 09:02");
	});

	it("draws the artboard's full span beside the open chip", () => {
		mountCorte({ periodEnd: "2026-08-22 20:05:00" });
		expect(text('[data-testid="movil-corte-subtitle"]')).toBe("Caja 2 · Jenni · 09:02 → 20:05");
		// Both, exactly as the artboard has them: the closing doc is stamped with
		// an end when the corte is PREPARED, and the shift is open until the
		// button below is pressed. Deriving "open" from a missing end would hide
		// the chip on precisely the screen it belongs to.
		expect(text('[data-testid="movil-corte-status"]')).toBe("Shift open");
	});

	it("drops the chip when the caller says the shift is not open", () => {
		mountCorte({ shiftOpen: false });
		expect(wrapper!.find('[data-testid="movil-corte-status"]').exists()).toBe(false);
	});
});

describe("the drawer is counted, not asserted", () => {
	it("derives the artboard's counted total from its ten rows", async () => {
		const { on } = mountCorte();
		await enterArtboardCount();

		expect(wrapper!.findAll('[data-testid="denomination-row"]')).toHaveLength(10);
		const last = on["onUpdate:counted"].mock.calls.at(-1);
		expect(last).toEqual([ARTBOARD.counted, "denominations"]);
	});

	it("counts in integers, so ten rows of pesos cannot drift a centavo", async () => {
		const { on } = mountCorte();
		// The float-hostile shape: many small faces, summed.
		await setCount(100, 7);
		await setCount(200, 11);
		await setCount(500, 13);
		expect(on["onUpdate:counted"].mock.calls.at(-1)?.[0]).toBe(7 + 22 + 65);
	});

	it("shows the expected-cash derivation exactly as the artboard states it", async () => {
		mountCorte();
		await nextTick();

		const box = text('[data-testid="drawer-count-expected"]');
		// 1,500 + 5,120 + 600 − 1,829 = 5,391.
		expect(box).toContain(money(1500));
		expect(box).toContain(money(5120));
		expect(box).toContain(money(600));
		expect(box).toContain(money(1829));
		expect(text('[data-testid="drawer-count-expected-total"]')).toBe(money(ARTBOARD.expected));
	});
});

describe("the difference is the band's, not this screen's", () => {
	it("renders the artboard's short count in amber, with its share of the day", async () => {
		mountCorte();
		await enterArtboardCount();

		const hero = wrapper!.get('[data-testid="movil-corte-hero"]');
		expect(hero.attributes("data-band-value")).toBe("-25");
		expect(hero.attributes("data-band-tone")).toBe("warning");
		expect(text('[data-testid="movil-corte-difference"]')).toBe(`−${money(25)}`);
		// 25 / 10,670 — the artboard's own figure.
		expect(text('[data-testid="movil-corte-ratio"]')).toBe("0.23 % of sales");
	});

	it("is amber for a surplus too", async () => {
		mountCorte();
		await setCount(100_000, 6);

		const hero = wrapper!.get('[data-testid="movil-corte-hero"]');
		expect(hero.attributes("data-band-value")).toBe("609");
		expect(hero.attributes("data-band-tone")).toBe("warning");
	});

	it("is calm only when the drawer counts clean", async () => {
		mountCorte();
		for (const [face, count] of [
			[100_000, 5],
			[20_000, 1],
			[10_000, 1],
			[5_000, 1],
			[2_000, 2],
			[100, 1],
		] as const) {
			await setCount(face, count);
		}

		const hero = wrapper!.get('[data-testid="movil-corte-hero"]');
		expect(hero.attributes("data-band-value")).toBe("0");
		expect(hero.attributes("data-band-tone")).toBe("positive");
	});

	it("says there is nothing to compare against rather than dividing by a dead day", async () => {
		mountCorte({ takings: 0 });
		await enterArtboardCount();

		expect(wrapper!.find('[data-testid="movil-corte-ratio"]').exists()).toBe(false);
		expect(text('[data-testid="movil-corte-ratio-absent"]')).toBe("no sales to compare against");
	});
});

describe("the note gate holds the close", () => {
	it("blocks a material difference until it is explained", async () => {
		const { on } = mountCorte();
		await enterArtboardCount();

		const primary = wrapper!.get('[data-testid="movil-corte-primary"]');
		expect(wrapper!.get('[data-testid="movil-corte-note"]').attributes("data-note-verdict")).toBe(
			"missing",
		);
		expect(primary.attributes("disabled")).toBeDefined();

		// The refusal has to be real, not only rendered: a disabled attribute is
		// gone the moment anything drives the handler another way.
		await primary.trigger("click");
		expect(on.onCloseShift).not.toHaveBeenCalled();
	});

	it("opens once a real explanation is written, and hands it on", async () => {
		const { on } = mountCorte();
		await enterArtboardCount();
		await typeNote(ARTBOARD.note);

		expect(wrapper!.get('[data-testid="movil-corte-note"]').attributes("data-note-verdict")).toBe(
			"satisfied",
		);
		const primary = wrapper!.get('[data-testid="movil-corte-primary"]');
		expect(primary.attributes("disabled")).toBeUndefined();

		await primary.trigger("click");
		expect(on.onCloseShift).toHaveBeenCalledTimes(1);
		expect(on.onCloseShift.mock.calls[0]?.[0]).toEqual({
			counted: ARTBOARD.counted,
			source: "denominations",
			note: ARTBOARD.note,
		});
		expect(on["onUpdate:note"].mock.calls.at(-1)).toEqual([ARTBOARD.note]);
	});

	it("does not accept a keystroke in place of a reason", async () => {
		const { on } = mountCorte();
		await enterArtboardCount();
		await typeNote(".");

		expect(wrapper!.get('[data-testid="movil-corte-note"]').attributes("data-note-verdict")).toBe(
			"tooShort",
		);
		await wrapper!.get('[data-testid="movil-corte-primary"]').trigger("click");
		expect(on.onCloseShift).not.toHaveBeenCalled();
	});

	it("lets a rounding peso close with nothing written", async () => {
		const { on } = mountCorte({ expected: 5367 });
		await enterArtboardCount();

		// −$1 against expected: inside tolerance, so the note is offered, never
		// demanded. This is the case that decides whether the control keeps its
		// meaning — a nightly demand for prose over a peso produces nightly ".".
		expect(wrapper!.get('[data-testid="movil-corte-note"]').attributes("data-note-verdict")).toBe(
			"notRequired",
		);
		expect(wrapper!.get('[data-testid="movil-corte-note-badge"]').text()).toBe("optional");

		await wrapper!.get('[data-testid="movil-corte-primary"]').trigger("click");
		expect(on.onCloseShift).toHaveBeenCalledTimes(1);
	});

	it("never blocks a drawer that counts clean", async () => {
		const { on } = mountCorte({ expected: 0 });
		await wrapper!.get('[data-testid="movil-corte-primary"]').trigger("click");
		expect(on.onCloseShift).toHaveBeenCalledTimes(1);
	});

	it("keeps a volunteered note even though it was not demanded", async () => {
		const { on } = mountCorte({ expected: 5367 });
		await enterArtboardCount();
		await typeNote("Se dejó propina en la charola, un peso");

		await wrapper!.get('[data-testid="movil-corte-primary"]').trigger("click");
		expect(on.onCloseShift.mock.calls[0]?.[0]?.note).toBe(
			"Se dejó propina en la charola, un peso",
		);
	});
});

describe("one action, and every figure says what it is", () => {
	it("carries exactly one primary, and it is CLOSE SHIFT", async () => {
		mountCorte();
		const primaries = wrapper!.findAll('[data-testid="movil-corte-primary"]');
		expect(primaries).toHaveLength(1);
		expect(primaries[0]!.text()).toBe("CLOSE SHIFT");
		// The band's own bottom lane is the shell's on a phone; this screen must
		// not mount a second one under the dock.
		expect(wrapper!.find('[data-testid="action-band"]').exists()).toBe(false);
	});

	it("leaves no unlabelled money figure on the screen", async () => {
		mountCorte();
		await enterArtboardCount();

		// Counted in TEXT, not in markup: `DenominationRow` legitimately embeds a
		// formatted amount in three `aria-label`s per row ("One more of $1,000"),
		// which is thirty screen-reader strings and zero figures on the glass.
		// Counting the HTML would fail this invariant for the accessibility work
		// that makes the count usable in the first place.
		const rendered = wrapper!.element.textContent ?? "";
		const figures = (rendered.match(new RegExp(MONEY, "g")) || []).length;
		const declared = wrapper!.findAll("[data-money-role]");

		expect(
			figures,
			"a money figure with no data-money-role is how a third total gets on screen unremarked",
		).toBe(declared.length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", async () => {
		mountCorte();
		await enterArtboardCount();

		for (const element of wrapper!.findAll("[data-money-role]")) {
			expect((element.text().match(new RegExp(MONEY, "g")) || []).length).toBe(1);
		}
	});

	it("does not label the percentage as money — it carries no currency", async () => {
		mountCorte();
		await enterArtboardCount();
		expect(
			wrapper!.get('[data-testid="movil-corte-ratio"]').attributes("data-money-role"),
		).toBeUndefined();
	});
});
