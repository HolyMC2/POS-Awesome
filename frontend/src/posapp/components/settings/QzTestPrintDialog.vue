<template>
	<v-dialog v-model="dialogModel" max-width="780" persistent>
		<v-card class="qz-ab-card">
			<v-card-title class="d-flex align-center">
				<v-icon start color="primary">mdi-printer-pos</v-icon>
				{{ __("QZ Tray — Interpolation A/B Test") }}
			</v-card-title>

			<v-card-text>
				<v-alert
					class="mb-4"
					type="info"
					variant="tonal"
					density="comfortable"
				>
					{{
						__(
							"Click 'Print All' to print 9 sample receipts (3 interpolations × 3 densities). Each carries a header with its config. Compare on paper, pick the cleanest, then save the winning combo into the POS Profile fields posa_qz_interpolation and posa_qz_density.",
						)
					}}
				</v-alert>

				<v-alert
					v-if="!qzConnected"
					type="warning"
					variant="tonal"
					density="compact"
					class="mb-3"
				>
					{{ __("QZ Tray is not connected. Open QZ Tray Setup first.") }}
				</v-alert>

				<v-alert
					v-else-if="!selectedQzPrinter"
					type="warning"
					variant="tonal"
					density="compact"
					class="mb-3"
				>
					{{ __("No QZ printer selected. Open QZ Tray Setup first.") }}
				</v-alert>

				<div class="d-flex flex-wrap ga-2 mb-3">
					<v-btn
						color="primary"
						:loading="running"
						:disabled="running || !qzConnected || !selectedQzPrinter"
						data-test="qz-ab-print-all"
						@click="printAll"
					>
						<v-icon start>mdi-printer-check</v-icon>
						{{ __("Print All (9 combos)") }}
					</v-btn>
					<v-btn
						variant="outlined"
						:disabled="running"
						@click="results = []"
					>
						{{ __("Clear Log") }}
					</v-btn>
				</div>

				<div class="text-caption text-medium-emphasis mb-2">
					{{ __("Printer") }}: <strong>{{ selectedQzPrinter || __("(none)") }}</strong>
				</div>

				<v-progress-linear
					v-if="running"
					:model-value="progressPct"
					color="primary"
					height="6"
					class="mb-2"
				/>

				<v-list density="compact" class="qz-ab-results" v-if="results.length">
					<v-list-item
						v-for="(row, idx) in results"
						:key="`r-${idx}`"
						:title="row.label"
						:subtitle="row.status === 'sent' ? __('Sent to printer') : row.message"
					>
						<template #prepend>
							<v-icon
								:color="row.status === 'sent' ? 'success' : row.status === 'pending' ? 'warning' : 'error'"
							>
								{{
									row.status === "sent"
										? "mdi-check-circle"
										: row.status === "pending"
											? "mdi-progress-clock"
											: "mdi-alert-circle"
								}}
							</v-icon>
						</template>
					</v-list-item>
				</v-list>
			</v-card-text>

			<v-card-actions>
				<v-spacer />
				<v-btn
					variant="text"
					:disabled="running"
					@click="dialogModel = false"
				>
					{{ __("Close") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useToastStore } from "../../stores/toastStore";
import {
	printHtmlViaQz,
	qzConnected,
	selectedQzPrinter,
	type QzPrintHtmlOptions,
} from "../../services/qzTray";

const props = defineProps<{
	modelValue: boolean;
}>();

const emit = defineEmits<{
	(e: "update:modelValue", value: boolean): void;
}>();

const toastStore = useToastStore();

const dialogModel = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

type Interp = "nearest-neighbor" | "bilinear" | "bicubic";

interface Combo {
	interpolation: Interp;
	density: number;
}

const COMBOS: Combo[] = [
	{ interpolation: "nearest-neighbor", density: 150 },
	{ interpolation: "nearest-neighbor", density: 203 },
	{ interpolation: "nearest-neighbor", density: 300 },
	{ interpolation: "bilinear", density: 150 },
	{ interpolation: "bilinear", density: 203 },
	{ interpolation: "bilinear", density: 300 },
	{ interpolation: "bicubic", density: 150 },
	{ interpolation: "bicubic", density: 203 },
	{ interpolation: "bicubic", density: 300 },
];

interface ResultRow {
	label: string;
	status: "pending" | "sent" | "failed";
	message?: string;
}

const running = ref(false);
const results = ref<ResultRow[]>([]);

const progressPct = computed(() => {
	if (!results.value.length) return 0;
	const done = results.value.filter((r) => r.status !== "pending").length;
	return Math.round((done / COMBOS.length) * 100);
});

function __(text: string, args?: string[]) {
	if (typeof window !== "undefined" && typeof (window as any).__ === "function") {
		return (window as any).__(text, args);
	}
	return text;
}

function notify(title: string, color = "info") {
	try {
		toastStore.show({ title: __(title), color });
	} catch {
		// toast store unavailable in some harnesses — ignore.
	}
}

// Canonical test receipt — built to surface raster artefacts:
//   * varied font weights and a small caps line for hinting issues
//   * a CODE128-style horizontal-bar SVG to expose nearest-neighbor moiré
//   * a 1px diagonal line drawing to expose interpolation choice
//   * a 30%-gray block to show dithering / banding direction
//   * a small inline base64 PNG (8x8 checkerboard) scaled to 24mm to
//     expose downscale interpolation
//
// Header is large so the operator can pick the winning print off a
// stack of 9 receipts without ambiguity.
const CHECKERBOARD_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///8AAABVwtN+AAAAFUlE" +
	"QVQI12NgYGBgYPgPxAxEYwBHEwH/V6mPRgAAAABJRU5ErkJggg==";

function buildTestHtml(combo: Combo): string {
	const header = `Interpolation: ${combo.interpolation} | Density: ${combo.density} DPI`;
	// CODE128-ish striped bar — alternating widths to surface stripes.
	const barcode = `
		<svg width="100%" height="40" viewBox="0 0 300 40" preserveAspectRatio="none"
			xmlns="http://www.w3.org/2000/svg">
			${[2, 4, 1, 3, 2, 5, 1, 2, 4, 3, 1, 2, 5, 2, 3, 1, 4, 2, 3, 1, 2, 4, 3, 1]
				.map((w, i, arr) => {
					const x = arr.slice(0, i).reduce((s, v) => s + v + 1, 0) * 8;
					const fill = i % 2 === 0 ? "#000" : "#fff";
					return `<rect x="${x}" y="0" width="${w * 8}" height="40" fill="${fill}" />`;
				})
				.join("")}
		</svg>`;

	const diagonal = `
		<svg width="100%" height="30" viewBox="0 0 300 30" preserveAspectRatio="none"
			xmlns="http://www.w3.org/2000/svg">
			<line x1="0" y1="0" x2="300" y2="30" stroke="#000" stroke-width="1" />
			<line x1="0" y1="15" x2="300" y2="15" stroke="#000" stroke-width="1" />
			<line x1="0" y1="29" x2="300" y2="0" stroke="#000" stroke-width="1" />
		</svg>`;

	const grayBlock = `<div style="background: #b3b3b3; height: 18mm; width: 100%; margin: 2mm 0;"></div>`;

	const checker = `<img alt="checker" src="data:image/png;base64,${CHECKERBOARD_PNG_BASE64}"
		style="width: 24mm; height: 24mm; image-rendering: pixelated; display: block; margin: 2mm auto;" />`;

	return `
		<div style="text-align:center; font-weight:700; font-size:13pt; border:2px solid #000; padding:3mm; margin-bottom:3mm;">
			${header}
		</div>
		<div style="font-size:10pt; line-height:1.3; margin-bottom:2mm;">
			<div>Light line — abcdefghijklmnopqrstuvwxyz 0123456789</div>
			<div style="font-weight:700;">Bold line — ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</div>
			<div style="font-variant: small-caps;">small caps — quick brown fox jumps over lazy dog</div>
			<div style="font-size:8pt;">8pt — fine print test</div>
		</div>
		<div style="margin: 2mm 0;">${barcode}</div>
		<div style="margin: 2mm 0;">${diagonal}</div>
		<div style="font-size:9pt; text-align:center; margin: 2mm 0;">30% gray fill</div>
		${grayBlock}
		<div style="font-size:9pt; text-align:center; margin: 2mm 0;">Checkerboard (downscaled)</div>
		${checker}
		<div style="font-size:9pt; text-align:center; margin-top:3mm; border-top:1px dashed #000; padding-top:2mm;">
			Pick the cleanest. Save into POS Profile.
		</div>`;
}

function wrapForQz(body: string, widthMm = 80): string {
	// Mirror buildPrintHtml in qzTray.ts so the test prints land on the
	// same viewport pin / 4mm body inset / font sizing as production
	// receipts. Otherwise the A/B result would not transfer.
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@page { size: ${widthMm}mm auto; margin: 0; }
html { width: ${widthMm}mm; margin: 0; padding: 0; }
body { width: ${widthMm}mm; margin: 0; padding: 0 4mm; box-sizing: border-box; font-size: 10pt; line-height: 1.3; }
* { box-sizing: border-box; }
img { max-width: 100%; height: auto; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function comboLabel(combo: Combo): string {
	return `${combo.interpolation} × ${combo.density} DPI`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printAll() {
	if (running.value) return;
	running.value = true;
	results.value = COMBOS.map((c) => ({
		label: comboLabel(c),
		status: "pending" as const,
	}));

	for (let i = 0; i < COMBOS.length; i += 1) {
		// `noUncheckedIndexedAccess` types COMBOS[i] as `Combo | undefined`;
		// the loop bound guarantees in-range, so assert.
		const combo = COMBOS[i]!;
		const html = wrapForQz(buildTestHtml(combo));
		const options: QzPrintHtmlOptions = {
			widthMm: 80,
			orientation: "portrait",
			interpolation: combo.interpolation,
			density: combo.density,
		};
		try {
			await printHtmlViaQz(html, options);
			results.value[i] = { label: comboLabel(combo), status: "sent" };
			notify(`Sent: ${comboLabel(combo)}`, "success");
		} catch (error: any) {
			const msg = error?.message || String(error);
			results.value[i] = {
				label: comboLabel(combo),
				status: "failed",
				message: msg,
			};
			notify(`Failed: ${comboLabel(combo)} — ${msg}`, "error");
			// Continue to the next combo; partial results are still
			// useful for the operator to compare.
		}

		// 1 s spacing so the printer queue / paper feed doesn't
		// collapse separate combos into one ribbon and the operator
		// can correlate receipts with this dialog's status list.
		if (i < COMBOS.length - 1) {
			await delay(1000);
		}
	}

	running.value = false;
}
</script>

<style scoped>
.qz-ab-card {
	background-color: rgb(var(--v-theme-surface));
	color: rgb(var(--v-theme-on-surface));
}

.qz-ab-results {
	max-height: 320px;
	overflow-y: auto;
	background-color: transparent;
}
</style>
