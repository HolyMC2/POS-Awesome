<template>
	<div class="gift-cards" data-testid="gift-cards-view">
		<form class="gift-cards__lookup" @submit.prevent="lookup">
			<v-icon class="gift-cards__lookup-icon" icon="mdi-barcode-scan" size="20" />
			<input
				ref="codeInput"
				v-model="code"
				class="gift-cards__lookup-field mono"
				data-testid="gift-card-lookup-input"
				type="text"
				autocomplete="off"
				spellcheck="false"
				enterkeyhint="search"
				:aria-label="__('Gift card code')"
				:placeholder="__('Gift card code')"
			/>
			<span class="gift-cards__lookup-hint">{{
				__("Scan, type or paste the code · Enter looks it up")
			}}</span>
			<button
				type="submit"
				class="gift-cards__verb gift-cards__verb--accent"
				data-testid="gift-card-lookup"
				:disabled="loading"
			>
				{{ __("Check") }}
			</button>
			<button
				type="button"
				class="gift-cards__verb"
				data-testid="gift-card-issue-mode"
				:disabled="!isSupervisor || loading"
				@click="startIssue"
			>
				{{ __("Issue new")
				}}<span v-if="!isSupervisor" class="gift-cards__gate">{{ __("Supervisor") }}</span>
			</button>
		</form>

		<p v-if="message" class="gift-cards__message" :class="messageClass" role="status">
			{{ message }}
		</p>

		<div class="gift-cards__body">
			<section v-if="mode === 'issue'" class="gift-cards__panel" data-testid="gift-card-issue-form">
				<p class="gift-cards__lbl">{{ __("Issue a gift card") }}</p>
				<label class="gift-cards__field">
					<span>{{ __("Code") }}</span>
					<input
						v-model="issueCode"
						class="mono"
						type="text"
						autocomplete="off"
						data-testid="gift-card-issue-code"
						:placeholder="__('Leave empty to generate one')"
					/>
				</label>
				<label class="gift-cards__field">
					<span>{{ __("Initial amount") }}</span>
					<input
						v-model="amount"
						type="number"
						inputmode="decimal"
						min="0"
						data-testid="gift-card-issue-amount"
					/>
				</label>
				<div class="gift-cards__panel-verbs">
					<button
						type="button"
						class="gift-cards__verb gift-cards__verb--accent"
						data-testid="gift-card-issue-confirm"
						:disabled="loading"
						@click="issueCard"
					>
						{{ __("Issue") }}
					</button>
					<button type="button" class="gift-cards__verb" :disabled="loading" @click="cancelMode">
						{{ __("Cancel") }}
					</button>
				</div>
				<p class="gift-cards__note">
					{{ __("Scan a printed card to use its own code, or leave it empty and we generate one.") }}
				</p>
			</section>

			<section v-else-if="card" class="gift-cards__panel" data-testid="gift-card-panel">
				<header class="gift-cards__id">
					<span class="gift-cards__id-glyph">
						<v-icon icon="mdi-card-bulleted-outline" size="20" />
					</span>
					<span class="gift-cards__id-copy">
						<span class="mono gift-cards__id-code" data-testid="gift-card-code">{{
							card.gift_card_code
						}}</span>
						<span class="gift-cards__id-meta">{{ issuedLine }}</span>
					</span>
					<span class="gift-cards__chip" :class="statusChipClass" data-testid="gift-card-status">{{
						statusLabel
					}}</span>
				</header>

				<p class="gift-cards__lbl gift-cards__balance-label">{{ __("Available balance") }}</p>
				<p class="mono gift-cards__balance" data-testid="gift-card-balance">
					{{ formatCurrency(card.current_balance) }}
				</p>
				<p v-if="lifeLine" class="gift-cards__id-meta" data-testid="gift-card-life">{{ lifeLine }}</p>

				<div class="gift-cards__spacer"></div>

				<div v-if="mode === 'topup'" class="gift-cards__topup" data-testid="gift-card-topup-form">
					<label class="gift-cards__field">
						<span>{{ __("Top up amount") }}</span>
						<input
							v-model="amount"
							type="number"
							inputmode="decimal"
							min="0"
							data-testid="gift-card-topup-amount"
						/>
					</label>
					<div class="gift-cards__panel-verbs">
						<button
							type="button"
							class="gift-cards__verb gift-cards__verb--accent"
							data-testid="gift-card-topup-confirm"
							:disabled="loading"
							@click="topUpCard"
						>
							{{ __("Top up") }}
						</button>
						<button type="button" class="gift-cards__verb" :disabled="loading" @click="cancelMode">
							{{ __("Cancel") }}
						</button>
					</div>
				</div>

				<div v-else class="gift-cards__panel-verbs gift-cards__panel-verbs--grid">
					<button
						type="button"
						class="gift-cards__verb gift-cards__verb--accent"
						data-testid="gift-card-topup-mode"
						:disabled="!isSupervisor || loading"
						@click="startTopUp"
					>
						{{ __("Top up")
						}}<span v-if="!isSupervisor" class="gift-cards__gate">{{ __("Supervisor") }}</span>
					</button>
					<button
						type="button"
						class="gift-cards__verb"
						:disabled="!isSupervisor || loading"
						@click="startIssue"
					>
						{{ __("Issue new")
						}}<span v-if="!isSupervisor" class="gift-cards__gate">{{ __("Supervisor") }}</span>
					</button>
				</div>

				<p class="gift-cards__note">
					{{ __("Issuing and topping up need a supervisor · checking does not") }}
				</p>

				<div class="gift-cards__exit">
					<span>{{ __("Paying with this card?") }}</span>
					<strong>{{ __("In Cobro · as a payment method") }}</strong>
				</div>
			</section>

			<section v-else class="gift-cards__panel gift-cards__panel--empty" data-testid="gift-card-empty">
				<v-icon icon="mdi-card-bulleted-outline" size="28" />
				<p>{{ emptyTitle }}</p>
				<button
					v-if="notFoundCode && isSupervisor"
					type="button"
					class="gift-cards__verb gift-cards__verb--accent"
					data-testid="gift-card-issue-missing"
					@click="startIssue(notFoundCode)"
				>
					{{ __("Issue a card with this code") }}
				</button>
			</section>

			<section v-if="card && mode !== 'issue'" class="gift-cards__ledger" data-testid="gift-card-ledger">
				<header class="gift-cards__ledger-head">
					<span class="gift-cards__lbl">{{ __("Movements of {0}", [card.gift_card_code]) }}</span>
					<span class="gift-cards__ledger-cap">{{
						__("last {0} · the shift count reconciles against this list", [transactionsLimit])
					}}</span>
				</header>
				<div class="gift-cards__row gift-cards__row--head">
					<span>{{ __("Date") }}</span>
					<span>{{ __("Movement") }}</span>
					<span class="gift-cards__num">{{ __("Amount") }}</span>
					<span class="gift-cards__num">{{ __("Balance") }}</span>
					<span class="gift-cards__row-who">{{ __("Cashier") }}</span>
				</div>
				<div class="gift-cards__ledger-rows">
					<div
						v-for="(row, index) in transactions"
						:key="`${row.posting_datetime}-${index}`"
						class="gift-cards__row"
						data-testid="gift-card-ledger-row"
					>
						<span class="mono gift-cards__row-when">{{ formatWhen(row.posting_datetime) }}</span>
						<span>
							{{ movementLabel(row.transaction_type) }}
							<span v-if="row.reference_name" class="mono gift-cards__row-ref"
								>· {{ row.reference_name }}</span
							>
						</span>
						<span class="mono gift-cards__num" :class="row.amount < 0 ? 'is-out' : 'is-in'">{{
							formatSigned(row.amount)
						}}</span>
						<span class="mono gift-cards__num gift-cards__row-balance">{{
							formatCurrency(row.balance_after)
						}}</span>
						<span class="gift-cards__row-who">{{ row.cashier || "—" }}</span>
					</div>
					<p v-if="!transactions.length" class="gift-cards__note gift-cards__note--pad">
						{{ __("No movements yet") }}
					</p>
				</div>
				<footer class="gift-cards__ledger-foot">
					{{
						__(
							"The balance lives on the card, not on a customer — whoever brings it, uses it. For value with a name and cashback: customer card.",
						)
					}}
				</footer>
			</section>
		</div>
	</div>
</template>

<script setup>
/**
 * Tarjeta de regalo — LOOKUP FIRST (`TarjetaRegalo.dc.html`).
 *
 * What this replaced was a marketing page: a hero, three "access" badges, a
 * "Scan-Ready" explainer and three stat cards narrating the permission model,
 * wrapped around one code field. None of it told the cashier anything the
 * screen was not already showing, and the one thing a counter actually asks —
 * «¿qué le pasó a esta tarjeta?» — had no surface at all, because the card's
 * own ledger never reached a caller.
 *
 * So: one field on top, always. A resolved card paints its balance, its state
 * and its OWN movements. The verbs sit on the panel with their gate written on
 * them.
 *
 * THE GATE IS A CHIP, NOT A HIDDEN BUTTON. A cashier who cannot see «Recargar»
 * learns the register is broken; one who sees it greyed with «Supervisor» on it
 * learns who to call. The server refuses either way (`_require_supervisor` +
 * `_require_gift_cards_enabled`), so what is drawn here is information, never
 * the gate itself.
 *
 * ONLINE ONLY, and not this component's argument to make: the destination is
 * registered `offlineAvailability: "blocked"` / `offline: "online_required"`,
 * so `DestinationHost` draws «Needs a connection» and never mounts this. The
 * one case the host cannot catch is going offline with the surface already
 * open, which is the only offline branch below.
 */
import { computed, nextTick, ref } from "vue";
import { storeToRefs } from "pinia";

import { useEmployeeStore } from "../../../stores/employeeStore";
import { useUIStore } from "../../../stores/uiStore";
import { isOffline } from "../../../../offline/index";

const __ = (value, params) =>
	typeof window !== "undefined" && window.__ ? window.__(value, params) : value;

const employeeStore = useEmployeeStore();
const uiStore = useUIStore();
const { currentCashier } = storeToRefs(employeeStore);
const { posProfile } = storeToRefs(uiStore);

const code = ref("");
const issueCode = ref("");
const amount = ref("");
const card = ref(null);
const transactions = ref([]);
const transactionsLimit = ref(20);
const notFoundCode = ref("");
const loading = ref(false);
const message = ref("");
const messageTone = ref("info");
const mode = ref("idle");
const codeInput = ref(null);

const isSupervisor = computed(() => Boolean(currentCashier.value?.is_supervisor));
const messageClass = computed(() => `gift-cards__message--${messageTone.value}`);

const emptyTitle = computed(() =>
	notFoundCode.value
		? __("We could not find card {0}", [notFoundCode.value])
		: __("Scan or type a code to see the card"),
);

const STATUS_LABELS = {
	Active: "Active",
	Inactive: "Inactive",
	Expired: "Expired",
};

const statusLabel = computed(() => __(STATUS_LABELS[card.value?.status] || card.value?.status || ""));

const statusChipClass = computed(() => {
	const status = card.value?.status;
	if (status === "Active") return "gift-cards__chip--positive";
	if (status === "Expired") return "gift-cards__chip--negative";
	return "gift-cards__chip--neutral";
});

const issuedLine = computed(() => {
	const value = card.value;
	if (!value) return "";
	const parts = [];
	if (value.issued_on) parts.push(__("issued {0}", [formatDate(value.issued_on)]));
	if (value.issued_by) parts.push(__("by {0}", [value.issued_by]));
	return parts.join(" · ");
});

const lifeLine = computed(() => {
	const value = card.value;
	if (!value) return "";
	const parts = [];
	if (value.expiry_date) parts.push(__("Expires {0}", [formatDate(value.expiry_date)]));
	if (value.last_redeemed_on)
		parts.push(__("last used {0}", [formatWhen(value.last_redeemed_on)]));
	return parts.join(" · ");
});

const flt = (value) =>
	typeof window !== "undefined" && typeof window.flt === "function"
		? window.flt(value || 0, 2)
		: Number(value || 0);

const formatCurrency = (value) => {
	const numeric = flt(value);
	const formatter =
		typeof window !== "undefined" && typeof window.format_currency === "function"
			? window.format_currency
			: null;
	return formatter
		? formatter(numeric, posProfile.value?.currency || "")
		: `${posProfile.value?.currency || ""} ${numeric.toFixed(2)}`.trim();
};

/** `−$120.00` / `+$200.00` — the ledger's whole point is which way it went. */
const formatSigned = (value) => {
	const numeric = flt(value);
	const rendered = formatCurrency(Math.abs(numeric));
	if (numeric < 0) return `−${rendered}`;
	if (numeric > 0) return `+${rendered}`;
	return rendered;
};

/**
 * `dd-mm-yyyy`, the same unambiguous shape `InvoiceManagement` prints. Not the
 * artboard's «12 ago 2026»: a Spanish month table would be one more place for
 * a language to be hardcoded, and this screen already has a translation path.
 */
const formatDate = (value) => {
	const date = String(value || "").slice(0, 10);
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : date;
};

const formatWhen = (value) => {
	const raw = String(value || "");
	if (!raw) return "";
	const date = raw.slice(0, 10);
	const time = raw.slice(11, 16);
	const today =
		typeof window !== "undefined" && window.frappe?.datetime?.get_today
			? window.frappe.datetime.get_today()
			: new Date().toISOString().slice(0, 10);
	if (date === today) return time ? `${__("today")} ${time}` : __("today");
	return formatDate(date);
};

const MOVEMENT_LABELS = {
	Issue: "Issued",
	"Top Up": "Topped up at the counter",
	Redeem: "Redeemed",
	Adjust: "Adjustment",
};

const movementLabel = (type) => __(MOVEMENT_LABELS[type] || type || "");

const setMessage = (text, tone = "info") => {
	message.value = text || "";
	messageTone.value = tone;
};

/**
 * Frappe throws arrive as `_server_messages` — a JSON array of JSON strings —
 * and carry no `message` key at all, so `error.message` alone prints the
 * generic transport text and loses the refusal the server took the trouble to
 * write.
 */
const errorText = (error, fallback) => {
	const raw = error?._server_messages;
	if (raw) {
		try {
			const outer = JSON.parse(raw);
			const first = Array.isArray(outer) ? outer[0] : outer;
			const inner = typeof first === "string" ? JSON.parse(first) : first;
			const text = inner?.message || first;
			if (text) return String(text).replace(/<[^>]*>/g, "");
		} catch (_parseError) {
			// Not the envelope; fall through to the transport message.
		}
	}
	return error?.message || fallback;
};

const clearCard = () => {
	card.value = null;
	transactions.value = [];
};

const cancelMode = () => {
	mode.value = "idle";
	amount.value = "";
	issueCode.value = "";
};

const focusCode = async () => {
	await nextTick();
	codeInput.value?.focus?.();
};

const requireOnline = () => {
	if (isOffline()) {
		setMessage(__("Gift cards need a connection. Reconnect and try again."), "error");
		return false;
	}
	return true;
};

const loadCard = async (lookupCode) => {
	const response = await window.frappe.call({
		method: "posawesome.posawesome.api.gift_cards.check_gift_card_balance",
		args: {
			gift_card_code: lookupCode,
			company: posProfile.value?.company,
			include_transactions: 1,
		},
	});
	const loaded = response?.message || null;
	if (!loaded) return null;
	card.value = loaded;
	transactions.value = Array.isArray(loaded.transactions) ? loaded.transactions : [];
	transactionsLimit.value = loaded.transactions_limit || transactionsLimit.value;
	notFoundCode.value = "";
	return loaded;
};

const lookup = async () => {
	const lookupCode = String(code.value || "").trim();
	if (!lookupCode) {
		setMessage(__("Scan or type a code to see the card"), "warning");
		return;
	}
	if (!requireOnline()) return;

	loading.value = true;
	setMessage("");
	cancelMode();
	try {
		await loadCard(lookupCode);
	} catch (error) {
		clearCard();
		notFoundCode.value = lookupCode;
		setMessage(errorText(error, __("We could not find card {0}", [lookupCode])), "error");
	} finally {
		loading.value = false;
	}
};

const startTopUp = () => {
	if (!isSupervisor.value) return;
	amount.value = "";
	mode.value = "topup";
};

const startIssue = (presetCode = "") => {
	if (!isSupervisor.value) return;
	issueCode.value = typeof presetCode === "string" ? presetCode : "";
	amount.value = "";
	mode.value = "issue";
};

const issueCard = async () => {
	if (!isSupervisor.value || !requireOnline()) return;

	loading.value = true;
	setMessage("");
	try {
		const response = await window.frappe.call({
			method: "posawesome.posawesome.api.gift_cards.issue_gift_card",
			args: {
				pos_profile: posProfile.value?.name,
				cashier: currentCashier.value?.user,
				company: posProfile.value?.company,
				initial_amount: flt(amount.value || 0),
				gift_card_code: String(issueCode.value || "").trim() || null,
				currency: posProfile.value?.currency,
			},
		});
		const issued = response?.message || {};
		code.value = issued.gift_card_code || code.value;
		cancelMode();
		// The write returns the lean serializer; the ledger comes from a read.
		await loadCard(code.value);
		setMessage(__("Gift card {0} issued", [code.value]), "success");
	} catch (error) {
		setMessage(errorText(error, __("Unable to issue gift card.")), "error");
	} finally {
		loading.value = false;
	}
};

const topUpCard = async () => {
	if (!isSupervisor.value || !requireOnline()) return;

	const topUpCode = card.value?.gift_card_code;
	loading.value = true;
	setMessage("");
	try {
		await window.frappe.call({
			method: "posawesome.posawesome.api.gift_cards.top_up_gift_card",
			args: {
				pos_profile: posProfile.value?.name,
				cashier: currentCashier.value?.user,
				gift_card_code: topUpCode,
				amount: flt(amount.value || 0),
			},
		});
		cancelMode();
		await loadCard(topUpCode);
		setMessage(__("Gift card {0} topped up", [topUpCode]), "success");
	} catch (error) {
		setMessage(errorText(error, __("Unable to top up gift card.")), "error");
	} finally {
		loading.value = false;
	}
};

focusCode();

defineExpose({ lookup, card, transactions });
</script>

<style scoped>
.gift-cards {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	gap: var(--reg-space-md, 10px);
	padding: var(--reg-space-lg, 14px);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

.gift-cards__lookup {
	flex: none;
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	padding: var(--reg-space-md, 10px) var(--reg-space-lg, 14px);
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.gift-cards__lookup-icon {
	color: var(--reg-text-muted, #667085);
}

.gift-cards__lookup-field {
	flex: 1;
	min-width: 0;
	border: 0;
	outline: none;
	background: transparent;
	font-size: 15px;
	color: var(--reg-text-primary, #212121);
}

.gift-cards__lookup-hint,
.gift-cards__ledger-cap {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.gift-cards__verb {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: var(--reg-touch-min, 44px);
	padding: 0 18px;
	border-radius: var(--reg-radius-md, 12px);
	border: 1.5px solid var(--reg-border, rgba(0, 0, 0, 0.12));
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #37414d);
	font-size: 13.5px;
	font-weight: 700;
	cursor: pointer;
}

/* Compounded on purpose: a single-class state rule loses to whichever of the
   two lands later in the sheet, and the accented verb would then look enabled
   while disabled. */
.gift-cards__verb--accent {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.gift-cards__verb:disabled,
.gift-cards__verb--accent:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.gift-cards__gate,
.gift-cards__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 700;
}

.gift-cards__gate {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.gift-cards__chip--positive {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.gift-cards__chip--negative {
	background: var(--reg-tone-negative-bg, #fdeaea);
	color: var(--reg-tone-negative-label, #b42318);
}

.gift-cards__chip--neutral {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #56606e);
}

.gift-cards__message {
	flex: none;
	margin: 0;
	padding: 9px 12px;
	border-radius: var(--reg-radius-sm, 10px);
	font-size: 12.5px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #56606e);
}

.gift-cards__message--success {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.gift-cards__message--warning {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.gift-cards__message--error {
	background: var(--reg-tone-negative-bg, #fdeaea);
	color: var(--reg-tone-negative-label, #b42318);
}

.gift-cards__body {
	flex: 1;
	display: flex;
	gap: var(--reg-space-md, 10px);
	min-height: 0;
}

.gift-cards__panel {
	flex: none;
	width: 420px;
	max-width: 100%;
	display: flex;
	flex-direction: column;
	min-height: 0;
	gap: var(--reg-space-sm, 6px);
	padding: var(--reg-space-xl, 18px);
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	border-radius: var(--reg-radius-md, 14px);
}

.gift-cards__panel--empty {
	flex: 1;
	width: auto;
	align-items: center;
	justify-content: center;
	text-align: center;
	gap: var(--reg-space-lg, 14px);
	border-color: var(--reg-border-light, rgba(0, 0, 0, 0.06));
	color: var(--reg-text-muted, #667085);
}

.gift-cards__id {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
}

.gift-cards__id-glyph {
	display: grid;
	place-items: center;
	flex: none;
	width: 40px;
	height: 40px;
	border-radius: 12px;
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.gift-cards__id-copy {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	line-height: 1.2;
}

.gift-cards__id-code {
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.gift-cards__id-meta {
	margin: 0;
	font-size: 11px;
	color: var(--reg-text-muted, #7b838f);
}

.gift-cards__lbl {
	margin: 0;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #8b93a0);
}

.gift-cards__balance-label {
	margin-top: var(--reg-space-lg, 14px);
}

.gift-cards__balance {
	margin: 0;
	font-size: 52px;
	font-weight: 700;
	letter-spacing: -0.03em;
	line-height: 1.05;
	color: var(--reg-text-primary, #212121);
}

.gift-cards__spacer {
	flex: 1;
	min-height: var(--reg-space-md, 10px);
}

.gift-cards__panel-verbs {
	display: flex;
	gap: var(--reg-space-sm, 8px);
}

.gift-cards__panel-verbs--grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
}

.gift-cards__field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.gift-cards__field input {
	min-height: var(--reg-touch-min, 44px);
	padding: 0 12px;
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border, rgba(0, 0, 0, 0.12));
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	font-size: 15px;
}

.gift-cards__note {
	margin: 0;
	font-size: 11px;
	color: var(--reg-text-muted, #9aa2ae);
}

.gift-cards__note--pad {
	padding: var(--reg-space-md, 10px) var(--reg-space-lg, 14px);
}

.gift-cards__exit {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-lg, 16px);
	margin-top: var(--reg-space-md, 10px);
	padding: 11px 12px;
	border-radius: var(--reg-radius-sm, 11px);
	background: var(--reg-surface-sunken, #fafbfc);
	border: 1px solid var(--reg-divider-soft, #eff2f5);
	font-size: 12.5px;
	color: var(--reg-text-secondary, #4a5260);
}

.gift-cards__exit strong {
	color: var(--reg-on-accent-soft, #00646f);
}

.gift-cards__ledger {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
	padding: var(--reg-space-lg, 14px) 0 0;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.gift-cards__ledger-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	padding: 0 var(--reg-space-lg, 14px) var(--reg-space-md, 12px);
}

.gift-cards__ledger-rows {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
}

.gift-cards__row {
	display: grid;
	grid-template-columns: 96px minmax(0, 1fr) 110px 110px 130px;
	gap: 12px;
	align-items: baseline;
	padding: 10px 14px;
	border-bottom: 1px solid var(--reg-divider-soft, #f5f7f9);
	font-size: 12.5px;
	color: var(--reg-text-secondary, #4a5260);
}

.gift-cards__row--head {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #8b93a0);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

.gift-cards__num {
	text-align: right;
}

.gift-cards__row-when,
.gift-cards__row-ref,
.gift-cards__row-who {
	color: var(--reg-text-muted, #9aa2ae);
}

.gift-cards__row-balance {
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.gift-cards__num.is-in {
	font-weight: 700;
	color: var(--reg-tone-positive-number, #14603a);
}

.gift-cards__num.is-out {
	font-weight: 700;
	color: var(--reg-tone-negative-label, #b42318);
}

.gift-cards__ledger-foot {
	flex: none;
	padding: 10px var(--reg-space-lg, 14px);
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: 11.5px;
	color: var(--reg-text-muted, #9aa2ae);
}

@media (max-width: 1099.98px) {
	.gift-cards__body {
		flex-direction: column;
		overflow-y: auto;
	}

	.gift-cards__panel {
		width: auto;
	}

	.gift-cards__row {
		grid-template-columns: 84px minmax(0, 1fr) 96px 96px;
	}

	.gift-cards__row-who {
		display: none;
	}
}
</style>
