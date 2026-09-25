<template>
	<!-- `--split` is a LAYOUT flag, not a state: it says the bags step exists, so
	     a wide count area can stand the two steps side by side instead of
	     leaving the column beside them empty while this one runs past the fold. -->
	<section
		v-if="phase !== 'off'"
		class="cash-closing"
		:class="{ 'cash-closing--split': Boolean(saved) || bags.length > 0 }"
		data-testid="cash-closing-allocation"
	>
		<!-- Until the register knows whether this drawer is under custody, the
		     closing screen is still drawing its own count: a second heading here
		     would be two count cards for as long as the check takes. -->
		<p v-if="phase === 'checking'" class="cash-closing__muted" role="status">
			{{ __("Loading…") }}
		</p>

		<!-- The check FAILED, which is not the same as custody being off: the
		     server would refuse the close with the cash still in the drawer. Say
		     so, and offer the retry rather than a dead end. -->
		<div v-else-if="phase === 'unavailable'" class="cash-closing__alert" role="alert">
			<span>{{ __("Cash custody could not be checked. Retry before closing.") }}</span>
			<button type="button" class="cash-closing__retry" @click="check">{{ __("Retry") }}</button>
		</div>

		<template v-else>
			<header class="cash-closing__head">
				<h3>{{ __("Count and return the drawer") }}</h3>
				<p class="cash-closing__lede">
					{{
						__(
							"Save the count, then allocate all cash to sealed bags. Closing records the count and returns those bags to the safe together.",
						)
					}}
				</p>
			</header>

			<!-- ---- 1. the count ------------------------------------------- -->
			<section
				class="cash-closing__step cash-closing__step--count"
				data-testid="cash-closing-count"
			>
				<h4 class="cash-closing__step-title">{{ __("Count the drawer") }}</h4>

				<div v-if="draftError" class="cash-closing__alert" role="alert">
					<span>{{ draftError }}</span>
					<button type="button" class="cash-closing__retry" @click="restore">
						{{ __("Retry") }}
					</button>
				</div>

				<!-- The register holds a count this screen cannot simply write over.
				     Both figures are shown first; neither side is adopted until the
				     cashier picks one, and nothing is sent until they save. -->
				<div
					v-if="conflict"
					class="cash-closing__alert cash-closing__alert--stack"
					role="alert"
					data-testid="cash-closing-conflict"
				>
					<p class="cash-closing__conflict-title">{{ conflictTitle }}</p>
					<p class="cash-closing__hint">{{ conflictDetail }}</p>

					<dl class="cash-closing__compare">
						<div>
							<dt>{{ __("Your count on this screen") }}</dt>
							<dd class="reg-mono" data-money-role="local-count">{{ money(counted) }}</dd>
						</div>
						<div v-if="conflict.server">
							<dt>{{ __("The register's count") }}</dt>
							<dd class="reg-mono" data-money-role="server-count">
								{{ money(conflict.server.amount) }} · {{ stamp(conflict.server.modified) }}
							</dd>
						</div>
					</dl>

					<!-- An unconfirmed save replays the instructions already sent, so it
					     decides the register's version. Choosing first would be choosing
					     against a count nobody has read yet. -->
					<p v-if="pending" class="cash-closing__hint cash-closing__hint--warn">
						{{ __("Retry the unconfirmed cash action before choosing how to continue.") }}
					</p>

					<div class="cash-closing__conflict-actions">
						<button
							v-if="conflict.server?.count"
							type="button"
							class="cash-closing__retry"
							data-testid="cash-closing-load-server"
							:disabled="busy || Boolean(pending)"
							@click="loadServerCount"
						>
							{{ __("Load the register's count") }}
						</button>
						<button
							type="button"
							class="cash-closing__retry"
							data-testid="cash-closing-keep-local"
							:disabled="busy || Boolean(pending)"
							@click="keepLocalCount"
						>
							{{ conflictKeepLabel }}
						</button>
					</div>

					<p v-if="conflict.server?.count" class="cash-closing__hint">
						{{ __("Loading replaces the count and note on this screen. Your bags stay as they are.") }}
					</p>
				</div>

				<CashCountEditor v-model="count" :currency="currency" />

				<div v-if="showsExpected" class="cash-closing__figures">
					<div class="cash-closing__figure">
						<span>{{ __("Expected in drawer") }}</span>
						<span class="reg-mono" data-money-role="expected">{{ money(expectedAmount) }}</span>
					</div>
					<div
						class="cash-closing__figure"
						:class="{ 'cash-closing__figure--warn': difference !== 0 }"
					>
						<span>{{ __("Difference") }}</span>
						<span
							class="reg-mono"
							data-testid="cash-closing-difference"
							data-money-role="difference"
						>
							{{ money(difference) }}
						</span>
					</div>
				</div>

				<label class="cash-closing__field" :for="ids.note">
					<span>{{ __("Difference / handover note") }}</span>
					<textarea
						:id="ids.note"
						v-model="note"
						rows="2"
						maxlength="1000"
						data-testid="cash-closing-note"
						:aria-describedby="ids.noteHint"
					/>
				</label>
				<p
					:id="ids.noteHint"
					class="cash-closing__hint"
					:class="{ 'cash-closing__hint--warn': noteMissing }"
				>
					{{ __("A handover note is required for a blind count or when counted cash differs from the expected amount.") }}
				</p>

				<!-- A save whose answer never arrived. Replaying the SAVED request
				     returns its original result; sending different instructions
				     under the same key is what `api.command()` refuses. -->
				<div
					v-if="pending"
					class="cash-closing__alert"
					role="alert"
					data-testid="cash-closing-pending"
				>
					<span>
						{{
							__(
								"A cash action has an unconfirmed result. Retry it before moving the money again.",
							)
						}}
					</span>
					<button type="button" class="cash-closing__retry" :disabled="busy" @click="retryPending">
						{{ __("Retry unconfirmed action") }}
					</button>
				</div>

				<div class="cash-closing__save">
					<button
						type="button"
						class="cash-closing__action"
						data-testid="cash-closing-save"
						:disabled="busy || Boolean(pending) || Boolean(conflict) || !contextRead"
						@click="saveCount"
					>
						{{ busy ? __("Saving…") : __("Save drawer count") }}
					</button>
					<p v-if="saved" class="cash-closing__saved" data-testid="cash-closing-saved">
						<span
							class="cash-closing__chip"
							:class="dirty ? 'cash-closing__chip--warn' : 'cash-closing__chip--ok'"
						>
							{{ dirty ? __("Unsaved changes") : __("Saved") }}
						</span>
						{{ __("Saved count") }}: {{ saved.cash_count }}
					</p>
					<p v-else class="cash-closing__hint">
						{{ __("Save the drawer count before allocating the bags.") }}
					</p>
				</div>

				<div v-if="error" class="cash-closing__alert" role="alert" data-testid="cash-closing-error">
					<span>{{ error }}</span>
					<!-- Not while a conflict is open: the same instructions would be
					     refused by the same server rule, which is the loop this screen
					     exists to end. -->
					<button
						v-if="!pending && !conflict"
						type="button"
						class="cash-closing__retry"
						:disabled="busy"
						@click="saveCount"
					>
						{{ __("Retry") }}
					</button>
				</div>
			</section>

			<!-- ---- 2. the bags ---------------------------------------------
			     Hidden until there is a saved count to divide: the server
			     compares the bag totals against the SAVED count, so allocating
			     before that is allocating against a figure nobody agreed on. -->
			<section
				v-if="saved || bags.length"
				class="cash-closing__step cash-closing__step--bags"
				data-testid="cash-closing-bags"
			>
				<h4 class="cash-closing__step-title">{{ __("Bags going into the safe") }}</h4>
				<p class="cash-closing__hint" data-testid="cash-closing-bags-help">
					{{
						__(
							"Put all the counted cash into sealed bags. A float bag waits in the safe to start a drawer; a takings bag is sent to the bank.",
						)
					}}
				</p>

				<p class="cash-closing__meter" data-testid="cash-closing-remaining">
					<span>{{ __("Allocated") }}</span>
					<span class="reg-mono" data-money-role="allocated">
						{{ money(allocated) }} / {{ money(counted) }}
					</span>
					<span
						v-if="remaining !== 0"
						class="cash-closing__chip cash-closing__chip--warn"
						data-testid="cash-closing-remaining-chip"
					>
						{{
							remaining > 0
								? __("Remaining {0}", [money(remaining)])
								: __("Over by {0}", [money(-remaining)])
						}}
					</span>
					<span v-else class="cash-closing__chip cash-closing__chip--ok">{{
						__("Fully allocated")
					}}</span>
				</p>

				<article v-for="(bag, index) in bags" :key="bag.uid" class="cash-closing__bag">
					<div class="cash-closing__bag-head">
						<label
							class="cash-closing__field cash-closing__field--seal"
							:for="`${ids.bag}-${bag.uid}`"
						>
							<span>{{ __("Bag seal / ID") }}</span>
							<input
								:id="`${ids.bag}-${bag.uid}`"
								v-model="bag.seal"
								maxlength="80"
								autocomplete="off"
								spellcheck="false"
								:aria-invalid="sealProblem(index) ? 'true' : 'false'"
								:aria-describedby="`${ids.bag}-${bag.uid}-hint`"
							/>
						</label>
						<label class="cash-closing__field" :for="`${ids.purpose}-${bag.uid}`">
							<span>{{ __("Purpose") }}</span>
							<select :id="`${ids.purpose}-${bag.uid}`" v-model="bag.purpose">
								<option value="Float">{{ __("Float for the next drawer") }}</option>
								<option value="Takings">{{ __("Takings for the bank") }}</option>
							</select>
						</label>
					</div>
					<p
						:id="`${ids.bag}-${bag.uid}-hint`"
						class="cash-closing__hint"
						:class="{ 'cash-closing__hint--warn': sealProblem(index) }"
					>
						{{
							sealProblem(index) ||
							__("Write this seal on the physical bag. Each bag keeps its own unique seal.")
						}}
					</p>

					<div class="cash-closing__bag-amount">
						<span class="cash-closing__bag-label">{{ __("Cash in this bag") }}</span>
						<span
							class="cash-closing__bag-value reg-mono"
							:class="{ 'cash-closing__bag-value--warn': cash(bag.count) <= 0 }"
							data-money-role="bag"
						>
							{{ money(cash(bag.count)) }}
						</span>
					</div>

					<div class="cash-closing__bag-actions">
						<button
							v-if="remaining > 0"
							type="button"
							class="cash-closing__action cash-closing__action--quiet"
							data-testid="cash-closing-fill"
							:disabled="!canFill(index)"
							@click="fillRemaining(index)"
						>
							{{ __("Put the remaining cash in this bag") }}
						</button>
						<button
							type="button"
							class="cash-closing__link"
							:aria-expanded="isOpen(bag.uid) ? 'true' : 'false'"
							@click="toggleBag(bag.uid)"
						>
							{{ isOpen(bag.uid) ? __("Hide the bag count") : __("Edit denomination count") }}
						</button>
						<!-- Several bags carry the same three buttons; the seal is what
						     tells them apart to a screen reader. -->
						<button
							type="button"
							class="cash-closing__link cash-closing__link--remove"
							:aria-label="[__('Remove bag'), sealOf(bag)].filter(Boolean).join(' ')"
							@click="removeBag(index)"
						>
							{{ __("Remove bag") }}
						</button>
					</div>

					<CashCountEditor
						v-show="isOpen(bag.uid)"
						v-model="bag.count"
						:currency="currency"
						:title="__('Cash in this bag')"
					/>
				</article>

				<button
					type="button"
					class="cash-closing__action cash-closing__action--quiet"
					data-testid="cash-closing-add-bag"
					:disabled="bags.length >= MAX_BAGS"
					@click="addBag"
				>
					{{ __("Add another bag") }}
				</button>
				<p v-if="bags.length >= MAX_BAGS" class="cash-closing__hint">
					{{ __("A closing can return at most 20 bags.") }}
				</p>
			</section>

			<!-- ---- 3. what is left before the shift can close --------------- -->
			<p v-if="ready" class="cash-closing__ready" role="status" data-testid="cash-closing-ready">
				{{
					__(
						"Count saved and bags allocated. Complete the payment reconciliation and close the shift.",
					)
				}}
			</p>
			<div v-else class="cash-closing__todo" data-testid="cash-closing-todo">
				<p class="cash-closing__hint">
					{{ __("Save the current count and allocate its exact total before closing.") }}
				</p>
				<ul>
					<li v-for="item in blockers" :key="item">{{ item }}</li>
				</ul>
			</div>

			<p
				v-if="storageWarning"
				class="cash-closing__hint cash-closing__hint--warn cash-closing__storage"
				role="status"
			>
				{{ storageWarning }}
			</p>
		</template>
	</section>
</template>

<script setup lang="ts">
/**
 * Counting the drawer at close, and dividing it into the bags that go back to
 * the safe (docs/POS-CASH-CUSTODY.md → "Shop setup and daily operation" §4).
 *
 * The contract with `ClosingDialog.vue` is unchanged: `enabled` decides whether
 * the register draws its own drawer count, `counted` writes the cash row,
 * `note` feeds the closing note, and `prepared` is either null or the exact
 * payload `finalize_drawer()` expects — `{cash_count, modified, bags, note}`.
 * The parent's `canSubmit` is `Boolean(cash_custody)`, so emitting the payload
 * IS the claim that this screen is finished; everything below exists to make
 * that claim true before the cashier reaches the band.
 *
 * The server owns the money. `finalize_drawer` refuses a bag total that is not
 * exactly the saved count, a non-positive bag, a seal outside
 * `[A-Za-z0-9_-]{3,80}` (unique across the whole site), a stale `modified`, and
 * a missing reason for a variance. None of that is relaxed here — this screen
 * only makes each refusal visible while the cash is still in the cashier's
 * hands, instead of after they pressed «Close shift».
 */
import { computed, onMounted, ref, watch } from "vue";

import CashCountEditor from "./CashCountEditor.vue";
import { amount, command, emptyCount, pendingActions, read } from "./api";

const props = defineProps<{
	profile: string;
	opening: string;
	currency: string;
	/**
	 * Expected cash for this shift, when the closing screen knows it. Optional:
	 * a profile with `hide_expected_amount` deliberately withholds it, and a
	 * blind count must still be able to close. Given it, this screen can gate
	 * the variance note the server will otherwise refuse at the last step.
	 */
	expected?: number | null;
}>();
const emit = defineEmits(["enabled", "prepared", "counted", "note"]);

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = (window as any).__;
	const translated = translate ? translate(text, args as any[]) : text;
	if (!args || !args.length) return translated || text;
	return String(translated || text).replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const MAX_BAGS = 20;
/** `new_bag()`'s own rule, so the message can name it before the server does. */
const SEAL = /^[A-Za-z0-9_-]{3,80}$/;

interface Bag {
	uid: string;
	seal: string;
	/** `Float` or `Takings`; `new_bag()` refuses anything else. */
	purpose: string;
	count: any;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const ids = {
	note: `cc-note-${uid()}`,
	noteHint: `cc-note-hint-${uid()}`,
	bag: `cc-bag-${uid()}`,
	purpose: `cc-purpose-${uid()}`,
};

/**
 * The register's own copy of this drawer count, as `context()` reports it.
 * `count` is null when the stored JSON cannot be read — the version still
 * exists and still owns the row, it just cannot be loaded into the editor.
 */
interface ServerCount {
	name: string;
	modified: string;
	amount: number;
	state: string;
	note: string;
	count: any | null;
}

/**
 * Why this screen cannot save as it stands.
 *
 * - `newer` — the register's draft moved on; our `modified` is stale and every
 *   save with it is refused.
 * - `draft` — the register holds a draft this screen never saved, and there is
 *   local work that adopting it would discard.
 * - `finalized` — the count was completed; it cannot be edited again.
 * - `missing` — the register has no such count any more.
 */
type Conflict = { kind: "newer" | "draft" | "finalized" | "missing"; server: ServerCount | null };

const phase = ref<"checking" | "off" | "unavailable" | "on">("checking");
const error = ref("");
const draftError = ref("");
/** Cleared by any failed context read: an unverified count is not a ready one. */
const contextRead = ref(false);
const conflict = ref<Conflict | null>(null);
/** The cache seeds this screen once. A later retry must not undo live edits. */
const hydrated = ref(false);
const storageWarning = ref("");
const busy = ref(false);
const count = ref<any>(emptyCount());
const bags = ref<Bag[]>([]);
const note = ref("");
const saved = ref<any>(null);
const savedSignature = ref("");
const openBags = ref<string[]>([]);
const knownSeals = ref<Set<string>>(new Set());
const pendingError = ref("");
const pending = ref<{ action: string; payload: any } | null>(null);

const key = `cash-closing:${(window as any).frappe?.session?.user}:${props.profile}:${props.opening}`;

const money = (value: number) => {
	const number = Number(value) || 0;
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: props.currency || "MXN",
			minimumFractionDigits: 2,
		}).format(number);
	} catch {
		return `${props.currency || ""} ${number.toFixed(2)}`.trim();
	}
};

/** A server timestamp as a cashier reads it: to the minute, no microseconds. */
const stamp = (value: string) => String(value || "").replace("T", " ").slice(0, 16);

/** `api.amount()` is the shared derivation; this only refuses to emit a NaN. */
const cash = (value: any) => {
	const total = Number(amount(value || emptyCount()));
	return Number.isFinite(total) ? total : 0;
};
const cents = (value: number) => Math.round((Number(value) || 0) * 100);

/**
 * What makes two counts the same count.
 *
 * Not `JSON.stringify`: a saved draft comes back from the server carrying
 * `derived_minor`/`total_minor` and a numeric `amount`, and a row re-entered at
 * the same quantity lands in a different position in the array. Comparing the
 * raw text reported "unsaved changes" for both, which trains a cashier to press
 * Save again and makes the badge meaningless when it is real.
 */
const signature = (value: any) => {
	if (!value || typeof value !== "object") return "";
	const manual = value.source === "manual";
	const rows = (Array.isArray(value.denominations) ? value.denominations : [])
		.map((row: any) => ({ v: cents(row?.value), q: Math.trunc(Number(row?.quantity) || 0) }))
		.filter((row: any) => row.v > 0 && row.q > 0)
		.sort((a: any, b: any) => b.v - a.v);
	return JSON.stringify({
		manual,
		rows,
		amount: manual ? cents(value.amount) : null,
		reason: manual ? String(value.reason || "").trim() : "",
	});
};

/**
 * A count reduced to the four fields `model.count()` reads, and to rows it
 * accepts. A draft restored from the server also carries `derived_minor` /
 * `total_minor`, and copying those into a bag would send the server back its
 * own derived figures as if they were an instruction.
 */
const cleanCount = (value: any) => ({
	source: value?.source === "manual" ? "manual" : "denominations",
	denominations: (Array.isArray(value?.denominations) ? value.denominations : [])
		.map((row: any) => ({ value: Number(row?.value), quantity: Math.trunc(Number(row?.quantity) || 0) }))
		.filter((row: any) => Number.isFinite(row.value) && row.value > 0 && row.quantity > 0)
		.sort((a: any, b: any) => b.value - a.value),
	reason: String(value?.reason || ""),
	amount: value?.amount ?? "",
});

const counted = computed(() => cash(count.value));
const dirty = computed(() => savedSignature.value !== signature(count.value));
const allocated = computed(() => bags.value.reduce((sum, bag) => sum + cents(cash(bag.count)), 0) / 100);
const remaining = computed(() => (cents(counted.value) - cents(allocated.value)) / 100);

const showsExpected = computed(
	() => props.expected !== null && props.expected !== undefined && Number.isFinite(Number(props.expected)),
);
const expectedAmount = computed(() => Number(props.expected) || 0);
const difference = computed(() =>
	showsExpected.value ? (cents(counted.value) - cents(expectedAmount.value)) / 100 : 0,
);
const noteMissing = computed(() =>
	(!showsExpected.value || difference.value !== 0) && note.value.trim().length < 8,
);

const isManual = computed(() => count.value?.source === "manual");
const manualAmountInvalid = computed(
	() => isManual.value && !/^\d+(\.\d{1,2})?$/.test(String(count.value?.amount ?? "").trim()),
);
const manualReasonInvalid = computed(
	() => isManual.value && String(count.value?.reason || "").trim().length < 8,
);

const sealOf = (bag?: Bag) => String(bag?.seal || "").trim();

/** The one refusal a cashier cannot see coming: seals are unique across the site. */
const sealProblem = (index: number) => {
	const bag = bags.value[index];
	const seal = sealOf(bag);
	if (!seal) return "";
	if (!SEAL.test(seal)) return __("Use 3 to 80 letters, digits, hyphens or underscores.");
	const lower = seal.toLowerCase();
	if (bags.value.some((other, i) => i !== index && sealOf(other).toLowerCase() === lower))
		return __("Each bag needs its own seal.");
	if (knownSeals.value.has(lower)) return __("This seal already belongs to another bag.");
	return "";
};

const sealsValid = computed(() =>
	bags.value.every((bag, index) => SEAL.test(sealOf(bag)) && !sealProblem(index)),
);

const conflictTitle = computed(() => {
	switch (conflict.value?.kind) {
		case "draft":
			return __("The register already holds a saved count for this shift.");
		case "finalized":
			return __("This count was already completed on the register.");
		case "missing":
			return __("The register no longer holds your saved count.");
		default:
			return __("This drawer count changed on the register.");
	}
});

const conflictDetail = computed(() =>
	conflict.value?.server && conflict.value.server.state === "Draft"
		? __("Review both counts, then choose which one to keep. Nothing is sent until you save.")
		: __("Keeping your count starts a new count. Nothing already recorded is overwritten."),
);

const conflictKeepLabel = computed(() =>
	conflict.value?.server && conflict.value.server.state === "Draft"
		? __("Keep my count and save it over that version")
		: __("Keep my count as a new count"),
);

/** Everything still standing between this screen and a close, in order. */
const blockers = computed(() => {
	const list: string[] = [];
	// The count's standing with the register comes first: nothing below it is
	// worth reading while this screen and the server disagree about the money.
	if (conflict.value) list.push(__("Reconcile this drawer count with the register before closing."));
	if (draftError.value)
		list.push(__("Your saved count could not be checked with the register. Retry before closing."));
	else if (!contextRead.value) list.push(__("Checking this drawer count with the register…"));
	if (pendingError.value) list.push(pendingError.value);
	if (manualAmountInvalid.value) list.push(__("Enter an amount with at most two decimals."));
	if (manualReasonInvalid.value)
		list.push(__("Explain the manual count override (at least 8 characters)."));
	if (noteMissing.value) list.push(__("Add a note explaining the cash difference before closing."));
	if (pending.value)
		list.push(__("A cash action has an unconfirmed result. Retry it before moving the money again."));
	if (!saved.value || dirty.value) list.push(__("Save the drawer count."));
	if (remaining.value > 0) list.push(__("Allocate the remaining {0}.", [money(remaining.value)]));
	if (remaining.value < 0)
		list.push(__("The bags hold {0} more than the counted cash.", [money(-remaining.value)]));
	if (bags.value.some((bag) => cash(bag.count) <= 0)) list.push(__("Every bag must hold more than zero."));
	if (!sealsValid.value) list.push(__("Give every bag its own seal."));
	return list;
});

const ready = computed(
	() =>
		Boolean(saved.value) &&
		!dirty.value &&
		// The save returned the server's own parse of this count; a drift here
		// would mean the payload claims a total the count no longer has.
		cents(saved.value.amount) === cents(counted.value) &&
		!blockers.value.length,
);

const preparedPayload = computed(() =>
	ready.value
		? {
				cash_count: saved.value.cash_count,
				modified: saved.value.modified,
				// A snapshot, not the live rows: the parent holds this until it
				// submits, and a later keystroke must not edit money in flight.
				bags: bags.value.map((bag) => ({
					seal: sealOf(bag),
					purpose: bag.purpose,
					count: cleanCount(bag.count),
				})),
				note: note.value,
			}
		: null,
);

// ---- bag editing -----------------------------------------------------------

const isOpen = (id: string) => openBags.value.includes(id);
const toggleBag = (id: string) =>
	(openBags.value = isOpen(id) ? openBags.value.filter((other) => other !== id) : [...openBags.value, id]);

const newBag = (purpose = "Float", source: any = null): Bag => ({
	uid: uid(),
	seal: "",
	purpose,
	count: source ? cleanCount(source) : emptyCount(),
});

function addBag() {
	if (bags.value.length >= MAX_BAGS) return;
	const bag = newBag(bags.value.length ? "Float" : "Takings");
	bags.value = [...bags.value, bag];
	openBags.value = [...openBags.value, bag.uid];
}

function removeBag(index: number) {
	const [removed] = bags.value.splice(index, 1);
	if (removed) openBags.value = openBags.value.filter((id) => id !== removed.uid);
}

/**
 * Per-face remainder of the drawer count, after every OTHER bag.
 *
 * The server only checks totals, but filling a bag with notes the drawer does
 * not hold would hand the next custodian a count they cannot verify. Negative
 * anywhere means the bags already disagree with the count, and the action is
 * refused rather than silently rounded.
 */
const remainderRows = (index: number) => {
	if (
		isManual.value ||
		bags.value.some((bag, i) => i !== index && bag.count?.source === "manual" && cash(bag.count) > 0)
	)
		return null;
	const wanted = new Map<number, number>();
	for (const row of count.value?.denominations || [])
		wanted.set(
			cents(row?.value),
			(wanted.get(cents(row?.value)) || 0) + Math.trunc(Number(row?.quantity) || 0),
		);
	bags.value.forEach((bag, i) => {
		if (i === index || bag.count?.source === "manual") return;
		for (const row of bag.count?.denominations || [])
			wanted.set(
				cents(row?.value),
				(wanted.get(cents(row?.value)) || 0) - Math.trunc(Number(row?.quantity) || 0),
			);
	});
	const rows = [...wanted.entries()]
		.filter(([, quantity]) => quantity !== 0)
		.map(([value, quantity]) => ({ value: value / 100, quantity }))
		.sort((a, b) => b.value - a.value);
	return rows.some((row) => row.quantity < 0) ? null : rows;
};

const canFill = (index: number) => {
	const bag = bags.value[index];
	if (!bag || remaining.value <= 0) return false;
	// A manual drawer total cannot be denominated, so the bag inherits the
	// override and its reason — which the count already proved is long enough.
	if (isManual.value) return !manualAmountInvalid.value && !manualReasonInvalid.value;
	if (!remainderRows(index)) return false;
	// Only when the bag is empty or already denominated: filling would otherwise
	// discard a hand-typed bag total nobody asked to replace.
	return bag.count?.source !== "manual" || cash(bag.count) === 0;
};

function fillRemaining(index: number) {
	const bag = bags.value[index];
	if (!bag || !canFill(index)) return;
	if (isManual.value) {
		bag.count = {
			source: "manual",
			denominations: [],
			amount: (cents(cash(bag.count)) + cents(remaining.value)) / 100,
			reason: String(count.value.reason || "").trim(),
		};
		return;
	}
	const rows = remainderRows(index);
	if (!rows) return;
	bag.count = { source: "denominations", denominations: rows, reason: "", amount: "" };
}

// ---- persistence -----------------------------------------------------------

const isCount = (value: any) =>
	Boolean(value) &&
	typeof value === "object" &&
	(value.source === "manual" || value.source === "denominations") &&
	Array.isArray(value.denominations);

function readCache() {
	try {
		const cached = JSON.parse(localStorage.getItem(key) || "null");
		if (!cached || !isCount(cached.count)) return null;
		return cached;
	} catch {
		// A corrupt entry is not a reason to lose the server's draft below.
		return null;
	}
}

function applyCache(cached: any) {
	count.value = cached.count;
	bags.value = (Array.isArray(cached.bags) ? cached.bags : [])
		.filter((bag: any) => bag && typeof bag === "object" && isCount(bag.count))
		.map((bag: any) => ({
			uid: String(bag.uid || uid()),
			seal: String(bag.seal || ""),
			purpose: bag.purpose === "Float" ? "Float" : "Takings",
			count: bag.count,
		}));
	note.value = typeof cached.note === "string" ? cached.note : "";
	saved.value = cached.saved && cached.saved.cash_count ? cached.saved : null;
	// `savedBody` is the pre-signature cache shape; recompute rather than
	// discard, so an upgrade mid-shift does not report a saved count as unsaved.
	if (typeof cached.savedSignature === "string") savedSignature.value = cached.savedSignature;
	else
		try {
			savedSignature.value = cached.savedBody ? signature(JSON.parse(cached.savedBody)) : "";
		} catch {
			// Worst case the count reads as unsaved and is saved again, which
			// optimistic concurrency handles. Losing it is not on the table.
			savedSignature.value = "";
		}
}

/**
 * A `save_drawer` whose answer never arrived.
 *
 * `api.command()` keeps the request ID so a replay returns the original result
 * instead of writing twice — but it also refuses DIFFERENT instructions under
 * the same key, which without this affordance is a loop: the cashier corrects
 * the count, presses Save, and gets the refusal again with nowhere to go.
 */
function refreshPending() {
	pendingError.value = "";
	try {
		pending.value =
			pendingActions(props.profile).find(
				(entry) => entry.action === "save_drawer" && entry.payload?.opening_shift === props.opening,
			) || null;
	} catch (exception: any) {
		pending.value = null;
		pendingError.value = exception.message;
	}
}

async function retryPending() {
	const entry = pending.value;
	if (!entry || busy.value) return;
	busy.value = true;
	error.value = "";
	try {
		const response = await command("save_drawer", entry.payload);
		saved.value = response;
		// The replay saved the count as it was SENT. If the cashier has edited
		// since, this correctly reads as unsaved rather than claiming the new
		// figures reached the server.
		savedSignature.value = signature(entry.payload.count);
	} catch (exception: any) {
		error.value = exception?.message || __("The drawer count could not be saved.");
	} finally {
		busy.value = false;
		refreshPending();
	}
}

watch(
	[count, bags, note, saved, savedSignature],
	() => {
		if (phase.value !== "on") return;
		try {
			localStorage.setItem(
				key,
				JSON.stringify({
					count: count.value,
					bags: bags.value,
					note: note.value,
					saved: saved.value,
					savedSignature: savedSignature.value,
				}),
			);
			storageWarning.value = "";
		} catch {
			// Counted work is still in memory and still savable to the server —
			// this only warns that leaving the screen would lose it.
			storageWarning.value = __(
				"Browser storage is unavailable. Save the drawer count before leaving this screen.",
			);
		}
	},
	{ deep: true },
);

watch(counted, (value) => emit("counted", value), { immediate: true });
// Not immediate: the closing screen seeds its note from the shift document, and
// announcing an empty one at mount would erase it before this screen has read
// anything back.
watch(note, (value) => emit("note", value));
// Immediate, because a restored cache can already be complete — the payload IS
// the parent's permission to close, and it must not wait for a keystroke.
watch(preparedPayload, (payload) => emit("prepared", payload), { immediate: true });

// ---- the server ------------------------------------------------------------

async function saveCount() {
	// A conflict means the identity this save would carry is not the register's
	// any more. Sending it again earns the same refusal, which is the loop.
	if (busy.value || pending.value || pendingError.value || conflict.value || !contextRead.value) return;
	const sentCount = JSON.parse(JSON.stringify(count.value));
	let refused = false;
	busy.value = true;
	error.value = "";
	try {
		const response = await command("save_drawer", {
			pos_profile: props.profile,
			opening_shift: props.opening,
			count: sentCount,
			note: note.value,
			...(saved.value ? { cash_count: saved.value.cash_count, modified: saved.value.modified } : {}),
		});
		saved.value = response;
		savedSignature.value = signature(sentCount);
		// The first save offers the whole drawer as one takings bag, which is
		// the common close; splitting off a float is then one more bag.
		if (!bags.value.length && cash(sentCount) > 0 && !dirty.value)
			bags.value = [newBag("Takings", sentCount)];
	} catch (exception: any) {
		// Never clears the count: a refused save leaves the cashier's work
		// exactly where it was, including the draft already on the server.
		error.value = exception?.message || __("The drawer count could not be saved.");
		refused = true;
	} finally {
		busy.value = false;
		refreshPending();
	}
	// A refusal usually means the register moved on. Read it back so the reason
	// is on screen with a way out, instead of a Retry that refuses identically.
	// Not while a request is unconfirmed: its replay decides that version first.
	if (refused && !pending.value) await restore();
}

/** A `POS Cash Count` row from `context()`, in this screen's own terms. */
const serverCount = (row: any): ServerCount => {
	let parsed: any = null;
	try {
		parsed = JSON.parse(row?.count_json);
	} catch {
		// Unreadable evidence is still evidence that the row exists; it just
		// cannot be offered as something to load.
		parsed = null;
	}
	return {
		name: String(row?.name || ""),
		modified: String(row?.modified || ""),
		amount: Number(row?.amount) || 0,
		state: String(row?.state || ""),
		note: String(row?.note || ""),
		count: isCount(parsed) ? cleanCount(parsed) : null,
	};
};

/** Anything the cashier would lose if a server version were adopted silently. */
const hasLocalWork = () =>
	Boolean(saved.value) ||
	bags.value.length > 0 ||
	note.value.trim().length > 0 ||
	signature(count.value) !== signature(emptyCount());

function adopt(row: ServerCount) {
	count.value = row.count;
	savedSignature.value = signature(count.value);
	saved.value = { cash_count: row.name, modified: row.modified, amount: row.amount };
	note.value = row.note;
}

/**
 * Compare what this screen believes it saved with what the register actually
 * holds, and decide only ONE thing: whether the cashier has to choose.
 *
 * Nothing here rewrites a count that took work to produce. Adopting the
 * register's draft happens in exactly one case — an untouched screen, where
 * there is nothing to lose — and every other disagreement becomes a conflict
 * the cashier resolves deliberately. In particular a stale `modified` is never
 * quietly replaced with the server's: that would make the next save write over
 * a version nobody read.
 */
function reconcile(context: any) {
	const user = (window as any).frappe?.session?.user;
	const rows = (Array.isArray(context?.counts) ? context.counts : []).filter(
		(row: any) =>
			row &&
			row.scope === "Drawer" &&
			row.opening_shift === props.opening &&
			row.counted_by === user,
	);
	// `context()` orders by `modified desc`, so the first draft is the live one.
	const draftRow = rows.find((row: any) => row.state === "Draft");
	const draft = draftRow ? serverCount(draftRow) : null;
	const mineRow = saved.value ? rows.find((row: any) => row.name === saved.value.cash_count) : null;

	if (!saved.value) {
		if (!draft) {
			conflict.value = null;
			return;
		}
		if (!hasLocalWork() && draft.count) {
			adopt(draft);
			conflict.value = null;
			return;
		}
		conflict.value = { kind: "draft", server: draft };
		return;
	}

	if (mineRow && mineRow.state === "Draft") {
		conflict.value =
			String(mineRow.modified) === String(saved.value.modified)
				? null
				: { kind: "newer", server: serverCount(mineRow) };
		return;
	}
	// Completed, cancelled or gone: either way the saved identity is spent, and
	// saving against it would be refused for as long as the cashier retried.
	if (mineRow) {
		conflict.value = { kind: "finalized", server: serverCount(mineRow) };
		return;
	}
	conflict.value = draft ? { kind: "newer", server: draft } : { kind: "missing", server: null };
}

/** Take the register's version, with the cashier looking at both figures. */
function loadServerCount() {
	const row = conflict.value?.server;
	if (!row || !row.count || busy.value || pending.value) return;
	if (row.state === "Draft") adopt(row);
	else {
		// A completed count cannot be edited; its figures start a fresh draft.
		count.value = row.count;
		note.value = row.note;
		saved.value = null;
		savedSignature.value = "";
	}
	conflict.value = null;
}

/**
 * Keep the count in front of the cashier, now that they have seen the other one.
 *
 * For a live draft this takes over the register's row AND its timestamp, which
 * is what ends the refusal loop — but only as a reviewed decision, never as a
 * silent rebase. The signature is deliberately left empty so the badge still
 * reads «Unsaved changes» and the money only moves when Save is pressed.
 */
function keepLocalCount() {
	const row = conflict.value?.server;
	if (busy.value || pending.value) return;
	saved.value =
		row && row.state === "Draft"
			? { cash_count: row.name, modified: row.modified, amount: row.amount }
			: null;
	savedSignature.value = "";
	conflict.value = null;
}

/**
 * Restore what this cashier already counted, then check it against the register.
 *
 * The local copy seeds the screen once, because it is the only place an unsaved
 * count lives. It is never treated as proof of what the server holds: the
 * context read happens every time — it carries the seals already in use and the
 * state of this shift's counts — and its failure blocks readiness rather than
 * letting a cached «Saved» badge speak for the register.
 */
async function restore() {
	contextRead.value = false;
	if (!hydrated.value) {
		hydrated.value = true;
		const cached = readCache();
		if (cached) applyCache(cached);
	}
	refreshPending();
	draftError.value = "";
	try {
		const context = await read("context", { pos_profile: props.profile });
		knownSeals.value = new Set(
			(context.bags || [])
				.map((bag: any) =>
					String(bag.seal || "")
						.trim()
						.toLowerCase(),
				)
				.filter(Boolean),
		);
		reconcile(context);
		contextRead.value = true;
	} catch (exception: any) {
		// Whatever was counted stays exactly where it is; what is lost is the
		// right to claim this count agrees with the register.
		contextRead.value = false;
		draftError.value =
			exception?.message || __("Your saved count could not be loaded. Retry before you count again.");
	}
}

async function check() {
	phase.value = "checking";
	try {
		const enabled = Boolean((await read("availability", { pos_profile: props.profile })).enabled);
		phase.value = enabled ? "on" : "off";
		emit("enabled", enabled);
		if (enabled) await restore();
	} catch {
		phase.value = "unavailable";
		emit("enabled", false);
	}
}

onMounted(check);
</script>

<style scoped>
/* Register tokens with fallbacks, the pattern `DrawerCount.vue` set. The one
   saturated accent on this screen belongs to the band's «Close shift»; the save
   action here wears the pale accent wash instead (§17.7). */
.cash-closing {
	display: grid;
	gap: 14px;
	align-content: start;
	padding: 2px;
	min-inline-size: 0;
}

/*
 * Count BESIDE the bags it is divided into, once the closing screen gives this
 * workspace a wide enough area (`corte-count`, declared by `ClosingDialog`).
 *
 * The one column ran the drawer form — thirteen denomination rows, the figures,
 * the note, the save, then the bags — past the fold while the evidence column
 * beside it stood empty (live capture 2026-09-15). The query reads the AREA,
 * not the window: this screen is ~690px inside the destination host and the
 * full body width in the floating dialog, and the window cannot tell them apart.
 * 686px is the floor for the pair — a denomination row is `58 + 146 + 76` with
 * its gaps, and below that floor the subtotal leaves the card.
 *
 * Only once the bags step exists. Before the first save this workspace is one
 * column on purpose — the count card spreads its own rows across the width.
 */
@container corte-count (min-width: 686px) {
	.cash-closing--split {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		column-gap: 18px;
		align-items: start;
	}

	/* The lede and everything that reports on BOTH steps — what is still
	   missing, the storage warning — stays one full-width line. */
	.cash-closing--split > .cash-closing__head,
	.cash-closing--split > .cash-closing__ready,
	.cash-closing--split > .cash-closing__todo,
	.cash-closing--split > .cash-closing__storage {
		grid-column: 1 / -1;
	}

	.cash-closing--split > .cash-closing__step--count {
		grid-column: 1;
	}

	.cash-closing--split > .cash-closing__step--bags {
		grid-column: 2;
	}
}

.cash-closing__head h3 {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cash-closing__lede,
.cash-closing__muted {
	margin: 4px 0 0;
	font-size: 12.5px;
	line-height: 1.45;
	color: var(--reg-text-muted, #667085);
}

.cash-closing__step {
	display: grid;
	gap: 10px;
	align-content: start;
}

.cash-closing__step-title {
	margin: 0;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cash-closing__figures {
	display: grid;
	gap: 4px;
	padding: 10px 12px;
	border: 1px solid var(--reg-divider-soft, #f2f4f7);
	border-radius: var(--reg-radius-sm, 12px);
	background: var(--reg-surface-sunken, #fafbfc);
}

.cash-closing__figure {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.cash-closing__figure--warn {
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.cash-closing__field {
	display: grid;
	gap: 5px;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
	min-inline-size: 0;
}

.cash-closing__field input,
.cash-closing__field select,
.cash-closing__field textarea {
	font: inherit;
	color: inherit;
	background: var(--reg-surface, var(--pos-card-bg, #ffffff));
	border: 1px solid var(--reg-border, var(--pos-border, rgba(0, 0, 0, 0.12)));
	border-radius: var(--reg-radius-xs, 8px);
	padding: 8px 10px;
	min-height: 48px;
	inline-size: 100%;
	min-inline-size: 0;
}

.cash-closing__field textarea {
	min-height: 64px;
	resize: vertical;
}

.cash-closing__hint {
	margin: 0;
	font-size: 11.5px;
	line-height: 1.4;
	color: var(--reg-text-muted, #667085);
}

.cash-closing__hint--warn {
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 600;
}

.cash-closing__save {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px 14px;
}

.cash-closing__saved {
	margin: 0;
	font-size: 12px;
	color: var(--reg-text-secondary, #56606e);
}

.cash-closing__chip {
	display: inline-block;
	padding: 2px 8px;
	margin-right: 6px;
	border-radius: 999px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.cash-closing__chip--ok {
	border: 1px solid var(--reg-tone-positive-border, #cdead8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.cash-closing__chip--warn {
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

/* The pale accent wash, not the saturated fill: this is the step's action, but
   the screen's one emphasis is «Close shift» on the band below. */
.cash-closing__action {
	min-height: 48px;
	padding: 10px 18px;
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	border-radius: var(--reg-radius-xs, 8px);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font: inherit;
	font-weight: 700;
	cursor: pointer;
}

.cash-closing__action--quiet {
	border-color: var(--reg-border, var(--pos-border, rgba(0, 0, 0, 0.12)));
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #56606e);
}

.cash-closing__action:disabled,
.cash-closing__retry:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.cash-closing__link {
	min-height: 44px;
	padding: 8px 4px;
	border: 0;
	background: transparent;
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	font-weight: 700;
	text-decoration: underline;
	cursor: pointer;
}

.cash-closing__link--remove {
	color: var(--reg-text-muted, #667085);
}

.cash-closing__meter {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px 12px;
	margin: 0;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.cash-closing__meter .reg-mono {
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cash-closing__bag {
	display: grid;
	gap: 10px;
	padding: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-sm, 12px);
	background: var(--reg-surface, var(--pos-card-bg, #ffffff));
}

.cash-closing__bag-head {
	display: grid;
	grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
	gap: 10px;
}

.cash-closing__bag-amount {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.cash-closing__bag-label {
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.cash-closing__bag-value {
	font-size: 18px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cash-closing__bag-value--warn {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.cash-closing__bag-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px 14px;
}

.cash-closing__ready {
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--reg-tone-positive-border, #cdead8);
	border-radius: var(--reg-radius-sm, 12px);
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
	font-size: 12.5px;
	font-weight: 600;
}

.cash-closing__todo ul {
	margin: 6px 0 0;
	padding-left: 18px;
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--reg-text-secondary, #56606e);
}

.cash-closing__alert {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	padding: 10px 12px;
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: var(--reg-radius-sm, 12px);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-strong, #6b4a10);
	font-size: 12.5px;
	line-height: 1.4;
}

/* The conflict panel is the same warning surface, read top to bottom: the two
   counts have to sit one under the other to be compared. */
.cash-closing__alert--stack {
	display: grid;
	gap: 8px;
	justify-items: start;
}

.cash-closing__conflict-title {
	margin: 0;
	font-weight: 700;
}

.cash-closing__compare {
	display: grid;
	gap: 4px;
	margin: 0;
	inline-size: 100%;
}

.cash-closing__compare > div {
	display: flex;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 4px 16px;
}

.cash-closing__compare dt {
	font-weight: 600;
}

.cash-closing__compare dd {
	margin: 0;
	font-weight: 700;
}

.cash-closing__conflict-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.cash-closing__retry {
	min-height: 44px;
	padding: 8px 14px;
	border: 1px solid currentColor;
	border-radius: var(--reg-radius-xs, 8px);
	background: transparent;
	color: inherit;
	font: inherit;
	font-weight: 700;
	cursor: pointer;
}

.cash-closing__action:focus-visible,
.cash-closing__link:focus-visible,
.cash-closing__retry:focus-visible,
.cash-closing__field input:focus-visible,
.cash-closing__field select:focus-visible,
.cash-closing__field textarea:focus-visible {
	outline: 2px solid var(--reg-text-primary, #212121);
	outline-offset: 2px;
}

@media (max-width: 599.98px) {
	.cash-closing__bag-head {
		grid-template-columns: minmax(0, 1fr);
	}

	.cash-closing__save,
	.cash-closing__bag-actions {
		gap: 8px;
	}
}
</style>
