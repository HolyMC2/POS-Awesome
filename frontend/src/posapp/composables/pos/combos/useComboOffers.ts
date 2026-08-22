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
 */

import { ref, type Ref } from "vue";

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
const inflight = new Map<string, Promise<ComboOffer[]>>();

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
	priority: toNumber(raw?.priority),
	components: Array.isArray(raw?.components) ? raw.components.map(normalizeComboComponent) : [],
});

export interface UseComboOffers {
	/** The register's combos. Empty until `load()` resolves, and on failure. */
	offers: Ref<ComboOffer[]>;
	/** A fetch is in flight. Surfaces render nothing rather than a spinner. */
	loading: Ref<boolean>;
	/** A fetch has completed at least once for the current context. */
	loaded: Ref<boolean>;
	load: (_context?: ComboOffersContext) => Promise<ComboOffer[]>;
}

export function useComboOffers(): UseComboOffers {
	const offers = ref<ComboOffer[]>([]);
	const loading = ref(false);
	const loaded = ref(false);

	/**
	 * Fetch (or serve from cache) the combos this register offers.
	 *
	 * Idempotent per pricing context, so the shell may call it from a watcher
	 * on profile and customer without counting the calls itself. Returns the
	 * list as well as assigning it, because a caller that wants to await the
	 * catalogue before deciding something should not have to read a ref to
	 * find out what it got.
	 */
	const load = async (context: ComboOffersContext = {}): Promise<ComboOffer[]> => {
		// No profile means no price list and no warehouse: the server would
		// have nothing to price or count against, so there is no honest answer
		// to fetch. The shift is not open yet.
		if (!context.pos_profile) {
			offers.value = [];
			return [];
		}

		const key = keyFor(context);
		const cached = cache.get(key);
		if (cached && Date.now() - cached.ts < TTL_MS) {
			offers.value = cached.data;
			loaded.value = true;
			return cached.data;
		}

		const pending =
			inflight.get(key) ??
			(async () => {
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
					return data;
				} catch (error) {
					// Not cached: a network blip must not blank the combos for
					// the next five minutes. Logged, not toasted — the cashier
					// can do nothing about it and the sale is unaffected.
					console.error("Failed to fetch combo offers", error);
					return [];
				} finally {
					inflight.delete(key);
				}
			})();

		inflight.set(key, pending);
		loading.value = true;
		try {
			const data = await pending;
			offers.value = data;
			loaded.value = true;
			return data;
		} finally {
			loading.value = false;
		}
	};

	return { offers, loading, loaded, load };
}
