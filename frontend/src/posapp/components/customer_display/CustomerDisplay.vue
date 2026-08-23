<template>
	<section class="cd" data-testid="customer-display">
		<!-- The idle face. It is NOT an empty-cart notice: this screen faces the
		     shop, so between sales it is what the street reads through the
		     window. A greeting is the honest content for that — an idle
		     register is not an error, and `Apertura.dc.html` point 6 already
		     says the display is optional hardware the shift opens without. -->
		<div v-if="!lines.length" class="cd-idle" data-testid="customer-display-idle">
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

		<template v-else>
			<!-- The line that just changed, at the top and large. This is the
			     one thing a customer is actually doing while they stand here:
			     checking that the thing the cashier just scanned rang up as the
			     thing they picked up, at the price on the shelf. -->
			<div class="cd-hero" data-testid="customer-display-hero">
				<p v-if="heroLabel" class="cd-hero__label" data-testid="customer-display-hero-label">
					{{ __(heroLabel) }}
				</p>
				<p class="cd-hero__name" data-testid="customer-display-hero-name">
					{{ heroLine.item_name }}
				</p>
				<p class="cd-hero__figures">
					<!-- Unit price only when the quantity is not one. At qty 1 the
					     rate and the amount are the same money said twice, which is
					     the duplication `registerSaysItOnce.spec.ts` exists over. -->
					<span
						v-if="heroUnit"
						class="cd-hero__unit reg-mono"
						data-money-role="line-unit"
						data-testid="customer-display-hero-unit"
					>{{ heroUnit }}</span>
					<span class="cd-hero__amount reg-mono" data-money-role="line">
						{{ formatCurrency(heroLine.amount) }}
					</span>
				</p>
			</div>

			<!-- Everything else in the basket, newest first — the cart prepends,
			     and a re-scanned line is moved back to index 0, so this order is
			     the register's own and not a sort invented here. It scrolls
			     rather than shrinking: a fourteenth line must not drag the first
			     thirteen below the size someone can read at two metres. -->
			<ul v-if="restLines.length" class="cd-lines" data-testid="customer-display-lines">
				<li v-for="row in restLines" :key="row.id" class="cd-line" data-testid="customer-display-line">
					<span class="cd-line__name">{{ row.item_name }}</span>
					<span v-if="unitLabel(row)" class="cd-line__unit reg-mono" data-money-role="line-unit">
						{{ unitLabel(row) }}
					</span>
					<span class="cd-line__amount reg-mono" data-money-role="line">
						{{ formatCurrency(row.amount) }}
					</span>
				</li>
			</ul>
			<!-- The single-line sale still needs the middle row to exist, or the
			     total jumps up the screen and lands where the hero was. -->
			<div v-else class="cd-lines cd-lines--empty" aria-hidden="true"></div>

			<footer class="cd-total">
				<p class="cd-total__label" data-testid="customer-display-total-label">
					{{ __("Total to charge · {0} items", [pieceLabel]) }}
				</p>
				<!-- `aria-live` on the total alone. It is the figure whose change
				     is the point of the screen, and a second live region would
				     make every scan announce twice. -->
				<p
					class="cd-total__value reg-mono"
					data-money-role="total"
					data-testid="customer-display-total"
					aria-live="polite"
					aria-atomic="true"
				>
					{{ formatCurrency(totalAmount) }}
				</p>
				<!-- Shown only when the lines do not add up to the total, so a
				     customer who does the arithmetic themselves does not find the
				     screen disagreeing with itself. "Adjustment" and not
				     "Discount": the snapshot folds discount and delivery into one
				     number before it crosses the window, and naming which one it
				     is would be a guess. A saving carries the positive STATE tone
				     — the canvas's own `ahorra $41` treatment — and a charge stays
				     neutral. Neither is the accent; see the style block. -->
				<p
					v-if="adjustment !== null"
					class="cd-total__adjust"
					:class="{ 'cd-total__adjust--saving': adjustment < 0 }"
					data-testid="customer-display-adjustment"
				>
					<span>{{ __("Adjustment") }}</span>
					<span class="reg-mono" data-money-role="adjustment">{{ adjustmentLabel }}</span>
				</p>
			</footer>
		</template>
	</section>
</template>

<script setup lang="ts">
/**
 * The screen the CUSTOMER reads (`docs/POS-RIEL-Y-CAJON-BUILD.md` §13, ranked
 * first). It has no artboard, so it inherits the register's vocabulary rather
 * than inventing a second one — the canvas's tokens, its tabular figures, its
 * `Total a cobrar · N artículos`, its bottom lane for THE number.
 *
 * ## Who is reading it, and what that costs
 *
 * A person standing one to two metres away, possibly without reading glasses,
 * with a queue behind them. That is roughly three times a cashier's viewing
 * distance, so the four-column table this replaced — item, qty, rate, amount
 * at cart density — was legible to nobody it was drawn for. The screen now
 * carries three things at three sizes: the line that just changed, the rest of
 * the basket, and the total, largest by a wide margin.
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
 *     it was meant to avoid.
 *   - **The wallet balance is not here and must not be added.** `Cobro.dc.html`
 *     shows `Monedero del cliente $418.00` — on the cashier's screen. A balance
 *     is a financial fact about a person; posting it at eye level to a stranger
 *     is a disclosure nobody consented to. The snapshot does not carry it and
 *     this component must not be the reason it starts to.
 *   - **Phone, customer id, purchase history, loyalty tier, `channel_id`** —
 *     same argument, and none of them helps anyone verify a price.
 *
 * `item_code` is dropped for a different reason and it is worth keeping the
 * two apart: an internal SKU is not private, it is simply noise the customer
 * cannot use, and at this type size every character competes with the name.
 *
 * `tests/customerDisplayPrivacy.spec.ts` asserts the absences, so re-adding
 * one fails by name rather than by review.
 *
 * ## No accent
 *
 * Invariant 2 spends one saturated colour per screen on the primary action.
 * This screen has no actions at all — nobody touches it — so there is nothing
 * for the accent to mark, and spending it anyway would give the eye a rival to
 * the total. The hierarchy is carried by SIZE alone. Green appears once, on a
 * saving, and green is STATE.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
	createCustomerDisplayTransport,
	type CustomerDisplayLineItem,
	type CustomerDisplaySnapshot,
} from "../../utils/customerDisplay";

const route = useRoute();

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

const emptySnapshot = (): CustomerDisplaySnapshot => ({
	channel_id: "",
	currency: "",
	customer_name: "",
	items: [],
	total_qty: 0,
	total_amount: 0,
	updated_at: "",
});

const snapshot = ref<CustomerDisplaySnapshot>(emptySnapshot());

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
		snapshot.value = emptySnapshot();
		return;
	}

	transport = createCustomerDisplayTransport(channelId.value);
	unsubscribe = transport.subscribe((nextSnapshot) => {
		snapshot.value = nextSnapshot || emptySnapshot();
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

const lines = computed<CustomerDisplayLineItem[]>(() => snapshot.value.items || []);

/**
 * Which line changed, established by DIFFING consecutive snapshots rather than
 * by assuming index 0 is the newest. The cart does prepend, and a re-scanned
 * line is moved back to the top — but "just added" is a claim about time, and
 * a claim this screen can actually verify is worth the fifteen lines.
 *
 * It survives a snapshot that changed nothing about the lines (the publisher
 * also republishes on customer and profile changes): the last thing that
 * changed is still the last thing that changed, so the highlight only moves
 * when something really moved, and only clears when that row leaves the cart.
 */
const highlightId = ref("");
const highlightKind = ref<"" | "added" | "updated">("");
let previousLines: Map<string, CustomerDisplayLineItem> | null = null;

watch(
	lines,
	(current) => {
		const next = new Map(current.map((row) => [row.id, row]));

		if (previousLines) {
			const added = current.find((row) => !previousLines!.has(row.id));
			const changed =
				added ||
				current.find((row) => {
					const before = previousLines!.get(row.id);
					return (
						!!before &&
						(before.qty !== row.qty ||
							before.rate !== row.rate ||
							before.amount !== row.amount)
					);
				});
			if (changed) {
				highlightId.value = changed.id;
				highlightKind.value = added ? "added" : "updated";
			}
		}

		// A highlighted row that has been removed stops being a fact.
		if (highlightId.value && !next.has(highlightId.value)) {
			highlightId.value = "";
			highlightKind.value = "";
		}

		previousLines = next;
	},
	{ immediate: true, deep: true },
);

/** The highlighted row when there is one; otherwise simply the top of the
 *  cart, and then WITHOUT a label — an unlabelled hero claims nothing. */
const heroLine = computed<CustomerDisplayLineItem>(() => {
	const highlighted = lines.value.find((row) => row.id === highlightId.value);
	return highlighted || lines.value[0] || ({} as CustomerDisplayLineItem);
});

const heroLabel = computed(() => {
	if (!highlightKind.value || heroLine.value.id !== highlightId.value) return "";
	return highlightKind.value === "added" ? "Just added" : "Updated";
});

const restLines = computed(() => lines.value.filter((row) => row.id !== heroLine.value.id));

const totalAmount = computed(() =>
	Number.isFinite(Number(snapshot.value.total_amount))
		? Number(snapshot.value.total_amount)
		: lines.value.reduce((sum, row) => sum + Number(row.amount || 0), 0),
);

const pieceCount = computed(() => {
	const declared = Number(snapshot.value.total_qty);
	if (Number.isFinite(declared) && declared > 0) return declared;
	return lines.value.reduce((sum, row) => sum + Number(row.qty || 0), 0);
});

const formatQty = (value: number) => {
	const qty = Number(value || 0);
	return qty.toLocaleString(undefined, {
		minimumFractionDigits: Number.isInteger(qty) ? 0 : 2,
		maximumFractionDigits: 3,
	});
};

const pieceLabel = computed(() => formatQty(pieceCount.value));

const formatCurrency = (value: number) => {
	const amount = Number(value || 0);
	const currency = snapshot.value.currency || "";
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

/** `2 × $120.00`, and nothing at all when the quantity is one. Weighed goods
 *  (0.75 kg) are not one, so they keep their unit price, which is the case
 *  where a customer most wants to see it. */
const unitLabel = (row: CustomerDisplayLineItem) => {
	const qty = Number(row?.qty || 0);
	if (Math.abs(qty - 1) < 1e-9) return "";
	return `${formatQty(qty)} × ${formatCurrency(Number(row?.rate || 0))}`;
};

const heroUnit = computed(() => unitLabel(heroLine.value));

/**
 * The gap between the lines and the total, or `null` when there is none.
 *
 * The publisher builds `total_amount` as lines − discount + delivery, so this
 * difference is real money the customer would otherwise have to take on faith
 * after adding the rows up themselves. Half a cent of tolerance because the
 * two sides are floats that took different routes.
 */
const adjustment = computed(() => {
	const lineSum = lines.value.reduce((sum, row) => sum + Number(row.amount || 0), 0);
	const delta = totalAmount.value - lineSum;
	return Math.abs(delta) < 0.005 ? null : delta;
});

/** Sign rendered outside the formatter, as `DifferenceHero` does it: a tenant
 *  formatter that parenthesises negatives would otherwise decide how a saving
 *  reads on this screen. */
const adjustmentLabel = computed(() => {
	const delta = adjustment.value;
	if (delta === null) return "";
	const magnitude = formatCurrency(Math.abs(delta));
	return delta < 0 ? `−${magnitude}` : `+${magnitude}`;
});
</script>

<style scoped>
/* Every colour resolves through a token — no literal outside a `var()`
   fallback — so the display follows theme.css into dark exactly when the rest
   of the POS does. `ActionBand.vue` is the reference; three components shipped
   literal hex earlier in this programme and had to be redone.

   There is no accent here at all, on purpose: a screen with no actions has
   nothing for invariant 2's one saturated colour to mark. */
.cd {
	/* The type scale, named so it can be asserted rather than eyeballed
	   (`tests/customerDisplayLegibility.spec.ts` reads these). The desktop
	   band's figure is 60px at a cashier's arm's length; a customer stands two
	   to three times further back, which is where the total's ceiling comes
	   from. The floors are what a 1280×820 popup can still hold. */
	--cd-size-total: clamp(56px, 7.4vw, 132px);
	--cd-size-hero-name: clamp(26px, 3.1vw, 54px);
	--cd-size-hero-figure: clamp(20px, 2.3vw, 40px);
	--cd-size-line: clamp(17px, 1.7vw, 28px);
	--cd-size-caption: clamp(12px, 1.05vw, 17px);

	height: 100%;
	min-height: 0;
	display: grid;
	grid-template-rows: auto minmax(0, 1fr) auto;
	gap: var(--reg-space-lg, 14px);
	color: var(--reg-text-primary, #212121);
}

/* ---- idle ------------------------------------------------------------- */

.cd-idle {
	grid-row: 1 / -1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--reg-space-md, 10px);
	text-align: center;
	padding: var(--reg-space-xl, 22px);
}

.cd-idle__word {
	margin: 0;
	font-size: var(--cd-size-hero-name);
	font-weight: 300;
	letter-spacing: 0.02em;
	color: var(--reg-text-primary, #212121);
}

.cd-idle__note {
	margin: 0;
	font-size: var(--cd-size-line);
	color: var(--reg-text-secondary, #56606e);
}

.cd-idle__unlinked {
	margin: var(--reg-space-lg, 14px) 0 0;
	font-size: var(--cd-size-caption);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

/* ---- the line that just changed --------------------------------------- */

.cd-hero {
	background: var(--reg-surface, #ffffff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	padding: var(--reg-space-lg, 14px) var(--reg-space-xl, 22px);
}

.cd-hero__label {
	margin: 0;
	font-size: var(--cd-size-caption);
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.cd-hero__name {
	margin: var(--reg-space-2xs, 2px) 0 0;
	font-size: var(--cd-size-hero-name);
	font-weight: 500;
	line-height: 1.12;
	color: var(--reg-text-primary, #212121);
}

.cd-hero__figures {
	margin: var(--reg-space-sm, 6px) 0 0;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-lg, 14px);
	font-size: var(--cd-size-hero-figure);
}

.cd-hero__unit {
	color: var(--reg-text-secondary, #56606e);
}

.cd-hero__amount {
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	white-space: nowrap;
}

/* ---- the rest of the basket ------------------------------------------- */

.cd-lines {
	margin: 0;
	padding: 0;
	list-style: none;
	min-height: 0;
	overflow-y: auto;
}

.cd-line {
	display: flex;
	align-items: baseline;
	gap: var(--reg-space-lg, 14px);
	padding: var(--reg-space-sm, 6px) var(--reg-space-xl, 22px);
	font-size: var(--cd-size-line);
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.cd-line__name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
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

/* ---- the total, in the bottom lane the register also uses -------------- */

.cd-total {
	background: var(--reg-surface, #ffffff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	padding: var(--reg-space-lg, 14px) var(--reg-space-xl, 22px);
}

.cd-total__label {
	margin: 0;
	font-size: var(--cd-size-caption);
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.cd-total__value {
	margin: var(--reg-space-2xs, 2px) 0 0;
	font-size: var(--cd-size-total);
	font-weight: 700;
	letter-spacing: -0.035em;
	line-height: 1.06;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

.cd-total__adjust {
	margin: var(--reg-space-sm, 6px) 0 0;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-lg, 14px);
	font-size: var(--cd-size-caption);
	color: var(--reg-text-secondary, #56606e);
}

/* STATE, not emphasis — the canvas gives a saving the same green it gives
   `ahorra $41`, and green is what invariant 2 reserves for state. A charge
   (delivery) stays in the neutral tone above. */
.cd-total__adjust--saving {
	color: var(--reg-tone-positive-number, #157a48);
	font-weight: 700;
}
</style>
