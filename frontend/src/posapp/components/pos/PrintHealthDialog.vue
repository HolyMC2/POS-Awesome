<template>
	<v-dialog v-model="dialogModel" max-width="820" scrollable>
		<v-card class="print-health-card">
			<v-card-title class="d-flex align-center">
				<v-icon start :color="statusColor(health.rollup.value)">mdi-printer-check</v-icon>
				{{ __("Printing status") }}
				<v-spacer />
				<v-chip
					:color="statusColor(health.rollup.value)"
					size="small"
					variant="tonal"
					data-test="print-health-rollup"
				>
					{{ rollupLabel }}
				</v-chip>
			</v-card-title>

			<v-card-text>
				<v-list density="compact" class="print-health-checks mb-3">
					<v-list-item
						v-for="check in health.checks.value"
						:key="check.id"
						:data-test="`print-health-${check.id}`"
						:title="check.title"
					>
						<template #prepend>
							<v-icon :color="statusColor(check.status)">{{ statusIcon(check.status) }}</v-icon>
						</template>
						<template #subtitle>
							<div v-if="check.detail" class="text-caption">{{ check.detail }}</div>
							<div v-if="check.hint" class="text-caption text-medium-emphasis">
								{{ check.hint }}
							</div>
						</template>
					</v-list-item>
				</v-list>

				<div class="d-flex flex-wrap ga-2 mb-4">
					<v-btn
						color="primary"
						variant="tonal"
						data-test="print-health-recheck"
						:loading="health.checking.value"
						:disabled="health.checking.value"
						@click="handleRecheck"
					>
						{{ __("Check again") }}
					</v-btn>
					<v-btn
						color="primary"
						data-test="print-health-test"
						:loading="testing"
						:disabled="testing"
						@click="handleTestPrint"
					>
						<v-icon start>mdi-printer-pos</v-icon>
						{{ __("Print test page") }}
					</v-btn>
					<v-btn variant="outlined" data-test="print-health-wizard" @click="openWizard">
						{{ __("Setup assistant") }}
					</v-btn>
				</div>

				<v-alert
					v-if="awaitingConfirmation"
					type="info"
					variant="tonal"
					density="comfortable"
					class="mb-4"
					data-test="print-health-confirm"
				>
					<div class="mb-2">{{ __("Did the ticket come out?") }}</div>
					<div class="d-flex flex-wrap ga-2">
						<v-btn
							color="success"
							size="small"
							data-test="print-health-confirm-yes"
							@click="confirmSelfTest(true)"
						>
							{{ __("Yes") }}
						</v-btn>
						<v-btn
							color="error"
							size="small"
							variant="outlined"
							data-test="print-health-confirm-no"
							@click="confirmSelfTest(false)"
						>
							{{ __("No") }}
						</v-btn>
					</div>
				</v-alert>

				<v-divider class="mb-4" />

				<div class="text-subtitle-1 mb-2">{{ __("Install QZ Tray") }}</div>
				<div class="d-flex flex-wrap ga-2 mb-3">
					<v-btn
						v-for="platform in PLATFORMS"
						:key="platform"
						:color="platform === health.platform ? 'primary' : 'default'"
						:variant="platform === health.platform ? 'flat' : 'outlined'"
						:data-test="`print-health-download-${platform}`"
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
				<ol class="text-caption text-medium-emphasis print-health-steps">
					<li v-for="(step, idx) in installSteps(health.platform)" :key="`s-${idx}`">
						{{ step }}
					</li>
				</ol>
			</v-card-text>

			<v-card-actions>
				<v-spacer />
				<v-btn variant="text" @click="dialogModel = false">{{ __("Close") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToastStore } from "../../stores/toastStore";
import { usePrintHealthActions } from "../../composables/core/usePrintHealthActions";
import type { PrintHealthStatus } from "../../composables/core/usePrintHealth";
import type { QzBundlePlatform } from "../../services/qzBundle";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
	(e: "update:modelValue", value: boolean): void;
	(e: "open-wizard"): void;
}>();

const toastStore = useToastStore();
const { health, connectAndRecheck, downloadInstaller, printTestPage, installSteps } =
	usePrintHealthActions();

const PLATFORMS: QzBundlePlatform[] = ["win", "linux"];

const downloading = ref<QzBundlePlatform | "">("");
const testing = ref(false);
const awaitingConfirmation = ref(false);

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

const rollupLabel = computed(() => {
	switch (health.rollup.value) {
		case "ok":
			return __("Ready to print");
		case "warn":
			return __("Needs attention");
		case "fail":
			return __("Not ready");
		default:
			return __("Not checked");
	}
});

const bundleFor = (platform: QzBundlePlatform) =>
	health.bundleInfo.value.platforms[platform]?.present ? health.bundleInfo.value.platforms[platform] : null;

const anyBundle = computed(() => PLATFORMS.some((p) => bundleFor(p)));

function notify(title: string, color = "info") {
	try {
		toastStore.show({ title: __(title), color });
	} catch {
		// toast store unavailable in some harnesses — ignore.
	}
}

async function handleRecheck() {
	const outcome = await connectAndRecheck();
	if (!outcome.connected && outcome.error) {
		notify(outcome.error, "warning");
	}
}

async function handleDownload(platform: QzBundlePlatform) {
	if (!bundleFor(platform)) return;
	downloading.value = platform;
	try {
		await downloadInstaller(platform);
		notify("Installer downloaded. Run it on this computer, then press Check again.", "success");
	} catch (error: any) {
		console.error("QZ bundle download failed", error);
		notify(error?.message || "Failed to download the QZ Tray installer.", "error");
	} finally {
		downloading.value = "";
	}
}

async function handleTestPrint() {
	testing.value = true;
	awaitingConfirmation.value = false;
	try {
		const outcome = await printTestPage();
		if (outcome.sent) {
			// Sent ≠ printed. Only the operator can close that loop.
			awaitingConfirmation.value = true;
		} else {
			notify(outcome.error || "The test page could not be sent to the printer.", "error");
			health.recordSelfTest(false, "manual");
		}
	} finally {
		testing.value = false;
	}
}

function confirmSelfTest(ok: boolean) {
	health.recordSelfTest(ok, "manual");
	awaitingConfirmation.value = false;
	if (ok) {
		notify("Printer confirmed. This terminal is ready.", "success");
	} else {
		// The checklist now carries a red self-test row with its own hints,
		// which is exactly where the operator should look next.
		notify("Recorded. Check the hints above, then test again.", "warning");
	}
}

function openWizard() {
	dialogModel.value = false;
	emit("open-wizard");
}

watch(
	() => props.modelValue,
	async (open) => {
		if (!open) {
			awaitingConfirmation.value = false;
			return;
		}
		await health.refresh().catch(() => undefined);
	},
	{ immediate: true },
);
</script>

<style scoped>
.print-health-card {
	background-color: rgb(var(--v-theme-surface));
	color: rgb(var(--v-theme-on-surface));
}

.print-health-checks {
	background-color: transparent;
}

.print-health-steps {
	padding-left: 1.2rem;
}
</style>
