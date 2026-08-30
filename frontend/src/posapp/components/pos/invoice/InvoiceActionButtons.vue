<template>
	<!-- The sale's secondary actions, as ONE line of keyboard-hint chips.
	     `Main.dc.html` draws this area as a single 38px strip between the cart
	     and the band — counts left, chips centre, figures right. What shipped
	     instead was an eight-button grid of saturated `v-btn`s roughly 200px
	     tall, which cost the register a third of its vertical space and put
	     eight competing fills directly above a band built to hold exactly one
	     accent (§17.7 invariant 2).

	     Every chip prints the chord that actually triggers it, read from the
	     resolved keymap rather than from the mock — see actionChips.ts. That
	     also finally puts the shortcuts engine (§17.3) in front of the
	     cashier, which is what it was built for: a chip reading "Alt+S
	     Guardar" teaches the keyboard while it works. -->
	<div class="pos-action-strip" data-perf-tag="pos-actions" data-testid="action-strip">
		<span class="pos-action-strip__counts" data-testid="action-strip-counts">
			{{ lineSummary }}
		</span>

		<v-btn
			v-for="chip in chips"
			:key="chip.id"
			class="pos-action-strip__chip"
			:class="{ 'pos-action-strip__chip--danger': chip.id === 'cancel-sale' }"
			variant="text"
			size="small"
			density="comfortable"
			:prepend-icon="chip.icon"
			:data-testid="`action-chip-${chip.id}`"
			:data-chip-scope="chip.scope"
			data-pos-keyboard-target="invoice-action"
			:loading="loadingFor(chip.id)"
			@click="$emit(chip.id)"
		>
			<span class="pos-action-strip__verb">{{ __(labelFor(chip)) }}</span>
			<!-- No chord element at all when unbound. An empty chip slot would
			     read as "this has a shortcut and we forgot it". -->
			<kbd
				v-if="chordFor(chip.actionId)"
				class="pos-action-strip__chord"
				:data-testid="`action-chord-${chip.id}`"
				>{{ chordFor(chip.actionId) }}</kbd
			>
		</v-btn>

		<div class="pos-action-strip__spacer"></div>

		<!-- «Margen estimado · Costo» (`Main.dc.html` nodes 113–116), at the
		     right end of this strip where the artboard draws it. Its amounts are
		     deliberately not quoted here — a cost literal in shipped markup is a
		     cost literal in every cashier's page source.

		     Three states and no fourth: absent for anyone who is not the acting
		     supervisor, a plain sentence when the cart is only partly costed,
		     and the two figures when every line carries one. The decision is
		     `cartMargin.ts`'s; this renders it.

		     TEXT, never a fill. Green here is the same state green the status
		     line spends on «En línea · sincronizado» and amber the same warning
		     — §17.7 invariant 2 keeps the screen's one saturated colour on the
		     primary action, and a margin figure is not that. -->
		<span
			v-if="cartMargin.state === 'incomplete'"
			class="pos-action-strip__margin"
			data-testid="cart-margin-incomplete"
		>
			{{ __("Cost incomplete") }}
		</span>
		<template v-else-if="cartMargin.state === 'ready'">
			<span class="pos-action-strip__margin" data-testid="cart-margin">
				{{ __("Estimated margin") }}
				<span
					class="pos-action-strip__margin-value mono"
					:class="{ 'pos-action-strip__margin-value--negative': cartMargin.negative }"
					:data-margin-sign="cartMargin.negative ? 'negative' : 'positive'"
					>{{ cartMargin.margin }}</span
				>
			</span>
			<span class="pos-action-strip__margin" data-testid="cart-cost">
				{{ __("Cost") }}
				<span class="pos-action-strip__cost-value mono">{{ cartMargin.cost }}</span>
			</span>
		</template>

		<!-- Phone and lean-vertical only: no band mounts there, so this stays
		     the only PAY there is, and it is the ONE accent on the screen. It
		     was `success` + a green gradient; green is STATE in this register
		     (the band tints itself green when there is change to give), and a
		     green PAY on every sale teaches the cashier that green is just a
		     button colour, after which the band's green signals nothing. -->
		<v-btn
			v-if="!bandOwnsPrimary"
			class="pos-action-strip__pay"
			variant="flat"
			color="primary"
			size="large"
			prepend-icon="mdi-credit-card"
			data-pos-keyboard-target="pay"
			data-testid="action-strip-pay"
			:loading="paymentLoading"
			@click="$emit('show-payment')"
		>
			{{ __("PAY") }}
		</v-btn>
	</div>
</template>

<script setup>
import { computed } from "vue";
import { useResponsive } from "../../../composables/core/useResponsive";
import { getActiveKeymap } from "../../../shortcuts";
import { ACTION_CHIPS, chordLabelFor, visibleChips } from "./actionChips";

const props = defineProps({
	pos_profile: { type: Object, default: () => ({}) },
	saveLoading: Boolean,
	loadDraftsLoading: Boolean,
	selectOrderLoading: Boolean,
	cancelLoading: Boolean,
	invoiceManagementLoading: Boolean,
	returnsLoading: Boolean,
	printLoading: Boolean,
	paymentLoading: Boolean,
	customerDisplayLoading: Boolean,
	/** Lines/pieces summary rendered at the strip's left, as the artboard does. */
	lineSummary: { type: String, default: "" },
	/**
	 * Margin and cost for the right end of the strip, already resolved and
	 * already formatted by the summary — `{ state, margin, cost, negative }`.
	 *
	 * Defaulting to `hidden` matters: every mount that does not pass this (a
	 * phone, a unit test, any caller written before the row existed) renders no
	 * cost, which is the correct answer for a component that cannot tell who is
	 * standing at the till.
	 */
	cartMargin: {
		type: Object,
		default: () => ({ state: "hidden", margin: "", cost: "", negative: false }),
	},
	/**
	 * True when the shell's ActionBand is mounted and carrying the primary
	 * action. It is also the signal that a RAIL is mounted, since Pos.vue
	 * mounts both on the same condition — so it doubles as "the rail owns the
	 * destination actions". Defaults false so the phone and lean-vertical
	 * paths keep every action and their PAY.
	 */
	bandOwnsPrimary: { type: Boolean, default: false },
	/**
	 * Per-chip label overrides, keyed by chip id. The chip's own label is the
	 * default and the registry stays the single list of what a chip IS; this is
	 * for the case where the same action MEANS something else.
	 *
	 * The one caller today: a mesa-owned sale, where «Cancelar venta» does not
	 * cancel a sale — it drops the edits in the cart and leaves the cuenta on
	 * the table exactly as the kitchen last saw it (golden flow §3).
	 */
	labelOverrides: { type: Object, default: () => ({}) },
});

defineEmits([
	"save-and-clear",
	"save-quotation",
	"load-drafts",
	"select-order",
	"cancel-sale",
	"open-invoice-management",
	"open-returns",
	"print-draft",
	"show-payment",
	"open-customer-display",
	"open-saldo-picker",
]);

const __ = window.__;
useResponsive();

const chips = computed(() => visibleChips(props.pos_profile, props.bandOwnsPrimary));
const labelFor = (chip) => props.labelOverrides?.[chip.id] || chip.label;

// Read once per render rather than per chip: `getActiveKeymap()` is a memoized
// lookup, but the strip re-renders on every cart mutation and this sits on the
// sale path (§6).
const keymap = computed(() => getActiveKeymap());
const chordFor = (actionId) => chordLabelFor(actionId, keymap.value);

const LOADING_BY_CHIP = {
	"save-and-clear": "saveLoading",
	"load-drafts": "loadDraftsLoading",
	"select-order": "selectOrderLoading",
	"cancel-sale": "cancelLoading",
	"open-invoice-management": "invoiceManagementLoading",
	"open-returns": "returnsLoading",
	"print-draft": "printLoading",
};
const loadingFor = (id) => Boolean(props[LOADING_BY_CHIP[id]]);

// Re-exported so a spec can assert the strip renders every chip the registry
// defines for a given profile, rather than a hand-copied list.
defineExpose({ ACTION_CHIPS });
</script>

<style scoped>
/* One line, 38px, matching Main.dc.html's strip: 9px vertical padding around
   ~20px of content, a dashed top rule and a faintly lifted ground. The old
   grid was ~200px of elevated blocks. */
.pos-action-strip {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	padding: 9px 12px;
	margin-top: 8px;
	border-top: 1px dashed var(--pos-border-light, rgba(0, 0, 0, 0.06));
	background: var(--pos-bg-secondary, #fcfdfe);
	border-radius: 0 0 10px 10px;
}

.pos-action-strip__counts {
	font-size: 12px;
	color: var(--pos-text-muted, #667085);
	white-space: nowrap;
}

.pos-action-strip__spacer {
	flex: 1 1 auto;
}

/* Text variant: Vuetify routes `color` to the foreground for anything that is
   not elevated/flat, so nothing here can become a fill by accident. No colour
   is set at all — these inherit the surface's text colour, which is what the
   artboard paints them (#667085 on #f2f4f7). */
.pos-action-strip__chip {
	text-transform: none !important;
	letter-spacing: 0 !important;
	font-size: 12px !important;
	font-weight: 500 !important;
	min-height: 28px !important;
	padding: 0 9px !important;
	border-radius: 999px !important;
	color: var(--pos-text-muted, #667085) !important;
	background: var(--pos-surface-variant, #f2f4f7) !important;
}

/* Destructive keeps red, as TEXT. A cashier already reads red for "this
   undoes something", and that is red as state — it never becomes a fill. */
.pos-action-strip__chip--danger {
	color: var(--pos-error, #c0392f) !important;
}

.pos-action-strip__verb {
	white-space: nowrap;
}

/* The chord is the quiet half: monospace, tabular, one step down, so the verb
   still reads first. */
.pos-action-strip__chord {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
	font-size: 10.5px;
	font-weight: 700;
	margin-left: 6px;
	padding: 1px 5px;
	border-radius: 5px;
	background: var(--pos-surface, #fff);
	color: var(--pos-text-muted, #667085);
	box-shadow: inset 0 0 0 1px var(--pos-border-light, rgba(0, 0, 0, 0.08));
}

/* The margin pair reads at counts weight — it is context for the total, not a
   figure competing with it. `Main.dc.html` sets both at 12px/#667085 with only
   the margin VALUE lifted. */
.pos-action-strip__margin {
	font-size: 12px;
	color: var(--pos-text-muted, #667085);
	white-space: nowrap;
}

.pos-action-strip__margin-value {
	font-weight: 700;
	color: var(--pos-button-success-text, #1b5e20);
}

/* Below cost. Amber is this register's warning tone (the status line's
   «Sin conexión» spends the same token), and it carries its own dark-mode
   pair — a literal green/red here would have needed a second palette. */
.pos-action-strip__margin-value--negative {
	color: var(--pos-button-warning-text, #e65100);
}

.pos-action-strip__cost-value {
	color: var(--pos-text-primary, #212121);
}

.pos-action-strip__margin .mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

.pos-action-strip__pay {
	min-height: 44px !important;
	font-weight: 600 !important;
	text-transform: none !important;
}

/* Phone: the strip stays one line conceptually but its targets stop being
   mouse targets. 28px is a fine pointer size and far below the 44px coarse
   floor theme.css enforces everywhere else (tests/touchTargetSweep.spec.ts),
   so the chips grow. Density is a desktop win; it is never worth a missed tap.
   PAY goes to 48px, where it has always been on a phone band. */
@media (max-width: 768px) {
	.pos-action-strip {
		gap: 8px;
	}
	.pos-action-strip__counts {
		width: 100%;
	}
	.pos-action-strip__chip {
		min-height: 44px !important;
		font-size: 13px !important;
		padding: 0 12px !important;
	}
	.pos-action-strip__pay {
		flex: 1 1 100%;
		min-height: 48px !important;
	}
}

/* A touch screen at desktop width — the counter terminals this product runs
   on — gets the same floor without the phone's other reflow. */
@media (pointer: coarse) {
	.pos-action-strip__chip {
		min-height: 44px !important;
	}
}
/* Dense desk tier (utils/itemSelectorLayout DENSE_DESK_*): ≥1100px wide,
 * ≤820px tall. At 1195×741 the strip wrapped to two rows (85px) because the
 * chord badges pushed «Cancelar Venta» down; without them the counts and
 * the three chips sit on one 37px row. Chords are keyboard affordances — the
 * shortcuts keep working, the badges just stop spending a cart row. */
@media (min-width: 1100px) and (max-height: 820px) {
	.pos-action-strip {
		margin-top: 0;
		padding: 4px 8px;
		gap: 6px 8px;
	}

	.pos-action-strip__chord {
		display: none;
	}
}
</style>
