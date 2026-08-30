<template>
	<div class="sticky-header" data-perf-tag="item-search">
		<v-row class="items">
			<v-col
				class="pb-0 search-col"
				:cols="posProfile.posa_input_qty && !isPhone ? 8 : 12"
				:sm="posProfile.posa_input_qty && !isPhone ? 9 : 12"
			>
				<div class="search-field-shell">
					<div class="search-field-row">
						<v-text-field
						density="compact"
						clearable
						:autofocus="!isPhone && !touchDriven"
						variant="solo"
						color="primary"
						class="pos-themed-input"
						:label="isPhone ? frappe._('Search') : frappe._('Search, scan or browse item')"
						:aria-label="frappe._('Search, scan or browse item')"
						hide-details
						data-pos-keyboard-target="item-search"
						enterkeyhint="search"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						:model-value="searchInput"
						@update:model-value="
							(val) => {
								$emit('update:searchInput', val);
								$emit('search-input', val);
							}
						"
						@keydown.enter="$emit('enter')"
						@keydown="handleSearchKeydown"
						@click:clear="$emit('clear-search')"
						@click:prepend-inner="$emit('focus')"
						@paste="$emit('search-paste', $event)"
						prepend-inner-icon="mdi-magnify"
						@focus="$emit('focus')"
						ref="debounce_search"
					>
						<template v-slot:append-inner>
							<!-- `último:` (artboard node 21) — what the last scan RESOLVED
							     to, not what was typed. Post-hoc confirmation for a fast
							     gun: the row appearing somewhere in a list is not proof
							     that the RIGHT row appeared. Desktop only; on a phone the
							     field has no room and the cart is already in view. -->
							<span
								v-if="!isPhone && lastResolvedScan"
								class="search-scan-echo"
								data-testid="scan-echo"
								:title="__('Last scan resolved to {0}', [lastResolvedScan])"
							>
								{{ __("last:") }} {{ lastResolvedScan }}
							</span>
							<span
								v-if="!isPhone && searchChord"
								class="search-chord-chip mono"
								data-testid="scan-chord"
								aria-hidden="true"
							>
								{{ searchChord }}
							</span>
							<v-chip
								v-if="isPhone && posProfile.posa_input_qty && qtyMultiplierActive"
								size="small"
								color="primary"
								variant="flat"
								class="qty-multiplier-chip"
								:aria-label="__('Quantity for next item — tap to reset')"
								:title="__('Quantity for next item — tap to reset')"
								@click.stop="$emit('update:qtyInput', 1)"
							>
								×{{ qtyInput }}
							</v-chip>
							<v-btn
								icon="mdi-tune-vertical"
								size="small"
								color="primary"
								variant="text"
								class="search-field-action"
								@click.stop="toolsOpen = !toolsOpen"
								:aria-label="toolsOpen ? __('Hide search tools') : __('Show search tools')"
							>
							</v-btn>
						</template>
					</v-text-field>
					<!-- Camera lives OUTSIDE append-inner: inside the field it
					     sat next to the clearable × (mis-tap generator) and
					     paid its width out of the label. -->
					<v-btn
						v-if="posProfile.posa_enable_camera_scanning"
						icon="mdi-camera"
						color="primary"
						variant="tonal"
						class="search-camera-btn"
						:disabled="scannerLocked"
						@click="$emit('start-camera')"
						:aria-label="
							scannerLocked
								? __('Camera scanner is locked until the current error is acknowledged')
								: __('Scan with camera')
						"
						:title="
							scannerLocked
								? __('Acknowledge the error to resume scanning')
								: __('Scan with Camera')
						"
					>
					</v-btn>
					<!-- Opens the cajón from beside the field (artboard nodes 23-24),
					     which is where a cashier's hand already is after a miss. It
					     emits onto the SAME door the rail item and the chord use —
					     one drawer state, three entry points, no fourth path. -->
					<v-btn
						v-if="showBrowse"
						variant="outlined"
						class="search-browse-btn"
						data-testid="browse-catalog"
						@click="$emit('browse-catalog')"
						:aria-label="__('Browse catalogue')"
					>
						<v-icon icon="mdi-view-grid-outline" size="18" start />
						<span class="search-browse-btn__label">{{ __("Browse catalogue") }}</span>
						<span v-if="browseChord" class="search-chord-chip mono" aria-hidden="true">
							{{ browseChord }}
						</span>
					</v-btn>
					</div>
					<div
						v-if="showSyncProgress"
						class="search-sync-progress"
						data-test="item-search-sync-shell"
						aria-live="polite"
					>
						<v-progress-linear
							:model-value="clampedSyncProgress"
							height="3"
							rounded
							color="info"
							bg-color="rgba(15, 23, 42, 0.08)"
							data-test="item-search-sync-bar"
						/>
						<div class="search-sync-progress__meta">
							<span class="search-sync-progress__label">
								{{ syncStatus || __("Syncing items in background") }}
								<span v-if="normalizedSyncItemsCount > 0" class="search-sync-progress__count">
									{{ syncItemsCountLabel }}
								</span>
							</span>
							<span class="search-sync-progress__value"> {{ clampedSyncProgress }}% </span>
						</div>
					</div>
				</div>
			</v-col>
			<v-col cols="4" sm="3" class="pb-0 search-qty-col" v-if="posProfile.posa_input_qty && !isPhone">
				<v-text-field
					density="compact"
					variant="solo"
					color="primary"
					class="pos-themed-input"
					:label="frappe._('QTY')"
					hide-details
					data-pos-keyboard-target="item-qty"
					:model-value="qtyInput"
					@update:model-value="$emit('update:qtyInput', $event)"
					type="text"
					inputmode="decimal"
					@keydown.enter="$emit('enter')"
					@keydown.esc="blurTarget"
					@focus="$emit('clear-qty')"
					@click="$emit('clear-qty')"
					@blur="$emit('blur-qty')"
				></v-text-field>
			</v-col>
		</v-row>
		<v-expand-transition>
			<div v-if="toolsOpen" class="tools-panel">
				<div
					v-if="isPhone && posProfile.posa_input_qty"
					class="tools-panel__qty"
				>
					<span class="tools-panel__qty-label">{{ __("Qty for next item") }}</span>
					<v-text-field
						density="compact"
						variant="solo"
						color="primary"
						class="pos-themed-input tools-panel__qty-field"
						hide-details
						data-pos-keyboard-target="item-qty"
						:model-value="qtyInput"
						@update:model-value="$emit('update:qtyInput', $event)"
						type="text"
						inputmode="decimal"
						@keydown.enter="$emit('enter')"
						@keydown.esc="blurTarget"
						@focus="$emit('clear-qty')"
						@click="$emit('clear-qty')"
						@blur="$emit('blur-qty')"
					></v-text-field>
				</div>
				<div class="tools-panel__actions">
					<v-btn
						v-if="context === 'purchase'"
						density="compact"
						variant="text"
						color="primary"
						prepend-icon="mdi-plus"
						@click="$emit('open-new-item')"
						class="settings-btn"
					>
						{{ __("New Item") }}
					</v-btn>
					<v-btn
						density="compact"
						variant="text"
						color="primary"
						prepend-icon="mdi-cog-outline"
						@click="$emit('toggle-settings')"
						class="settings-btn"
					>
						{{ __("Settings") }}
					</v-btn>
					<v-btn
						density="compact"
						variant="text"
						color="primary"
						prepend-icon="mdi-refresh"
						@click="$emit('reload-items')"
						class="settings-btn"
					>
						{{ __("Reload Items") }}
					</v-btn>
				</div>
				<div class="tools-panel__meta">
					<span v-if="syncStatus" class="text-caption text-info font-weight-bold sync-status-label">
						{{ syncStatus }}
					</span>
					<span
						v-else-if="enableBackgroundSync"
						class="text-caption text-medium-emphasis last-sync-label"
					>
						{{ __("Last sync:") }} {{ lastSyncTime }}
					</span>
				</div>
			</div>
		</v-expand-transition>
	</div>
</template>

<script setup>
import { computed, ref } from "vue";

import { coarsePointer } from "../../../utils/pointer";

// A tablet passes `!isPhone` and still must not autofocus: focusing the
// search on mount summons the on-screen keyboard over half the register
// (owner tablet, 08-24). Evaluated once — a pointer does not change mid-mount.
const touchDriven = coarsePointer();

const props = defineProps({
	searchInput: { type: String, default: "" },
	qtyInput: { type: [String, Number], default: 1 },
	posProfile: { type: Object, required: true },
	scannerLocked: { type: Boolean, default: false },
	enableBackgroundSync: { type: Boolean, default: false },
	lastSyncTime: { type: String, default: "" },
	syncStatus: { type: String, default: "" },
	showSyncProgress: { type: Boolean, default: false },
	syncProgress: { type: Number, default: 0 },
	syncItemsCount: { type: Number, default: 0 },
	context: { type: String, default: "pos" },
	isPhone: { type: Boolean, default: false },
	/** Item code the last scan resolved to. "" hides the echo entirely. */
	lastResolvedScan: { type: String, default: "" },
	/** Display chord for the action that focuses this field; null hides it. */
	searchChord: { type: String, default: "" },
	/** Display chord for opening the catalogue; null hides just the chip. */
	browseChord: { type: String, default: "" },
	/** Whether this header owns a catalogue to open (sale screen only). */
	showBrowse: { type: Boolean, default: false },
});

const emit = defineEmits([
	"update:searchInput",
	"update:qtyInput",
	"esc",
	"enter",
	"search-keydown",
	"clear-search",
	"search-input",
	"search-paste",
	"focus",
	"clear-qty",
	"blur-qty",
	"start-camera",
	"open-new-item",
	"toggle-settings",
	"reload-items",
	"browse-catalog",
]);

const debounce_search = ref(null);
const toolsOpen = ref(false);
// The "multiply the next tap" state only surfaces on phone when it is
// armed (≠1) — as a chip on the bar, tappable to disarm. The permanent
// QTY field stays desktop-only.
const qtyMultiplierActive = computed(() => {
	const parsed = Number(props.qtyInput);
	return Number.isFinite(parsed) && parsed !== 1 && String(props.qtyInput) !== "";
});
const clampedSyncProgress = computed(() => {
	const normalized = Number(props.syncProgress);
	if (!Number.isFinite(normalized) || normalized <= 0) {
		return 0;
	}
	return Math.min(100, Math.round(normalized));
});
const normalizedSyncItemsCount = computed(() => {
	const normalized = Number(props.syncItemsCount);
	if (!Number.isFinite(normalized) || normalized <= 0) {
		return 0;
	}
	return Math.round(normalized);
});
const translate = (value) => (typeof globalThis.__ === "function" ? globalThis.__(value) : value);
const syncItemsCountLabel = computed(() => {
	const count = normalizedSyncItemsCount.value;
	const itemLabel = count === 1 ? translate("item synced") : translate("items synced");
	return `${count.toLocaleString()} ${itemLabel}`;
});

const blurTarget = (event) => {
	event?.target?.blur?.();
};

const handleSearchEscape = (event) => {
	if (props.searchInput) {
		emit("esc");
		return;
	}
	blurTarget(event);
};

const handleSearchKeydown = (event) => {
	if (event?.key === "Escape") {
		handleSearchEscape(event);
		return;
	}
	emit("search-keydown", event);
};

defineExpose({
	debounce_search,
});
</script>

<style scoped>
/* Scan-bar affordances (Riel y Cajón §17.7, artboard nodes 21-24).
   Every colour resolves through `--pos-*` rather than the artboard's literals,
   so the bar follows the dark theme the way the rest of the register does —
   the shell components were converted for exactly this reason and the mock's
   hexes are light-mode-only values. */

/* `último: IPN001902`. Quiet on purpose: it is confirmation a cashier glances
   at, not a thing competing with the field's own text. `tabular-nums` keeps a
   changing code from shifting the label beside it. */
.search-scan-echo {
	font-size: 0.72rem;
	color: var(--pos-text-muted, #667085);
	opacity: 0.85;
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
	margin-inline-end: 6px;
}

/* Chord chips. Neutral by construction — invariant 2 spends the register's one
   saturated colour on the primary button, and a chip that competes with PAGAR
   for attention is spending it twice. */
.search-chord-chip {
	display: inline-flex;
	align-items: center;
	height: 20px;
	padding: 0 7px;
	border-radius: 999px;
	background: var(--pos-surface-variant, #f5f5f5);
	color: var(--pos-text-muted, #667085);
	font-size: 0.68rem;
	font-weight: 600;
	letter-spacing: 0.02em;
	white-space: nowrap;
	font-family: "Roboto Mono", ui-monospace, monospace;
}

.search-browse-btn {
	flex: none;
	height: 40px;
	border-radius: 10px;
	border-color: var(--pos-border, rgba(0, 0, 0, 0.12));
	color: var(--pos-text-secondary, #666666);
	text-transform: none;
	letter-spacing: 0;
	font-weight: 500;
	gap: 8px;
}

.search-browse-btn__label {
	margin-inline-end: 2px;
}

/* Below the two-column boundary the label goes and the icon carries it — the
   button keeps its job without spending width the ticket needs. */
@media (max-width: 1099px) {
	.search-browse-btn__label {
		display: none;
	}
}

/* The header card (selector-header-card) is the sticky element and owns
   the surface; a second sticky + background here painted a stacked
   double panel on phones. */
.sticky-header {
	background: transparent;
	padding: 12px 12px 0 12px;
	margin-bottom: 0;
}

.items {
	margin: 0;
}

.search-field-shell {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.search-field-row {
	display: flex;
	align-items: center;
	gap: 6px;
}

.search-field-row > .pos-themed-input {
	flex: 1 1 auto;
	min-width: 0;
}

.search-camera-btn {
	flex: 0 0 auto;
	width: 40px;
	height: 40px;
}

@media (pointer: coarse) {
	.search-camera-btn {
		width: 44px;
		height: 44px;
	}
}

/* Camera and search-tools live inside the search field's append-inner
   slot. Vuetify's `size="small"` icon button is a 28px square — under a
   thumb that is a miss waiting to happen. 44px (WCAG 2.5.5) does not fit:
   the field is `density="compact"`, so its own box is 40px tall and a
   44px control would overflow it and clip against the sticky header's
   bottom border. 40x40 is the largest square the field can hold, and
   still more than double the area of the 28px default. */
@media (pointer: coarse) {
	.search-field-shell :deep(.search-field-action) {
		min-width: 40px;
		min-height: 40px;
		width: 40px;
		height: 40px;
		touch-action: manipulation;
	}
}

.search-sync-progress {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 0 6px 2px;
	animation: sync-progress-fade-in 160ms ease-out;
}

:deep(.search-sync-progress .v-progress-linear) {
	border-radius: 999px;
	overflow: hidden;
	box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.08);
}

.search-sync-progress__meta {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.search-sync-progress__label,
.search-sync-progress__value {
	font-size: 0.7rem;
	line-height: 1.2;
	color: color-mix(in srgb, var(--pos-primary, #2563eb) 78%, #0f172a 22%);
}

.search-sync-progress__label {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
	font-weight: 600;
	letter-spacing: 0.01em;
}

.search-sync-progress__count {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	opacity: 0.82;
}

.search-sync-progress__value {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
}

.tools-panel {
	margin-top: 8px;
	padding: 10px 12px;
	border-radius: 16px;
	background: var(--pos-surface-muted);
	border: 1px solid var(--pos-border);
}

.tools-panel__actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
}

.tools-panel__qty {
	display: flex;
	align-items: center;
	gap: 10px;
	padding-bottom: 8px;
}

.tools-panel__qty-label {
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--pos-text-secondary);
	white-space: nowrap;
}

.tools-panel__qty-field {
	max-width: 110px;
}

.qty-multiplier-chip {
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.tools-panel__meta {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	padding-top: 6px;
}

.settings-btn {
	text-transform: none !important;
	letter-spacing: normal !important;
	font-weight: 500 !important;
	background-color: transparent !important;
	min-height: 40px !important;
}

.last-sync-label {
	white-space: nowrap;
	font-size: 0.75rem;
}

:deep(.sticky-header .v-field) {
	border-radius: 16px;
}

@media (max-width: 768px) {
	/* Keep the bar lean: the 40px compact field is the touch floor (see
	   the append-inner note above), so height savings come from chrome,
	   not the field. */
	.sticky-header {
		padding: 4px 8px;
	}

	/* Reclaim Vuetify's 12px col gutters — at 360px they cost the search
	   label 48px it does not have. */
	.sticky-header .items > .v-col {
		padding-left: 0;
		padding-right: 0;
	}

	.tools-panel {
		padding: 8px 10px;
	}

	.tools-panel__meta {
		justify-content: flex-start;
	}

	.search-sync-progress {
		gap: 3px;
		padding: 0 2px 2px;
	}

	.search-sync-progress__label,
	.search-sync-progress__value {
		font-size: 0.68rem;
	}
}

@keyframes sync-progress-fade-in {
	from {
		opacity: 0;
		transform: translateY(-2px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}
/* Dense desk tier (utils/itemSelectorLayout DENSE_DESK_*): ≥1100px wide,
 * ≤820px tall. Marco at 1143×656: «the cantidad field can be removed and the
 * explorar catálogo button made smaller». The qty-for-next-item field goes
 * (the multiplier chip inside the search field still answers a typed «3*»
 * and the tools panel keeps its own field), the search column takes the
 * width it leaves, and the browse button becomes its glyph — Alt+B, the
 * rail item and the drawer chip are the other three doors to the same
 * drawer. Heights fall to 36px so the row reads as one line. */
@media (min-width: 1100px) and (max-height: 820px) {
	.sticky-header .search-qty-col {
		display: none;
	}

	.sticky-header .search-col {
		flex: 1 1 auto;
		max-width: none;
	}

	.search-browse-btn,
	.search-camera-btn {
		height: 36px;
	}

	.search-browse-btn {
		min-width: 44px;
		padding: 0 12px;
	}

	.search-browse-btn__label,
	.search-browse-btn .search-chord-chip {
		display: none;
	}

	.search-browse-btn :deep(.v-icon) {
		margin-inline-end: 0;
	}
}
</style>
