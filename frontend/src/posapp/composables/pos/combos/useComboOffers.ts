/**
 * The register's combo offers — the read model behind the Combos drawer
 * category and the "se suele llevar junto" strip.
 *
 * Until this module existed, `Pos.vue` held `const comboOffers = ref([])` with
 * a comment saying the read model had not landed. It HAD landed:
 * `posawesome/posawesome/api/combos.py::get_combos` returns every combo the
 * register offers, with each component priced from the active price list and
 * counted in the register's warehouse. Nothing called it. This is that call.
 *
 * ONE FETCH PER REGISTER, NOT ONE PER LINE. That is the whole shape of this
 * module and the reason it exists as a cache rather than as a `frappe.call`
 * inside a computed. The strip re-ranks on every cart change — a scan, a
 * quantity step, a line removed — and the sale path is the hottest surface in
 * the product (§6 budgets scan-to-paint at 50 ms p95). Filtering combos
 * against the cart is client-side arithmetic in `comboCatalog.ts`; only the
 * CATALOGUE needs the server, and the catalogue does not change while a
 * cashier rings up a ticket.
 *
 * What legitimately invalidates the cache is the pricing context, not the
 * cart: a different register (another price list, another warehouse) or a
 * different customer (their own price list). Both are keyed in, for the same
 * reason `useComboComponents` keys them — a cache on the profile alone would
 * quote one customer's saving to the next, and the saving is a number the
 * shopkeeper says out loud.
 *
 * Failure is empty, never an exception. A register whose combo fetch fails
 * sells exactly as it did before combos existed: the strip renders nothing and
 * the drawer shows no Combos chip. The sale is never the thing that breaks.
 *
 * ## The triggers, and why there are exactly three
 *
 * Passing `posProfile` / `customer` / `eventBus` makes this module own its own
 * refresh schedule, so the shell god-file gains a call and not a watcher farm
 * (golden flow §1: "`Pos.vue` gains only the call"). The schedule is:
 *
 *   1. REGISTER ACTIVATION — the profile resolving is the first moment there is
 *      a price list and a warehouse to ask about. Before that the server has
 *      nothing to price or count against, so there is no honest answer to
 *      fetch and the watcher deliberately does nothing.
 *   2. CATALOG SYNC COMPLETED — `set_all_items`, the bus event the item sync
 *      already emits when the catalogue array has been replaced or extended
 *      (`useItemsLoader`, `useItemSync`). A newly synced catalogue can carry a
 *      new bundle parent, a new price or new stock. It is FLOORED at
 *      {@link CATALOG_REFRESH_FLOOR_MS} because that same event also fires per
 *      page at boot and on every search — unfloored it would be a round trip
 *      per keystroke, which is the exact cost this module exists to avoid.
 *   3. CUSTOMER CHANGE, and only when the pricing context actually moves. The
 *      watcher watches the KEY, not the customer object, so re-selecting the
 *      same customer, or a store re-assigning an equal object, fetches nothing;
 *      and a customer changed back inside the TTL is served from memory.
 *
 * There is NO POLLING and no timer of any kind. Nothing here calls
 * `setInterval` or `setTimeout`; every refresh is a consequence of something
 * the register actually did. `comboOffersTriggers.spec.ts` holds that.
 *
 * ## Offline
 *
 * The last successful answer per pricing context lives in
 * `offline/comboOffers.ts` (Dexie, via the `memory` + `persist` idiom the other
 * keyed caches use). Offline, that answer is served and no call is attempted;
 * a cold cache offline yields an empty list, which draws no combo UI at all —
 * never a stub. A failed call falls back to the same cache and is NOT recorded,
 * so the next natural trigger retries rather than serving a five-minute-old
 * failure.
 *
 * That module is imported DIRECTLY rather than through `offline/index.ts`:
 * a good half of the suite replaces the barrel with a stub, and a cache whose
 * honesty rules disappear under a stub is a cache whose rules are untested.
 */

import {
	getCurrentScope,
	isRef,
	onScopeDispose,
	ref,
	watch,
	type Ref,
} from "vue";

import { isOffline } from "../../../../offline/db";
import {
	readCachedComboOffers,
	saveComboOffers,
} from "../../../../offline/comboOffers";
import { normalizeComboComponent } from "../items/comboLineAttachment";
import type { ComboOffer } from "./comboCatalog";

declare const frappe: any;

/**
 * Five minutes. The catalogue turns over when someone edits a Product Bundle
 * or a POS Combo, which is a back-office action measured in days, not in the
 * seconds a component cache needs (`useComboComponents` uses 60 s because it
 * is asked mid-cart). Long enough that a shift costs a handful of calls;
 * short enough that a shopkeeper who adds a combo at 10:00 sees it by 10:05
 * without reloading the register.
 */
const TTL_MS = 300_000;

/**
 * Floor between two catalog-sync refreshes.
 *
 * `set_all_items` is the honest "the catalogue changed" signal, but it is not a
 * rare one: `useItemsLoader` emits it per page of a paged first load and
 * `useItemsSelectorSearch` emits it on every search that replaces the array.
 * One minute collapses a boot's worth of pages, and every search a cashier can
 * type in a minute, into at most one round trip — while still picking up a
 * back-office bundle edit within a minute of the catalogue syncing it.
 */
export const CATALOG_REFRESH_FLOOR_MS = 60_000;

/** The bus event the item sync already emits when the catalogue changes. */
export const CATALOG_SYNC_EVENT = "set_all_items";

interface CacheEntry {
	data: ComboOffer[];
	ts: number;
}

const cache = new Map<string, CacheEntry>();
/**
 * In-flight requests, deduplicated by key. Two surfaces ask for the same
 * catalogue — the drawer for its category chip, the strip for its tiles — and
 * they mount in the same tick. Without this the register opens with two
 * identical round trips on the critical path.
 */
const inflight = new Map<string, Promise<ComboOffer[] | null>>();

/** Test seam — module state would otherwise leak between specs. */
export const clearComboOffersCache = (): void => {
	cache.clear();
	inflight.clear();
};

export interface ComboOffersContext {
	pos_profile?: any;
	customer?: unknown;
}

const keyFor = (context: ComboOffersContext): string =>
	[
		String(context.pos_profile?.name ?? context.pos_profile ?? ""),
		String(context.pos_profile?.selling_price_list ?? ""),
		String(context.pos_profile?.warehouse ?? ""),
		String(context.customer ?? ""),
	].join("::");

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/**
 * Normalise one combo from the read model.
 *
 * Frappe returns Decimal-backed fields as strings often enough that this is
 * not defensive programming but ordinary interop: a string `rate` reaches
 * `priceCombo()` and computes a saving by string subtraction, and a string
 * `qty` on a component computes a list price by concatenation. Components go
 * through `normalizeComboComponent`, which is the same normaliser the cart
 * line uses — one spelling of "what a component is" across both surfaces.
 */
export const normalizeComboOffer = (raw: any): ComboOffer => ({
	item_code: String(raw?.item_code ?? ""),
	item_name: String(raw?.item_name ?? raw?.item_code ?? ""),
	rate: toNumber(raw?.rate),
	image: raw?.image ?? null,
	targets: Array.isArray(raw?.targets) ? raw.targets.map((t: unknown) => String(t)) : [],
	// The device-model leg. Both halves are carried, because the matcher needs
	// the attribute NAME to know the values are answers to the question this
	// register is asking — an offline payload can outlive the storefront config
	// that produced it. Absent stays absent (`null` / `[]`), and a combo with
	// neither is universal exactly as before.
	target_attribute: raw?.target_attribute ? String(raw.target_attribute) : null,
	// Filtered AFTER trimming and never by `String(v)` alone: `String(null)` is
	// the four-character string "null", which is truthy and would sit in the
	// target set as a value no attribute has — matching nothing, but pretending
	// the combo is targeted.
	target_attribute_values: Array.isArray(raw?.target_attribute_values)
		? raw.target_attribute_values
				.map((v: unknown) => (v === null || v === undefined ? "" : String(v).trim()))
				.filter(Boolean)
		: [],
	priority: toNumber(raw?.priority),
	components: Array.isArray(raw?.components) ? raw.components.map(normalizeComboComponent) : [],
});

/** A ref, a getter, or a plain value — whichever the caller already holds. */
type MaybeSource<T> = T | Ref<T> | (() => T);

const readSource = <T>(source: MaybeSource<T> | undefined): T | undefined => {
	if (typeof source === "function") return (source as () => T)();
	if (isRef(source)) return source.value as T;
	return source as T | undefined;
};

/** The two methods this module needs from the shell's mitt bus. */
export interface ComboOffersEventBus {
	on: (_event: any, _handler: (..._args: any[]) => void) => void;
	off: (_event: any, _handler: (..._args: any[]) => void) => void;
}

export interface UseComboOffersOptions {
	/** The active POS Profile. Its arrival IS register activation. */
	posProfile?: MaybeSource<any>;
	/** The selected customer, for customer-specific pricing. */
	customer?: MaybeSource<unknown>;
	/** The shell's event bus, for the catalog-sync refresh. */
	eventBus?: ComboOffersEventBus | null;
}

export interface UseComboOffers {
	/** The register's combos. Empty until `load()` resolves, and on failure. */
	offers: Ref<ComboOffer[]>;
	/** A fetch is in flight. Surfaces render nothing rather than a spinner. */
	loading: Ref<boolean>;
	/** A fetch has completed at least once for the current context. */
	loaded: Ref<boolean>;
	load: (_context?: ComboOffersContext, _options?: { force?: boolean }) => Promise<ComboOffer[]>;
	/** The catalog-sync handler, exposed so the trigger schedule is testable. */
	onCatalogSynced: () => void;
}

export function useComboOffers(options: UseComboOffersOptions = {}): UseComboOffers {
	const offers = ref<ComboOffer[]>([]);
	const loading = ref(false);
	const loaded = ref(false);

	/**
	 * When the server last actually answered. The catalog-sync trigger measures
	 * its floor against this rather than against its own last firing, so the
	 * activation fetch already counts: a `set_all_items` arriving in the same
	 * boot as the first load does not buy a second copy of the same answer.
	 */
	let lastServerAnswerAt = 0;

	const currentContext = (): ComboOffersContext => ({
		pos_profile: readSource(options.posProfile),
		customer: readSource(options.customer),
	});

	/**
	 * The cached answer for this context, or `[]`.
	 *
	 * Deliberately NOT promoted into the in-memory TTL map: a cached answer is
	 * what we fall back to, not what we were told just now, and writing it there
	 * would suppress the retry the next natural trigger is supposed to make.
	 */
	const fromOfflineCache = async (context: ComboOffersContext): Promise<ComboOffer[]> => {
		const cached = await readCachedComboOffers(context.pos_profile, context.customer);
		if (!Array.isArray(cached)) {
			// Never told, or the entry aged out: no combo UI at all. A stub
			// offer is worse than no offer — the cashier would quote it.
			return [];
		}
		return cached.map(normalizeComboOffer);
	};

	/**
	 * Fetch (or serve from cache) the combos this register offers.
	 *
	 * Idempotent per pricing context, so the shell may call it from a watcher
	 * on profile and customer without counting the calls itself. Returns the
	 * list as well as assigning it, because a caller that wants to await the
	 * catalogue before deciding something should not have to read a ref to
	 * find out what it got.
	 *
	 * `force` skips the TTL — the catalog-sync refresh, which exists precisely
	 * because the answer may have changed inside the five minutes.
	 */
	const load = async (
		context: ComboOffersContext = currentContext(),
		{ force = false }: { force?: boolean } = {},
	): Promise<ComboOffer[]> => {
		// No profile means no price list and no warehouse: the server would
		// have nothing to price or count against, so there is no honest answer
		// to fetch. The shift is not open yet.
		if (!context.pos_profile) {
			offers.value = [];
			return [];
		}

		const key = keyFor(context);
		const cached = cache.get(key);
		if (!force && cached && Date.now() - cached.ts < TTL_MS) {
			offers.value = cached.data;
			loaded.value = true;
			return cached.data;
		}

		// Offline: serve the last successful answer and do not attempt a call.
		// Not merely an optimisation — `frappe.call` offline resolves slowly or
		// with an HTML error page, and either would blank the strip for the
		// length of the timeout.
		if (isOffline()) {
			const stored = await fromOfflineCache(context);
			offers.value = stored;
			loaded.value = true;
			return stored;
		}

		const pending =
			inflight.get(key) ??
			(async (): Promise<ComboOffer[] | null> => {
				try {
					const response = await frappe.call({
						method: "posawesome.posawesome.api.combos.get_combos",
						args: {
							pos_profile: context.pos_profile?.name ?? context.pos_profile,
							customer: context.customer ?? null,
						},
					});
					const raw = response?.message;
					const data = Array.isArray(raw) ? raw.map(normalizeComboOffer) : [];
					cache.set(key, { data, ts: Date.now() });
					lastServerAnswerAt = Date.now();
					// A successful EMPTY answer is recorded too: "this tenant
					// authored no bundles" is a fact the offline register should
					// keep, and it is the difference between drawing nothing on
					// purpose and drawing nothing because we never asked.
					saveComboOffers(context.pos_profile, context.customer, data);
					return data;
				} catch (error) {
					// Not cached: a network blip must not blank the combos for
					// the next five minutes. Logged, not toasted — the cashier
					// can do nothing about it and the sale is unaffected.
					// `null` rather than `[]` so the caller can tell a failure
					// from an empty catalogue and fall back to the cache.
					console.error("Failed to fetch combo offers", error);
					return null;
				} finally {
					inflight.delete(key);
				}
			})();

		inflight.set(key, pending);
		loading.value = true;
		try {
			const data = await pending;
			const resolved = data ?? (await fromOfflineCache(context));
			offers.value = resolved;
			loaded.value = true;
			return resolved;
		} finally {
			loading.value = false;
		}
	};

	/**
	 * The catalogue finished syncing. Refresh past the TTL, at most once per
	 * {@link CATALOG_REFRESH_FLOOR_MS} — see the module docstring for why this
	 * event needs a floor and the other two triggers do not.
	 */
	const onCatalogSynced = (): void => {
		// Offline the event still fires — searching the local cache replaces the
		// array — but it cannot mean "the server told us something new", which
		// is the only thing this refresh is for.
		if (isOffline()) return;
		if (Date.now() - lastServerAnswerAt < CATALOG_REFRESH_FLOOR_MS) {
			return;
		}
		void load(currentContext(), { force: true });
	};

	// --- triggers ----------------------------------------------------------
	// Wired only when the caller supplied the sources. A bare `useComboOffers()`
	// stays the pure, manually-driven composable the specs use.

	if (options.posProfile !== undefined || options.customer !== undefined) {
		watch(
			// The KEY, not the profile object and not the customer id: this is
			// what makes "refresh on customer change ONLY if the price could
			// differ" true rather than aspirational. Same profile re-assigned,
			// same customer re-selected, a store handing back an equal object —
			// all produce the same string and fetch nothing.
			() => keyFor(currentContext()),
			() => {
				void load();
			},
			{ immediate: true },
		);
	}

	const bus = options.eventBus;
	if (bus && typeof bus.on === "function") {
		bus.on(CATALOG_SYNC_EVENT, onCatalogSynced);
		if (getCurrentScope()) {
			// Always with the handler: a bare `off(event)` drops every listener
			// for it, including the item surfaces' own.
			onScopeDispose(() => bus.off(CATALOG_SYNC_EVENT, onCatalogSynced));
		}
	}

	return { offers, loading, loaded, load, onCatalogSynced };
}
