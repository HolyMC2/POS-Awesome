/**
 * Print-readiness state for one terminal, and the operator-confirmed
 * self-test that proves it.
 *
 * Everything else in the print pipeline reports what happened AFTER a sale:
 * a QZ failure, a browser fallback, a blocked popup. None of it answers the
 * question a shop actually asks — "is this till going to print when the next
 * customer pays?" — because every signal needs a sale to produce it. These
 * six checks answer it from the terminal's own state, before the queue forms.
 *
 * The last check is deliberately not machine-verifiable. QZ Tray reports a
 * print as sent the moment the job leaves the websocket; paper jams, empty
 * rolls and a printer powered off all look like success from here. Only a
 * human looking at the slip can close that loop, so `recordSelfTest` takes
 * the operator's yes/no and emits `pos:print_selftest` — the one fleet
 * signal that reflects paper actually coming out of a printer.
 *
 * This module is the single machinery behind BOTH entry paths: the
 * PrintHealthDialog checklist and the PrintSetupWizard's guided steps. The
 * wizard is a path over these primitives, never a second implementation.
 *
 * Dependency-injected throughout: the defaults wire the real QZ service and
 * telemetry, and tests pass plain refs and stubs.
 */
import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
	EMPTY_BUNDLE_INFO,
	detectQzPlatform,
	fetchQzBundleInfo,
	type QzBundleInfo,
	type QzBundlePlatform,
} from "../../services/qzBundle";
import {
	getQzVersion,
	probeQzSigning,
	qzConnected,
	qzPrinters,
	selectedQzPrinter,
	type QzSigningProbe,
} from "../../services/qzTray";
import { track as trackTelemetry } from "../../utils/telemetry";

// Bare `__` is a Frappe desk global absent under vitest; guard it.
const translateMessage = (value: string) =>
	typeof window !== "undefined" && window.__ ? window.__(value) : value;

export type PrintHealthStatus = "ok" | "warn" | "fail" | "unknown";

export type PrintHealthCheckId =
	| "bundle"
	| "connection"
	| "version"
	| "signing"
	| "printer"
	| "selftest";

export interface PrintHealthCheck {
	id: PrintHealthCheckId;
	status: PrintHealthStatus;
	title: string;
	detail: string;
	/** What the operator should DO about it. Empty when nothing to fix. */
	hint: string;
}

export interface SelfTestRecord {
	ok: boolean;
	at: string;
	printer?: string;
	qzVersion?: string;
}

export type SelfTestSource = "manual" | "wizard";

export const SELFTEST_EVENT = "pos:print_selftest";
export const WIZARD_EVENT = "pos:print_setup_wizard";
export const SELFTEST_STORAGE_KEY = "posa_print_selftest";
export const SETUP_DONE_STORAGE_KEY = "posa_print_setup_done";

/** Past this, a green self-test is too old to still be evidence. */
export const SELFTEST_STALE_DAYS = 30;
/** Cheap periodic re-check. No prints, no downloads. */
export const RECHECK_INTERVAL_MS = 10 * 60 * 1000;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface PrintHealthDeps {
	connected?: Ref<boolean>;
	printers?: Ref<string[]>;
	selectedPrinter?: Ref<string>;
	/** POS Profile's `posa_qz_printer_name`, or "" when unpinned. */
	pinnedPrinter?: () => string;
	loadBundleInfo?: () => Promise<QzBundleInfo>;
	loadQzVersion?: () => Promise<string>;
	probeSigning?: () => Promise<QzSigningProbe>;
	track?: (name: string, value?: number, meta?: Record<string, unknown>) => void;
	storage?: StorageLike | null;
	platform?: QzBundlePlatform;
	now?: () => Date;
}

export interface PrintHealth {
	checks: ComputedRef<PrintHealthCheck[]>;
	/** Worst status across all checks — what the navbar dot shows. */
	rollup: ComputedRef<PrintHealthStatus>;
	bundleInfo: Ref<QzBundleInfo>;
	trayVersion: Ref<string>;
	signing: Ref<QzSigningProbe | null>;
	lastSelfTest: Ref<SelfTestRecord | null>;
	platform: QzBundlePlatform;
	checking: Ref<boolean>;
	refresh: () => Promise<void>;
	recordSelfTest: (_ok: boolean, _source: SelfTestSource) => SelfTestRecord;
	isSetupDone: () => boolean;
	markSetupDone: () => void;
}

export type VersionDrift = "exact" | "patch" | "minor" | "major" | "unknown";

function parseVersion(value: string): number[] | null {
	const parts = String(value || "")
		.trim()
		.split(/[.\-+]/)
		.map((part) => Number.parseInt(part, 10));
	return parts.length && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

/**
 * Classify the gap between the tray a terminal runs and the one this site
 * publishes. Anything unparseable is "unknown" rather than a guess — a false
 * "your printer software is wrong" trains operators to ignore the panel.
 */
export function compareTrayVersion(installed: string, bundled: string): VersionDrift {
	const a = parseVersion(installed);
	const b = parseVersion(bundled);
	if (!a || !b) return "unknown";
	if ((a[0] ?? 0) !== (b[0] ?? 0)) return "major";
	if ((a[1] ?? 0) !== (b[1] ?? 0)) return "minor";
	const length = Math.max(a.length, b.length);
	for (let i = 2; i < length; i += 1) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return "patch";
	}
	return "exact";
}

export function readSelfTest(storage: StorageLike | null): SelfTestRecord | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(SELFTEST_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		return {
			ok: Boolean(parsed.ok),
			at: String(parsed.at || ""),
			printer: String(parsed.printer || ""),
			qzVersion: String(parsed.qzVersion || ""),
		};
	} catch {
		// Corrupt or unreadable storage is the same as never tested.
		return null;
	}
}

function defaultStorage(): StorageLike | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

function ageInDays(from: string, to: Date): number | null {
	const parsed = Date.parse(from);
	if (!Number.isFinite(parsed)) return null;
	return (to.getTime() - parsed) / 86_400_000;
}

export function usePrintHealth(deps: PrintHealthDeps = {}): PrintHealth {
	const {
		connected = qzConnected,
		printers = qzPrinters,
		selectedPrinter = selectedQzPrinter,
		pinnedPrinter = () => "",
		loadBundleInfo = fetchQzBundleInfo,
		loadQzVersion = getQzVersion,
		probeSigning = probeQzSigning,
		track = trackTelemetry,
		storage = defaultStorage(),
		platform = detectQzPlatform(),
		now = () => new Date(),
	} = deps;

	const bundleInfo = ref<QzBundleInfo>({ ...EMPTY_BUNDLE_INFO });
	const trayVersion = ref("");
	const signing = ref<QzSigningProbe | null>(null);
	const lastSelfTest = ref<SelfTestRecord | null>(readSelfTest(storage));
	const checking = ref(false);

	const bundleCheck = computed<PrintHealthCheck>(() => {
		const info = bundleInfo.value;
		if (info.available) {
			return {
				id: "bundle",
				status: "ok",
				title: translateMessage("Installer available"),
				detail: info.qz_version ? `QZ Tray ${info.qz_version}` : "",
				hint: "",
			};
		}
		// No manifest published is the normal first-run state, and a shop whose
		// staff installed QZ Tray by hand prints perfectly well without one.
		// "Unknown", never an error.
		return {
			id: "bundle",
			status: "unknown",
			title: translateMessage("No installer published"),
			detail: "",
			hint: translateMessage(
				"Install QZ Tray manually, or ask support to publish the installer for this site.",
			),
		};
	});

	const connectionCheck = computed<PrintHealthCheck>(() =>
		connected.value
			? {
					id: "connection",
					status: "ok",
					title: translateMessage("QZ Tray connected"),
					detail: trayVersion.value,
					hint: "",
				}
			: {
					id: "connection",
					status: "fail",
					title: translateMessage("QZ Tray not connected"),
					detail: "",
					hint: translateMessage(
						"Start QZ Tray on this computer, then press Check again.",
					),
				},
	);

	const versionCheck = computed<PrintHealthCheck>(() => {
		const bundled = bundleInfo.value.qz_version;
		const drift = compareTrayVersion(trayVersion.value, bundled);
		if (drift === "exact") {
			return {
				id: "version",
				status: "ok",
				title: translateMessage("QZ Tray is up to date"),
				detail: trayVersion.value,
				hint: "",
			};
		}
		if (drift === "unknown") {
			return {
				id: "version",
				status: "warn",
				title: translateMessage("QZ Tray version unknown"),
				detail: "",
				hint: translateMessage(
					"Connect to QZ Tray to compare it against the version this site publishes.",
				),
			};
		}
		// A patch gap is cosmetic; a minor/major gap is the shape of "prints
		// fine on every till except this one".
		return {
			id: "version",
			status: drift === "patch" ? "warn" : "fail",
			title: translateMessage("QZ Tray version does not match"),
			detail: `${trayVersion.value} → ${bundled}`,
			hint: translateMessage("Download and reinstall QZ Tray from this panel."),
		};
	});

	const signingCheck = computed<PrintHealthCheck>(() => {
		const probe = signing.value;
		if (!probe) {
			return {
				id: "signing",
				status: "unknown",
				title: translateMessage("Signing not checked yet"),
				detail: "",
				hint: "",
			};
		}
		if (probe.certificate && probe.signature) {
			return {
				id: "signing",
				status: "ok",
				title: translateMessage("Certificate signing works"),
				detail: translateMessage("Receipts print without a confirmation prompt."),
				hint: "",
			};
		}
		// Empty means the site's key material is missing on the server. The
		// operator-visible symptom is QZ's "Cannot verify trust" dialog on
		// every receipt — which nobody traces back to a missing file.
		return {
			id: "signing",
			status: "fail",
			title: translateMessage("Certificate signing failed"),
			detail: probe.error,
			hint: translateMessage(
				"The site's QZ certificate is missing on the server. Ask support to run Setup QZ Certificate.",
			),
		};
	});

	const printerCheck = computed<PrintHealthCheck>(() => {
		const available = printers.value;
		const pinned = (pinnedPrinter() || "").trim();
		const chosen = (selectedPrinter.value || "").trim() || pinned;

		if (!available.length) {
			return {
				id: "printer",
				status: connected.value ? "fail" : "unknown",
				title: translateMessage("No printers found"),
				detail: "",
				hint: translateMessage(
					"Check that the printer is installed and switched on, then press Check again.",
				),
			};
		}
		if (!chosen) {
			// Exactly one printer needs no decision — qzTray.ts already
			// auto-persists it. Two or more genuinely needs a choice.
			if (available.length === 1) {
				return {
					id: "printer",
					status: "ok",
					title: translateMessage("Printer selected"),
					detail: available[0] ?? "",
					hint: "",
				};
			}
			return {
				id: "printer",
				status: "fail",
				title: translateMessage("No printer selected"),
				detail: "",
				hint: translateMessage("Choose the receipt printer for this terminal."),
			};
		}
		if (!available.includes(chosen)) {
			// The silent-queue pathology: prints go to whatever is first in the
			// list and every one reports success while paper never moves.
			return {
				id: "printer",
				status: "fail",
				title: translateMessage("Selected printer not found"),
				detail: chosen,
				hint: translateMessage(
					"This printer is not installed on this terminal. Pick one from the list.",
				),
			};
		}
		return {
			id: "printer",
			status: "ok",
			title: translateMessage("Printer selected"),
			detail: chosen,
			hint: "",
		};
	});

	const selfTestCheck = computed<PrintHealthCheck>(() => {
		const record = lastSelfTest.value;
		if (!record) {
			return {
				id: "selftest",
				status: "unknown",
				title: translateMessage("Never tested"),
				detail: "",
				hint: translateMessage(
					"Print a test page to confirm paper actually comes out.",
				),
			};
		}
		if (!record.ok) {
			return {
				id: "selftest",
				status: "fail",
				title: translateMessage("Last test failed"),
				detail: translateMessage("The operator reported that nothing printed."),
				hint: translateMessage(
					"Check the printer power, cable, paper and selected printer name, then test again.",
				),
			};
		}
		const age = ageInDays(record.at, now());
		if (age === null || age > SELFTEST_STALE_DAYS) {
			return {
				id: "selftest",
				status: "warn",
				title: translateMessage("Test is out of date"),
				detail: record.at,
				hint: translateMessage(
					"Run the test again to confirm this terminal still prints.",
				),
			};
		}
		return {
			id: "selftest",
			status: "ok",
			title: translateMessage("Test page confirmed"),
			detail: record.printer || "",
			hint: "",
		};
	});

	const checks = computed<PrintHealthCheck[]>(() => [
		bundleCheck.value,
		connectionCheck.value,
		versionCheck.value,
		signingCheck.value,
		printerCheck.value,
		selfTestCheck.value,
	]);

	const rollup = computed<PrintHealthStatus>(() => {
		const statuses = checks.value.map((check) => check.status);
		if (statuses.includes("fail")) return "fail";
		if (statuses.includes("warn")) return "warn";
		if (statuses.includes("unknown")) return "unknown";
		return "ok";
	});

	const refresh = async () => {
		checking.value = true;
		try {
			// Independent reads; one failing must not blank the others. All
			// three helpers swallow their own errors and answer with an
			// "unknown" shape, so the panel degrades check by check.
			const [info, version, probe] = await Promise.all([
				loadBundleInfo(),
				loadQzVersion(),
				probeSigning(),
			]);
			bundleInfo.value = info;
			trayVersion.value = version;
			signing.value = probe;
		} finally {
			checking.value = false;
		}
	};

	const recordSelfTest = (ok: boolean, source: SelfTestSource): SelfTestRecord => {
		const record: SelfTestRecord = {
			ok,
			at: now().toISOString(),
			printer: selectedPrinter.value || "",
			qzVersion: trayVersion.value || "",
		};
		lastSelfTest.value = record;
		try {
			storage?.setItem(SELFTEST_STORAGE_KEY, JSON.stringify(record));
		} catch {
			// A terminal with storage disabled still emits the telemetry row;
			// only the local "last tested" memory is lost.
		}
		try {
			// Shape is the server's contract (api/telemetry.get_qz_fleet): the
			// row `value` carries the same 1|0 as `metadata.ok` so a payload
			// whose metadata is lost still reports the verdict.
			track(SELFTEST_EVENT, ok ? 1 : 0, {
				ok: ok ? 1 : 0,
				printer: (record.printer || "").slice(0, 80),
				qz_version: record.qzVersion || "",
				source,
			});
		} catch {
			// telemetry dispatch must never bubble
		}
		return record;
	};

	const isSetupDone = () => {
		try {
			return storage?.getItem(SETUP_DONE_STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	};

	const markSetupDone = () => {
		try {
			storage?.setItem(SETUP_DONE_STORAGE_KEY, "1");
		} catch {
			// Worst case the wizard offers itself again next boot.
		}
	};

	return {
		checks,
		rollup,
		bundleInfo,
		trayVersion,
		signing,
		lastSelfTest,
		platform,
		checking,
		refresh,
		recordSelfTest,
		isSetupDone,
		markSetupDone,
	};
}
