/**
 * The three things that can fail at the exact moment money changes hands
 * (Riel y Cajón §12 item B, `Cobro.dc.html` nodes 20–23).
 *
 * The artboard puts them in the payment screen's header:
 *
 *     Cajón conectado · Impresora lista · Terminal BBVA lista
 *
 * ⚠ THIS MODULE'S ONLY JOB IS TO REFUSE. Every one of those is a PROMISE the
 * cashier acts on: they hit COBRAR expecting a drawer to open, a ticket to
 * come out and a card to authorise. A green chip that is really "we never
 * checked" is worse than no chip, because it converts an unknown into a
 * commitment — and the cashier discovers the truth with the customer's card
 * already in their hand. So a claim is emitted ONLY from evidence, and the
 * absence of evidence emits nothing at all.
 *
 * That rule is mutation-tested in `tests/cobroHardwareReadiness.spec.ts`; it
 * is the only function on this screen with a promise behind it.
 *
 * WHAT THE REGISTER ACTUALLY KNOWS TODAY — investigated 2026-08-22:
 *
 *  - **Printer**: real. `usePrintHealth` runs six checks against QZ Tray and
 *    rolls them up to ok/warn/fail/unknown, and it is already the navbar dot's
 *    source. Only meaningful where silent printing is configured; a register
 *    that prints through the browser dialog has no "ready" state to report.
 *  - **Drawer**: NOTHING. There is no cash-drawer integration in this app —
 *    no kick command, no ESC/POS pulse, no connected/disconnected state
 *    anywhere in the tree (`qzTray.ts` emits a cut sequence and nothing else).
 *    The input exists so the seam is visible at the point somebody would
 *    otherwise invent one; it is `null` for every register and the chip is
 *    absent.
 *  - **Terminal**: config only. `mp_point.listEnabledTerminals()` proves the
 *    connector answered and a terminal is enabled, but nothing polls it before
 *    a push — `useMpPointSaleGate` resolves a terminal at the moment of
 *    charging. `mp_point_enabled` on the profile is a SETTING, not a state,
 *    and "configurada" is not "lista". Until something probes, this is
 *    unknown and the chip is absent.
 *
 * Pure: no Vue, no store, no `__()`. Labels come out as translation keys and
 * the component calls `__()` on them — the contract `registerStatusLine.ts`
 * set and this file keeps.
 */

/** Worst-first, like the print health rollup this reads from. */
export type DeviceState = "ready" | "attention" | "unknown";

export type DeviceId = "drawer" | "printer" | "terminal";

export interface ReadinessChip {
	id: DeviceId;
	state: Exclude<DeviceState, "unknown">;
	/** Translation key; the component calls `__()`. */
	labelKey: string;
	/** `{0}`-style interpolation values, in order. */
	labelParams?: (string | number)[];
	/**
	 * What survives when the header runs out of room. 1 never drops.
	 * A fault outranks a reassurance for the same reason it does in the status
	 * line: "ready" can go, an instruction cannot.
	 */
	priority: number;
}

export interface HardwareReadinessInput {
	/**
	 * `usePrintHealthShared().rollup`. `"unknown"` and absent mean the same
	 * thing and both emit nothing.
	 */
	printerStatus?: "ok" | "warn" | "fail" | "unknown" | null;
	/**
	 * Whether this register prints silently at all (a pinned QZ printer /
	 * `posa_silent_print`). False means the browser dialog does the printing
	 * and there is no readiness to report.
	 */
	usesSilentPrint?: boolean;
	/**
	 * Cash drawer. `null` = no read model, which is every register today.
	 * `false` would mean "checked, and it is not connected".
	 */
	drawerConnected?: boolean | null;
	/**
	 * Card terminals the connector confirmed are enabled, from a real probe.
	 * `null` = never probed. `0` = probed and the shop has none configured,
	 * which is not a fault — it is a shop that does not take cards on a
	 * terminal — so it emits nothing either.
	 */
	terminalsAvailable?: number | null;
	/** Terminal label, e.g. `BBVA`. Only decorates a chip already earned. */
	terminalName?: string | null;
}

export interface HardwareReadiness {
	chips: ReadinessChip[];
	/** True when at least one device is asking for attention. */
	needsAttention: boolean;
}

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * Printer. Three outcomes, and `unknown` is one of them.
 *
 * `ok` is the only input that produces "Impresora lista". `warn` and `fail`
 * both produce an attention chip — they differ in wording, not in whether the
 * cashier should look. An unset or unknown rollup produces NOTHING: the health
 * check runs asynchronously after boot, and the window where it has not
 * answered yet is exactly when a stale green would be believed.
 */
const printerChip = (input: HardwareReadinessInput): ReadinessChip | null => {
	if (!input.usesSilentPrint) return null;
	const status = input.printerStatus ?? "unknown";
	if (status === "unknown") return null;
	if (status === "ok") {
		return { id: "printer", state: "ready", labelKey: "Printer ready", priority: 2 };
	}
	return {
		id: "printer",
		state: "attention",
		labelKey: status === "warn" ? "Printer needs attention" : "Printer unavailable",
		priority: 1,
	};
};

/**
 * Drawer. Structurally unable to claim anything today, and that is deliberate
 * rather than unfinished — see the header. When a kick command lands, it feeds
 * `drawerConnected` and this function already handles both answers.
 */
const drawerChip = (input: HardwareReadinessInput): ReadinessChip | null => {
	const connected = input.drawerConnected;
	if (connected === null || connected === undefined) return null;
	return connected
		? { id: "drawer", state: "ready", labelKey: "Drawer connected", priority: 3 }
		: { id: "drawer", state: "attention", labelKey: "Drawer not connected", priority: 1 };
};

/**
 * Terminal. A count from a real probe, or silence.
 *
 * Zero is NOT a fault: a shop with no card terminal has nothing failing. Only
 * a probe that came back with at least one enabled terminal earns the chip,
 * and even then the claim is scoped to what was proven — the connector
 * answered and a terminal is enabled.
 */
const terminalChip = (input: HardwareReadinessInput): ReadinessChip | null => {
	const available = input.terminalsAvailable;
	if (available === null || available === undefined || !Number.isFinite(available)) return null;
	if (available <= 0) return null;
	const name = text(input.terminalName);
	return name
		? {
				id: "terminal",
				state: "ready",
				labelKey: "Terminal {0} ready",
				labelParams: [name],
				priority: 2,
			}
		: { id: "terminal", state: "ready", labelKey: "Terminal ready", priority: 2 };
};

/**
 * What the header is allowed to say about this register's hardware.
 *
 * Drawer first, then printer, then terminal — the artboard's order, which is
 * also the order the cashier meets them: the drawer opens, the ticket prints,
 * the card authorises.
 */
export const resolveHardwareReadiness = (
	input: HardwareReadinessInput | null | undefined,
): HardwareReadiness => {
	const source = input ?? {};
	const chips = [drawerChip(source), printerChip(source), terminalChip(source)].filter(
		(chip): chip is ReadinessChip => chip !== null,
	);

	return {
		chips,
		needsAttention: chips.some((chip) => chip.state === "attention"),
	};
};

/**
 * Exported so the header and its tests agree on what "claims a device is
 * ready" means without either restating the rule — the same reason
 * `registerStatusLine.claimsSynced` exists.
 */
export const claimsReady = (readiness: HardwareReadiness, id: DeviceId): boolean =>
	readiness.chips.some((chip) => chip.id === id && chip.state === "ready");
