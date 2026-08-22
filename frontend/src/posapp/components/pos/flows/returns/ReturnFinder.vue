<template>
	<div class="return-finder" data-testid="return-finder">
		<div class="return-finder__columns">
			<section class="return-finder__col return-finder__col--find" :aria-label="__('Find the sale')">
				<h3 class="return-finder__label">{{ __("Find the sale") }}</h3>

				<!-- Toggle buttons, not tabs: there are no tabpanels here, and
				     `role="tab"` would promise a keyboard model (arrow keys move
				     between tabs) that this list does not implement. -->
				<div class="return-finder__ways" role="group" :aria-label="__('Find the sale')">
					<button
						v-for="method in methods"
						:key="method.id"
						type="button"
						class="return-finder__way"
						:class="{
							'return-finder__way--on': method.id === activeMethod,
							'return-finder__way--supervised': method.kind === 'supervised',
						}"
						:data-testid="`find-method-${method.id}`"
						:data-find-kind="method.kind"
						:aria-pressed="method.id === activeMethod"
						@click="emit('update:activeMethod', method.id)"
					>
						<v-icon :icon="method.icon" size="18" />
						<span class="return-finder__way-label">{{ __(method.label) }}</span>
						<span v-if="method.hint" class="return-finder__way-hint">{{ __(method.hint) }}</span>
						<span
							v-for="chord in method.chords"
							:key="chord"
							class="return-finder__chord reg-mono"
							:data-testid="`find-chord-${method.id}`"
							>{{ chord }}</span
						>
					</button>
				</div>

				<div v-if="activeIsSearch" class="return-finder__search">
					<v-text-field
						:model-value="term"
						:label="__(activePlaceholder)"
						:aria-label="__(activePlaceholder)"
						density="compact"
						variant="outlined"
						hide-details
						clearable
						autofocus
						class="pos-themed-input"
						data-testid="find-term"
						@update:model-value="(value) => emit('update:term', value ?? '')"
						@keyup.enter="emit('search')"
					/>
					<v-btn
						variant="flat"
						color="primary"
						:loading="searching"
						data-testid="find-submit"
						@click="emit('search')"
					>
						<v-icon start icon="mdi-magnify" />
						{{ __("Search") }}
					</v-btn>
				</div>

				<details v-if="activeIsSearch" class="return-finder__more" data-testid="find-more-filters">
					<summary>{{ __("Narrow it down") }}</summary>
					<slot name="filters" />
				</details>

				<p v-if="searchError" class="return-finder__error" data-testid="find-error">
					{{ __("The search could not run. Ask a supervisor before trying another way.") }}
				</p>

				<ul v-if="results.length" class="return-finder__results" data-testid="find-results">
					<li v-for="row in results" :key="row.name">
						<button
							type="button"
							class="return-finder__result"
							:class="{ 'return-finder__result--on': row.name === selectedSale?.name }"
							:data-testid="`find-result-${row.name}`"
							@click="emit('select-sale', row)"
						>
							<span class="reg-mono return-finder__result-id">{{ row.name }}</span>
							<span class="return-finder__result-who">{{ row.customer_name || row.customer }}</span>
							<span class="reg-mono return-finder__result-when">{{ formatDate(row.posting_date ?? "") }}</span>
							<span class="reg-mono return-finder__result-sum" data-money-role="breakdown">{{
								formatCurrency(row.grand_total ?? 0)
							}}</span>
						</button>
					</li>
					<li><slot name="results-footer" /></li>
				</ul>
				<p
					v-else-if="searchedOnce && activeIsSearch && !searching && !searchError"
					class="return-finder__empty"
					data-testid="find-empty"
				>
					{{ __("No sale matched. Try another way to find it.") }}
				</p>

				<div v-if="selectedSale" class="return-finder__panel" data-testid="original-sale">
					<h4 class="return-finder__label">{{ __("Original sale") }}</h4>
					<div class="return-finder__pair">
						<span>{{ __("Date") }}</span>
						<span class="reg-mono">{{ formatDate(selectedSale.posting_date ?? "") }} · {{ selectedSale.posting_time }}</span>
					</div>
					<div v-if="cashier" class="return-finder__pair" data-testid="original-cashier">
						<span>{{ __("Cashier") }}</span>
						<span>{{ cashier }}</span>
					</div>
					<div class="return-finder__pair">
						<span>{{ __("Customer") }}</span>
						<span>{{ selectedSale.customer_name || selectedSale.customer }}</span>
					</div>
					<div class="return-finder__pair">
						<span>{{ __("Total") }}</span>
						<span class="reg-mono return-finder__pair-strong" data-money-role="breakdown">{{
							formatCurrency(selectedSale.grand_total ?? 0)
						}}</span>
					</div>
				</div>

				<div class="return-finder__spacer"></div>

				<p
					v-if="warranty"
					class="return-finder__warranty"
					:class="`return-finder__warranty--${warranty.verdict}`"
					data-testid="warranty-window"
				>
					{{ warrantyMessage }}
				</p>
			</section>

			<section class="return-finder__col return-finder__col--lines" :aria-label="__('What the customer is bringing back')">
				<header class="return-finder__lines-head">
					<h3 class="return-finder__label">{{ __("What the customer is bringing back") }}</h3>
					<span class="return-finder__rule">{{
						__("the original price, tax and tender are kept")
					}}</span>
				</header>

				<div class="return-finder__lines-cols">
					<span></span>
					<span>{{ __("Item") }}</span>
					<span class="return-finder__num">{{ __("Price") }}</span>
					<span class="return-finder__num">{{ __("Qty") }}</span>
					<span class="return-finder__num">{{ __("To return") }}</span>
				</div>

				<div class="return-finder__lines" data-testid="return-lines">
					<div
						v-for="line in plan.lines"
						:key="line.name"
						class="return-finder__line"
						:class="{ 'return-finder__line--on': line.selected }"
						:data-testid="`return-line-${line.item_code}`"
					>
						<v-checkbox
							:model-value="line.selected"
							density="compact"
							hide-details
							color="primary"
							:aria-label="line.item_name"
							:data-testid="`return-line-toggle-${line.item_code}`"
							@update:model-value="(value) => toggleLine(line, value)"
						/>
						<div class="return-finder__line-id">
							<span class="return-finder__line-name">{{ line.item_name }}</span>
							<span class="reg-mono return-finder__line-code">{{ line.item_code }}</span>
						</div>
						<span class="reg-mono return-finder__num" data-money-role="breakdown">{{
							formatCurrency(line.rate)
						}}</span>
						<span class="return-finder__num">
							<input
								class="reg-mono return-finder__qty"
								type="number"
								inputmode="decimal"
								min="0"
								:max="line.returnableQty"
								:value="line.qty"
								:aria-label="`${line.item_name} — ${__('To return')}`"
								:data-testid="`return-line-qty-${line.item_code}`"
								@input="onQtyInput(line, $event)"
							/>
							<span class="return-finder__qty-cap reg-mono">{{ __("of") }} {{ line.returnableQty }}</span>
						</span>
						<span class="reg-mono return-finder__num return-finder__line-amount" data-money-role="breakdown">{{
							formatCurrency(line.amount)
						}}</span>
					</div>

					<p v-if="!plan.totalLineCount" class="return-finder__empty" data-testid="return-lines-empty">
						{{ __("Find the sale first and its items will appear here.") }}
					</p>
				</div>

				<footer class="return-finder__lines-foot">
					<span data-testid="return-line-count"
						>{{ plan.selectedLineCount }} {{ __("of") }} {{ plan.totalLineCount }}
						{{ __("items") }}</span
					>
					<span class="reg-mono" data-testid="return-selected-amount" data-money-role="breakdown">{{
						formatCurrency(plan.selectedAmount)
					}}</span>
				</footer>
			</section>

			<section class="return-finder__col return-finder__col--why" :aria-label="__('Reason and authorisation')">
				<h3 class="return-finder__label">{{ __("Reason") }}</h3>
				<div class="return-finder__reasons">
					<button
						v-for="option in REASONS"
						:key="option"
						type="button"
						class="return-finder__reason"
						:class="{ 'return-finder__reason--on': option === noTicket.reason }"
						:data-testid="`return-reason-${option}`"
						@click="patchNoTicket({ reason: option })"
					>
						{{ __(option) }}
					</button>
				</div>

				<div v-if="isNoTicket" class="return-finder__supervise" data-testid="no-ticket-panel">
					<h4 class="return-finder__label">{{ __("Authorisation") }}</h4>
					<v-select
						:model-value="noTicket.authoriserUser"
						:items="authoriserItems"
						item-title="title"
						item-value="value"
						density="compact"
						variant="outlined"
						hide-details
						:label="__('Authorised by')"
						class="pos-themed-input"
						data-testid="no-ticket-authoriser"
						@update:model-value="(value) => patchNoTicket({ authoriserUser: value ?? null })"
					/>
					<v-checkbox
						:model-value="noTicket.signatureTaken"
						density="compact"
						hide-details
						color="primary"
						:label="__('The customer signed the printed return note')"
						data-testid="no-ticket-signature"
						@update:model-value="(value) => patchNoTicket({ signatureTaken: Boolean(value) })"
					/>
					<ul class="return-finder__blockers" data-testid="no-ticket-blockers">
						<li v-for="blocker in decision.blockers" :key="blocker" :data-blocker="blocker">
							{{ __(NO_TICKET_BLOCKER_MESSAGES[blocker]) }}
						</li>
					</ul>
				</div>

				<div v-else-if="warranty?.requiresAuthorisation" class="return-finder__supervise" data-testid="expired-panel">
					<h4 class="return-finder__label">{{ __("Authorisation") }}</h4>
					<v-select
						:model-value="noTicket.authoriserUser"
						:items="authoriserItems"
						item-title="title"
						item-value="value"
						density="compact"
						variant="outlined"
						hide-details
						:label="__('Authorised by')"
						class="pos-themed-input"
						data-testid="expired-authoriser"
						@update:model-value="(value) => patchNoTicket({ authoriserUser: value ?? null })"
					/>
				</div>

				<div class="return-finder__panel" data-testid="return-record">
					<h4 class="return-finder__label">{{ __("On the record") }}</h4>
					<div class="return-finder__pair">
						<span>{{ __("Returned by") }}</span>
						<span>{{ cashierOnDuty }}</span>
					</div>
					<div class="return-finder__pair">
						<span>{{ __("Authorised by") }}</span>
						<span data-testid="record-authoriser">{{ authoriserLabel }}</span>
					</div>
					<div v-if="selectedSale" class="return-finder__pair">
						<span>{{ __("Original sale") }}</span>
						<span class="reg-mono">{{ selectedSale.name }}</span>
					</div>
				</div>

				<div class="return-finder__spacer"></div>

				<v-btn
					block
					size="large"
					variant="flat"
					class="return-finder__primary"
					:disabled="!canProceed"
					data-testid="return-proceed"
					:data-can-proceed="canProceed ? '1' : '0'"
					@click="emit('proceed')"
				>
					<v-icon start icon="mdi-backup-restore" />
					{{ __("Continue the return") }}
				</v-btn>
			</section>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Devolución — finding the sale (`Devolucion.dc.html`, roadmap §5.4 / §5.6).
 *
 * PRESENTATION ONLY, and the boundary is deliberate. This component decides
 * which ways of finding a sale to draw, which chord chip each one has earned,
 * what the warranty window means, and whether the supervised path may
 * proceed. It decides NOTHING about money: the refund is built by
 * `Returns.vue::submit_dialog` exactly as it was before this screen existed,
 * from items whose rate, discount, net amount and tender mapping this file
 * never touches.
 *
 * The band is not drawn here either. `bandState.ts` already has a `refund`
 * kind carrying the ticket id and the amount, and the shell owns the lane —
 * a second big number rendered inside this panel would be the "one number,
 * one action" invariant broken by the screen that most needs it.
 */
import { computed } from "vue";

import {
	NO_TICKET_BLOCKER_MESSAGES,
	evaluateNoTicketReturn,
	eligibleAuthorisers,
	type NoTicketRequest,
	type ReturnAuthoriser,
} from "./noTicketGate";
import type { OriginalSaleRow } from "./findOriginalSale";
import type { ResolvedFindMethod, ReturnFindMethodId } from "./findMethods";
import {
	clampReturnQty,
	planReturnLines,
	type ReturnableLine,
	type ReturnSelection,
} from "./returnLines";
import { WARRANTY_MESSAGES, type WarrantyWindow } from "./warrantyWindow";

/** Reason chips, in the artboard's order. English source; `__()` at render. */
const REASONS = ["Did not fit", "Arrived faulty", "Wrong item", "Other"] as const;

// Bound locally rather than leaning on the ambient global, the same way
// `CatalogDrawer.vue` does: a `<script setup>` component mounted in a spec has
// no Vuetify-era `mocks.__` to fall back on, and an unstubbed global would
// throw inside a computed rather than degrade to the source string.
const __ = window.__ || ((value: string) => value);

const props = defineProps<{
	methods: readonly ResolvedFindMethod[];
	activeMethod: ReturnFindMethodId;
	term: string;
	searching: boolean;
	searchedOnce: boolean;
	searchError: string | null;
	results: readonly OriginalSaleRow[];
	selectedSale: OriginalSaleRow | null;
	cashier: string | null;
	cashierOnDuty: string;
	warranty: WarrantyWindow | null;
	lines: readonly ReturnableLine[];
	selection: ReturnSelection;
	authorisers: readonly ReturnAuthoriser[];
	noTicket: Pick<NoTicketRequest, "allowedByProfile" | "authoriserUser" | "signatureTaken" | "reason">;
	formatCurrency: (value: number) => string;
	/** The dialog's own date formatter — same output the results table had. */
	formatDate: (value: string) => string;
}>();

const emit = defineEmits<{
	"update:activeMethod": [ReturnFindMethodId];
	"update:term": [string];
	"update:selection": [Record<string, number>];
	"update:noTicket": [Partial<NoTicketRequest>];
	search: [];
	"select-sale": [OriginalSaleRow];
	proceed: [];
}>();

const activeDef = computed(() => props.methods.find((method) => method.id === props.activeMethod) ?? null);
const activeIsSearch = computed(() => activeDef.value?.kind === "search");
const isNoTicket = computed(() => activeDef.value?.kind === "supervised");
const activePlaceholder = computed(() => activeDef.value?.placeholder || "Search");

const plan = computed(() => planReturnLines(props.lines, props.selection));

const authoriserItems = computed(() =>
	eligibleAuthorisers(props.authorisers).map((candidate) => ({
		title: candidate.full_name || candidate.user,
		value: candidate.user,
	})),
);

const decision = computed(() =>
	evaluateNoTicketReturn({
		allowedByProfile: props.noTicket.allowedByProfile,
		authorisers: props.authorisers,
		authoriserUser: props.noTicket.authoriserUser,
		signatureTaken: props.noTicket.signatureTaken,
		reason: props.noTicket.reason,
	}),
);

const namedAuthoriser = computed(() =>
	eligibleAuthorisers(props.authorisers).find(
		(candidate) => candidate.user === props.noTicket.authoriserUser,
	) ?? null,
);

const authoriserLabel = computed(() => {
	if (isNoTicket.value || props.warranty?.requiresAuthorisation) {
		return namedAuthoriser.value?.full_name || namedAuthoriser.value?.user || __("not named yet");
	}
	return __("not needed");
});

const warrantyMessage = computed(() => {
	const window = props.warranty;
	if (!window) return "";
	const slot =
		window.verdict === "expired" ? String(window.validUpto ?? "") : String(window.daysLeft ?? "");
	return __(WARRANTY_MESSAGES[window.verdict]).replace("{0}", slot);
});

/**
 * The primary action's own gate.
 *
 * Three separate refusals, kept separate on purpose: the supervised path is
 * refused by `evaluateNoTicketReturn`, an out-of-warranty return is refused
 * until a supervisor is named, and an ordinary return is refused only when
 * nothing is selected. Collapsing them into one boolean would make the
 * disabled button unexplainable, which is how a cashier ends up tapping it
 * repeatedly.
 */
const canProceed = computed(() => {
	if (isNoTicket.value) {
		return decision.value.allowed;
	}
	if (!props.selectedSale || plan.value.selectedLineCount === 0) {
		return false;
	}
	if (props.warranty?.requiresAuthorisation) {
		return Boolean(namedAuthoriser.value);
	}
	return true;
});

const patchNoTicket = (patch: Partial<NoTicketRequest>) => emit("update:noTicket", patch);

const toggleLine = (line: { name: string; returnableQty: number }, value: unknown) => {
	emit("update:selection", {
		...props.selection,
		[line.name]: value ? line.returnableQty : 0,
	});
};

const onQtyInput = (line: { name: string; returnableQty: number }, event: Event) => {
	const raw = (event.target as HTMLInputElement | null)?.value;
	emit("update:selection", {
		...props.selection,
		// Clamped on the way IN, not only on the way out: an input that shows
		// 99 while the plan holds 1 tells the cashier they are returning 99.
		[line.name]: clampReturnQty(raw, line.returnableQty),
	});
};
</script>

<style scoped>
.return-finder {
	display: flex;
	flex-direction: column;
	/* Height chain (59c5fe1ad): fill the parent, refuse to grow past it, and
	 * let exactly one descendant scroll. `min-height: 0` is the half that
	 * does the work — a flex item defaults to `min-height: auto` and will not
	 * shrink below its content, which is how a second scrollport appears. */
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

.return-finder__columns {
	display: flex;
	gap: var(--reg-space-lg, 14px);
	flex: 1 1 auto;
	min-height: 0;
	padding: var(--reg-space-lg, 14px);
}

.return-finder__col {
	display: flex;
	flex-direction: column;
	min-height: 0;
	gap: var(--reg-space-md, 10px);
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	padding: var(--reg-space-lg, 14px);
}

.return-finder__col--find,
.return-finder__col--why {
	width: 310px;
	flex: none;
}

.return-finder__col--lines {
	flex: 1 1 auto;
	min-width: 0;
}

.return-finder__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
	margin: 0;
}

.return-finder__ways {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xs, 5px);
}

.return-finder__way {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	min-height: var(--reg-touch-min, 44px);
	padding: 0 13px;
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 13px;
	text-align: left;
	cursor: pointer;
}

/* Selection is an EDGE and a wash, never a saturated fill: invariant 2 spends
 * the one saturated colour on the primary button at the bottom of this panel,
 * and a filled tab would be a second thing shouting. */
.return-finder__way--on {
	border: 2px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.return-finder__way--supervised {
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.return-finder__way-label {
	flex: 1;
}

.return-finder__way-hint,
.return-finder__chord {
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__search {
	display: flex;
	gap: var(--reg-space-sm, 6px);
	align-items: center;
}

.return-finder__more {
	font-size: 12px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__more > summary {
	cursor: pointer;
	padding: 4px 0;
}

.return-finder__results {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-2xs, 2px);
	max-height: 190px;
	overflow-y: auto;
}

.return-finder__result {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 2px 8px;
	width: 100%;
	padding: 7px 10px;
	border: 1px solid transparent;
	border-radius: var(--reg-radius-xs, 6px);
	background: var(--reg-surface-sunken, #f8f9fa);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 12.5px;
	text-align: left;
	cursor: pointer;
}

.return-finder__result--on {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
}

.return-finder__result-id {
	font-weight: 700;
}

.return-finder__result-who,
.return-finder__result-when {
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__result-sum {
	text-align: right;
}

.return-finder__panel {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 6px);
	padding: 12px 13px;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-sunken, #f8f9fa);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
}

.return-finder__pair {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	font-size: 12.5px;
	color: var(--reg-text-primary, #212121);
}

.return-finder__pair > span:first-child {
	color: var(--reg-text-muted, #667085);
}

.return-finder__pair-strong {
	font-weight: 700;
}

.return-finder__spacer {
	flex: 1 1 auto;
	min-height: 0;
}

.return-finder__warranty {
	margin: 0;
	padding: 12px 13px;
	border-radius: var(--reg-radius-sm, 10px);
	font-size: 12px;
	line-height: 1.45;
	background: var(--reg-tone-positive-bg, #f4fbf7);
	border: 1px solid var(--reg-tone-positive-border, #cdead8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.return-finder__warranty--expired {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border-color: var(--reg-tone-warning-border, #f0dcae);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.return-finder__warranty--unrecorded {
	background: var(--reg-surface-sunken, #f8f9fa);
	border-color: var(--reg-border-light, rgba(0, 0, 0, 0.06));
	color: var(--reg-text-muted, #667085);
}

.return-finder__lines-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.return-finder__rule {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__lines-cols,
.return-finder__line {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr) 84px 128px 96px;
	gap: var(--reg-space-md, 10px);
	align-items: center;
}

.return-finder__lines-cols {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
	padding-bottom: var(--reg-space-sm, 6px);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

/* The one scrollport in this view. */
.return-finder__lines {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
}

.return-finder__line {
	min-height: var(--reg-row-height, 56px);
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.return-finder__line--on {
	background: var(--reg-accent-soft, #e0f7fa);
}

.return-finder__line-id {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.return-finder__line-name {
	font-size: 14px;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.return-finder__line-code {
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__num {
	text-align: right;
	font-size: 13px;
	color: var(--reg-text-secondary, #56606e);
}

.return-finder__line-amount {
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.return-finder__qty {
	width: 62px;
	text-align: right;
	padding: 3px 6px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-xs, 6px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13.5px;
	font-weight: 700;
}

.return-finder__qty-cap {
	margin-left: 6px;
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__lines-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 14px;
	padding-top: 11px;
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: 12px;
	color: var(--reg-text-muted, #667085);
}

.return-finder__reasons {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--reg-space-xs, 5px);
}

.return-finder__reason {
	padding: 8px 10px;
	border-radius: 999px;
	border: 1px solid transparent;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}

.return-finder__reason--on {
	background: var(--reg-accent-soft, #e0f7fa);
	border-color: var(--reg-accent-edge, #9fdde6);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.return-finder__supervise {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 6px);
	padding: 12px 13px;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
}

.return-finder__blockers {
	margin: 0;
	padding-left: 16px;
	font-size: 11.5px;
	line-height: 1.5;
	color: var(--reg-tone-warning-strong, #6b4a10);
}

.return-finder__error {
	margin: 0;
	font-size: 12px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.return-finder__empty {
	margin: 0;
	font-size: 12.5px;
	color: var(--reg-text-muted, #667085);
}

/* The single saturated accent on this screen. */
.return-finder__primary {
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #fff);
	font-weight: 700;
}
</style>
