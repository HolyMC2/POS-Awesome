<template>
	<section class="opening-readiness" data-testid="opening-readiness">
		<header class="opening-readiness__head">
			<span class="opening-readiness__label">
				{{ translate("Register check · {0} points", [verdict.total]) }}
			</span>
			<span class="opening-readiness__motto">{{ __("it is not asked, it is checked") }}</span>
		</header>

		<ol class="opening-readiness__list">
			<li
				v-for="check in verdict.checks"
				:key="check.id"
				class="opening-readiness__row"
				:class="`opening-readiness__row--${check.outcome}`"
				:data-testid="`readiness-check-${check.id}`"
				:data-outcome="check.outcome"
				:data-severity="check.severity"
			>
				<span class="opening-readiness__n" aria-hidden="true">{{ check.order }}</span>
				<span class="opening-readiness__body">
					<span class="opening-readiness__title">{{ __(check.titleKey) }}</span>
					<span class="opening-readiness__detail" data-testid="readiness-detail">
						{{ translate(check.detailKey, check.detailParams) }}
					</span>
				</span>
				<span
					v-if="check.outcome === 'warn'"
					class="opening-readiness__chip opening-readiness__chip--warn"
					>{{ __("Optional") }}</span
				>
				<span
					v-else-if="check.outcome === 'unknown'"
					class="opening-readiness__chip opening-readiness__chip--unknown"
					>{{ __("Not verified") }}</span
				>
				<span
					v-else-if="check.outcome === 'stop'"
					class="opening-readiness__chip opening-readiness__chip--stop"
					>{{ __("Required") }}</span
				>
				<!-- A verified row is the only one whose outcome would otherwise be
				     carried by colour alone: the tick is decorative and the tint is
				     not readable by a screen reader. The word rides along hidden,
				     for the same reason the rail's blocked reason does (wave-3 A1). -->
				<span v-else class="opening-readiness__chip opening-readiness__chip--pass">
					<span aria-hidden="true">✓</span>
					<span class="opening-readiness__sr">{{ __("Verified") }}</span>
				</span>
			</li>
		</ol>

		<p class="opening-readiness__summary" data-testid="readiness-summary">
			<span class="opening-readiness__count">{{
				translate("{0} of {1} verified", [verdict.verified, verdict.total])
			}}</span>
			<span v-if="verdict.warnings.length">{{
				translate("· {0} optional", [verdict.warnings.length])
			}}</span>
			<span v-if="verdict.unknowns.length">{{
				translate("· {0} not verified", [verdict.unknowns.length])
			}}</span>
		</p>

		<p
			v-if="!verdict.canOpen"
			class="opening-readiness__blocked"
			role="alert"
			data-testid="readiness-blocked"
		>
			{{ __("This register cannot open yet:") }}
			<strong>{{ blockedReasons }}</strong>
		</p>
		<p v-else class="opening-readiness__note">
			{{
				__(
					"A register does not open when a payment method has no account, the warehouse cannot sell, the ticket format is missing or the trade's data is incomplete. Optional warns; required stops.",
				)
			}}
		</p>
	</section>
</template>

<script setup lang="ts">
/**
 * Apertura — the ten-point readiness check (build plan §12 A, roadmap §5.1,
 * artboard `Apertura.dc.html`).
 *
 * Presentation only, and deliberately so. Every decision that could be wrong —
 * above all whether a register may open with a payment method that has no
 * accounting account — lives in `openingReadiness.ts` and is tested there
 * against plain objects. This file renders what that module returns and emits
 * the verdict so the dialog's own primary action can be gated on it.
 *
 * Colour: none of it is emphasis. The row tints are the register's STATE
 * palette (§17.7 invariant 2) — green for verified, amber for an optional
 * warning, the error tone for a stop — and the one saturated accent on this
 * screen stays where it belongs, on the dialog's submit button. Ten green
 * ticks rendered in the brand colour would spend the whole screen's colour
 * budget on reassurance.
 *
 * The panel renders all ten rows from the first paint, before any cache has
 * answered, because a checklist that grows as data arrives reads as a loading
 * spinner rather than as a checklist. Rows begin unverified and become
 * verified; they never appear out of nowhere.
 *
 * One round trip is now made, and only one: `get_opening_readiness` answers
 * the seven points the browser cannot — chief among them the accounting
 * account behind each mode of payment, which lives in a doctype no opening
 * payload carries. That call is the panel's, not the snapshot's, so the
 * assembler stays a pure function of what it is handed and this file owns the
 * probe rule: once per register, never retried on refusal.
 */
import { computed, onMounted, ref, watch } from "vue";
import {
	evaluateReadiness,
	type ReadinessVerdict,
} from "./openingReadiness";
import { collectReadinessInput } from "./readinessSnapshot";
import {
	fetchOpeningReadiness,
	type OpeningReadinessPayload,
} from "../../../services/openingReadinessService";

defineOptions({ name: "OpeningReadiness" });

const props = defineProps<{
	company?: string | null;
	posProfile?: string | null;
	paymentRows?: readonly any[] | null;
}>();

const emit = defineEmits<{
	(_e: "verdict", _verdict: ReadinessVerdict): void;
}>();

const __ = (text: string): string => {
	const globalTranslate = (globalThis as any).__;
	return typeof globalTranslate === "function" ? String(globalTranslate(text)) : text;
};

/**
 * `__()` then `{0}`-style interpolation, matching `RegisterStatusLine.vue`.
 * Routing through one helper keeps the fallback honest when the global is
 * absent, which is how these components are unit-mounted.
 */
function translate(key: string, params?: (string | number)[]): string {
	if (!key) return "";
	let out = __(key);
	(params || []).forEach((value, index) => {
		out = out.replace(new RegExp(`\\{${index}\\}`, "g"), String(value));
	});
	return out;
}

/**
 * The empty snapshot is a legitimate starting verdict, not a placeholder: ten
 * unknowns, nothing blocking. That is also exactly what a register whose
 * caches cannot be read is entitled to, so the failure path and the first
 * paint are the same code.
 */
const verdict = ref<ReadinessVerdict>(evaluateReadiness({}));

const blockedReasons = computed(() =>
	verdict.value.stops.map((stop) => translate(stop.detailKey, stop.detailParams)).join(" · "),
);

/**
 * Collection is async and the cashier can change the profile while it runs.
 * The token drops a stale answer rather than letting register A's snapshot
 * land under register B's name.
 */
let collectToken = 0;

/**
 * One server answer per register, for the life of this panel.
 *
 * `refresh()` runs on mount and again on every prop that settles — the company
 * resolves, the profile auto-selects, the payment rows arrive — so an
 * unguarded fetch would be three or four calls to open one till. The PROMISE
 * is cached, not the value, so two refreshes that race share the one request.
 *
 * A refusal is cached exactly like an answer, and that is the rule this
 * follows rather than an oversight: a register whose user is not assigned to
 * it, or a server too old to carry this endpoint, will refuse every time, and
 * asking again on each prop change is the floors/tables 403 loop wearing a new
 * hat. The panel already has an honest answer for "no server said anything" —
 * the points stay unverified — so there is nothing a retry could win.
 */
const serverAnswers = new Map<string, Promise<OpeningReadinessPayload | null>>();

/** What the server said about the register on screen. `null` = nothing yet. */
const serverAnswer = ref<OpeningReadinessPayload | null>(null);

const currentProfile = (): string =>
	typeof props.posProfile === "string" ? props.posProfile.trim() : "";

function serverAnswerFor(profile: string): Promise<OpeningReadinessPayload | null> {
	if (!profile) return Promise.resolve(null);
	let pending = serverAnswers.get(profile);
	if (!pending) {
		pending = fetchOpeningReadiness(profile).catch(() => null);
		serverAnswers.set(profile, pending);
	}
	return pending;
}

/**
 * The answer belongs to the register it was asked about.
 *
 * `pos_profile` comes back on the payload for exactly this: a cashier who
 * switches register while a call is out must not read register A's accounts
 * under register B's name. The same rule `readinessSnapshot` applies to the
 * cached opening payload, and for the same reason — it is the failure that
 * would put a green tick on the wrong till.
 */
const answerForCurrentRegister = (): OpeningReadinessPayload | null => {
	const answer = serverAnswer.value;
	const profile = currentProfile();
	if (!answer || !profile) return null;
	const asked = typeof answer.pos_profile === "string" ? answer.pos_profile.trim() : "";
	return asked === profile ? answer : null;
};

/**
 * Ask, then re-check — never the other way round.
 *
 * `refresh()` deliberately does NOT await this. The panel paints what the
 * register already knows the moment it opens, and the server's answer lands
 * over it, because a checklist that waits on the network is a checklist a
 * cashier watches instead of reads. Until it lands the rows say what they say
 * today: not verified.
 *
 * A refusal costs nothing further — it does not even re-evaluate, because
 * nothing changed. The identity check does the same for a repeat probe, so the
 * three prop changes that settle while one till is being opened cost one call
 * and one extra verdict between them.
 */
async function probeServer() {
	const profile = currentProfile();
	if (!profile) return;
	const answer = await serverAnswerFor(profile);
	if (!answer || serverAnswer.value === answer || profile !== currentProfile()) return;
	serverAnswer.value = answer;
	await refresh();
}

async function refresh() {
	const token = ++collectToken;
	let next: ReadinessVerdict;
	try {
		next = evaluateReadiness(
			await collectReadinessInput({
				company: props.company ?? null,
				posProfile: props.posProfile ?? null,
				paymentRows: props.paymentRows ?? null,
				server: answerForCurrentRegister(),
			}),
		);
	} catch {
		// A snapshot that could not be collected is ten unverified points, which
		// is honest and non-blocking. It is never a reason to stop the shop.
		next = evaluateReadiness({});
	}
	if (token !== collectToken) return;
	verdict.value = next;
	emit("verdict", next);
}

watch(() => [props.company, props.posProfile, props.paymentRows], () => {
	void probeServer();
	void refresh();
});
onMounted(() => {
	void probeServer();
	void refresh();
});
</script>

<style scoped>
/* No accent token appears in this file. See the header comment: the register's
 * one saturated colour belongs to the primary action, and these rows are
 * STATE. */
.opening-readiness {
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	background: var(--reg-surface, #ffffff);
	padding: 12px 14px;
	margin-bottom: 12px;
}

.opening-readiness__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 4px;
}

.opening-readiness__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.opening-readiness__motto {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.opening-readiness__list {
	list-style: none;
	margin: 0;
	padding: 0;
}

/* The artboard's three-column check row: number, body, trailing marker. */
.opening-readiness__row {
	display: grid;
	grid-template-columns: 26px 1fr auto;
	gap: 11px;
	align-items: start;
	padding: 8px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.opening-readiness__row:last-child {
	border-bottom: 0;
}

.opening-readiness__n {
	width: 22px;
	height: 22px;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 10.5px;
	font-weight: 700;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.opening-readiness__row--pass .opening-readiness__n {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-number, #157a48);
}

.opening-readiness__row--warn .opening-readiness__n {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-number, #8a5a0d);
}

.opening-readiness__row--stop .opening-readiness__n {
	background: var(--pos-error-container, #fdeaea);
	color: var(--pos-error, #e86674);
}

.opening-readiness__body {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.opening-readiness__title {
	font-size: 13.5px;
	font-weight: 500;
	color: var(--reg-text-primary, #212121);
}

.opening-readiness__detail {
	font-size: 11.5px;
	color: var(--reg-text-secondary, #56606e);
}

.opening-readiness__row--warn .opening-readiness__detail {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.opening-readiness__row--stop .opening-readiness__detail {
	color: var(--pos-error, #e86674);
}

.opening-readiness__chip {
	white-space: nowrap;
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	font-size: 11.5px;
	font-weight: 700;
	padding: 3px 9px;
	margin-top: 2px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.opening-readiness__chip--warn {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-heading, #a15200);
}

.opening-readiness__chip--stop {
	background: var(--pos-error-container, #fdeaea);
	color: var(--pos-error, #e86674);
}

/* The tick carries no pill — a verified point should read as quiet, not as a
 * badge competing with the ones that need attention. */
.opening-readiness__chip--pass {
	background: transparent;
	color: var(--reg-tone-positive-tick, #2e7d32);
	padding: 3px 0;
}

.opening-readiness__sr {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}

.opening-readiness__summary {
	margin: 10px 0 0;
	font-size: 12px;
	color: var(--reg-text-secondary, #56606e);
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}

.opening-readiness__count {
	font-weight: 700;
	color: var(--reg-tone-positive-number, #157a48);
}

.opening-readiness__note,
.opening-readiness__blocked {
	margin: 8px 0 0;
	padding: 10px 12px;
	border-radius: var(--reg-radius-sm, 10px);
	font-size: 12px;
	line-height: 1.5;
	background: var(--reg-surface-sunken, #f8f9fa);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	color: var(--reg-text-secondary, #56606e);
}

.opening-readiness__blocked {
	background: var(--pos-error-container, #fdeaea);
	border-color: var(--pos-error, #e86674);
	color: var(--pos-error, #e86674);
}
</style>
