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
 * space. `min-width: 0` down the chain is what lets the identity block ellipse
 * instead of pushing the chips off the end. */
.register-status-line {
	display: flex;
	align-items: center;
	gap: 12px;
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
}

.register-status-line__identity {
	line-height: 1.2;
	min-width: 0;
	flex: 0 1 auto;
}

.register-status-line__title {
	font-size: 13px;
	font-weight: 700;
	color: var(--pos-text-primary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.register-status-line__subtitle {
	font-size: 10.5px;
	color: var(--pos-text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Chips are pushed to the trailing edge and are the first thing allowed to
 * scroll — losing "31 tickets hoy" off a narrow register is survivable;
 * losing the connection chip is not, so it is rendered last and therefore
 * clipped last. */
.register-status-line__chips {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-inline-start: auto;
	min-width: 0;
	overflow: hidden;
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
	background: var(--pos-surface-muted);
	color: var(--pos-text-muted);
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
