// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import PaymentReadinessHeader from "../src/posapp/components/pos/payments/PaymentReadinessHeader.vue";
import {
	claimsReady,
	resolveHardwareReadiness,
	type DeviceId,
	type HardwareReadiness,
	type HardwareReadinessInput,
} from "../src/posapp/components/pos/payments/hardwareReadiness";
import { useHardwareReadiness } from "../src/posapp/components/pos/payments/useHardwareReadiness";

/**
 * "Impresora lista" is a promise the cashier acts on.
 *
 * They hit COBRAR expecting a drawer to open, a ticket to come out and a card
 * to authorise. A green chip that is really "we never checked" converts an
 * unknown into a commitment, and the truth arrives with the customer's card
 * already in their hand. So the rule under test is a REFUSAL: a claim comes
 * only from evidence, and the absence of evidence emits nothing.
 *
 * Mutation-tested at the bottom of this file, in the shape
 * `tenderChips.spec.ts` settled on — a case table, a set of plausible
 * weakenings, and the assertion that the table kills every one of them.
 */

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

const SILENT: HardwareReadinessInput = { usesSilentPrint: true, printerStatus: "ok" };

describe("a claim comes only from evidence", () => {
	it("says the printer is ready when the health check says so", () => {
		expect(claimsReady(resolveHardwareReadiness(SILENT), "printer")).toBe(true);
	});

	it("says NOTHING while the health check has not answered", () => {
		// The rollup is "unknown" for the window between boot and the first QZ
		// check — which is exactly when a stale green would be believed.
		expect(resolveHardwareReadiness({ usesSilentPrint: true }).chips).toEqual([]);
		expect(
			resolveHardwareReadiness({ usesSilentPrint: true, printerStatus: "unknown" }).chips,
		).toEqual([]);
	});

	it("says nothing about a printer this register does not drive", () => {
		// A register printing through the browser dialog has no "ready" state,
		// and a chip that is always grey teaches the operator to stop reading
		// the row.
		expect(resolveHardwareReadiness({ printerStatus: "ok" }).chips).toEqual([]);
	});

	it("raises attention rather than staying silent on a fault", () => {
		for (const status of ["warn", "fail"] as const) {
			const readiness = resolveHardwareReadiness({ usesSilentPrint: true, printerStatus: status });
			expect(claimsReady(readiness, "printer")).toBe(false);
			expect(readiness.needsAttention).toBe(true);
			// A fault is an instruction and cannot be dropped; "ready" is
			// reassurance and can.
			expect(readiness.chips[0]?.priority).toBe(1);
		}
	});

	it("never claims a drawer, because nothing in this app reads one", () => {
		expect(claimsReady(resolveHardwareReadiness({ drawerConnected: null }), "drawer")).toBe(false);
		expect(claimsReady(resolveHardwareReadiness({}), "drawer")).toBe(false);
		// The seam is real, not decoration: hand it an answer and it reports it.
		expect(claimsReady(resolveHardwareReadiness({ drawerConnected: true }), "drawer")).toBe(true);
		expect(
			resolveHardwareReadiness({ drawerConnected: false }).chips[0]?.state,
		).toBe("attention");
	});

	it("never claims a terminal from configuration alone", () => {
		// `mp_point_enabled` is a SETTING, not a state. Only a probe that came
		// back with an enabled terminal earns the chip.
		expect(claimsReady(resolveHardwareReadiness({ terminalsAvailable: null }), "terminal")).toBe(
			false,
		);
		expect(claimsReady(resolveHardwareReadiness({ terminalsAvailable: 1 }), "terminal")).toBe(true);
	});

	it("treats a shop with no terminal as silent, not as failing", () => {
		const readiness = resolveHardwareReadiness({ terminalsAvailable: 0 });
		expect(readiness.chips).toEqual([]);
		expect(readiness.needsAttention).toBe(false);
	});

	it("names the terminal only on a chip it already earned", () => {
		expect(resolveHardwareReadiness({ terminalsAvailable: 2, terminalName: "BBVA" }).chips[0])
			.toMatchObject({ labelKey: "Terminal {0} ready", labelParams: ["BBVA"] });
		expect(resolveHardwareReadiness({ terminalsAvailable: null, terminalName: "BBVA" }).chips)
			.toEqual([]);
	});

	it("orders the chips the way the cashier meets the devices", () => {
		const readiness = resolveHardwareReadiness({
			drawerConnected: true,
			usesSilentPrint: true,
			printerStatus: "ok",
			terminalsAvailable: 1,
		});
		expect(readiness.chips.map((chip) => chip.id)).toEqual(["drawer", "printer", "terminal"]);
	});

	it("survives being handed nothing at all", () => {
		expect(resolveHardwareReadiness(null).chips).toEqual([]);
		expect(resolveHardwareReadiness(undefined).needsAttention).toBe(false);
	});
});

describe("what the header draws", () => {
	const mountHeader = (hardware: HardwareReadinessInput | null) =>
		mount(PaymentReadinessHeader, { props: { hardware } });

	it("renders a chip only for a device with evidence behind it", () => {
		const wrapper = mountHeader({ usesSilentPrint: true, printerStatus: "ok" });
		expect(wrapper.find('[data-testid="pay-readiness-printer"]').text()).toBe("Printer ready");
		expect(wrapper.find('[data-testid="pay-readiness-drawer"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="pay-readiness-terminal"]').exists()).toBe(false);
	});

	it("renders no chips at all on a register that knows nothing", () => {
		const wrapper = mountHeader(null);
		expect(wrapper.findAll("[data-state]")).toHaveLength(0);
		// The back affordance is not conditional on hardware — it is the way
		// out of the screen.
		expect(wrapper.find('[data-testid="pay-back-to-sale"]').exists()).toBe(true);
	});

	it("interpolates the terminal name into its label", () => {
		const wrapper = mountHeader({ terminalsAvailable: 1, terminalName: "BBVA" });
		expect(wrapper.find('[data-testid="pay-readiness-terminal"]').text()).toBe("Terminal BBVA ready");
	});

	it("asks the shell to go back to the sale, and nothing else", () => {
		// `wrapper.emitted()` does not record component emits in this repo
		// (build plan §10); listener props are the working assertion.
		const onBack = vi.fn();
		const wrapper = mount(PaymentReadinessHeader, { props: { hardware: null, onBack } });
		wrapper.find('[data-testid="pay-back-to-sale"]').trigger("click");
		expect(onBack).toHaveBeenCalledTimes(1);
	});
});

describe("the composable reports the register's real state", () => {
	it("reads the print-health rollup and the profile's silent-print flag", () => {
		const input = useHardwareReadiness({
			posProfile: { posa_silent_print: 1 },
			printHealth: { rollup: { value: "ok" } },
		});
		expect(claimsReady(resolveHardwareReadiness(input.value), "printer")).toBe(true);
	});

	it("claims nothing when the profile does not print silently", () => {
		const input = useHardwareReadiness({
			posProfile: { posa_silent_print: 0 },
			printHealth: { rollup: { value: "ok" } },
		});
		expect(resolveHardwareReadiness(input.value).chips).toEqual([]);
	});

	it("leaves drawer and terminal unknown rather than optimistic", () => {
		const input = useHardwareReadiness({
			posProfile: { posa_silent_print: 1 },
			printHealth: { rollup: { value: "ok" } },
		});
		expect(input.value.drawerConnected).toBeNull();
		expect(input.value.terminalsAvailable).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Mutation test.
// ---------------------------------------------------------------------------

interface ReadinessCase {
	name: string;
	input: HardwareReadinessInput;
	/** Devices the header is allowed to claim are ready, in order. */
	readyClaims: DeviceId[];
	/** Devices the header must flag. */
	attentionClaims: DeviceId[];
}

/**
 * The contract, as a table, because the harness below re-runs every mutant
 * against this same list. A case no mutant fails is a case with no
 * discriminating power, and the harness says so.
 */
const CASES: readonly ReadinessCase[] = [
	{
		name: "a healthy silent printer is the one thing this register can claim",
		input: { usesSilentPrint: true, printerStatus: "ok" },
		readyClaims: ["printer"],
		attentionClaims: [],
	},
	{
		// THE CASE WITH THE PROMISE BEHIND IT. Between boot and the first QZ
		// check the rollup is "unknown"; a green chip there is a lie the
		// cashier acts on.
		name: "an unanswered health check claims nothing",
		input: { usesSilentPrint: true, printerStatus: "unknown" },
		readyClaims: [],
		attentionClaims: [],
	},
	{
		name: "a printer fault is stated, not swallowed",
		input: { usesSilentPrint: true, printerStatus: "fail" },
		readyClaims: [],
		attentionClaims: ["printer"],
	},
	{
		name: "a browser-print register says nothing about a printer",
		input: { usesSilentPrint: false, printerStatus: "ok" },
		readyClaims: [],
		attentionClaims: [],
	},
	{
		name: "a drawer nobody can read is never claimed",
		input: { drawerConnected: null, usesSilentPrint: true, printerStatus: "ok" },
		readyClaims: ["printer"],
		attentionClaims: [],
	},
	{
		name: "a drawer that answered NO is flagged",
		input: { drawerConnected: false },
		readyClaims: [],
		attentionClaims: ["drawer"],
	},
	{
		name: "an unprobed terminal is never claimed",
		input: { terminalsAvailable: null },
		readyClaims: [],
		attentionClaims: [],
	},
	{
		name: "a shop with zero terminals is silent, not failing",
		input: { terminalsAvailable: 0 },
		readyClaims: [],
		attentionClaims: [],
	},
	{
		name: "a probed terminal is claimed",
		input: { terminalsAvailable: 2, terminalName: "BBVA" },
		readyClaims: ["terminal"],
		attentionClaims: [],
	},
];

type Resolver = (_input: HardwareReadinessInput | null | undefined) => HardwareReadiness;

const claimsOf = (resolve: Resolver, input: HardwareReadinessInput) => {
	const readiness = resolve(input);
	return {
		ready: readiness.chips.filter((c) => c.state === "ready").map((c) => c.id),
		attention: readiness.chips.filter((c) => c.state === "attention").map((c) => c.id),
	};
};

const matches = (resolve: Resolver, testCase: ReadinessCase): boolean => {
	const claims = claimsOf(resolve, testCase.input);
	return (
		JSON.stringify(claims.ready) === JSON.stringify(testCase.readyClaims) &&
		JSON.stringify(claims.attention) === JSON.stringify(testCase.attentionClaims)
	);
};

/** A mutant built from three device rules, so each one can be weakened alone. */
const build = (rules: {
	printer: (_i: HardwareReadinessInput) => HardwareReadiness["chips"][number] | null;
	drawer: (_i: HardwareReadinessInput) => HardwareReadiness["chips"][number] | null;
	terminal: (_i: HardwareReadinessInput) => HardwareReadiness["chips"][number] | null;
}): Resolver => {
	return (input) => {
		const source = input ?? {};
		const chips = [rules.drawer(source), rules.printer(source), rules.terminal(source)].filter(
			(chip): chip is HardwareReadiness["chips"][number] => chip !== null,
		);
		return { chips, needsAttention: chips.some((chip) => chip.state === "attention") };
	};
};

const OK_PRINTER = (i: HardwareReadinessInput) => {
	if (!i.usesSilentPrint) return null;
	const status = i.printerStatus ?? "unknown";
	if (status === "unknown") return null;
	return status === "ok"
		? ({ id: "printer", state: "ready", labelKey: "Printer ready", priority: 2 } as const)
		: ({ id: "printer", state: "attention", labelKey: "Printer unavailable", priority: 1 } as const);
};
const OK_DRAWER = (i: HardwareReadinessInput) => {
	if (i.drawerConnected === null || i.drawerConnected === undefined) return null;
	return i.drawerConnected
		? ({ id: "drawer", state: "ready", labelKey: "Drawer connected", priority: 3 } as const)
		: ({ id: "drawer", state: "attention", labelKey: "Drawer not connected", priority: 1 } as const);
};
const OK_TERMINAL = (i: HardwareReadinessInput) => {
	const available = i.terminalsAvailable;
	if (available === null || available === undefined || available <= 0) return null;
	return { id: "terminal", state: "ready", labelKey: "Terminal ready", priority: 2 } as const;
};

/**
 * Each mutant is a plausible weakening somebody could actually write on a
 * Friday — an optimistic default, a missing guard, a setting mistaken for a
 * state. Not a random operator flip.
 */
const MUTANTS: ReadonlyArray<readonly [string, Resolver]> = [
	[
		"treats an unanswered health check as ready",
		build({
			drawer: OK_DRAWER,
			terminal: OK_TERMINAL,
			printer: (i) => {
				if (!i.usesSilentPrint) return null;
				const status = i.printerStatus ?? "ok";
				return status === "ok" || status === "unknown"
					? ({ id: "printer", state: "ready", labelKey: "Printer ready", priority: 2 } as const)
					: ({ id: "printer", state: "attention", labelKey: "Printer unavailable", priority: 1 } as const);
			},
		}),
	],
	[
		"claims a printer on a register that prints through the browser",
		build({
			drawer: OK_DRAWER,
			terminal: OK_TERMINAL,
			printer: (i) => {
				const status = i.printerStatus ?? "unknown";
				if (status === "unknown") return null;
				return status === "ok"
					? ({ id: "printer", state: "ready", labelKey: "Printer ready", priority: 2 } as const)
					: ({ id: "printer", state: "attention", labelKey: "Printer unavailable", priority: 1 } as const);
			},
		}),
	],
	[
		"downgrades a printer fault to silence",
		build({
			drawer: OK_DRAWER,
			terminal: OK_TERMINAL,
			printer: (i) =>
				i.usesSilentPrint && i.printerStatus === "ok"
					? ({ id: "printer", state: "ready", labelKey: "Printer ready", priority: 2 } as const)
					: null,
		}),
	],
	[
		"assumes a drawer nobody read is connected",
		build({
			printer: OK_PRINTER,
			terminal: OK_TERMINAL,
			drawer: (i) =>
				i.drawerConnected === false
					? ({ id: "drawer", state: "attention", labelKey: "Drawer not connected", priority: 1 } as const)
					: ({ id: "drawer", state: "ready", labelKey: "Drawer connected", priority: 3 } as const),
		}),
	],
	[
		"swallows a drawer that answered NO",
		build({
			printer: OK_PRINTER,
			terminal: OK_TERMINAL,
			drawer: (i) =>
				i.drawerConnected === true
					? ({ id: "drawer", state: "ready", labelKey: "Drawer connected", priority: 3 } as const)
					: null,
		}),
	],
	[
		"reads an unprobed terminal as ready",
		build({
			printer: OK_PRINTER,
			drawer: OK_DRAWER,
			terminal: (i) =>
				(i.terminalsAvailable ?? 1) > 0
					? ({ id: "terminal", state: "ready", labelKey: "Terminal ready", priority: 2 } as const)
					: null,
		}),
	],
	[
		"reports a shop with no terminal as a fault",
		build({
			printer: OK_PRINTER,
			drawer: OK_DRAWER,
			terminal: (i) => {
				if (i.terminalsAvailable === null || i.terminalsAvailable === undefined) return null;
				return i.terminalsAvailable > 0
					? ({ id: "terminal", state: "ready", labelKey: "Terminal ready", priority: 2 } as const)
					: ({ id: "terminal", state: "attention", labelKey: "Terminal unavailable", priority: 1 } as const);
			},
		}),
	],
];

describe("mutation — the case table kills every weakening of the refusal", () => {
	it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
		expect(matches(resolveHardwareReadiness, testCase)).toBe(true);
	});

	it.each(MUTANTS.map(([name, mutant]) => [name, mutant] as const))(
		"kills a resolver that %s",
		(_name, mutant) => {
			const survived = CASES.filter((testCase) => matches(mutant, testCase));
			expect(
				survived.length,
				"this mutant passes every case above, so the table does not actually test the refusal",
			).toBeLessThan(CASES.length);
		},
	);

	it("every case earns its place by killing at least one mutant", () => {
		// The inverse check. A case no mutant fails is decoration, and
		// decoration in the suite guarding a promise is how a suite stays green
		// through a regression.
		const idle = CASES.filter((testCase) =>
			MUTANTS.every(([, mutant]) => matches(mutant, testCase)),
		).map((testCase) => testCase.name);
		expect(idle).toEqual([]);
	});
});
