<template>
	<div class="movil-orden" data-testid="movil-orden" :data-connection="online ? 'online' : 'offline'">
		<!-- Header. The two chips are STATE, never emphasis (§1 invariant 2):
		     how many orders are waiting, and whether the register can reach
		     the workshop's records at all. -->
		<header class="movil-orden__head">
			<div class="movil-orden__brand">
				<div class="movil-orden__titles">
					<div class="movil-orden__title" data-testid="orden-title">{{ title }}</div>
					<div class="movil-orden__who" data-testid="orden-who">{{ who }}</div>
				</div>
				<span v-if="readyCount > 0" class="movil-orden__chip" data-testid="orden-ready-count">
					{{ __("{0} ready", [readyCount]) }}
				</span>
				<span
					class="movil-orden__chip"
					:class="online ? 'movil-orden__chip--ok' : 'movil-orden__chip--wait'"
					data-testid="orden-connection"
					:data-connection-state="online ? 'online' : 'offline'"
				>
					{{ online ? __("Online") : __("Offline") }}
				</span>
			</div>

			<label class="movil-orden__finder" :class="{ 'movil-orden__finder--off': !online }">
				<v-icon icon="mdi-magnify" size="17" aria-hidden="true" />
				<input
					class="movil-orden__finder-input"
					type="search"
					inputmode="search"
					data-testid="orden-finder"
					:value="searchTerm"
					:disabled="!online"
					:placeholder="__('Folio, IMEI or phone…')"
					:aria-label="__('Folio, IMEI or phone…')"
					@input="onSearchInput"
					@keyup.enter="emit('search')"
				/>
			</label>
		</header>

		<!--
			The offline statement, not an offline simulation.

			`serviceOrder` is `blocked` in railDestinations.ts because the order
			is created in Taller and PULLED from the server; there is nothing
			local to read. This block asks that module rather than restating
			its answer, so a wave-3 correction there reaches this screen
			without an edit here.
		-->
		<div
			v-if="!online"
			class="movil-orden__notice"
			data-testid="orden-offline-notice"
			:data-offline-availability="offlineAvailability"
			role="status"
			aria-live="polite"
		>
			<v-icon icon="mdi-cloud-off-outline" size="18" aria-hidden="true" />
			<div>
				<div class="movil-orden__notice-title">{{ __("Service orders need a connection") }}</div>
				<div class="movil-orden__notice-body">
					{{
						__(
							"The order lives in the workshop's records; the register reads it from the server.",
						)
					}}
				</div>
			</div>
		</div>

		<template v-if="view">
			<section class="movil-orden__card movil-orden__order" data-testid="orden-order">
				<div class="movil-orden__order-top">
					<span class="movil-orden__folio reg-mono" data-testid="orden-folio">
						#{{ view.orderId }}
					</span>
					<span class="movil-orden__chip movil-orden__chip--ok" data-testid="orden-status">
						{{ __(view.statusKey) }}
					</span>
					<div class="movil-orden__grow"></div>
					<span
						v-if="view.fiscal"
						class="movil-orden__chip movil-orden__chip--soft"
						data-testid="orden-fiscal"
					>
						{{ __("CFDI") }}
					</span>
				</div>
				<div class="movil-orden__device">
					<div class="movil-orden__glyph" aria-hidden="true">
						<v-icon icon="mdi-cellphone" size="24" />
					</div>
					<div class="movil-orden__device-copy">
						<div class="movil-orden__device-name" data-testid="orden-device">
							{{ view.deviceLabel }}
						</div>
						<div class="movil-orden__device-customer" data-testid="orden-customer">
							{{ view.customerName }}
						</div>
						<!--
							The masked id, and the only form of it that exists in this
							component: `ServiceOrderView` has no raw field, so there is
							nothing a title, an aria-label or a data-* could leak. The
							label reads the last four rather than a run of bullets,
							which is what a screen reader would otherwise announce.
						-->
						<div
							v-if="view.deviceIdMasked"
							class="movil-orden__device-id reg-mono"
							data-testid="orden-device-id"
							:aria-label="__('{0} ending {1}', [view.deviceIdLabelKey, view.deviceIdTail])"
						>
							{{ __(view.deviceIdLabelKey) }} {{ view.deviceIdMasked }}
						</div>
					</div>
				</div>
			</section>

			<ServiceOrderLineList
				:lines="view.lines"
				:evidence="view.evidence"
				:technician="view.technician"
				:format-amount="lineMoney"
			/>

			<ServiceOrderBalance
				:band="band"
				:order-total="view.totals.orderTotal"
				:advance="view.advance"
				:counter-sales="view.totals.counterSales"
				:blocked-reason="blockedReason"
				:format-currency="money"
				@primary="onPrimary"
			/>
		</template>

		<div v-else class="movil-orden__empty" data-testid="orden-empty">
			{{ __("Find an order by folio, IMEI or phone.") }}
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Órdenes de servicio on the phone (artboard `MovilOrden.dc.html`, roadmap
 * §4.6 Repair + Retail).
 *
 * This screen bills an order it did not create. The order lives in Taller and
 * arrives as a POS Charge Request; the register's whole job here is to show
 * the customer what they are being charged for and take the balance. That
 * framing decides three things the component does not get to choose:
 *
 *   - it renders the lines it was handed, all of them, including the ones
 *     worth nothing;
 *   - it never sees a raw IMEI (`serviceOrderLines.ts` masks before the view
 *     model exists);
 *   - it does not compute the balance — `resolveBandState` does, and this
 *     shows its three parts underneath.
 *
 * The parent owns fetching, currency and the connection flag. A component
 * that probed `navigator.onLine` itself would disagree with the shell's own
 * answer somewhere between the two.
 */
import { computed } from "vue";

import { resolveBandState } from "../../../../composables/pos/shell/bandState";
import { getRailDestination, isOfflineBlocked } from "../../../../composables/pos/shell/railDestinations";
import ServiceOrderBalance from "./ServiceOrderBalance.vue";
import ServiceOrderLineList from "./ServiceOrderLineList.vue";
import { serviceOrderBandInput, type ServiceOrderView } from "./serviceOrderLines";

defineOptions({ name: "MovilOrdenView" });

const props = withDefaults(
	defineProps<{
		/** Already mapped by `toServiceOrderView`; `null` shows the empty state. */
		view?: ServiceOrderView | null;
		/** "Órdenes de servicio", or whatever the preset's vocabulary calls it. */
		title?: string;
		/** "Caja 2 · Jenni" — the shell knows the register and the operator. */
		who?: string;
		readyCount?: number;
		/** The shell owns "can we reach the server?"; this never probes. */
		online?: boolean;
		searchTerm?: string;
		formatCurrency?: (_value: number) => string;
		/**
		 * Line figures are drawn bare on the artboard (`1,450`) while the
		 * balance block carries the symbol. Two formatters rather than one
		 * flag, so the tenant's currency decisions stay in one layer — the
		 * shell's — instead of being half-encoded here.
		 */
		formatLineAmount?: (_value: number) => string;
	}>(),
	{
		view: null,
		title: "",
		who: "",
		readyCount: 0,
		online: true,
		searchTerm: "",
		formatCurrency: undefined,
		formatLineAmount: undefined,
	},
);

const emit = defineEmits<{
	(_event: "update:searchTerm", _term: string): void;
	(_event: "search"): void;
	(_event: "primary", _actionId: string): void;
}>();

/** Mirrors `frappe-shim`'s `__`, as ActionBand.vue does — same reasoning. */
const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

/**
 * Asked once, at module scope: this is a property of the product, not of the
 * render. `blocked` is the honest answer for a surface the POS PULLS from the
 * server — see that module's note, and the `service_order_capture` entry in
 * `shell/mobile/offlineSurfaceManifest.ts` that points the other way.
 */
const SERVICE_ORDER = getRailDestination("serviceOrder");
const offlineAvailability = SERVICE_ORDER?.offlineAvailability ?? "blocked";
const NEEDS_CONNECTION = SERVICE_ORDER ? isOfflineBlocked(SERVICE_ORDER) : true;

const money = (value: number) =>
	props.formatCurrency
		? props.formatCurrency(value)
		: value.toLocaleString("es-MX", {
				style: "currency",
				currency: "MXN",
				minimumFractionDigits: 2,
			});

const lineMoney = (value: number) => (props.formatLineAmount ? props.formatLineAmount(value) : money(value));

/**
 * Why the button is off, in the cashier's words rather than by inference from
 * a disabled control. Three reasons, and the order is the order in which the
 * cashier can do something about them.
 */
const blockedReason = computed(() => {
	if (NEEDS_CONNECTION && !props.online) {
		return __("Charging a service order needs a connection to the workshop's records.");
	}
	if (props.view?.blocked) {
		return __("This order was already invoiced. Check before charging it again.");
	}
	return "";
});

const band = computed(() =>
	resolveBandState(
		serviceOrderBandInput(props.view?.lines ?? [], {
			advance: props.view?.advance ?? 0,
			orderId: props.view?.orderId ?? "",
			payable: !blockedReason.value && (props.view?.lines.length ?? 0) > 0,
		}),
	),
);

const onSearchInput = (event: Event) => emit("update:searchTerm", (event.target as HTMLInputElement).value);

/** Named, not inline: `$emit` is not bound on the setup proxy (build plan §10). */
const onPrimary = () => emit("primary", band.value.primaryAction.id);
</script>

<style scoped>
/* Artboard values carried as fallbacks, as the band does: this screen has to
 * render correctly on a phone whose stylesheet load raced the mount. */
.movil-orden {
	display: flex;
	flex-direction: column;
	gap: 9px;
	min-height: 0;
	background: var(--reg-surface-sunken, #f8f9fa);
	padding-bottom: 9px;
}

.movil-orden__head {
	background: var(--reg-surface, #ffffff);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
	padding: 13px 14px 11px;
	flex: none;
}

.movil-orden__brand {
	display: flex;
	align-items: center;
	gap: 9px;
}

.movil-orden__titles {
	flex: 1;
	min-width: 0;
	line-height: 1.15;
}

.movil-orden__title {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__who {
	font-size: 9.5px;
	color: var(--reg-text-muted, #667085);
}

.movil-orden__chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 500;
	padding: 3px 8px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
}

/* Green and amber are STATE here, never emphasis — the accent stays on the
 * one primary button below. */
.movil-orden__chip--ok {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
	font-weight: 700;
}

.movil-orden__chip--wait {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.movil-orden__chip--soft {
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.movil-orden__finder {
	display: flex;
	align-items: center;
	gap: 9px;
	margin-top: 11px;
	min-height: 44px;
	/* The artboard draws this border in the full accent. On the phone the
	 * finder sits a thumb's width above the one primary button, and two
	 * saturated teal shapes in one 390 px viewport is exactly the noise the
	 * single-accent rule exists to prevent — so the pale edge token, not the
	 * accent. Deliberate deviation from the artboard, recorded here. */
	border: 2px solid var(--reg-accent-edge, #9fdde6);
	border-radius: 11px;
	padding: 0 12px;
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.movil-orden__finder--off {
	background: var(--reg-surface-muted, #f2f4f7);
	border-color: var(--reg-border-soft, #e6e9ee);
	color: var(--reg-text-muted, #667085);
}

.movil-orden__finder-input {
	flex: 1;
	min-width: 0;
	min-height: 44px;
	border: 0;
	outline: none;
	background: transparent;
	font: inherit;
	font-size: 14px;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__notice {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	margin: 0 11px;
	padding: 11px 12px;
	border-radius: 12px;
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-orden__notice-title {
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-tone-warning-strong, #6b4a10);
}

.movil-orden__notice-body {
	font-size: 11px;
	margin-top: 2px;
}

.movil-orden__card {
	background: var(--reg-surface, #ffffff);
	margin: 0 11px;
	border-radius: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	padding: 12px;
	flex: none;
}

.movil-orden__order-top {
	display: flex;
	align-items: center;
	gap: 9px;
}

.movil-orden__grow {
	flex: 1;
}

.movil-orden__folio {
	font-size: 18px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__device {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 10px;
}

.movil-orden__glyph {
	width: 46px;
	height: 46px;
	border-radius: 11px;
	display: grid;
	place-items: center;
	flex: none;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #56606e);
}

.movil-orden__device-copy {
	flex: 1;
	min-width: 0;
	line-height: 1.3;
}

.movil-orden__device-name {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__device-customer {
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
}

.movil-orden__device-id {
	font-size: 10px;
	color: var(--reg-text-secondary, #56606e);
}

.movil-orden__empty {
	margin: 0 11px;
	padding: 28px 14px;
	text-align: center;
	font-size: 12.5px;
	color: var(--reg-text-muted, #667085);
	background: var(--reg-surface, #ffffff);
	border-radius: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
}

/* WCAG 2.5.5 on the two controls a thumb actually lands on. Desktop density
 * is untouched, as theme.css's own coarse block is. */
@media (pointer: coarse) {
	.movil-orden__finder,
	.movil-orden__finder-input {
		min-height: max(var(--reg-touch-min, 44px), 44px);
	}
}
</style>
