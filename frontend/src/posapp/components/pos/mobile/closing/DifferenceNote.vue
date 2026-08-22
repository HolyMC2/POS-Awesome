<template>
	<section class="corte-note" data-testid="movil-corte-note" :data-note-verdict="gate.verdict">
		<div class="corte-note__head">
			<span class="corte-note__label">{{ __("Note on the difference") }}</span>
			<span
				class="corte-note__badge"
				:class="gate.required ? 'corte-note__badge--required' : 'corte-note__badge--optional'"
				data-testid="movil-corte-note-badge"
			>
				<!-- Lowercase, and deliberately NOT the existing `Required` /
				     `Optional` pair: those are the apertura's readiness verdicts and
				     translate as `Necesario` / `Opcional`, masculine. This badge sits
				     under *la nota*, and the artboard writes it `obligatoria`. Two
				     source strings, because one Spanish word cannot be both. -->
				{{ gate.required ? __("mandatory") : __("optional") }}
			</span>
		</div>

		<!-- A textarea, not an input: the worked example on the artboard runs two
		     lines, and a single-line box that scrolls sideways is how a long
		     explanation gets truncated into a short one. -->
		<textarea
			class="corte-note__field"
			:class="{ 'corte-note__field--required': gate.required && !gate.satisfied }"
			data-testid="movil-corte-note-input"
			rows="3"
			autocomplete="off"
			:aria-label="__('Note on the difference')"
			:aria-required="gate.required ? 'true' : 'false'"
			:aria-describedby="hintId"
			:placeholder="__('What happened? For example: $25 short on sale B-04801, too much change given at close.')"
			:value="modelValue"
			@input="onInput"
		></textarea>

		<!-- One line, and it says the SAME thing the button's disabled state
		     says, because a control that blocks without naming its condition is
		     the one a cashier defeats by typing anything at all.

		     Two of the four hints quote the threshold in pesos, so the paragraph
		     declares itself as a money figure on exactly those two — the amount
		     is interpolated into a sentence and cannot carry its own span, and a
		     figure that does not say what it is, is how an unaccounted number
		     gets onto a screen (tests/registerSaysItOnce.spec.ts). -->
		<p
			:id="hintId"
			class="corte-note__hint"
			:class="hintClass"
			data-testid="movil-corte-note-hint"
			:data-money-role="quotesThreshold ? 'note-threshold' : undefined"
		>
			{{ hint }}
		</p>
	</section>
</template>

<script setup lang="ts">
/**
 * The mandatory note (`MovilCorte.dc.html` — `Nota del faltante · obligatoria`).
 *
 * Presentation only. WHEN the note is demanded, and what counts as an
 * explanation, is `differenceNote.ts`'s decision and is argued at length there;
 * this component renders a verdict it is handed and emits what was typed.
 *
 * The badge flips between *required* and *optional* rather than appearing only
 * when required, because the difference between the two states is the control:
 * a cashier who has watched the badge say *optional* on the ordinary nights
 * reads *required* as information rather than as furniture.
 */
import { computed } from "vue";

import { type NoteGate } from "./differenceNote";

const props = defineProps<{
	modelValue: string;
	gate: NoteGate;
	/** Formatted tolerance, so the hint can say what "material" means in pesos. */
	toleranceLabel: string;
}>();

const emit = defineEmits<{ (_event: "update:modelValue", _note: string): void }>();

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

// Stable per instance so `aria-describedby` still points at this card's hint
// when two corte surfaces are mounted in one document (a spec, a shell that
// keeps the destination alive behind the sale).
const hintId = `corte-note-hint-${Math.random().toString(36).slice(2, 9)}`;

const onInput = (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value);

const hint = computed(() => {
	switch (props.gate.verdict) {
		case "missing":
			return __("A difference over {0} has to be explained before the shift can close.", [
				props.toleranceLabel,
			]);
		case "tooShort":
			return __("Say what happened, in a sentence — this is what a supervisor reads tomorrow.");
		case "satisfied":
			return __("The note goes on the closing document with the shift.");
		default:
			// Not required, and the box is still there. A cashier who knows why
			// three pesos are missing should be able to say so, and throwing that
			// away because it was under a threshold would discard the one kind of
			// note that was volunteered rather than extracted.
			return __("Under {0} a difference is coins. Write a note anyway if you know why.", [
				props.toleranceLabel,
			]);
	}
});

/** The two verdicts whose hint names the threshold in money. */
const quotesThreshold = computed(
	() => props.gate.verdict === "missing" || props.gate.verdict === "notRequired",
);

const hintClass = computed(() =>
	props.gate.required && !props.gate.satisfied ? "corte-note__hint--blocking" : "",
);
</script>

<style scoped>
/* Amber is the only tint here, and only ever on a caption, a border or a
   badge — never a fill on a control. The screen's one accent belongs to
   CERRAR TURNO (§17.7 invariant 2). */
.corte-note {
	padding: 11px 13px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 12px);
	background: var(--reg-surface, #ffffff);
}

.corte-note__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 7px;
}

.corte-note__label {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.corte-note__badge {
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.corte-note__badge--required {
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.corte-note__badge--optional {
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	color: var(--reg-text-muted, #667085);
}

.corte-note__field {
	display: block;
	width: 100%;
	/* Three rows at 11.5px would clear 44px on their own; stated anyway so a
	   density sweep cannot shrink the one control this screen demands input in
	   below the touch minimum. */
	min-height: var(--reg-touch-min, 44px);
	padding: 9px 11px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font-family: inherit;
	font-size: 11.5px;
	line-height: 1.4;
	resize: vertical;
}

.corte-note__field--required {
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-strong, #6b4a10);
}

.corte-note__field:focus-visible {
	outline: 2px solid var(--reg-text-primary, #212121);
	outline-offset: 1px;
}

.corte-note__hint {
	margin: 7px 0 0;
	font-size: 11px;
	line-height: 1.35;
	color: var(--reg-text-muted, #667085);
}

.corte-note__hint--blocking {
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 500;
}
</style>
