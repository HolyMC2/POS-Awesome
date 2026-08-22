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
			<span class="pos-action-strip__verb">{{ __(chip.label) }}</span>
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
	 * True when the shell's ActionBand is mounted and carrying the primary
	 * action. It is also the signal that a RAIL is mounted, since Pos.vue
	 * mounts both on the same condition — so it doubles as "the rail owns the
	 * destination actions". Defaults false so the phone and lean-vertical
	 * paths keep every action and their PAY.
	 */
	bandOwnsPrimary: { type: Boolean, default: false },
});

defineEmits([
	"save-and-clear",
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
</style>
