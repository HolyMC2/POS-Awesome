/**
 * The recharge catalogue, normalised for the destination chrome
 * (build plan §12 item F).
 *
 * The shape it reads is `saldo.api.catalog_admin.catalog_tree` — the SAME
 * endpoint the existing picker calls, deliberately. posawesome owns no
 * catalogue of its own here: the tabs, the companies and the amounts are all
 * saldo's data reaching this app through the seam, and this module only turns
 * the wire shape into something a template can render.
 *
 * ## Two things the artboard draws that are not facts
 *
 * **The three tabs.** `Recargas.dc.html` draws *Tiempo aire · Paquetes · Pago
 * de servicios*. The real category set is whatever TAECEL's `getProducts` sync
 * wrote — `catalog_tree` orders it `Tiempo Aire, Paquetes, GiftCards,
 * Servicios` and then appends anything else it found. Hard-coding three would
 * hide a category the shop actually sells, so the tabs are built from the tree
 * and the artboard's three are simply the ones a phone shop sees most.
 *
 * **The amount presets.** The artboard draws `$10 · $20 · $30 · $50 · $100 ·
 * $150 · $200 · $300 · $500` for every company. Those are not amounts a cashier
 * may choose: each one has to exist as a `Saldo Product` (and therefore an
 * Item) or the recharge cannot be sent at all. So the presets ARE the
 * company's products, sorted by amount, and a company with three products
 * shows three buttons. An open-amount company (`tipo == "1"`, TAECEL's *monto
 * libre*) shows none and takes a typed amount instead.
 *
 * Pure and Vue-free; `useRecargasSnapshot.ts` is the half that fetches.
 */

type AnyRecord = Record<string, any>;

export interface CatalogProduct {
	/** TAECEL `Codigo`, which IS the ERPNext `item_code` (saldo/api/items.py). */
	code: string;
	label: string;
	description: string;
	/** null for an open-amount product — the operator types the figure. */
	amount: number | null;
	validity: string;
}

export interface CatalogCarrier {
	/** `Saldo Carrier.name` — the id the hint and the ledger both speak. */
	id: string;
	label: string;
	logo: string | null;
	/** TAECEL `tipo == "1"`: no fixed catalogue, the amount is typed. */
	openAmount: boolean;
	/** The carrier's own reference regex, when it published one. */
	referencePattern: string | null;
	products: CatalogProduct[];
}

export interface CatalogTab {
	id: string;
	/** Category name as TAECEL spells it — DATA, never a translated source. */
	label: string;
	carriers: CatalogCarrier[];
}

const text = (value: unknown): string => {
	const out = String(value ?? "").trim();
	return out;
};

const finiteAmount = (value: unknown): number | null => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function buildProduct(raw: AnyRecord): CatalogProduct | null {
	const code = text(raw?.codigo);
	if (!code) {
		// No `codigo` means no Item, which means nothing can be added to a cart.
		// Rendering it would be a button that cannot work.
		return null;
	}
	return {
		code,
		label: text(raw?.nombre) || code,
		description: text(raw?.descripcion),
		// `monto_libre` is the server's own reading of `monto <= 0`; trust it and
		// fall back to the amount so an older payload still resolves.
		amount: raw?.monto_libre ? null : finiteAmount(raw?.monto),
		validity: text(raw?.vigencia),
	};
}

function buildCarrier(raw: AnyRecord): CatalogCarrier | null {
	const id = text(raw?.name);
	if (!id) {
		return null;
	}
	const products = (Array.isArray(raw?.products) ? raw.products : [])
		.map((p: AnyRecord) => buildProduct(p))
		.filter((p: CatalogProduct | null): p is CatalogProduct => p !== null);
	// TAECEL's `tipo` is the authority, not the product count. A catalogue
	// carrier whose products all failed to materialise as Items is NOT an
	// open-amount one — it is a carrier this register cannot sell today, and
	// showing it with a free-amount box would invite a figure that can never be
	// sent. It is dropped instead, the same call `buildProduct` makes for a
	// product with no code.
	const openAmount = text(raw?.tipo) === "1";
	if (!openAmount && !products.length) {
		return null;
	}
	return {
		id,
		label: text(raw?.label) || id,
		logo: text(raw?.logo) || null,
		openAmount,
		referencePattern: text(raw?.regex) || null,
		products,
	};
}

/** `catalog_tree()` → tabs. An unreadable or empty tree yields no tabs, and the
 * chrome renders nothing rather than an empty frame of tabs with no companies. */
export function buildCatalogTabs(tree: unknown): CatalogTab[] {
	const categorias = (tree as AnyRecord)?.categorias;
	if (!Array.isArray(categorias)) {
		return [];
	}
	const tabs: CatalogTab[] = [];
	for (const cat of categorias) {
		const label = text((cat as AnyRecord)?.name);
		if (!label) {
			continue;
		}
		const carriers = (Array.isArray((cat as AnyRecord)?.carriers) ? (cat as AnyRecord).carriers : [])
			.map((c: AnyRecord) => buildCarrier(c))
			.filter((c: CatalogCarrier | null): c is CatalogCarrier => c !== null);
		if (!carriers.length) {
			continue;
		}
		tabs.push({ id: label, label, carriers });
	}
	return tabs;
}

/**
 * The amount buttons for one company: its fixed-amount products, cheapest
 * first, de-duplicated by amount.
 *
 * De-duplicated because TAECEL lists several products at the same figure for
 * some companies (a $50 airtime and a $50 package), and two adjacent buttons
 * reading `$50` is a coin-flip the cashier cannot see. The first at each amount
 * wins, which is the cheapest-first order's own answer.
 */
export function amountPresets(carrier: CatalogCarrier | null | undefined): CatalogProduct[] {
	if (!carrier) {
		return [];
	}
	const byAmount = new Map<number, CatalogProduct>();
	for (const product of [...carrier.products].sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0))) {
		if (product.amount === null || byAmount.has(product.amount)) {
			continue;
		}
		byAmount.set(product.amount, product);
	}
	return [...byAmount.values()];
}

/** Find a company across every tab — the hint names one without knowing which
 * tab it sits under, and a Telcel airtime hint must still resolve while the
 * operator is looking at Paquetes. */
export function findCarrier(tabs: readonly CatalogTab[], id: string | null): CatalogCarrier | null {
	if (!id) {
		return null;
	}
	for (const tab of tabs) {
		const found = tab.carriers.find((c) => c.id === id);
		if (found) {
			return found;
		}
	}
	return null;
}

/** Which tab holds a company, so selecting a hinted one can bring its tab
 * forward instead of leaving the chip highlighted on a page nobody is looking at. */
export function tabForCarrier(tabs: readonly CatalogTab[], id: string | null): CatalogTab | null {
	if (!id) {
		return null;
	}
	return tabs.find((tab) => tab.carriers.some((c) => c.id === id)) ?? null;
}
