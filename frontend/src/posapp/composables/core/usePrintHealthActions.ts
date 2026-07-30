/**
 * The actions the print-health surfaces perform, in one place.
 *
 * Both entry paths — the PrintHealthDialog checklist and the guided
 * PrintSetupWizard — connect, download an installer, print a test page and
 * record the operator's verdict. Sharing this module is what keeps the
 * wizard a path over the same primitives rather than a second
 * implementation that drifts from the dialog after the first bug fix.
 *
 * Nothing here decides UI state; each surface owns its own presentation and
 * calls in for the behaviour.
 */
import { useUIStore } from "../../stores/uiStore";
import {
	downloadQzBundle,
	type QzBundlePlatform,
} from "../../services/qzBundle";
import {
	connectQzTray,
	findQzPrinters,
	printHtmlViaQz,
	selectedQzPrinter,
} from "../../services/qzTray";
import { buildSelfTestSlipHtml } from "../../utils/printSelfTestSlip";
import { usePrintHealthShared } from "./usePrintHealthShared";
import type { PrintHealth } from "./usePrintHealth";

const translateMessage = (value: string) =>
	typeof window !== "undefined" && window.__ ? window.__(value) : value;

export interface PrintHealthActionsDeps {
	health?: PrintHealth;
	connect?: (_options?: { userInitiated?: boolean }) => Promise<boolean>;
	findPrinters?: () => Promise<string[]>;
	printHtml?: (_html: string, _options?: Record<string, unknown>) => Promise<void>;
	downloadBundle?: (_platform: QzBundlePlatform, _filename?: string) => Promise<void>;
	profile?: () => any;
	now?: () => Date;
}

export interface ConnectOutcome {
	connected: boolean;
	printers: string[];
	/** Honest detail for the wizard's failure line; "" on success. */
	error: string;
}

export interface TestPrintOutcome {
	sent: boolean;
	error: string;
}

/**
 * Install steps per platform. Kept as data, not prose in a template, so the
 * dialog and the wizard render identical instructions.
 */
export function bundleInstallSteps(platform: QzBundlePlatform): string[] {
	if (platform === "linux") {
		return [
			translateMessage("Extract the archive: tar xzf <file>"),
			translateMessage("Run the installer: sudo ./install.sh"),
			translateMessage("QZ Tray starts automatically and stays in the system tray."),
		];
	}
	return [
		translateMessage("Unzip the downloaded file."),
		translateMessage("Right-click install.bat and choose «Run as administrator»."),
		translateMessage("QZ Tray starts automatically and stays in the system tray."),
	];
}

export function usePrintHealthActions(deps: PrintHealthActionsDeps = {}) {
	const {
		health = usePrintHealthShared(),
		connect = connectQzTray,
		findPrinters = findQzPrinters,
		printHtml = printHtmlViaQz,
		downloadBundle = downloadQzBundle,
		profile = () => {
			try {
				const uiStore = useUIStore();
				return uiStore?.posProfile && typeof uiStore.posProfile === "object" && "value" in uiStore.posProfile
					? (uiStore.posProfile as any).value
					: uiStore?.posProfile;
			} catch {
				return null;
			}
		},
		now = () => new Date(),
	} = deps;

	/**
	 * Try to reach QZ Tray, then re-derive everything that depends on it.
	 * Returns the failure detail rather than throwing — the wizard shows the
	 * real reason ("QZ Tray is not running") instead of a generic retry.
	 */
	const connectAndRecheck = async (): Promise<ConnectOutcome> => {
		let connected = false;
		let error = "";
		try {
			connected = await connect({ userInitiated: true });
			if (!connected) {
				error = translateMessage("QZ Tray did not answer. Is it running on this computer?");
			}
		} catch (err: any) {
			error = err?.message || String(err ?? "");
		}

		let printers: string[] = [];
		if (connected) {
			try {
				printers = await findPrinters();
			} catch (err: any) {
				error = err?.message || String(err ?? "");
			}
		}

		await health.refresh().catch(() => undefined);
		return { connected, printers, error };
	};

	const downloadInstaller = async (platform: QzBundlePlatform): Promise<void> => {
		const entry = health.bundleInfo.value.platforms[platform];
		await downloadBundle(platform, entry?.filename);
	};

	/**
	 * Send the test page. A resolved promise means the job left the
	 * websocket — NOT that paper moved, which is why the caller must still
	 * ask the operator before recording a verdict.
	 */
	const printTestPage = async (): Promise<TestPrintOutcome> => {
		try {
			const currentProfile = profile();
			const html = buildSelfTestSlipHtml({
				companyName: String(currentProfile?.company || ""),
				printer: selectedQzPrinter.value || "",
				terminalLabel: String(currentProfile?.name || ""),
				at: now(),
				translate: translateMessage,
			});
			await printHtml(html, { widthMm: 80, orientation: "portrait" });
			return { sent: true, error: "" };
		} catch (err: any) {
			return { sent: false, error: err?.message || String(err ?? "") };
		}
	};

	return {
		health,
		connectAndRecheck,
		downloadInstaller,
		printTestPage,
		installSteps: bundleInstallSteps,
	};
}
