<template>
	<v-dialog v-model="dialogModel" max-width="760" scrollable persistent>
		<v-card class="print-wizard-card">
			<v-card-title class="d-flex align-center">
				<v-icon start color="primary">mdi-printer-settings</v-icon>
				{{ __("Printer setup") }}
				<v-spacer />
				<span class="text-caption text-medium-emphasis" data-test="print-wizard-step">
					{{ stepLabel }}
				</span>
			</v-card-title>

			<v-card-text>
				<!-- 1. Detection -->
				<div v-if="step === 'detect'" data-test="print-wizard-detect">
					<p class="mb-3">
						{{ __("Looking for QZ Tray on this computer...") }}
					</p>
					<v-progress-linear v-if="busy" indeterminate color="primary" class="mb-3" />
					<v-alert v-else-if="detectError" type="warning" variant="tonal" density="compact">
						{{ detectError }}
					</v-alert>
					<v-btn
						v-if="!busy"
						color="primary"
						data-test="print-wizard-detect-retry"
						@click="runDetection"
					>
						{{ __("Check again") }}
					</v-btn>
				</div>

				<!-- 2. Installation -->
				<div v-else-if="step === 'install'" data-test="print-wizard-install">
					<p class="mb-3">
						{{ __("QZ Tray is not installed yet. Install it on this computer to print receipts.") }}
					</p>
					<div class="d-flex flex-wrap ga-2 mb-3">
						<v-btn
							v-for="platform in PLATFORMS"
							:key="platform"
							:color="platform === health.platform ? 'primary' : 'default'"
							:variant="platform === health.platform ? 'flat' : 'outlined'"
							:data-test="`print-wizard-download-${platform}`"
							:loading="downloading === platform"
							:disabled="!!downloading || !bundleFor(platform)"
							@click="handleDownload(platform)"
						>
							<v-icon start>mdi-download</v-icon>
							{{ platform === "linux" ? __("Download for Linux") : __("Download for Windows") }}
						</v-btn>
					</div>
					<div v-if="!anyBundle" class="text-caption text-medium-emphasis mb-2">
						{{ __("No installer has been published for this site yet.") }}
					</div>
					<ol class="text-caption text-medium-emphasis print-wizard-steps mb-3">
						<li v-for="(s, idx) in installSteps(health.platform)" :key="`i-${idx}`">{{ s }}</li>
					</ol>
					<v-alert
						v-if="detectError"
						type="warning"
						variant="tonal"
						density="compact"
						class="mb-3"
						data-test="print-wizard-install-error"
					>
						{{ detectError }}
					</v-alert>
					<v-btn
						color="primary"
						data-test="print-wizard-installed"
						:loading="busy"
						:disabled="busy"
						@click="runDetection"
					>
						{{ __("I installed it — check") }}
					</v-btn>
				</div>

				<!-- 3. Printer -->
				<div v-else-if="step === 'printer'" data-test="print-wizard-printer">
					<p class="mb-3">{{ __("Choose the receipt printer for this terminal.") }}</p>
					<v-select
						v-model="selectedPrinter"
						:items="printerOptions"
						:label="__('Printer')"
						variant="outlined"
						density="compact"
						data-test="print-wizard-printer-select"
					/>
					<v-btn
						color="primary"
						data-test="print-wizard-printer-next"
						:disabled="!selectedPrinter"
						@click="goToTest"
					>
						{{ __("Continue") }}
					</v-btn>
				</div>

				<!-- 4. Test -->
				<div v-else-if="step === 'test'" data-test="print-wizard-test-step">
					<p class="mb-3">{{ __("Print a test page to confirm paper actually comes out.") }}</p>
					<v-btn
						color="primary"
						class="mb-3"
						data-test="print-wizard-test"
						:loading="busy"
						:disabled="busy"
						@click="handleTestPrint"
					>
						<v-icon start>mdi-printer-pos</v-icon>
						{{ __("Print test page") }}
					</v-btn>

					<v-alert
						v-if="awaitingConfirmation"
						type="info"
						variant="tonal"
						density="comfortable"
						data-test="print-wizard-confirm"
					>
						<div class="mb-2">{{ __("Did the ticket come out?") }}</div>
						<div class="d-flex flex-wrap ga-2">
							<v-btn
								color="success"
								size="small"
								data-test="print-wizard-confirm-yes"
								@click="confirmSelfTest(true)"
							>
								{{ __("Yes") }}
							</v-btn>
							<v-btn
								color="error"
								size="small"
								variant="outlined"
								data-test="print-wizard-confirm-no"
								@click="confirmSelfTest(false)"
							>
								{{ __("No") }}
							</v-btn>
						</div>
					</v-alert>

					<div v-if="troubleshooting.length" data-test="print-wizard-troubleshooting">
						<v-alert type="warning" variant="tonal" density="comfortable" class="mb-3">
							<div class="mb-2">{{ __("Nothing printed. Check these:") }}</div>
							<ul class="print-wizard-steps">
								<li v-for="(tip, idx) in troubleshooting" :key="`t-${idx}`">{{ tip }}</li>
							</ul>
						</v-alert>
						<div class="d-flex flex-wrap ga-2">
							<v-btn
								color="primary"
								size="small"
								data-test="print-wizard-retry"
								@click="handleTestPrint"
							>
								{{ __("Try again") }}
							</v-btn>
							<v-btn
								variant="outlined"
								size="small"
								data-test="print-wizard-back-printer"
								@click="backToPrinter"
							>
								{{ __("Change printer") }}
							</v-btn>
						</div>
					</div>
				</div>

				<!-- 5. Done -->
				<div v-else data-test="print-wizard-done">
					<v-alert type="success" variant="tonal" density="comfortable" class="mb-3">
						{{ __("This terminal is ready to print.") }}
					</v-alert>
					<v-list density="compact" class="print-wizard-summary">
						<v-list-item
							v-for="check in health.checks.value"
							:key="check.id"
							:title="check.title"
							:subtitle="check.detail"
						>
							<template #prepend>
								<v-icon :color="statusColor(check.status)">{{ statusIcon(check.status) }}</v-icon>
							</template>
						</v-list-item>
					</v-list>
				</div>
			</v-card-text>

			<v-card-actions>
				<!-- Never blocks selling: skippable at every step. -->
				<v-btn
					v-if="step !== 'done'"
					variant="text"
					data-test="print-wizard-skip"
					@click="skip"
				>
					{{ __("Set up later") }}
				</v-btn>
				<v-spacer />
				<v-btn variant="text" data-test="print-wizard-close" @click="finish">
					{{ step === "done" ? __("Done") : __("Close") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToastStore } from "../../stores/toastStore";
import { usePrintHealthActions } from "../../composables/core/usePrintHealthActions";
import { WIZARD_EVENT, type PrintHealthStatus } from "../../composables/core/usePrintHealth";
import { qzPrinters, selectedQzPrinter, setSelectedQzPrinter } from "../../services/qzTray";
import { track } from "../../utils/telemetry";
import type { QzBundlePlatform } from "../../services/qzBundle";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void }>();

const toastStore = useToastStore();
const { health, connectAndRecheck, downloadInstaller, printTestPage, installSteps } =
	usePrintHealthActions();

const PLATFORMS: QzBundlePlatform[] = ["win", "linux"];

// Linear state machine. `detect` probes; a connected tray jumps straight to
// `printer` because there is nothing to install.
type WizardStep = "detect" | "install" | "printer" | "test" | "done";
const STEP_ORDER: WizardStep[] = ["detect", "install", "printer", "test", "done"];

const step = ref<WizardStep>("detect");
const busy = ref(false);
const downloading = ref<QzBundlePlatform | "">("");
const detectError = ref("");
const awaitingConfirmation = ref(false);
const troubleshooting = ref<string[]>([]);

function __(text: string, args?: string[]) {
	if (typeof window !== "undefined" && typeof (window as any).__ === "function") {
		return (window as any).__(text, args);
	}
	return text;
}

const dialogModel = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const stepLabel = computed(
	() => `${STEP_ORDER.indexOf(step.value) + 1} / ${STEP_ORDER.length}`,
);

const selectedPrinter = computed({
	get: () => selectedQzPrinter.value || null,
	set: (value: string | null) => setSelectedQzPrinter(value || ""),
});

const printerOptions = computed(() =>
	qzPrinters.value.map((printer) => ({ title: printer, value: printer })),
);

const STATUS_COLORS: Record<PrintHealthStatus, string> = {
	ok: "success",
	warn: "warning",
	fail: "error",
	unknown: "grey",
};
const STATUS_ICONS: Record<PrintHealthStatus, string> = {
	ok: "mdi-check-circle",
	warn: "mdi-alert",
	fail: "mdi-alert-circle",
	unknown: "mdi-help-circle",
};
const statusColor = (status: PrintHealthStatus) => STATUS_COLORS[status];
const statusIcon = (status: PrintHealthStatus) => STATUS_ICONS[status];

const bundleFor = (platform: QzBundlePlatform) =>
	health.bundleInfo.value.platforms[platform]?.present
		? health.bundleInfo.value.platforms[platform]
		: null;

const anyBundle = computed(() => PLATFORMS.some((p) => bundleFor(p)));

function emitStep(outcome: string) {
	try {
		track(WIZARD_EVENT, 1, { step: step.value, outcome });
	} catch {
		// telemetry dispatch must never bubble
	}
}

function notify(title: string, color = "info") {
	try {
		toastStore.show({ title: __(title), color });
	} catch {
		// toast store unavailable in some harnesses — ignore.
	}
}

async function runDetection() {
	busy.value = true;
	detectError.value = "";
	try {
		const outcome = await connectAndRecheck();
		if (outcome.connected) {
			emitStep("connected");
			// Nothing to install — skip straight to picking the printer.
			step.value = "printer";
			return;
		}
		detectError.value = outcome.error || __("QZ Tray is not running on this computer.");
		emitStep("not_found");
		step.value = "install";
	} finally {
		busy.value = false;
	}
}

async function handleDownload(platform: QzBundlePlatform) {
	if (!bundleFor(platform)) return;
	downloading.value = platform;
	try {
		await downloadInstaller(platform);
		emitStep("downloaded");
		notify("Installer downloaded. Run it, then press «I installed it».", "success");
	} catch (error: any) {
		console.error("QZ bundle download failed", error);
		emitStep("download_failed");
		notify(error?.message || "Failed to download the QZ Tray installer.", "error");
	} finally {
		downloading.value = "";
	}
}

function goToTest() {
	emitStep("printer_selected");
	step.value = "test";
}

function backToPrinter() {
	troubleshooting.value = [];
	awaitingConfirmation.value = false;
	emitStep("back_to_printer");
	step.value = "printer";
}

async function handleTestPrint() {
	busy.value = true;
	awaitingConfirmation.value = false;
	troubleshooting.value = [];
	try {
		const outcome = await printTestPage();
		if (outcome.sent) {
			// Sent ≠ printed; only the operator can close that loop.
			awaitingConfirmation.value = true;
			emitStep("test_sent");
		} else {
			emitStep("test_send_failed");
			health.recordSelfTest(false, "wizard");
			showTroubleshooting(outcome.error);
		}
	} finally {
		busy.value = false;
	}
}

function showTroubleshooting(extra = "") {
	troubleshooting.value = [
		__("Is the printer switched on?"),
		__("Is the cable or network connection in place?"),
		__("Does the selected printer name match the one on this computer?"),
		__("Is the printer driver installed?"),
		...(extra ? [extra] : []),
	];
}

function confirmSelfTest(ok: boolean) {
	health.recordSelfTest(ok, "wizard");
	awaitingConfirmation.value = false;
	if (ok) {
		emitStep("test_confirmed");
		health.markSetupDone();
		step.value = "done";
		return;
	}
	emitStep("test_denied");
	showTroubleshooting();
}

function skip() {
	// Skipping leaves the navbar dot amber; the dialog re-offers the wizard.
	emitStep("skipped");
	dialogModel.value = false;
}

function finish() {
	dialogModel.value = false;
}

// Any dismissal that FOLLOWED a real open counts as "this terminal has met
// the wizard" — finished, skipped or closed alike. That is what stops the
// boot auto-open from re-offering itself every session; a terminal that
// skipped is still reachable through the health dialog, and its dot stays
// amber until the checks actually pass.
//
// `wasOpen` is the guard that makes the immediate:true mount fire (which
// arrives with open=false on a dialog that was never shown) a no-op — without
// it, merely mounting the navbar would mark setup done and the wizard would
// never auto-open at all.
let wasOpen = false;

watch(
	() => props.modelValue,
	async (open) => {
		if (!open) {
			if (wasOpen) {
				wasOpen = false;
				health.markSetupDone();
			}
			return;
		}
		wasOpen = true;
		step.value = "detect";
		detectError.value = "";
		awaitingConfirmation.value = false;
		troubleshooting.value = [];
		await runDetection();
	},
	{ immediate: true },
);
</script>

<style scoped>
.print-wizard-card {
	background-color: rgb(var(--v-theme-surface));
	color: rgb(var(--v-theme-on-surface));
}

.print-wizard-summary {
	background-color: transparent;
}

.print-wizard-steps {
	padding-left: 1.2rem;
}
</style>
