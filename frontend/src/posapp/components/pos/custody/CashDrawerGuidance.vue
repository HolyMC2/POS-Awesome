<template>
	<!-- Nothing at all is the common case: a drawer under its limit on a
	     register with no custody, no shift or no configured limit must not
	     spend a line of the cashier's screen. -->
	<section
		v-if="unavailable || data?.show"
		class="drawer-guidance"
		:class="{ 'drawer-guidance--act': data?.over_limit }"
		data-testid="drawer-guidance"
		aria-live="polite"
	>
		<template v-if="unavailable">
			<p class="drawer-guidance__line" data-testid="drawer-guidance-error">
				{{ __("The drawer cash check is unavailable. Nothing was counted or moved.") }}
			</p>
			<button class="drawer-guidance__retry" @click="refresh" :disabled="busy">
				{{ busy ? __("Checking…") : __("Retry") }}
			</button>
		</template>

		<template v-else-if="data?.over_limit">
			<p class="drawer-guidance__line">
				<b data-testid="drawer-guidance-headline">{{
					__("Expected drawer cash is above its limit.")
				}}</b>
			</p>
			<dl class="drawer-guidance__facts">
				<div>
					<dt>{{ __("Expected in the drawer") }}</dt>
					<dd data-testid="drawer-guidance-expected">{{ money(data.expected_amount) }}</dd>
				</div>
				<div>
					<dt>{{ __("Drawer cash limit") }}</dt>
					<dd>{{ money(data.drawer_limit) }}</dd>
				</div>
				<div>
					<dt>{{ __("Suggested return") }}</dt>
					<dd data-testid="drawer-guidance-suggested">{{ money(data.suggested_return) }}</dd>
				</div>
			</dl>
			<!-- The ledger figure is a system expectation. Saying so out loud is
			     the whole reason this surface is allowed to show it. -->
			<p class="drawer-guidance__muted">
				{{
					__(
						"This is what the system expects, not a count. Count the cash you actually take out.",
					)
				}}
			</p>
			<button
				class="drawer-guidance__action"
				data-testid="drawer-guidance-return"
				@click="requestReturn"
			>
				{{ __("Return bag to safe") }}
			</button>
			<p class="drawer-guidance__muted">
				<span v-if="data.safe_title">{{ data.safe_title }} · </span>{{ freshness }}
			</p>
		</template>

		<template v-else>
			<p class="drawer-guidance__line" data-testid="drawer-guidance-ok">
				{{ __("Expected drawer cash is within its limit.") }}
				<span class="drawer-guidance__muted">{{ freshness }}</span>
			</p>
		</template>
	</section>
</template>

<script setup lang="ts">
/**
 * "Should I walk a bag to the safe right now?" — answered beside the drawer,
 * never in the way of a sale.
 *
 * `docs/POS-CASH-CUSTODY.md` is explicit that the drawer cash limit is
 * guidance and NOT a sales block, and the UX review's remaining work asks for
 * "useful excess-drawer-cash alerts". So this is a hint with one next action,
 * not an alert framework: no severity ladder, no dismissal state, no polling.
 *
 * Every decision that could leak money facts belongs to the server
 * (`api/cash_custody/service.drawer_guidance`): a blind-count profile, a
 * register with no safe, no open shift or no configured limit comes back with
 * `show: false` and no amounts in the payload, so there is nothing here to
 * accidentally render. The figure shown is the canonical closing expectation,
 * and the copy says so — it is never presented as a physical count, and this
 * component never pre-fills one.
 *
 * Standalone on purpose: the parent wires `request-return` to whatever it
 * already uses to start a drop, so `CashCustodyView` and the closing screen
 * stay untouched.
 */
import { computed, ref, watch } from "vue";
import { read } from "./api";

const props = defineProps<{ profile?: string | null; opening?: string | null }>();
const emit = defineEmits(["request-return"]);

const __ = (s: string) => (window as any).__?.(s) || s;

/** The parent starts the drop. This surface never opens a count of its own. */
const requestReturn = () => emit("request-return");

const data = ref<any>(null);
const failed = ref(false);
const busy = ref(false);
/** Only the newest request may write state: switching register must not let a
 *  slower answer for the previous one land as a live alert here. */
let token = 0;

const unavailable = computed(() => failed.value && Boolean(props.profile) && Boolean(props.opening));

const money = (value: any) => {
	const amount = Number(value) || 0;
	const currency = data.value?.currency || "MXN";
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			minimumFractionDigits: 2,
		}).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`.trim();
	}
};

/** When the figure was read. An amount with no age invites trusting a stale one. */
const freshness = computed(() => {
	const raw = data.value?.as_of;
	if (!raw) return "";
	const parsed = new Date(String(raw).replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) return String(raw);
	return `${__("Checked")} ${parsed.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	})}`;
});

async function refresh() {
	const mine = ++token;
	// Cleared BEFORE the read, not after it: a figure from the register the
	// cashier just left is worse than no figure.
	data.value = null;
	failed.value = false;
	if (!props.profile || !props.opening) return;
	busy.value = true;
	try {
		const result = await read("drawer_guidance", {
			pos_profile: props.profile,
			opening_shift: props.opening,
		});
		if (mine !== token) return;
		data.value = result && result.show ? result : null;
	} catch {
		if (mine !== token) return;
		failed.value = true;
	} finally {
		if (mine === token) busy.value = false;
	}
}

// Mount and every props change. Nothing polls: a cashier who wants a fresher
// figure presses Retry, and the parent calls `refresh()` after a drop.
watch(() => [props.profile, props.opening], refresh, { immediate: true });

defineExpose({ refresh });
</script>

<style scoped>
/* Register tokens with artboard fallbacks, the pattern the other custody
   surfaces use. No accent fill: the main action band owns the one accent. */
.drawer-guidance {
	display: flex;
	flex-direction: column;
	gap: 8px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	background: var(--reg-surface, var(--pos-card-bg, #ffffff));
	padding: var(--reg-space-md, 12px);
	min-inline-size: 0;
}
.drawer-guidance--act {
	border-color: var(--reg-warning-border, rgba(176, 106, 0, 0.45));
	background: var(--reg-warning-surface, rgba(255, 176, 32, 0.08));
}
.drawer-guidance__line {
	margin: 0;
}
.drawer-guidance__facts {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin: 0;
}
.drawer-guidance__facts div {
	min-inline-size: 0;
}
.drawer-guidance__facts dt {
	font-size: 12px;
	color: var(--reg-text-muted, #6b7280);
}
.drawer-guidance__facts dd {
	margin: 0;
	font-variant-numeric: tabular-nums;
	font-weight: 600;
}
.drawer-guidance__muted {
	margin: 0;
	font-size: 12px;
	color: var(--reg-text-muted, #6b7280);
}
/* 48px: the touch size the counting surfaces settled on. */
.drawer-guidance__action,
.drawer-guidance__retry {
	min-height: 48px;
	padding-inline: var(--reg-space-md, 12px);
	border: 1px solid var(--reg-border, rgba(0, 0, 0, 0.18));
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-raised, #f7f7f8);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
	align-self: flex-start;
}
.drawer-guidance__action:disabled,
.drawer-guidance__retry:disabled {
	opacity: 0.6;
	cursor: default;
}
</style>
