<template>
	<div class="kiosk" data-testid="kiosk-view" @pointerdown="touch">
		<!-- ATTRACT — the resting face. One tap starts an order. -->
		<button
			v-if="stage === 'attract'"
			type="button"
			class="kiosk__attract"
			data-testid="kiosk-attract"
			@click="startOrder"
		>
			<span class="kiosk__attract-title">{{ __("Order here") }}</span>
			<span class="kiosk__attract-sub">{{ __("Tap to start · pay at the counter") }}</span>
		</button>

		<!-- BOOT / PICKER — staff-only face, shown when no profile is armed. -->
		<div v-else-if="stage === 'boot'" class="kiosk__boot">
			<h1>{{ __("Kiosk") }}</h1>
			<p v-if="bootError" class="kiosk__error">{{ bootError }}</p>
			<p v-else-if="!context">{{ __("Connecting…") }}</p>
			<p v-else-if="!context.profiles.length" class="kiosk__error">
				{{ __("This account has no kiosk-enabled register.") }}
			</p>
			<template v-else>
				<button
					v-for="profile in context.profiles"
					:key="profile.pos_profile"
					type="button"
					class="kiosk__chip"
					:disabled="!profile.ready"
					@click="armProfile(profile.pos_profile)"
				>
					{{ profile.pos_profile }}
					<template v-if="!profile.ready"> · {{ __("no walk-in customer") }}</template>
				</button>
			</template>
		</div>

		<!-- BROWSE — the menu. -->
		<template v-else-if="stage === 'browse'">
			<header class="kiosk__head">
				<span class="kiosk__brand">{{ __("Order here") }}</span>
				<button type="button" class="kiosk__cancel" data-testid="kiosk-cancel" @click="reset">
					{{ __("Start over") }}
				</button>
			</header>
			<nav v-if="groups.length > 1" class="kiosk__groups">
				<button
					v-for="group in groups"
					:key="group"
					type="button"
					class="kiosk__chip"
					:class="{ 'kiosk__chip--on': activeGroup === group }"
					@click="activeGroup = group"
				>
					{{ group }}
				</button>
			</nav>
			<div class="kiosk__grid" data-testid="kiosk-grid">
				<button
					v-for="item in visibleItems"
					:key="item.item_code"
					type="button"
					class="kiosk__item"
					data-testid="kiosk-item"
					@click="add(item)"
				>
					<span class="kiosk__item-art" aria-hidden="true">
						<img v-if="item.image" :src="item.image" alt="" loading="lazy" />
						<span v-else>{{ item.item_name.slice(0, 1) }}</span>
					</span>
					<span class="kiosk__item-name">{{ item.item_name }}</span>
					<span class="kiosk__item-rate reg-mono">{{ formatMoney(item.rate) }}</span>
					<span v-if="qtyOf(item.item_code)" class="kiosk__item-count">{{
						qtyOf(item.item_code)
					}}</span>
				</button>
			</div>
			<footer v-if="cart.length" class="kiosk__bar">
				<button type="button" class="kiosk__bar-cart" data-testid="kiosk-open-cart" @click="cartOpen = true">
					{{ cartCount }} · {{ formatMoney(cartTotal) }}
				</button>
				<button
					type="button"
					class="kiosk__bar-pay"
					:disabled="placing"
					data-testid="kiosk-pay"
					@click="checkout"
				>
					{{ __("PAY AT THE COUNTER") }}
				</button>
			</footer>

			<!-- The cart sheet: fix quantities without starting over. -->
			<div v-if="cartOpen" class="kiosk__sheet" @click.self="cartOpen = false">
				<div class="kiosk__sheet-card">
					<h2>{{ __("Your order") }}</h2>
					<div v-for="line in cart" :key="line.item_code" class="kiosk__line">
						<span class="kiosk__line-name">{{ line.item_name }}</span>
						<span class="kiosk__line-controls">
							<button type="button" @click="minus(line)">−</button>
							<span class="reg-mono">{{ line.qty }}</span>
							<button type="button" @click="plus(line)">+</button>
						</span>
						<span class="reg-mono">{{ formatMoney(line.qty * line.rate) }}</span>
					</div>
					<div class="kiosk__line kiosk__line--total">
						<span>{{ __("Total") }}</span>
						<span class="reg-mono">{{ formatMoney(cartTotal) }}</span>
					</div>
					<button type="button" class="kiosk__chip" @click="cartOpen = false">
						{{ __("Keep browsing") }}
					</button>
				</div>
			</div>

			<!-- Optional name, so the counter can call it out. -->
			<div v-if="askName" class="kiosk__sheet" @click.self="askName = false">
				<div class="kiosk__sheet-card">
					<h2>{{ __("A name for the order?") }}</h2>
					<input
						ref="nameInput"
						v-model="customerLabel"
						class="kiosk__name"
						maxlength="40"
						:placeholder="__('Optional')"
						@keyup.enter="placeOrder"
					/>
					<p v-if="errorMessage" class="kiosk__error">{{ errorMessage }}</p>
					<button
						type="button"
						class="kiosk__bar-pay"
						:disabled="placing"
						data-testid="kiosk-confirm"
						@click="placeOrder"
					>
						{{ __("Confirm order") }}
					</button>
				</div>
			</div>
		</template>

		<!-- TICKET — the number the counter will call. -->
		<div v-else-if="stage === 'ticket'" class="kiosk__ticket" data-testid="kiosk-ticket" @click="reset">
			<span class="kiosk__ticket-label">{{ __("Your order") }}</span>
			<span class="kiosk__ticket-number reg-mono">{{ ticket?.order_number }}</span>
			<span class="kiosk__ticket-total">{{ formatMoney(ticket?.amount_total || 0) }}</span>
			<span class="kiosk__ticket-hint">{{ __("Pay at the counter — say your number.") }}</span>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * The self-service kiosk (critique D2): a customer-facing menu whose only
 * exit is a numbered «paga en caja» charge request — the D3 order hub row
 * the register collects like any other. The device holds no money path:
 * item_code + qty go up, the server re-prices everything, and the ticket
 * number comes back.
 *
 * Mostly SUBTRACTIVE by design: no drawer, no rail, no shift, no search-box
 * cleverness — an attract face, a grid, a bar, a number. Idle for 90 s at
 * any stage returns to attract and forgets the cart: the next customer must
 * never inherit the last one's order.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

declare const __: (_text: string) => string;

interface KioskItem {
	item_code: string;
	item_name: string;
	item_group: string;
	image?: string | null;
	rate: number;
}
interface CartLine extends KioskItem {
	qty: number;
}

const STORAGE_KEY = "posa_kiosk_screen";
const IDLE_RESET_MS = 90_000;
const TICKET_RESET_MS = 20_000;

const stage = ref<"boot" | "attract" | "browse" | "ticket">("boot");
const context = ref<{ profiles: { pos_profile: string; ready: boolean }[] } | null>(null);
const bootError = ref("");
const profileName = ref("");

const groups = ref<string[]>([]);
const items = ref<KioskItem[]>([]);
const activeGroup = ref("");
const cart = ref<CartLine[]>([]);
const cartOpen = ref(false);
const askName = ref(false);
const customerLabel = ref("");
const placing = ref(false);
const errorMessage = ref("");
const ticket = ref<{ order_number: string; amount_total: number } | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let ticketTimer: ReturnType<typeof setTimeout> | null = null;

const call = async (method: string, args: Record<string, unknown>) => {
	const response = await (window as any).frappe.call({ method, args });
	return response?.message;
};

const formatMoney = (value: number) =>
	`$${(Number(value) || 0).toFixed(2)}`;

const visibleItems = computed(() =>
	activeGroup.value ? items.value.filter((i) => i.item_group === activeGroup.value) : items.value,
);
const cartCount = computed(() => cart.value.reduce((sum, line) => sum + line.qty, 0));
const cartTotal = computed(() =>
	cart.value.reduce((sum, line) => sum + line.qty * line.rate, 0),
);
const qtyOf = (code: string) => cart.value.find((l) => l.item_code === code)?.qty || 0;

// ---- lifecycle -------------------------------------------------------------

const armProfile = async (name: string) => {
	profileName.value = name;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: name }));
	} catch {
		/* storage-less kiosk browsers just re-ask */
	}
	try {
		const catalog = await call("posawesome.posawesome.api.kiosk.get_kiosk_catalog", {
			pos_profile: name,
		});
		groups.value = catalog?.groups || [];
		items.value = catalog?.items || [];
		activeGroup.value = groups.value[0] || "";
		stage.value = "attract";
	} catch (err: any) {
		bootError.value = err?.message || String(err);
		stage.value = "boot";
	}
};

onMounted(async () => {
	try {
		context.value = await call("posawesome.posawesome.api.kiosk.get_kiosk_context", {});
	} catch (err: any) {
		bootError.value = err?.message || String(err);
		return;
	}
	let saved: { profile?: string } = {};
	try {
		saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
	} catch {
		saved = {};
	}
	const remembered = context.value?.profiles.find(
		(p) => p.pos_profile === saved.profile && p.ready,
	);
	if (remembered) void armProfile(remembered.pos_profile);
});

onBeforeUnmount(() => {
	if (idleTimer) clearTimeout(idleTimer);
	if (ticketTimer) clearTimeout(ticketTimer);
});

const reset = () => {
	cart.value = [];
	cartOpen.value = false;
	askName.value = false;
	customerLabel.value = "";
	errorMessage.value = "";
	ticket.value = null;
	if (ticketTimer) clearTimeout(ticketTimer);
	stage.value = profileName.value ? "attract" : "boot";
};

// Any touch re-arms the idle clock; idle at any armed stage forgets the
// cart — the next customer never inherits the last one's order.
const touch = () => {
	if (idleTimer) clearTimeout(idleTimer);
	if (stage.value === "browse" || stage.value === "ticket") {
		idleTimer = setTimeout(reset, IDLE_RESET_MS);
	}
};

const startOrder = () => {
	stage.value = "browse";
	touch();
};

// ---- cart ------------------------------------------------------------------

const add = (item: KioskItem) => {
	const line = cart.value.find((l) => l.item_code === item.item_code);
	if (line) line.qty = Math.min(line.qty + 1, 20);
	else cart.value.push({ ...item, qty: 1 });
};
const plus = (line: CartLine) => {
	line.qty = Math.min(line.qty + 1, 20);
};
const minus = (line: CartLine) => {
	line.qty -= 1;
	if (line.qty <= 0) cart.value = cart.value.filter((l) => l !== line);
	if (!cart.value.length) cartOpen.value = false;
};

const checkout = () => {
	if (!cart.value.length) return;
	cartOpen.value = false;
	askName.value = true;
	errorMessage.value = "";
	void nextTick(() => nameInput.value?.focus());
};

const placeOrder = async () => {
	if (placing.value || !cart.value.length) return;
	placing.value = true;
	errorMessage.value = "";
	try {
		const result = await call("posawesome.posawesome.api.kiosk.place_kiosk_order", {
			pos_profile: profileName.value,
			lines: cart.value.map((l) => ({ item_code: l.item_code, qty: l.qty })),
			customer_label: customerLabel.value || null,
		});
		ticket.value = {
			order_number: result?.order_number || result?.name || "?",
			amount_total: Number(result?.amount_total) || 0,
		};
		askName.value = false;
		stage.value = "ticket";
		ticketTimer = setTimeout(reset, TICKET_RESET_MS);
	} catch (err: any) {
		errorMessage.value = err?.message || String(err);
	} finally {
		placing.value = false;
	}
};
</script>

<style scoped>
/* Customer hardware: huge targets, no small print, nothing precious. */
.kiosk {
	height: 100%;
	display: flex;
	flex-direction: column;
	font-size: 20px;
	user-select: none;
}
.kiosk__attract {
	flex: 1;
	border: none;
	background: transparent;
	color: var(--pos-text-primary);
	display: grid;
	place-content: center;
	gap: 14px;
	cursor: pointer;
}
.kiosk__attract-title {
	font-size: clamp(44px, 8vw, 84px);
	font-weight: 800;
}
.kiosk__attract-sub {
	font-size: 22px;
	color: var(--pos-text-secondary);
}
.kiosk__boot {
	margin: auto;
	display: grid;
	gap: 14px;
	text-align: center;
}
.kiosk__error {
	color: var(--pos-error);
}
.kiosk__chip {
	border: 1px solid var(--pos-border-light);
	border-radius: 999px;
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	padding: 10px 20px;
	font-size: 18px;
	cursor: pointer;
}
.kiosk__chip--on {
	border-color: var(--pos-primary);
	color: var(--pos-primary);
	font-weight: 700;
}
.kiosk__chip:disabled {
	opacity: 0.5;
}
.kiosk__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14px 18px 0;
}
.kiosk__brand {
	font-size: 24px;
	font-weight: 800;
}
.kiosk__cancel {
	border: none;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 16px;
	cursor: pointer;
}
.kiosk__groups {
	display: flex;
	gap: 10px;
	padding: 12px 18px;
	overflow-x: auto;
}
.kiosk__grid {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
	gap: 14px;
	padding: 6px 18px 120px;
	align-content: start;
}
.kiosk__item {
	position: relative;
	border: 1px solid var(--pos-border-light);
	border-radius: 16px;
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	display: grid;
	gap: 8px;
	padding: 14px;
	cursor: pointer;
	text-align: center;
}
.kiosk__item-art {
	height: 84px;
	display: grid;
	place-content: center;
	font-size: 42px;
	font-weight: 800;
	color: var(--pos-text-secondary);
}
.kiosk__item-art img {
	max-height: 84px;
	max-width: 100%;
	object-fit: contain;
}
.kiosk__item-name {
	font-size: 17px;
	font-weight: 600;
}
.kiosk__item-rate {
	font-size: 16px;
	color: var(--pos-text-secondary);
	font-variant-numeric: tabular-nums;
}
.kiosk__item-count {
	position: absolute;
	top: 8px;
	inset-inline-end: 8px;
	min-width: 26px;
	line-height: 26px;
	border-radius: 13px;
	/* Ink, not accent: a count is a figure, and the accent belongs to the
	   one button that ends the order (singleAccent contract). */
	background: var(--pos-text-primary);
	color: var(--pos-bg-primary);
	font-weight: 800;
}
.kiosk__bar {
	position: fixed;
	inset-inline: 0;
	bottom: 0;
	display: flex;
	gap: 12px;
	padding: 14px 18px calc(14px + env(safe-area-inset-bottom, 0px));
	background: var(--pos-bg-primary);
	border-top: 1px solid var(--pos-border-light);
}
.kiosk__bar-cart {
	border: 1px solid var(--pos-border-light);
	border-radius: 14px;
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	font-size: 20px;
	font-weight: 700;
	padding: 16px 22px;
	cursor: pointer;
	font-variant-numeric: tabular-nums;
}
.kiosk__bar-pay {
	flex: 1;
	border: none;
	border-radius: 14px;
	background: var(--pos-primary);
	color: #fff;
	font-size: 22px;
	font-weight: 800;
	letter-spacing: 0.04em;
	padding: 16px;
	cursor: pointer;
}
.kiosk__bar-pay:disabled {
	opacity: 0.5;
}
.kiosk__sheet {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.45);
	display: grid;
	place-items: end center;
	z-index: 30;
}
.kiosk__sheet-card {
	width: min(560px, 94vw);
	margin-bottom: 4vh;
	border-radius: 18px;
	background: var(--pos-bg-primary);
	padding: 22px;
	display: grid;
	gap: 14px;
}
.kiosk__line {
	display: flex;
	align-items: center;
	gap: 12px;
	justify-content: space-between;
	font-size: 19px;
}
.kiosk__line--total {
	border-top: 1px solid var(--pos-border-light);
	padding-top: 10px;
	font-weight: 800;
}
.kiosk__line-name {
	flex: 1;
}
.kiosk__line-controls {
	display: flex;
	align-items: center;
	gap: 10px;
}
.kiosk__line-controls button {
	width: 40px;
	height: 40px;
	border-radius: 12px;
	border: 1px solid var(--pos-border-light);
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	font-size: 22px;
	cursor: pointer;
}
.kiosk__name {
	border: 1px solid var(--pos-border-light);
	border-radius: 12px;
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	font-size: 22px;
	padding: 14px;
}
.kiosk__ticket {
	flex: 1;
	display: grid;
	place-content: center;
	gap: 10px;
	text-align: center;
	cursor: pointer;
}
.kiosk__ticket-label {
	font-size: 26px;
	color: var(--pos-text-secondary);
}
.kiosk__ticket-number {
	font-size: clamp(96px, 22vw, 220px);
	font-weight: 800;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}
.kiosk__ticket-total {
	font-size: 30px;
	font-weight: 700;
}
.kiosk__ticket-hint {
	font-size: 20px;
	color: var(--pos-text-secondary);
}
</style>
