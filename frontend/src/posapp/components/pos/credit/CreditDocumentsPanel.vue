<template>
	<section class="credit-docs" :aria-labelledby="headingId" data-testid="credit-documents">
		<header class="credit-docs__head">
			<h3 :id="headingId" class="credit-docs__title">{{ __("Documents") }}</h3>
			<CreditChip
				v-if="documents.total"
				:tone="documents.complete ? 'positive' : 'warning'"
				data-testid="credit-documents-progress"
			>
				{{
					documents.complete
						? __("All documents ready")
						: __("{0} of {1} ready", [documents.total - documents.missing, documents.total])
				}}
			</CreditChip>
		</header>

		<p v-if="!documents.required.length" class="credit-docs__hint">
			{{ __("This provider asks for no documents.") }}
		</p>
		<p v-else-if="editable" class="credit-docs__hint" data-testid="credit-documents-purpose">
			{{
				__(
					"The photos or files this provider asks for. They stay private with this sale; once all are ready, a manager marks the paperwork complete.",
				)
			}}
		</p>
		<p v-else class="credit-docs__hint">
			{{ __("You can see these documents but not change them.") }}
		</p>

		<ul v-if="documents.required.length" class="credit-docs__list">
			<li
				v-for="doc in documents.required"
				:key="doc.kind"
				class="credit-docs__row"
				:data-testid="`credit-doc-${doc.kind}`"
				:data-state="rowState(doc)"
			>
				<div class="credit-docs__main">
					<span
						class="credit-docs__mark"
						:class="doc.satisfied ? 'credit-docs__mark--done' : 'credit-docs__mark--missing'"
						aria-hidden="true"
					>
						<v-icon :icon="doc.satisfied ? 'mdi-check' : 'mdi-alert-circle-outline'" size="16" />
					</span>
					<div class="credit-docs__text">
						<strong class="credit-docs__label">{{ doc.label }}</strong>
						<span class="credit-docs__status" :data-testid="`credit-doc-status-${doc.kind}`">
							{{ statusText(doc) }}
						</span>
					</div>
					<a
						v-if="doc.file && fileHref(doc.file)"
						class="credit-docs__thumb"
						:href="fileHref(doc.file) || undefined"
						target="_blank"
						rel="noopener"
						:aria-label="__('Open {0}', [doc.file.file_name])"
						:data-testid="`credit-doc-open-${doc.kind}`"
					>
						<img
							v-if="doc.file.is_image"
							:src="fileHref(doc.file) || undefined"
							alt=""
							loading="lazy"
							decoding="async"
						/>
						<span v-else class="credit-docs__badge" aria-hidden="true">{{ fileBadge(doc.file) }}</span>
					</a>
				</div>

				<div v-if="editable && !doc.via_serial" class="credit-docs__actions">
					<template v-if="!doc.file">
						<button
							type="button"
							class="credit-docs__button"
							:disabled="isBusy(requiredKey(doc))"
							:data-testid="`credit-doc-camera-${doc.kind}`"
							@click="choose(requiredKey(doc), 'camera')"
						>
							<v-icon icon="mdi-camera" size="18" aria-hidden="true" />
							{{ __("Take photo") }}
						</button>
						<button
							type="button"
							class="credit-docs__button"
							:disabled="isBusy(requiredKey(doc))"
							:data-testid="`credit-doc-upload-${doc.kind}`"
							@click="choose(requiredKey(doc), 'file')"
						>
							<v-icon icon="mdi-paperclip" size="18" aria-hidden="true" />
							{{ __("Upload file") }}
						</button>
						<input
							:ref="(el) => keepInput(requiredKey(doc), 'camera', el)"
							class="credit-docs__input"
							type="file"
							:accept="CAMERA_ACCEPT"
							capture="environment"
							tabindex="-1"
							aria-hidden="true"
							:data-testid="`credit-doc-camera-input-${doc.kind}`"
							@change="onPicked(requiredKey(doc), doc.kind, $event)"
						/>
						<input
							:ref="(el) => keepInput(requiredKey(doc), 'file', el)"
							class="credit-docs__input"
							type="file"
							:accept="FILE_ACCEPT"
							tabindex="-1"
							aria-hidden="true"
							:data-testid="`credit-doc-file-input-${doc.kind}`"
							@change="onPicked(requiredKey(doc), doc.kind, $event)"
						/>
					</template>
					<template v-else-if="doc.file.can_remove">
						<button
							v-if="confirming !== doc.file.name"
							type="button"
							class="credit-docs__button"
							:disabled="removing === doc.file.name"
							:data-testid="`credit-doc-remove-${doc.kind}`"
							@click="askRemove(doc.file.name)"
						>
							{{ __("Remove") }}
						</button>
						<span v-else class="credit-docs__confirm" role="group" :aria-label="__('Remove this file?')">
							<span>{{ __("Remove this file?") }}</span>
							<button
								type="button"
								class="credit-docs__button credit-docs__button--danger"
								:data-testid="`credit-doc-remove-confirm-${doc.kind}`"
								@click="remove(doc.file.name)"
							>
								{{ __("Remove") }}
							</button>
							<button type="button" class="credit-docs__button" @click="confirming = ''">
								{{ __("Keep") }}
							</button>
						</span>
					</template>
				</div>

				<p
					v-if="slotOf(requiredKey(doc)).status === 'working'"
					class="credit-docs__progress"
					:data-testid="`credit-doc-working-${doc.kind}`"
				>
					<span class="credit-docs__spinner" aria-hidden="true"></span>
					{{ workingText(requiredKey(doc)) }}
				</p>
				<div
					v-if="slotOf(requiredKey(doc)).status === 'failed'"
					class="credit-docs__error"
					role="alert"
					:data-testid="`credit-doc-error-${doc.kind}`"
				>
					<p>{{ slotOf(requiredKey(doc)).error }}</p>
					<button
						v-if="slotOf(requiredKey(doc)).retryable"
						type="button"
						class="credit-docs__button"
						:data-testid="`credit-doc-retry-${doc.kind}`"
						@click="retry(requiredKey(doc))"
					>
						{{ __("Try again") }}
					</button>
				</div>
				<p
					v-if="doc.file && removeErrors[doc.file.name]"
					class="credit-docs__error"
					role="alert"
				>
					{{ removeErrors[doc.file.name] }}
				</p>
			</li>
		</ul>

		<section class="credit-docs__extra" :aria-labelledby="`${headingId}-extra`">
			<h4 :id="`${headingId}-extra`" class="credit-docs__subtitle">{{ __("Other documents") }}</h4>
			<ul v-if="documents.extra.length" class="credit-docs__list">
				<li
					v-for="file in documents.extra"
					:key="file.name"
					class="credit-docs__row"
					:data-testid="`credit-extra-${file.name}`"
				>
					<div class="credit-docs__main">
						<div class="credit-docs__text">
							<strong class="credit-docs__label">{{ file.file_name }}</strong>
							<span v-if="file.attachment_kind" class="credit-docs__status">{{ __(file.attachment_kind) }}</span>
						</div>
						<a
							v-if="fileHref(file)"
							class="credit-docs__thumb"
							:href="fileHref(file) || undefined"
							target="_blank"
							rel="noopener"
							:aria-label="__('Open {0}', [file.file_name])"
						>
							<img v-if="file.is_image" :src="fileHref(file) || undefined" alt="" loading="lazy" decoding="async" />
							<span v-else class="credit-docs__badge" aria-hidden="true">{{ fileBadge(file) }}</span>
						</a>
					</div>
					<div v-if="editable && file.can_remove" class="credit-docs__actions">
						<button
							v-if="confirming !== file.name"
							type="button"
							class="credit-docs__button"
							:disabled="removing === file.name"
							:data-testid="`credit-extra-remove-${file.name}`"
							@click="askRemove(file.name)"
						>
							{{ __("Remove") }}
						</button>
						<span v-else class="credit-docs__confirm" role="group" :aria-label="__('Remove this file?')">
							<span>{{ __("Remove this file?") }}</span>
							<button
								type="button"
								class="credit-docs__button credit-docs__button--danger"
								:data-testid="`credit-extra-remove-confirm-${file.name}`"
								@click="remove(file.name)"
							>
								{{ __("Remove") }}
							</button>
							<button type="button" class="credit-docs__button" @click="confirming = ''">
								{{ __("Keep") }}
							</button>
						</span>
					</div>
					<p v-if="removeErrors[file.name]" class="credit-docs__error" role="alert">
						{{ removeErrors[file.name] }}
					</p>
				</li>
			</ul>
			<p v-else-if="!editable" class="credit-docs__hint">{{ __("No other documents.") }}</p>

			<div v-if="editable" class="credit-docs__add" data-testid="credit-extra-add">
				<label v-if="documentKinds.length" class="credit-docs__field">
					<span>{{ __("Document type") }}</span>
					<select v-model="extraKind" data-testid="credit-extra-kind">
						<option v-for="kind in documentKinds" :key="kind" :value="kind">{{ __(kind) }}</option>
					</select>
				</label>
				<div class="credit-docs__actions">
					<button
						type="button"
						class="credit-docs__button"
						:disabled="isBusy(EXTRA)"
						data-testid="credit-extra-camera"
						@click="choose(EXTRA, 'camera')"
					>
						<v-icon icon="mdi-camera" size="18" aria-hidden="true" />
						{{ __("Take photo") }}
					</button>
					<button
						type="button"
						class="credit-docs__button"
						:disabled="isBusy(EXTRA)"
						data-testid="credit-extra-upload"
						@click="choose(EXTRA, 'file')"
					>
						<v-icon icon="mdi-paperclip" size="18" aria-hidden="true" />
						{{ __("Upload file") }}
					</button>
					<input
						:ref="(el) => keepInput(EXTRA, 'camera', el)"
						class="credit-docs__input"
						type="file"
						:accept="CAMERA_ACCEPT"
						capture="environment"
						tabindex="-1"
						aria-hidden="true"
						data-testid="credit-extra-camera-input"
						@change="onPicked(EXTRA, extraKind, $event)"
					/>
					<input
						:ref="(el) => keepInput(EXTRA, 'file', el)"
						class="credit-docs__input"
						type="file"
						:accept="FILE_ACCEPT"
						tabindex="-1"
						aria-hidden="true"
						data-testid="credit-extra-file-input"
						@change="onPicked(EXTRA, extraKind, $event)"
					/>
				</div>
				<p v-if="slotOf(EXTRA).status === 'working'" class="credit-docs__progress" data-testid="credit-extra-working">
					<span class="credit-docs__spinner" aria-hidden="true"></span>
					{{ workingText(EXTRA) }}
				</p>
				<div v-if="slotOf(EXTRA).status === 'failed'" class="credit-docs__error" role="alert" data-testid="credit-extra-error">
					<p>{{ slotOf(EXTRA).error }}</p>
					<button
						v-if="slotOf(EXTRA).retryable"
						type="button"
						class="credit-docs__button"
						data-testid="credit-extra-retry"
						@click="retry(EXTRA)"
					>
						{{ __("Try again") }}
					</button>
				</div>
			</div>
		</section>

		<p class="credit-docs__sr" aria-live="polite">{{ announcement }}</p>
	</section>
</template>

<script setup lang="ts">
/**
 * The paperwork a provider asks for, as a checklist the cashier works through
 * with the customer still at the counter: take a photo of the ID, upload the
 * contract PDF, and see at once what is still missing.
 *
 * Each row keeps its own upload state. A failed upload keeps the prepared
 * bytes, so «Try again» re-sends the same file instead of asking the cashier
 * to find it again — the customer whose ID it was may already have left.
 * Uploads are sent one at a time, so the documents block each answer carries
 * always includes the uploads before it.
 */
import { onBeforeUnmount, reactive, ref, useId, watch } from "vue";

import CreditChip from "./CreditChip.vue";
import {
	attachCreditDocument,
	removeCreditDocument,
	type CreditDocuments,
	type CreditFile,
	type CreditRequiredDocument,
} from "./creditApi";
import { describeError, safeFileUrl, translate as __ } from "./creditFormat";
import {
	CAMERA_ACCEPT,
	DEFAULT_MAX_UPLOAD_MB,
	FILE_ACCEPT,
	UploadRefusedError,
	prepareUpload,
	uploadLimitMb,
	type PreparedUpload,
} from "./creditUpload";

const props = withDefaults(
	defineProps<{
		invoice: string;
		documents: CreditDocuments;
		editable: boolean;
		/** `File.attachment_kind` options for «Other documents». */
		documentKinds?: string[];
		maxUploadMb?: number;
	}>(),
	{ documentKinds: () => [], maxUploadMb: DEFAULT_MAX_UPLOAD_MB },
);

const emit = defineEmits<{ "update:documents": [CreditDocuments] }>();

const headingId = `credit-docs-${useId()}`;

const EXTRA = "extra";
type PickMode = "camera" | "file";

interface UploadSlot {
	status: "idle" | "working" | "failed";
	phase: "preparing" | "uploading";
	error: string;
	/** Refusals (too large, wrong type) cannot succeed with the same file. */
	retryable: boolean;
	file: File | null;
	prepared: PreparedUpload | null;
	kind: string;
}

const IDLE: UploadSlot = Object.freeze({
	status: "idle",
	phase: "preparing",
	error: "",
	retryable: false,
	file: null,
	prepared: null,
	kind: "",
}) as UploadSlot;

const slots = reactive<Record<string, UploadSlot>>({});
const confirming = ref("");
const removing = ref("");
const removeErrors = reactive<Record<string, string>>({});
const announcement = ref("");
const extraKind = ref(props.documentKinds[0] || "");
const inputs = new Map<string, HTMLInputElement>();
let disposed = false;

const requiredKey = (doc: CreditRequiredDocument) => `required:${doc.kind}`;
const slotOf = (key: string): UploadSlot => slots[key] ?? IDLE;
const isBusy = (key: string) => slotOf(key).status === "working";

const fileHref = (file: CreditFile) => safeFileUrl(file.file_url);

/** `PDF`, `DOCX`… — the extension says what the file is when there is no picture. */
const fileBadge = (file: CreditFile) => {
	const match = /\.([a-z0-9]{1,5})$/i.exec(file.file_name || "");
	return (match?.[1] || "pdf").toUpperCase();
};

const rowState = (doc: CreditRequiredDocument) => {
	const slot = slotOf(requiredKey(doc));
	if (slot.status !== "idle") return slot.status;
	return doc.satisfied ? "done" : "missing";
};

const statusText = (doc: CreditRequiredDocument) => {
	if (doc.via_serial) return __("IMEI from serial number");
	if (doc.satisfied) return doc.file?.file_name || __("Ready");
	return __("Missing");
};

const workingText = (key: string) =>
	slotOf(key).phase === "preparing" ? __("Preparing the photo…") : __("Uploading…");

function keepInput(key: string, mode: PickMode, element: unknown) {
	const id = `${key}:${mode}`;
	if (element instanceof HTMLInputElement) inputs.set(id, element);
	else inputs.delete(id);
}

function choose(key: string, mode: PickMode) {
	if (isBusy(key)) return;
	inputs.get(`${key}:${mode}`)?.click();
}

function onPicked(key: string, kind: string, event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0] ?? null;
	// Cleared so choosing the same file again still fires `change`.
	input.value = "";
	if (file) void send(key, kind, file, null);
}

function retry(key: string) {
	const slot = slots[key];
	if (slot?.file && slot.status === "failed") void send(key, slot.kind, slot.file, slot.prepared);
}

let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(task, task);
	queue = run.catch(() => undefined);
	return run;
}

function refusalText(error: UploadRefusedError): string {
	if (error.reason === "too-large") {
		return __("This file is over {0} MB. Choose a smaller one.", [uploadLimitMb(props.maxUploadMb)]);
	}
	if (error.reason === "unsupported") return __("Choose a photo (JPEG, PNG or WebP) or a PDF.");
	return __("This file could not be read. Take the photo again or choose another file.");
}

async function send(key: string, kind: string, file: File, prepared: PreparedUpload | null) {
	if (isBusy(key)) return;
	const invoice = props.invoice;
	const slot: UploadSlot = reactive({ ...IDLE, status: "working", phase: prepared ? "uploading" : "preparing", file, prepared, kind });
	slots[key] = slot;
	announcement.value = "";
	try {
		const payload = prepared ?? (await prepareUpload(file, { maxUploadMb: props.maxUploadMb }));
		slot.prepared = payload;
		slot.phase = "uploading";
		const documents = await inTurn(() =>
			attachCreditDocument({ invoice, kind, filename: payload.filename, content: payload.content }),
		);
		if (disposed || invoice !== props.invoice) return;
		delete slots[key];
		announcement.value = __("{0} saved", [payload.filename]);
		emit("update:documents", documents);
	} catch (error) {
		if (disposed || invoice !== props.invoice) return;
		slot.status = "failed";
		if (error instanceof UploadRefusedError) {
			slot.retryable = false;
			slot.prepared = null;
			slot.error = refusalText(error);
		} else {
			slot.retryable = true;
			slot.error = describeError(error, __("The file was not saved. Check the connection and try again."));
		}
	}
}

function askRemove(fileName: string) {
	delete removeErrors[fileName];
	confirming.value = fileName;
}

async function remove(fileName: string) {
	if (removing.value) return;
	const invoice = props.invoice;
	confirming.value = "";
	removing.value = fileName;
	try {
		const documents = await inTurn(() => removeCreditDocument(invoice, fileName));
		if (disposed || invoice !== props.invoice) return;
		announcement.value = __("File removed");
		emit("update:documents", documents);
	} catch (error) {
		if (disposed || invoice !== props.invoice) return;
		removeErrors[fileName] = describeError(
			error,
			__("The file was not removed. Check the connection and try again."),
		);
	} finally {
		if (removing.value === fileName) removing.value = "";
	}
}

watch(
	() => props.invoice,
	() => {
		for (const key of Object.keys(slots)) delete slots[key];
		for (const key of Object.keys(removeErrors)) delete removeErrors[key];
		confirming.value = "";
		announcement.value = "";
	},
);

watch(
	() => props.documentKinds,
	(kinds) => {
		if (!kinds.includes(extraKind.value)) extraKind.value = kinds[0] || "";
	},
);

onBeforeUnmount(() => {
	disposed = true;
});
</script>

<style scoped>
.credit-docs {
	display: grid;
	gap: var(--reg-space-md);
	min-width: 0;
	color: var(--reg-text-primary);
}

.credit-docs__head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-sm);
}

.credit-docs__title {
	margin: 0;
	font-size: 16px;
	font-weight: 700;
}

.credit-docs__subtitle {
	margin: 0;
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-secondary);
}

.credit-docs__hint {
	margin: 0;
	font-size: 13px;
	color: var(--reg-text-secondary);
}

.credit-docs__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: var(--reg-space-sm);
}

.credit-docs__row {
	display: grid;
	gap: var(--reg-space-md);
	padding: var(--reg-space-md) var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface);
	min-width: 0;
}

.credit-docs__row[data-state="missing"] {
	border-color: var(--reg-tone-warning-border);
}

.credit-docs__main {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--reg-space-md);
}

.credit-docs__extra .credit-docs__main {
	grid-template-columns: minmax(0, 1fr) auto;
}

.credit-docs__mark {
	display: inline-grid;
	place-items: center;
	width: 28px;
	height: 28px;
	border-radius: 999px;
	border: 1px solid transparent;
}

.credit-docs__mark--done {
	background: var(--reg-tone-positive-bg);
	border-color: var(--reg-tone-positive-border);
	color: var(--reg-tone-positive-label);
}

.credit-docs__mark--missing {
	background: var(--reg-tone-warning-bg);
	border-color: var(--reg-tone-warning-border);
	color: var(--reg-tone-warning-label);
}

.credit-docs__text {
	display: grid;
	gap: 2px;
	min-width: 0;
}

.credit-docs__label {
	font-size: 14px;
	overflow-wrap: anywhere;
}

.credit-docs__status {
	font-size: 12.5px;
	color: var(--reg-text-secondary);
	overflow-wrap: anywhere;
}

.credit-docs__row[data-state="missing"] .credit-docs__status {
	color: var(--reg-tone-warning-label);
	font-weight: 600;
}

.credit-docs__thumb {
	display: grid;
	place-items: center;
	width: 56px;
	height: 56px;
	overflow: hidden;
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface-sunken);
	color: var(--reg-text-secondary);
	text-decoration: none;
}

.credit-docs__thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.credit-docs__badge {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.04em;
}

.credit-docs__actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm);
}

.credit-docs__button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--reg-space-xs);
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font: inherit;
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
	transition: transform var(--motion-fast) var(--ease-out);
}

.credit-docs__button:active:not(:disabled) {
	transform: scale(var(--press-scale));
}

.credit-docs__button:disabled {
	opacity: 0.55;
	cursor: default;
}

.credit-docs__button--danger {
	border-color: var(--reg-tone-negative-border);
	color: var(--reg-tone-negative-label);
}

.credit-docs__confirm {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm);
	font-size: 13px;
	font-weight: 600;
}

/* Visually hidden, not `display: none`: some mobile WebViews refuse a
   programmatic click() on an input that is not rendered. */
.credit-docs__input {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
	overflow: hidden;
	clip-path: inset(50%);
	pointer-events: none;
}

.credit-docs__progress {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm);
	margin: 0;
	font-size: 13px;
	color: var(--reg-text-secondary);
}

.credit-docs__spinner {
	width: 14px;
	height: 14px;
	border-radius: 999px;
	border: 2px solid var(--reg-border);
	border-top-color: var(--reg-text-secondary);
	animation: credit-docs-spin 800ms linear infinite;
}

.credit-docs__error {
	display: grid;
	gap: var(--reg-space-sm);
	justify-items: start;
	margin: 0;
	padding: var(--reg-space-sm) var(--reg-space-md);
	border: 1px solid var(--reg-tone-negative-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-tone-negative-bg);
	color: var(--reg-tone-negative-label);
	font-size: 13px;
}

.credit-docs__error p {
	margin: 0;
}

.credit-docs__error .credit-docs__button {
	color: var(--reg-text-primary);
}

.credit-docs__extra {
	display: grid;
	gap: var(--reg-space-sm);
}

.credit-docs__add {
	display: grid;
	gap: var(--reg-space-sm);
	padding: var(--reg-space-md) var(--reg-space-lg);
	border: 1px dashed var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-sunken);
}

.credit-docs__field {
	display: grid;
	gap: var(--reg-space-2xs);
	font-size: 13px;
	color: var(--reg-text-secondary);
}

.credit-docs__field select {
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-md);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font: inherit;
	font-size: 14px;
}

.credit-docs__sr {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

.credit-docs :is(button, a, select):focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}

@keyframes credit-docs-spin {
	to {
		transform: rotate(360deg);
	}
}

@media (max-width: 599.98px) {
	.credit-docs__actions > .credit-docs__button {
		flex: 1 1 140px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.credit-docs__spinner {
		animation: none;
	}
	.credit-docs__button {
		transition: none;
	}
}
</style>
