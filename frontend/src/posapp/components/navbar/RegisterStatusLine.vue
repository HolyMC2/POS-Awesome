<template>
	<div
		class="register-status-line"
		:class="{ 'register-status-line--compact': compact }"
		data-testid="register-status-line"
	>
		<div v-if="line" class="register-status-line__identity">
			<div
				class="register-status-line__title"
				:class="{ mono: line.titleIsLiteral }"
				data-testid="register-status-title"
			>
				{{ line.titleIsLiteral ? line.titleKey : translate(line.titleKey, line.titleParams) }}
			</div>
			<div
				v-if="subtitle"
				class="register-status-line__subtitle"
				data-testid="register-status-subtitle"
			>
				{{ subtitle }}
			</div>
		</div>

		<div v-if="line" class="register-status-line__chips">
			<span
				v-for="chip in line.chips"
				:key="chip.id"
				class="register-status-chip"
				:class="[`register-status-chip--${chip.tone}`, { mono: chip.mono }]"
				:data-testid="`register-status-chip-${chip.id}`"
				:data-tone="chip.tone"
				:data-priority="chip.priority"
			>
				{{ chip.mono ? chip.labelKey : translate(chip.labelKey, chip.labelParams) }}
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * The register status line (convergence checklist item A).
 *
 * Presentation only. Every decision that could be wrong — above all whether
 * the register may claim to be synchronised — lives in `registerStatusLine.ts`
 * and is tested there without mounting anything. This file renders what that
 * module returns and nothing else.
 *
 * No literal colour. The artboard's chip palette turned out to be the theme's
 * own: `#e8f5e8`/`#1b5e20` for the synced chip is exactly
 * `--pos-button-success-bg`/`-text`, so the strip inherits dark mode for free
 * rather than needing a second palette maintained beside the first.
 *
 * The root `<div>` renders unconditionally and the CONTENT is guarded, because
 * this element replaces the app bar's spacer — a `v-if` on the root would
 * collapse the bar's layout for the second or two a register takes to answer
 * its bootstrap, and the actions would jump left and then jump back. The
 * comment lives here rather than above the template's root for the reason the
 * plan's §10 records: a top-level template comment is itself a root node and
 * silently makes the component a fragment, which breaks `wrapper.attributes()`.
 */
import { computed } from "vue";
import {
	resolveRegisterStatusLine,
	type RegisterStatusInput,
	type RegisterStatusLine,
} from "./registerStatusLine";

const props = withDefaults(defineProps<{ input?: RegisterStatusInput }>(), {
	input: () => ({}),
});

const compact = computed(() => Boolean(props.input?.compact));

const line = computed<RegisterStatusLine | null>(() => {
	const resolved = resolveRegisterStatusLine(props.input || {});
	// Nothing to say yet — a register still booting should render no strip at
	// all rather than an empty shell of one.
	if (!resolved.titleKey && !resolved.chips.length) {
		return null;
	}
	return resolved;
});

/**
 * `__()` then `{0}`-style interpolation, matching how the rest of the POS
 * substitutes — Frappe's own `__()` takes an array as its second argument, but
 * routing through one helper keeps the fallback honest when it is absent (unit
 * tests mount this without the global).
 */
function translate(key: string, params?: (string | number)[]): string {
	if (!key) return "";
	const globalTranslate = (globalThis as any).__;
	let out = typeof globalTranslate === "function" ? String(globalTranslate(key)) : key;
	(params || []).forEach((value, index) => {
		out = out.replace(new RegExp(`\\{${index}\\}`, "g"), String(value));
	});
	return out;
}

const subtitle = computed(() =>
	line.value ? translate(line.value.subtitleKey, line.value.subtitleParams) : "",
);
</script>

<style scoped>
/* Height is inherited from the app bar on purpose: the strip replaces the
 * icons that already sat on that row, so it must cost zero extra vertical
 * space. */
.register-status-line {
	display: flex;
	align-items: center;
	gap: 12px;
	flex: 1 1 auto;
	min-width: 0;
}

/* The identity NEVER shrinks and never ellipses.
 *
 * It used to do both, and the register shipped a bar reading
 * "Doco Ventas · Bot Playwright · shift since 0…" — a shift start cut off
 * before its own digits. A truncated status line is worse than the icons it
 * replaced, because an icon looks deliberate and a severed word looks broken.
 * So the identity renders whole and the CHIPS yield instead: they are
 * individually droppable by priority, and losing one whole chip states less
 * without stating anything false. */
.register-status-line__identity {
	line-height: 1.2;
	min-width: 0;
	flex: 0 0 auto;
}

.register-status-line__title {
	font-size: 13px;
	font-weight: 700;
	color: var(--pos-text-primary);
	white-space: nowrap;
}

.register-status-line__subtitle {
	font-size: 10.5px;
	color: var(--pos-text-muted);
	white-space: nowrap;
}

/* No `overflow: hidden` here, deliberately. Clipping is what produced
 * "Online · synce" — the connection chip, the one chip that must never lie
 * about money, severed mid-word by the box it sat in. Chips are
 * `flex: 0 0 auto` so they can never be squashed either; when the row runs
 * out of room the priority rules below remove whole chips instead. */
.register-status-line__chips {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-inline-start: auto;
	min-width: 0;
	flex: 0 1 auto;
}

.register-status-chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	border-radius: 999px;
	font-size: 11.5px;
	font-weight: 500;
	padding: 3px 9px;
	white-space: nowrap;
	flex: 0 0 auto;
	background: var(--pos-surface-muted);
	color: var(--pos-text-muted);
}

/* Drop order under pressure, highest priority number first. Informational
 * chips go before operational ones: the clock is on the wall behind the
 * cashier and the day's count can wait for the corte, but a printer fault is
 * an instruction and the connection state is a claim about whether money has
 * reached the server. Priority 1 has no rule here and therefore never drops. */
@media (max-width: 1499px) {
	.register-status-chip[data-priority="5"] {
		display: none;
	}
}

@media (max-width: 1359px) {
	.register-status-chip[data-priority="4"] {
		display: none;
	}
}

@media (max-width: 1239px) {
	.register-status-chip[data-priority="3"] {
		display: none;
	}
}

/* Tone is STATE, never emphasis (invariant 2). There is no accent tone here
 * by design — the status strip never carries the screen's one saturated
 * colour, which belongs to the primary action. */
.register-status-chip--positive {
	background: var(--pos-button-success-bg);
	color: var(--pos-button-success-text);
}

.register-status-chip--warning {
	background: var(--pos-button-warning-bg);
	color: var(--pos-button-warning-text);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

.register-status-line--compact .register-status-line__title {
	font-size: 12.5px;
}

.register-status-line--compact .register-status-line__subtitle {
	font-size: 10px;
}
</style>
