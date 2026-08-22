// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * Counting the drawer by denomination (build plan §12 C, artboard
 * `design/register-hifi/Corte.dc.html`).
 *
 * The corte used to ask for a total and believe it. The artboard counts ten
 * denominations instead, and the reason is not decoration: a typed total is an
 * assertion, a denomination count is a derivation, and only the second one can
 * be checked. This file holds the derivation to that standard.
 *
 * Every money figure below comes from the artboard, which §8 R7 settled as the
 * reference of record — `_rail.txt` says salidas 1,830 / esperado 5,390 /
 * contado 5,365, one peso off in each, and both sets happen to yield −25, which
 * is why the drift survived. The artboard's numbers are asserted here so a later
 * "correction" of the note cannot quietly move the code the wrong way.
 */

import DrawerCount from "../src/posapp/components/pos/closing/DrawerCount.vue";
import {
	countedMinorTotal,
	denominationsFor,
	minorToMajor,
	rowMinorSubtotal,
} from "../src/posapp/components/pos/closing/denominations";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

/** The artboard's own count, row by row: `$1,000 − 2 +  $2,000.00` and so on. */
const ARTBOARD_COUNT: ReadonlyArray<{ minor: number; count: number; subtotal: number }> = [
	{ minor: 100_000, count: 2, subtotal: 2000 },
	{ minor: 50_000, count: 3, subtotal: 1500 },
	{ minor: 20_000, count: 4, subtotal: 800 },
	{ minor: 10_000, count: 6, subtotal: 600 },
	{ minor: 5_000, count: 5, subtotal: 250 },
	{ minor: 2_000, count: 8, subtotal: 160 },
	{ minor: 1_000, count: 3, subtotal: 30 },
	{ minor: 500, count: 3, subtotal: 15 },
	{ minor: 200, count: 3, subtotal: 6 },
	{ minor: 100, count: 5, subtotal: 5 },
];

/** Artboard band: fondo 1,500 + efectivo 5,120 + anticipos 600 − salidas 1,829. */
const ARTBOARD_EXPECTED = 5391;
const ARTBOARD_COUNTED = 5366;
const ARTBOARD_DIFFERENCE = -25;

/** A marker no formatter would emit, so counting it counts MONEY FIGURES. */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${value.toFixed(2)}`;
/**
 * Counted over rendered TEXT, not markup. The steppers name their denomination
 * in an `aria-label` — "one more of ¤500.00" — which is exactly right for a
 * screen reader and is not a figure on screen. Matching markup would count
 * thirty of those and call the accessibility work a duplication.
 */
const countMoney = (text: string) => (text.match(new RegExp(MONEY, "g")) || []).length;

/**
 * Listener props, not `wrapper.emitted()`. VTU records only the native event
 * that bubbles to the root in this repo, so an emit assertion fails while the
 * component emits perfectly well (build plan §10, found the hard way three
 * times in one wave).
 */
const mountCount = (props: Record<string, unknown> = {}) => {
	const onCounted = vi.fn();
	const wrapper = mount(DrawerCount, {
		props: {
			currency: "MXN",
			expected: ARTBOARD_EXPECTED,
			formatCurrency: money,
			"onUpdate:counted": onCounted,
			...props,
		},
	});
	return { wrapper, onCounted };
};

type Wrapper = ReturnType<typeof mountCount>["wrapper"];

/** What the card last published: `[amount, source]`. */
const lastCounted = (onCounted: ReturnType<typeof vi.fn>) =>
	onCounted.mock.calls.at(-1) as [number, string] | undefined;

/** Drive the ten steppers to the artboard's counts. */
const enterArtboardCount = async (wrapper: Wrapper) => {
	const inputs = wrapper.findAll('[data-testid="denomination-count"]');
	for (const [index, row] of ARTBOARD_COUNT.entries()) {
		const input = inputs[index];
		if (!input) throw new Error(`no stepper for face ${row.minor}`);
		await input.setValue(String(row.count));
	}
};

beforeEach(() => {
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args && args.length
			? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m))
			: text,
	);
});

describe("the denomination list varies by currency", () => {
	it("gives MXN the artboard's ten faces, largest first", () => {
		const { faces, minorPerMajor } = denominationsFor("MXN");

		expect(minorPerMajor).toBe(100);
		expect(faces).toEqual(ARTBOARD_COUNT.map((row) => row.minor));
		// The artboard's own header: "10 denominaciones".
		expect(faces.length).toBe(10);
	});

	it("gives a different currency a different list", () => {
		const mxn = denominationsFor("MXN").faces;
		const usd = denominationsFor("USD").faces;

		expect(usd).not.toEqual(mxn);
		// A count list without coins is not a count list: a US drawer holds
		// quarters, and MXN's bottom four rows are coins too.
		expect(usd).toContain(25);
	});

	it("falls back rather than rendering a drawer with no rows", () => {
		// An unknown code still has to be countable — the register has to close
		// either way, and the manual override is the escape hatch for the rest.
		const unknown = denominationsFor("ZZZ");
		expect(unknown.faces.length).toBeGreaterThan(0);
		expect([...unknown.faces]).toEqual([...unknown.faces].sort((a, b) => b - a));

		// A currency smartTender already knows is reused rather than guessed.
		expect(denominationsFor("PKR").faces).toContain(500_000);
	});

	it("does not assume every currency has hundredths", () => {
		expect(denominationsFor("JPY").minorPerMajor).toBe(1);
	});
});

describe("the rows derive the counted total exactly", () => {
	it("reaches the artboard's $5,366.00 from its own ten rows", () => {
		const minor = countedMinorTotal(ARTBOARD_COUNT);

		expect(Number.isInteger(minor)).toBe(true);
		expect(minor).toBe(536_600);
		expect(minorToMajor(minor, 100)).toBe(ARTBOARD_COUNTED);
	});

	it("gives every row the subtotal the artboard prints beside it", () => {
		for (const row of ARTBOARD_COUNT) {
			expect(minorToMajor(rowMinorSubtotal(row.minor, row.count), 100)).toBe(row.subtotal);
		}
	});

	it("is integer arithmetic, so a fractional count does not drift", () => {
		// 3 dimes + 2 nickels + 1 penny. In float that is 0.41000000000000003,
		// and a drawer that reports a fraction of a cent reports a difference
		// nobody can explain or count back.
		const change = [
			{ minor: 10, count: 3 },
			{ minor: 5, count: 2 },
			{ minor: 1, count: 1 },
		];
		const floatSum = 0.1 * 3 + 0.05 * 2 + 0.01 * 1;

		expect(floatSum).not.toBe(0.41);
		expect(minorToMajor(countedMinorTotal(change), 100)).toBe(0.41);
	});

	it("refuses half a banknote and a negative count", () => {
		expect(countedMinorTotal([{ minor: 10_000, count: 2.7 }])).toBe(20_000);
		expect(countedMinorTotal([{ minor: 10_000, count: -3 }])).toBe(0);
	});

	/**
	 * MUTATION TEST. Every row must contribute, and "obviously it does" is how a
	 * skipped face survives — a stale key, a filter, a loop that stops one short.
	 * Zeroing each row in turn must move the total; if any one of them does not,
	 * this fails naming the face that is being ignored.
	 */
	it("fails by name if any single row stops contributing", () => {
		for (const dropped of ARTBOARD_COUNT) {
			const mutated = ARTBOARD_COUNT.map((row) =>
				row.minor === dropped.minor ? { ...row, count: 0 } : row,
			);
			const total = minorToMajor(countedMinorTotal(mutated), 100);

			expect(
				total,
				`zeroing the $${dropped.minor / 100} row must drop the counted total by exactly $${dropped.subtotal} — the derivation is not counting every row as drawn`,
			).toBe(ARTBOARD_COUNTED - dropped.subtotal);
		}
	});
});

describe("the card counts the drawer", () => {
	it("renders one stepper per denomination", () => {
		const { wrapper } = mountCount();

		expect(wrapper.findAll('[data-testid="denomination-row"]')).toHaveLength(10);
		expect(wrapper.get('[data-testid="drawer-count-denomination-count"]').text()).toContain("10");
	});

	it("derives the counted figure from the steppers and publishes it", async () => {
		const { wrapper, onCounted } = mountCount();
		await enterArtboardCount(wrapper);

		expect(wrapper.get('[data-testid="drawer-count-counted"]').text()).toBe(money(ARTBOARD_COUNTED));
		expect(lastCounted(onCounted)).toEqual([ARTBOARD_COUNTED, "denominations"]);
	});

	it("steps a single row without touching the others", async () => {
		const { wrapper } = mountCount();
		await enterArtboardCount(wrapper);
		// One more $500 note found under the tray.
		await wrapper.findAll('[data-testid="denomination-increment"]')[1]?.trigger("click");

		expect(wrapper.get('[data-testid="drawer-count-counted"]').text()).toBe(
			money(ARTBOARD_COUNTED + 500),
		);
	});

	it("declares every money figure, and claims no total", async () => {
		const { wrapper } = mountCount();
		await enterArtboardCount(wrapper);

		const declared = wrapper.findAll("[data-money-role]");

		// Ten denomination rows are twenty money figures — a face and a subtotal
		// each — plus the counted figure. Every one of them says what it is.
		expect(declared).toHaveLength(21);
		expect(countMoney(wrapper.text())).toBe(declared.length);
		for (const element of declared) {
			expect(countMoney(element.text())).toBe(1);
		}
		// The band owns the total; this card must not claim one.
		expect(wrapper.findAll('[data-money-role="total"]')).toHaveLength(0);
	});
});

describe("a hand-typed total wins, and says so", () => {
	it("overrides the derived figure and stays labelled as an override", async () => {
		const { wrapper, onCounted } = mountCount();
		await enterArtboardCount(wrapper);
		await wrapper.get('[data-testid="drawer-count-override-toggle"]').trigger("click");
		await wrapper.get('[data-testid="drawer-count-manual-input"]').setValue("5300");

		expect(lastCounted(onCounted)).toEqual([5300, "manual"]);
		expect(wrapper.get('[data-testid="drawer-count"]').attributes("data-count-source")).toBe("manual");
		expect(wrapper.find('[data-testid="drawer-count-manual-chip"]').exists()).toBe(true);

		// Both figures stay on screen. The gap between the count and the claim is
		// the reason a supervisor opens this screen at all.
		expect(wrapper.get('[data-testid="drawer-count-derived"]').text()).toContain(
			money(ARTBOARD_COUNTED),
		);
	});

	it("hands the figure back to the count when the override is dropped", async () => {
		const { wrapper, onCounted } = mountCount();
		await enterArtboardCount(wrapper);
		const toggle = wrapper.get('[data-testid="drawer-count-override-toggle"]');

		await toggle.trigger("click");
		await wrapper.get('[data-testid="drawer-count-manual-input"]').setValue("5300");
		await toggle.trigger("click");

		expect(lastCounted(onCounted)).toEqual([ARTBOARD_COUNTED, "denominations"]);
		expect(wrapper.find('[data-testid="drawer-count-manual-chip"]').exists()).toBe(false);
	});

	it("treats a figure that arrived from elsewhere as the override it is", () => {
		// A resumed close, or an amount typed straight into the reconciliation
		// table: it was not derived from these rows, so it cannot claim to be.
		const { wrapper, onCounted } = mountCount({ initialCounted: 4820 });

		expect(wrapper.get('[data-testid="drawer-count"]').attributes("data-count-source")).toBe("manual");
		expect(lastCounted(onCounted)).toEqual([4820, "manual"]);
	});
});

describe("the expected box shows provenance only when it accounts for expected", () => {
	it("shows the identity when the parts add up", () => {
		const { wrapper } = mountCount({
			breakdown: { openingFloat: 1500, cashSales: 5120, advances: 600, withdrawals: 1829 },
		});

		const box = wrapper.get('[data-testid="drawer-count-expected"]');
		expect(box.exists()).toBe(true);
		expect(wrapper.get('[data-testid="drawer-count-expected-total"]').text()).toBe(
			money(ARTBOARD_EXPECTED),
		);
	});

	it("shows nothing when the parts do not, rather than a sum that lies", () => {
		// The same shift with `advances` missing — 1500 + 5120 − 1829 is 4,791,
		// not 5,391. A box that printed that identity beside "= 5,391.00" would
		// be wrong on screen in a way a cashier is expected to trust.
		const { wrapper } = mountCount({
			breakdown: { openingFloat: 1500, cashSales: 5120, withdrawals: 1829 },
		});

		expect(wrapper.find('[data-testid="drawer-count-expected"]').exists()).toBe(false);
	});
});

describe("the difference reaches the band", () => {
	/** The seam: whatever the card publishes is what the band is fed. */
	const bandFor = (counted: number) =>
		resolveBandState({ kind: "closing", expected: ARTBOARD_EXPECTED, counted });

	it("carries the artboard's −$25.00, in amber", async () => {
		const { wrapper, onCounted } = mountCount();
		await enterArtboardCount(wrapper);
		const [counted] = lastCounted(onCounted) as [number, string];

		const band = bandFor(counted);

		expect(band.kind).toBe("closing");
		expect(band.value).toBe(ARTBOARD_DIFFERENCE);
		expect(band.tone).toBe("warning");
		expect(band.primaryAction.id).toBe("shift.close");
	});

	it("is amber for a surplus too — cash that appeared is unexplained as well", () => {
		const over = bandFor(ARTBOARD_EXPECTED + 25);

		expect(over.value).toBe(25);
		expect(over.tone).toBe("warning");
		expect(over.labelKey).toContain("over");
	});

	it("is calm only on a clean zero", () => {
		expect(bandFor(ARTBOARD_EXPECTED).tone).toBe("positive");
		expect(bandFor(ARTBOARD_EXPECTED).value).toBe(0);
	});

	it("carries a hand-typed total through unchanged", async () => {
		const { wrapper, onCounted } = mountCount();
		await wrapper.get('[data-testid="drawer-count-override-toggle"]').trigger("click");
		await wrapper.get('[data-testid="drawer-count-manual-input"]').setValue("5391");

		const [counted, source] = lastCounted(onCounted) as [number, string];

		expect(source).toBe("manual");
		// An override is a different PROVENANCE, not a different arithmetic: a
		// hand-typed figure equal to expected still closes the drawer clean.
		expect(bandFor(counted).tone).toBe("positive");
	});
});
