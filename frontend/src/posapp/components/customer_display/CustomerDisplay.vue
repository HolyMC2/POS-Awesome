<template>
	<section
		class="cd"
		:class="`cd--${view.state}`"
		:data-state="view.state"
		data-testid="customer-display"
	>
		<!-- The idle face. It is NOT an empty-cart notice: this screen faces the
		     shop, so between sales it is what the street reads through the
		     window. A greeting is the honest content for that — an idle
		     register is not an error, and `Apertura.dc.html` point 6 already
		     says the display is optional hardware the shift opens without. -->
		<div v-if="view.state === 'idle'" class="cd-idle" data-testid="customer-display-idle">
			<p class="cd-brand cd-brand--idle">
				<span class="cd-brand__mark" aria-hidden="true">
					<svg viewBox="2 2 36 30" role="presentation" focusable="false">
						<rect x="5" y="14" width="7" height="14" rx="3.5" fill="currentColor" opacity=".45" />
						<rect x="16.5" y="8" width="7" height="20" rx="3.5" fill="currentColor" opacity=".7" />
						<rect x="28" y="2" width="7" height="26" rx="3.5" fill="currentColor" />
						<rect x="2" y="28" width="36" height="4" rx="2" fill="currentColor" opacity=".55" />
					</svg>
				</span>
				<span class="cd-brand__word"
					><span class="cd-brand__light">{{ brand.wordmarkLight }}</span
					><span class="cd-brand__bold">{{ brand.wordmarkBold }}</span></span
				>
			</p>
			<p class="cd-idle__word">{{ __("Welcome") }}</p>
			<p class="cd-idle__note">{{ __("Your items and total appear here") }}</p>
			<!-- A display opened without a channel shows the customer the SAME
			     calm face; only this caption differs, at caption size and in the
			     muted tone. The shopkeeper still learns why nothing arrives, and
			     nobody in the queue reads a stack trace. -->
			<p v-if="!channelId" class="cd-idle__unlinked" data-testid="customer-display-unlinked">
				{{ __("Not linked to a register") }}
			</p>
		</div>

		<div v-else class="cd-stage">
			<!-- The sale, as it was scanned. Newest at the top: that is the order
			     the register's own cart keeps, and it is the one that matters
			     here — the line a customer wants to check is the one that just
			     rang up. The column CLIPS rather than scrolling; a customer
			     display with a scrollbar is a control, and the count in the
			     footer says how many lines there are in total. -->
			<section class="cd-sale" data-testid="customer-display-sale">
				<header class="cd-sale__head">
					<p class="cd-brand">
						<span class="cd-brand__mark" aria-hidden="true">
							<svg viewBox="2 2 36 30" role="presentation" focusable="false">
								<rect x="5" y="14" width="7" height="14" rx="3.5" fill="currentColor" opacity=".45" />
								<rect x="16.5" y="8" width="7" height="20" rx="3.5" fill="currentColor" opacity=".7" />
								<rect x="28" y="2" width="7" height="26" rx="3.5" fill="currentColor" />
								<rect x="2" y="28" width="36" height="4" rx="2" fill="currentColor" opacity=".55" />
							</svg>
						</span>
						<span class="cd-brand__word"
							><span class="cd-brand__light">{{ brand.wordmarkLight }}</span
							><span class="cd-brand__bold">{{ brand.wordmarkBold }}</span></span
						>
					</p>
					<span class="cd-sale__caption">{{ __(saleCaption) }}</span>
				</header>

				<ul class="cd-lines" data-testid="customer-display-lines">
					<li
						v-for="row in view.lines"
						:key="row.id"
						class="cd-line"
						data-testid="customer-display-line"
					>
						<span class="cd-line__text">
							<span class="cd-line__name">{{ row.name }}</span>
							<span v-if="row.note" class="cd-line__note">· {{ row.note }}</span>
							<!-- A bundle's own saving, on the line that sells it, only
							     when the feed carried the figure. Never derived here:
							     the combo's rate is the shop's Item Price and the
							     saving is `combos.get_combo_components`' to state. -->
							<span
								v-if="row.saving !== null"
								class="cd-line__saving"
								data-testid="customer-display-line-saving"
								>{{ __("you save {0}", [formatCurrency(row.saving)]) }}</span
							>
						</span>
						<span
							v-if="unitLabel(row)"
							class="cd-line__unit reg-mono"
							data-money-role="line-unit"
							>{{ unitLabel(row) }}</span
						>
						<span class="cd-line__amount reg-mono" data-money-role="line">{{
							formatCurrency(row.amount)
						}}</span>
					</li>

					<!-- The gap between the rows and the figure, so a customer who
					     adds the column up themselves does not find the screen
					     disagreeing with itself. A saving carries the positive STATE
					     tone (the artboard's «Ahorro del combo»); a charge stays
					     neutral. Neither is the accent — see the style block. -->
					<li
						v-if="view.saving !== null"
						class="cd-line cd-line--saving"
						data-testid="customer-display-saving"
					>
						<span class="cd-line__text">{{ __("Saving") }}</span>
						<span class="cd-line__amount reg-mono" data-money-role="saving"
							>−{{ formatCurrency(view.saving) }}</span
						>
					</li>
					<li
						v-else-if="view.surcharge !== null"
						class="cd-line cd-line--charge"
						data-testid="customer-display-surcharge"
					>
						<span class="cd-line__text">{{ __("Adjustment") }}</span>
						<span class="cd-line__amount reg-mono" data-money-role="surcharge"
							>+{{ formatCurrency(view.surcharge) }}</span
						>
					</li>
				</ul>

				<footer class="cd-sale__foot">
					<span data-testid="customer-display-count">{{
						__("{0} items", [countLabel])
					}}</span>
				</footer>
			</section>

			<!-- The number that matters. One per state: the total while the sale
			     is open, the change once the money is on the counter. -->
			<aside class="cd-figure">
				<p v-if="view.state === 'done'" class="cd-figure__thanks" data-testid="customer-display-thanks">
					{{ __("Thank you") }}
				</p>

				<p class="cd-figure__label" data-testid="customer-display-figure-label">
					{{ __(figureLabel) }}
				</p>
				<!-- `aria-live` on this figure alone. It is the number whose change
				     is the point of the screen, and a second live region would make
				     every scan announce twice.

				     Two elements rather than one with a bound `data-money-role`,
				     because that attribute is how the money guards find this
				     screen: a computed role is invisible to a template scan, and
				     `customerDisplayPrivacySource.spec.ts` reads the file. -->
				<p
					v-if="figureRole === 'change'"
					class="cd-figure__value cd-figure__value--change reg-mono"
					:class="{ 'cd-figure__value--long': figureIsLong }"
					data-money-role="change"
					data-testid="customer-display-figure"
					aria-live="polite"
					aria-atomic="true"
				>
					{{ figureText }}
				</p>
				<p
					v-else
					class="cd-figure__value reg-mono"
					:class="{ 'cd-figure__value--long': figureIsLong }"
					data-money-role="total"
					data-testid="customer-display-figure"
					aria-live="polite"
					aria-atomic="true"
				>
					{{ figureText }}
				</p>

				<div v-if="tenderCard" class="cd-card" data-testid="customer-display-tender">
					<p v-if="tenderCard.received !== null" class="cd-card__row">
						<span class="cd-card__label">{{ __("Received") }}</span>
						<span class="cd-card__figure reg-mono" data-money-role="received">{{
							formatCurrency(tenderCard.received)
						}}</span>
					</p>
					<p
						v-if="tenderCard.change !== null"
						class="cd-card__row cd-card__row--change"
					>
						<span class="cd-card__label cd-card__label--change">{{
							__("Your change")
						}}</span>
						<span
							class="cd-card__figure cd-card__figure--change reg-mono"
							data-money-role="change"
							>{{ formatCurrency(tenderCard.change) }}</span
						>
					</p>
				</div>

				<!-- Enrolled customers on card-enabled registers only. For everyone
				     else this card is simply not here — absence, not zeros
				     (`walletSummary.ts`'s standing rule, and the artboard says so
				     in its own comment). The card names no person: whoever is next
				     in the queue reads this screen too, and the customer already
				     knows whose card it is. -->
				<div
					v-if="view.accrual"
					class="cd-card cd-card--accrual"
					data-testid="customer-display-accrual"
				>
					<p class="cd-card__row">
						<span class="cd-card__label">{{ __("This purchase earns you") }}</span>
						<span
							class="cd-card__figure cd-card__figure--earn reg-mono"
							data-money-role="accrual"
							>+{{ formatCurrency(view.accrual.earned) }}</span
						>
					</p>
					<p
						v-if="view.accrual.balanceAfter !== null"
						class="cd-card__note"
						data-testid="customer-display-accrual-balance"
					>
						{{ __("Your card · balance will be {0}", [formatCurrency(view.accrual.balanceAfter)]) }}
					</p>
				</div>

				<p v-if="view.state !== 'done'" class="cd-figure__foot">
					{{ __("Thank you for your visit") }}
				</p>
			</aside>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * The screen the CUSTOMER reads, rebuilt to `PantallaCliente.dc.html`
 * (`docs/PANTALLA_CLIENTE_GOLDEN_FLOW.md` is the acceptance contract).
 *
 * A mirror, never a control: nothing here is tappable, it holds no session
 * powers, and it must be legible from 1.5 m.
 *
 * ## Presentation only — the transport is untouched
 *
 * The register feeds this window through `utils/customerDisplay.ts`: the
 * publisher (`useCustomerDisplayPublisher`) posts a snapshot envelope on a
 * `BroadcastChannel` named for the channel id AND mirrors it to
 * `localStorage`, so a display opened mid-sale gets the current basket from
 * the mirror and every later change from the channel (or from the `storage`
 * event, when `BroadcastChannel` is missing). The channel id arrives as
 * `?channel=` on `/app/posapp?customer_display=1`, which `App.vue` renders
 * standalone inside `CustomerDisplayLayout`. None of that changed here.
 *
 * What the snapshot CARRIES is the constraint on this file: the basket, the
 * total and the currency. The tender, the stage and the cashback accrual the
 * artboard draws are read optionally by `displayModel.ts` and render the
 * moment a publisher sends them — see that module's header for why none of
 * the three may be inferred locally.
 *
 * ## Who is reading it, and what that costs
 *
 * A person standing one to two metres away, possibly without reading glasses,
 * with a queue behind them. That is roughly three times a cashier's viewing
 * distance. The screen carries the basket at reading size, one dominant
 * figure, and the two cards that answer «¿cuánto me devuelven?» and «¿qué
 * gané?» — nothing else competes.
 *
 * ## What is deliberately NOT here — the privacy decision
 *
 * This surface faces outward. Whoever is next in the queue reads it too, and
 * the customer cannot opt out of what the screen behind the till says about
 * them. So the rule is: it shows what is already on the counter, never what
 * only the shop's database knows.
 *
 *   - **`customer_name` is never rendered.** It is the only PII the snapshot
 *     carries, and it buys the customer nothing — they know who they are. The
 *     party who needs the account confirmed is the CASHIER, and `Main.dc.html`
 *     already puts the customer chip on the cashier's screen, which is a
 *     different privacy context. Not truncated to initials either: a half-name
 *     still identifies a regular in a small shop, and it invites the question
 *     it was meant to avoid. The artboard's «Monedero de Sofía» is rendered
 *     here as «Tu tarjeta» for exactly that reason.
 *   - **Phone, customer id, purchase history, loyalty tier, the channel id** —
 *     same argument, and none of them helps anyone verify a price.
 *   - **No register name, no doctype id, no SKU.** An internal identifier is
 *     not private, it is simply noise the customer cannot use, and at this
 *     type size every character competes with the item's name.
 *
 * The cashback card is the one thing the contract now admits that the earlier
 * round refused, and it is admitted on the customer's own terms: their card's
 * accrual, unnamed, only when they are enrolled.
 * `tests/customerDisplayPrivacy.spec.ts` asserts the absences, so re-adding
 * one fails by name rather than by review.
 *
 * ## No accent, one wash
 *
 * Invariant 2 spends one saturated colour per screen on the primary action.
 * This screen has no actions at all — nobody touches it — so there is nothing
 * for the accent to mark, and spending it anyway would give the eye a rival to
 * the total. The hierarchy is carried by SIZE. The figure column's brand tint
 * is a `color-mix` wash under `singleAccent.spec.ts`'s 25% ceiling, which is
 * the same treatment the drawer and the empty cart already use, and it is the
 * artboard's own `--ac-soft`. Green appears on a saving and on change, and
 * green is STATE.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { BRAND } from "../../../brand";
import {
	createCustomerDisplayTransport,
	type CustomerDisplaySnapshot,
} from "../../utils/customerDisplay";
import { resolveDisplayView, type CustomerDisplayFeed, type DisplayLine } from "./displayModel";

const route = useRoute();

/**
 * The wordmark. `brand.ts` is the single source (roadmap §17.4) and this
 * screen is the one the shop's customers read, so it carries the brand and
 * never the fork's internal name. The glyph beside it is drawn in
 * `currentColor` — the artboard's four rising bars, minus the tenant palette
 * this app has no token for yet.
 */
const brand = BRAND;

/** Mirrors `frappe-shim`'s `__`, including the `{0}` substitution, so a
 *  snapshot arriving before the shim attaches does not paint a literal "{0}". */
const __ = (text: string, args?: (string | number)[]): string => {
	const translate = typeof window === "undefined" ? undefined : window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const getChannelFromLocation = () => {
	if (typeof window === "undefined") return "";
	const params = new URLSearchParams(window.location.search);
	return String(params.get("channel") || "").trim();
};

const channelId = computed(() => {
	const fromRoute = String(route.query.channel || "").trim();
	if (fromRoute) return fromRoute;
	return getChannelFromLocation();
});

const snapshot = ref<CustomerDisplayFeed | null>(null);

let unsubscribe: (() => void) | null = null;
let transport: ReturnType<typeof createCustomerDisplayTransport> | null = null;

/**
 * No channel means no transport and an idle screen — never a thrown error and
 * never a retry loop. The register does not depend on this window existing
 * (build plan §13, `Apertura.dc.html` point 6), and the reverse has to hold
 * too: this window must cost the register nothing when it is misconfigured.
 */
const syncSubscription = () => {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	if (transport) {
		transport.close();
		transport = null;
	}

	if (!channelId.value) {
		snapshot.value = null;
		return;
	}

	transport = createCustomerDisplayTransport(channelId.value);
	unsubscribe = transport.subscribe((nextSnapshot: CustomerDisplaySnapshot) => {
		snapshot.value = nextSnapshot || null;
	});
};

watch(channelId, syncSubscription, { immediate: true });

onBeforeUnmount(() => {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	if (transport) {
		transport.close();
		transport = null;
	}
});

const view = computed(() => resolveDisplayView(snapshot.value));

/** «Tu compra» while it is still being rung up; the sale column keeps the
 *  receipt afterwards so the customer can still check what they paid for. */
const saleCaption = computed(() => (view.value.state === "done" ? "Your purchase" : "Your basket"));

/**
 * The one dominant figure, and what it claims.
 *
 * Once the sale has closed, the number a customer must not walk away without
 * is the CHANGE — so it takes the lane, and the total steps down into the
 * tender card. With nothing owed back, the total is the figure again.
 */
const figureRole = computed(() =>
	view.value.state === "done" && (view.value.tender?.change ?? 0) > 0 ? "change" : "total",
);

const figureAmount = computed(() =>
	figureRole.value === "change" ? (view.value.tender?.change ?? 0) : view.value.total,
);

const figureLabel = computed(() => {
	if (figureRole.value === "change") return "Remember your change";
	return view.value.state === "done" ? "Paid" : "Total to pay";
});

/** The tender card repeats nothing the dominant figure already says. */
const tenderCard = computed(() => {
	const tender = view.value.tender;
	if (!tender) return null;
	if (figureRole.value !== "change") return tender;
	return tender.received === null ? null : { received: tender.received, change: null };
});

const formatQty = (value: number) => {
	const qty = Number(value || 0);
	return qty.toLocaleString(undefined, {
		minimumFractionDigits: Number.isInteger(qty) ? 0 : 2,
		maximumFractionDigits: 3,
	});
};

const countLabel = computed(() => formatQty(view.value.itemCount));

const formatCurrency = (value: number) => {
	const amount = Number(value || 0);
	const currency = view.value.currency;
	if (!currency) {
		return amount.toLocaleString(undefined, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	}
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount);
	} catch {
		return amount.toFixed(2);
	}
};

const figureText = computed(() => formatCurrency(figureAmount.value));

/**
 * Eight glyphs is what the artboard's column holds at the headline size, in
 * tabular mono at −0.04em. `$1,234.00` is nine and would run past the gutter,
 * so past that the figure steps down a size rather than the column stealing
 * width from the basket. Counted on the FORMATTED string because the currency
 * decides the width: the same amount is `$598.00` in one locale and
 * `MX$598.00` in another.
 */
const figureIsLong = computed(() => figureText.value.length > 8);

/** `2 × $120.00`, and nothing at all when the quantity is one. Weighed goods
 *  (0.75 kg) are not one, so they keep their unit price, which is the case
 *  where a customer most wants to see it. */
const unitLabel = (row: DisplayLine) => {
	const qty = Number(row?.qty || 0);
	if (Math.abs(qty - 1) < 1e-9) return "";
	return `${formatQty(qty)} × ${formatCurrency(Number(row?.rate || 0))}`;
};
</script>

<style scoped>
/* Every colour resolves through a token — no literal outside a `var()`
   fallback — so the display follows theme.css into dark exactly when the rest
   of the POS does. `ActionBand.vue` is the reference; three components shipped
   literal hex earlier in this programme and had to be redone. */
.cd {
	/* The type scale, named so it can be asserted rather than eyeballed
	   (`tests/customerDisplayLegibility.spec.ts` reads these). Each preferred
	   term is the artboard's own px at its 1280px width, so the screen renders
	   `PantallaCliente.dc.html` at 1:1 on the popup the register opens and
	   scales from there. The floors hold a 1280×800 window; the ceilings hold a
	   24" panel bolted to the counter without the total swallowing the column. */
	--cd-size-total: clamp(56px, 6.88vw, 132px);
	/* The same figure when the string is long. A peso total runs to
	   `$15,000.00` — ten glyphs of tabular mono, which at the size above is
	   wider than the column the artboard draws. Stepping the TYPE down beats
	   widening the column (that starves the basket) and beats letting it
	   overflow (the customer reads `$15,000.0`). */
	--cd-size-total-long: clamp(40px, 4.85vw, 94px);
	--cd-size-change: clamp(30px, 2.66vw, 51px);
	--cd-size-tender: clamp(24px, 2.03vw, 39px);
	--cd-size-mark: clamp(22px, 1.88vw, 36px);
	--cd-size-line: clamp(18px, 1.48vw, 29px);
	--cd-size-note: clamp(15px, 1.17vw, 23px);
	--cd-size-caption: clamp(13px, 1.02vw, 20px);

	height: 100%;
	min-height: 0;
	width: 100%;
	display: flex;
	color: var(--reg-text-primary, #212121);
	/* A mirror, never a control. Nothing here is tappable and nothing here is
	   selectable — the guarantee is cheaper to keep as a property of the root
	   than as a review note on every future row. */
	pointer-events: none;
	-webkit-user-select: none;
	user-select: none;
}

/* The artboard's `.reg * { box-sizing: border-box }`. Without it the figure
   column's padding is added OUTSIDE its declared width and the basket loses
   80px it was drawn with — the layout is off by exactly the gutter. */
.cd,
.cd *,
.cd *::before,
.cd *::after {
	box-sizing: border-box;
}

/* ---- idle ------------------------------------------------------------- */

.cd-idle {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--reg-space-md, 10px);
	text-align: center;
	padding: var(--reg-space-xl, 22px);
}

/* The idle state has no number, so the greeting is what dominates it — this
   screen is what the street reads through the window between sales, and a
   40px «Bienvenido» on a 24" panel reads as a screensaver. */
.cd-idle__word {
	margin: var(--reg-space-xl, 22px) 0 0;
	font-size: var(--cd-size-total);
	font-weight: 300;
	letter-spacing: -0.02em;
	line-height: 1.04;
	color: var(--reg-text-primary, #212121);
}

.cd-idle__note {
	margin: 0;
	font-size: var(--cd-size-note);
	color: var(--reg-text-secondary, #56606e);
}

.cd-idle__unlinked {
	margin: var(--reg-space-lg, 14px) 0 0;
	font-size: var(--cd-size-caption);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

/* ---- the wordmark ------------------------------------------------------ */

.cd-brand {
	margin: 0;
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	font-size: var(--cd-size-mark);
	line-height: 1;
	color: var(--reg-text-primary, #212121);
}

.cd-brand--idle {
	flex-direction: column;
	gap: var(--reg-space-lg, 14px);
	font-size: var(--cd-size-change);
}

.cd-brand__mark {
	display: block;
	flex: none;
	line-height: 0;
}

/* 1.5em against a viewBox cropped to the bars, which is the artboard's own
   ratio (a 36px mark beside 24px type). The untrimmed 0 0 40 42 box left a
   third of its height as padding and the glyph read as an afterthought. */
.cd-brand__mark svg {
	display: block;
	height: 1.5em;
	width: auto;
}

.cd-brand__word {
	letter-spacing: -0.02em;
	white-space: nowrap;
}

.cd-brand__light {
	font-weight: 300;
}

.cd-brand__bold {
	font-weight: 700;
}

/* ---- the sale column --------------------------------------------------- */

.cd-stage {
	flex: 1;
	min-width: 0;
	display: flex;
}

.cd-sale {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xl, 22px);
	padding: clamp(20px, 3.1vw, 56px) clamp(22px, 3.4vw, 62px);
	/* Clips, never scrolls: a scrollbar is a control, and this screen has
	   none. The newest line is at the top, so what a customer is checking is
	   always on screen and the footer's count says how many there are. */
	overflow: hidden;
}

.cd-sale__head {
	flex: none;
	display: flex;
	align-items: center;
	gap: var(--reg-space-lg, 14px);
}

/* Secondary, not muted. This caption sits in the top-right corner, which is
   where the layout's brand radial is strongest — measured against the pixels
   the browser actually paints there, #667085 comes out at 3.91:1 and the
   token's usual 4.97:1 on plain white does not apply. */
.cd-sale__caption {
	margin-left: auto;
	font-size: var(--cd-size-note);
	color: var(--reg-text-secondary, #56606e);
}

.cd-lines {
	flex: 1;
	min-height: 0;
	margin: 0;
	padding: 0;
	list-style: none;
	overflow: hidden;
}

.cd-line {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-xl, 22px);
	padding: var(--reg-space-lg, 14px) 0;
	font-size: var(--cd-size-line);
	/* `--reg-divider`, not `--reg-divider-soft`: the layout washes this column
	   with the brand radial, and the softer rule disappeared into it in
	   patches — a separator that exists on half a row reads as a rendering
	   fault rather than as quiet. */
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

/* The line that just arrived settles in rather than blinking into place —
   "lines appear as scanned" is the sale state's whole behaviour, and a row
   that simply exists on the next frame reads as a redraw. */
.cd-line:first-child {
	animation: cd-scanned 380ms ease-out;
}

@keyframes cd-scanned {
	from {
		opacity: 0;
		transform: translateY(-6px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@media (prefers-reduced-motion: reduce) {
	.cd-line:first-child {
		animation: none;
	}
}

.cd-line__text {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	color: var(--reg-text-primary, #212121);
}

.cd-line__name {
	display: inline;
	overflow-wrap: anywhere;
}

/* The gap is a margin, not a space in the template: Vue's compiler condenses
   whitespace that spans a newline between two elements away entirely, and the
   qualifier renders as `Instalación· incluida`. */
.cd-line__note {
	margin-left: 0.35em;
	color: var(--reg-text-muted, #667085);
}

/* Its own row under the name. Inline, it competed with the qualifier for the
   space a long item name was already using, and `text-overflow` clipped
   whichever lost. */
.cd-line__saving {
	display: block;
	margin-top: var(--reg-space-2xs, 2px);
	font-size: var(--cd-size-caption);
	font-weight: 700;
	color: var(--reg-tone-positive-number, #157a48);
}

.cd-line__unit {
	flex: none;
	color: var(--reg-text-secondary, #56606e);
}

.cd-line__amount {
	flex: none;
	font-weight: 700;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

/* STATE, not emphasis — the artboard gives «Ahorro del combo» the same green
   it gives `ahorra $41`, and green is what invariant 2 reserves for state. A
   charge (delivery) stays in the neutral tone above. Compounded rather than
   set on a bare `.cd-line--saving`: a single-class override loses to
   `.cd-line__amount` on source order and the saving would silently render
   neutral. */
.cd-line.cd-line--saving,
.cd-line.cd-line--saving .cd-line__text,
.cd-line.cd-line--saving .cd-line__amount {
	border-bottom: 0;
	font-weight: 700;
	color: var(--reg-tone-positive-number, #157a48);
}

.cd-line.cd-line--charge {
	border-bottom: 0;
}

.cd-sale__foot {
	flex: none;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-lg, 14px);
	padding-top: var(--reg-space-lg, 14px);
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: var(--cd-size-note);
	color: var(--reg-text-muted, #667085);
}

/* ---- the figure column ------------------------------------------------- */

.cd-figure {
	flex: none;
	/* 38% is the artboard's 470px of 1236 usable at 1280 wide. */
	width: clamp(340px, 38%, 640px);
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	padding: clamp(22px, 3.4vw, 62px) clamp(20px, 3.1vw, 56px);
	border-left: 1px solid var(--reg-divider, #eceff3);
	/* The artboard's `--ac-soft`: the brand at 10%, washed into the surface so
	   it flips with the theme. A wash, not a fill — `singleAccent.spec.ts`
	   caps it at 25% and this is the same treatment the drawer already uses. */
	background: linear-gradient(
		170deg,
		color-mix(in srgb, var(--pos-primary) 10%, var(--reg-surface)) 0%,
		var(--reg-surface) 70%
	);
}

.cd-figure__thanks {
	margin: 0;
	font-size: var(--cd-size-tender);
	font-weight: 300;
	letter-spacing: 0.01em;
	color: var(--reg-text-primary, #212121);
}

.cd-figure__label {
	margin: 0;
	font-size: var(--cd-size-caption);
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	/* Secondary, not muted: this label sits on the wash, where #667085 measures
	   4.5:1 with nothing to spare. */
	color: var(--reg-text-secondary, #56606e);
}

.cd-figure__value {
	margin: var(--reg-space-xs, 5px) 0 0;
	font-size: var(--cd-size-total);
	font-weight: 700;
	letter-spacing: -0.04em;
	line-height: 1.02;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

.cd-figure__value.cd-figure__value--change {
	color: var(--reg-tone-positive-number, #157a48);
}

.cd-figure__value.cd-figure__value--long {
	font-size: var(--cd-size-total-long);
}

.cd-figure__foot {
	margin: auto 0 0;
	font-size: var(--cd-size-caption);
	color: var(--reg-text-muted, #667085);
}

/* ---- the two cards ----------------------------------------------------- */

.cd-card {
	margin-top: var(--reg-space-xl, 22px);
	padding: var(--reg-space-xl, 22px);
	border-radius: var(--reg-radius-lg, 18px);
	background: var(--reg-surface, #ffffff);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
}

.cd-card--accrual {
	margin-top: var(--reg-space-lg, 14px);
}

.cd-card__row {
	margin: 0;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-lg, 14px);
}

.cd-card__row--change {
	margin-top: var(--reg-space-lg, 14px);
	padding-top: var(--reg-space-lg, 14px);
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.cd-card__label {
	font-size: var(--cd-size-note);
	color: var(--reg-text-secondary, #56606e);
}

.cd-card__label.cd-card__label--change {
	font-weight: 700;
	color: var(--reg-tone-positive-number, #157a48);
}

.cd-card__figure {
	font-size: var(--cd-size-tender);
	font-weight: 700;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

.cd-card__figure.cd-card__figure--change {
	font-size: var(--cd-size-change);
	color: var(--reg-tone-positive-number, #157a48);
}

.cd-card__figure.cd-card__figure--earn {
	font-size: var(--cd-size-note);
	color: var(--reg-tone-positive-number, #157a48);
}

.cd-card__note {
	margin: var(--reg-space-sm, 6px) 0 0;
	font-size: var(--cd-size-caption);
	color: var(--reg-text-muted, #667085);
}

/* ---- the narrow panel -------------------------------------------------- */

/* A display bolted to a counter is sometimes portrait, and a 470px column on
   a 900px-wide window leaves the item names two words wide. Below that the
   figure moves under the sale rather than beside it; the type scale does not
   change, so the hierarchy asserted in the spec is the same one here. */
@media (max-width: 900px) {
	.cd-stage {
		flex-direction: column;
	}

	.cd-figure {
		width: auto;
		border-left: 0;
		border-top: 1px solid var(--reg-divider, #eceff3);
	}

	.cd-figure__foot {
		display: none;
	}
}
</style>
