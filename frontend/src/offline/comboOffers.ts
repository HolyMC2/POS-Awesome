/**
 * The register's last successful combo answer, kept so the drawer's Combos
 * category and the "se suele llevar junto" strip survive a lost connection.
 *
 * ## Why a cache at all
 *
 * `api/combos.py::get_combos` is the ONLY source of what a register offers as a
 * combo — the Product Bundles, their rate, their components' list prices and
 * their warehouse counts. Offline there is no second place to derive it from:
 * the items table knows the bundle PARENT as an ordinary sellable item and
 * knows nothing about what it contains, and `Product Bundle` is not in the sync
 * registry. So without this module a register that drops its connection loses
 * the combo surfaces entirely until it reconnects.
 *
 * ## What is and is not cached
 *
 * Only a SUCCESSFUL answer is written. A failed fetch leaves whatever was here
 * untouched — a network blip must not blank a register's combos, and it must
 * not write an empty list that would then be served as if the shop had stopped
 * selling bundles.
 *
 * An EMPTY successful answer is a real answer and is written as one. A register
 * whose tenant has authored no bundles should keep drawing no combo UI offline,
 * exactly as it does online. That is why the read returns `null` for a miss and
 * `[]` for a genuine empty answer: the two are different facts and the caller
 * treats them differently — `null` means "we have never been told", which is
 * also the cold-cache state that must render nothing rather than a stub.
 *
 * ## Freshness
 *
 * A combo's SAVING is a number the shopkeeper says out loud, so a stale one is
 * a money-visible error rather than a cosmetic one. Entries carry a timestamp
 * and are treated as a miss past {@link COMBO_OFFERS_TTL_MS} — the same 24 h
 * the other keyed caches in `cache.ts` use (delivery charges, currency options,
 * price-list metadata). A register offline overnight still opens with its
 * combos; one offline for three days draws none, which is the honest degraded
 * state and not a stub.
 *
 * ## Shape
 *
 * Keyed by the PRICING CONTEXT, not by the register alone — the same key the
 * `useComboOffers` composable caches in memory under, for the same reason:
 * another price list, another warehouse or another customer is a different
 * answer, and a cache on the profile alone would quote one customer's saving to
 * the next.
 *
 * @module offline/comboOffers
 */

import { initPromise, memory, persist } from "./db";

/** `memory` slot; routed to the Dexie `cache` table by `KEY_TABLE_MAP`. */
export const COMBO_OFFERS_CACHE_KEY = "combo_offers_cache";

/** 24 h, matching the other keyed reference caches. See the module docstring. */
export const COMBO_OFFERS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How many pricing contexts one register keeps.
 *
 * The key carries the customer, so a busy counter would otherwise accumulate an
 * entry per customer served, forever, in a slot that is written whole on every
 * `persist`. Eight is enough to cover a register's own contexts plus the
 * handful of named customers a cashier bounces between in a shift; past that
 * the oldest is dropped and simply refetched when it is next asked for.
 */
const MAX_CACHED_CONTEXTS = 8;

interface ComboOffersCacheEntry {
	data: unknown[];
	timestamp: number;
}

type ComboOffersCacheSlot = Record<string, ComboOffersCacheEntry>;

const normalizeKeyPart = (value: unknown): string =>
	String(value ?? "")
		.trim()
		.toLowerCase();

/**
 * The pricing context this answer belongs to.
 *
 * `profile` is passed whole rather than by name so the price list and the
 * warehouse ride along: two registers on one profile document cannot differ,
 * but the same profile re-read with a changed price list is a different answer
 * and must not be served from the old key.
 */
export const comboOffersCacheKey = (
	posProfile: Record<string, unknown> | string | null | undefined,
	customer?: unknown,
): string => {
	const profile = typeof posProfile === "object" && posProfile ? posProfile : null;
	return [
		normalizeKeyPart(profile ? profile.name : posProfile),
		normalizeKeyPart(profile?.selling_price_list),
		normalizeKeyPart(profile?.warehouse),
		normalizeKeyPart(customer),
	].join("::");
};

/**
 * JSON round trip, for the same reason `cache.ts` clones on the way in and out:
 * what reaches IndexedDB must be structured-clone safe, and what a caller gets
 * back must not be the cached copy — a surface that sorted the array it was
 * handed would reorder the cache with it.
 */
const clonePayload = <T>(value: T): T | null => {
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch (error) {
		console.warn("Failed to clone combo offers payload", error);
		return null;
	}
};

const readSlot = (): ComboOffersCacheSlot => {
	const slot = memory[COMBO_OFFERS_CACHE_KEY];
	return slot && typeof slot === "object" ? (slot as ComboOffersCacheSlot) : {};
};

const isFresh = (
	entry: ComboOffersCacheEntry | undefined,
	ttlMs: number,
): entry is ComboOffersCacheEntry => {
	if (!entry || typeof entry !== "object" || !Array.isArray(entry.data)) return false;
	const timestamp = Number(entry.timestamp || 0);
	if (!timestamp) return false;
	return Date.now() - timestamp < ttlMs;
};

/** Drop the oldest contexts once the slot outgrows {@link MAX_CACHED_CONTEXTS}. */
const prune = (slot: ComboOffersCacheSlot): ComboOffersCacheSlot => {
	const keys = Object.keys(slot);
	if (keys.length <= MAX_CACHED_CONTEXTS) return slot;
	const kept = keys
		.sort((left, right) => Number(slot[right]?.timestamp || 0) - Number(slot[left]?.timestamp || 0))
		.slice(0, MAX_CACHED_CONTEXTS);
	const pruned: ComboOffersCacheSlot = {};
	for (const key of kept) {
		const entry = slot[key];
		if (entry) {
			pruned[key] = entry;
		}
	}
	return pruned;
};

/**
 * Record a successful answer for this pricing context.
 *
 * Call it ONLY on success — including a successful empty answer. Anything else
 * (a rejected call, a malformed payload) must leave the previous answer alone;
 * see the module docstring.
 */
export function saveComboOffers(
	posProfile: Record<string, unknown> | string | null | undefined,
	customer: unknown,
	offers: readonly unknown[],
): void {
	try {
		const key = comboOffersCacheKey(posProfile, customer);
		// A blank key means no profile: there is no register to attribute the
		// answer to, and writing it under "::::" would serve it to the next one.
		if (!key.replace(/:/g, "") || !Array.isArray(offers)) {
			return;
		}
		const slot = { ...readSlot() };
		slot[key] = { data: clonePayload(offers as unknown[]) || [], timestamp: Date.now() };
		memory[COMBO_OFFERS_CACHE_KEY] = prune(slot);
		persist(COMBO_OFFERS_CACHE_KEY);
	} catch (error) {
		console.error("Failed to save combo offers cache", error);
	}
}

/**
 * The cached answer for this context, or `null` when there is none.
 *
 * Synchronous, reading only the in-memory mirror. Use it on any path that
 * cannot wait — the register's boot hydrates `memory` from IndexedDB during
 * idle time, so this returns `null` until then even for a warm cache.
 */
export function peekCachedComboOffers(
	posProfile: Record<string, unknown> | string | null | undefined,
	customer?: unknown,
	ttlMs: number = COMBO_OFFERS_TTL_MS,
): unknown[] | null {
	try {
		const entry = readSlot()[comboOffersCacheKey(posProfile, customer)];
		if (!isFresh(entry, ttlMs)) return null;
		return clonePayload(entry.data) || [];
	} catch (error) {
		console.error("Failed to read combo offers cache", error);
		return null;
	}
}

/**
 * The cached answer, waiting for the offline store to hydrate first.
 *
 * This is the read the offline register wants: on a cold boot with no network,
 * `memory` is not populated until `initPromise` resolves, so a synchronous peek
 * would report "no cache" for a register that has one. Awaiting is affordable
 * here precisely because nothing on the sale path waits for combos.
 */
export async function readCachedComboOffers(
	posProfile: Record<string, unknown> | string | null | undefined,
	customer?: unknown,
	ttlMs: number = COMBO_OFFERS_TTL_MS,
): Promise<unknown[] | null> {
	try {
		await initPromise;
	} catch {
		// A degraded offline store is a cache miss, not a failure to report:
		// the caller renders nothing and the sale is unaffected.
		return null;
	}
	return peekCachedComboOffers(posProfile, customer, ttlMs);
}

/** Forget every cached context. Used by the cache-clear paths and by specs. */
export function clearCachedComboOffers(): void {
	memory[COMBO_OFFERS_CACHE_KEY] = {};
	persist(COMBO_OFFERS_CACHE_KEY);
}
