/**
 * Phase 3 scaffold: dedicated Worker that owns the search index.
 *
 * Why
 * ---
 * Today `performLocalSearch` filters the full 5 k-item catalog on the
 * main thread per keystroke. With multi-term queries + several fields
 * per item the filter is single-digit-ms on a desktop but 10-30 ms on
 * the slow phones the operators carry. While the filter runs, input
 * events queue and the cart re-render fights the search pass. Moving
 * the loop into a dedicated Worker frees the main thread; the Worker
 * gets its own thread on the CPU.
 *
 * SharedWorker vs dedicated Worker
 * --------------------------------
 * 3-SIGMA Phase 3 calls for a SharedWorker so multiple POS tabs in the
 * same origin share the index. The hard part of SharedWorker is debug
 * tooling (Safari doesn't fully support it; Chromium devtools only
 * show shared workers via a separate inspector). For the first slice
 * we ship a dedicated Worker per tab — simpler, well-supported, and
 * the per-tab heap cost (a single Map of strings) is small. Promote
 * to SharedWorker once telemetry shows multi-tab heap pressure as a
 * real problem.
 *
 * Protocol
 * --------
 * Message shapes are minimal + versioned via the `op` field. The main
 * thread keeps the canonical Item objects and only sends search index
 * payloads here; the Worker returns matching `item_code` arrays. The
 * caller maps codes back to items via `itemsMap.value.get(code)`.
 *
 *   in:  { op: "set_index", entries: Array<{code, idx, group}> }
 *   in:  { op: "patch_index", entries, removals?: string[] }
 *   in:  { op: "search", id, term, group? }
 *   out: { op: "search_result", id, codes: string[], took_ms }
 *   out: { op: "ready" }  // once initial index landed
 */

type IndexEntry = { code: string; idx: string; group?: string };

interface SearchEntry {
	idx: string;
	terms: string[];
	group?: string;
}

const catalog = new Map<string, SearchEntry>();

function splitTerms(text: string): string[] {
	return String(text || "")
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

function buildEntry(raw: IndexEntry): SearchEntry {
	const idx = String(raw.idx || "").toLowerCase();
	return {
		idx,
		terms: splitTerms(idx),
		group: raw.group,
	};
}

function setIndex(entries: IndexEntry[]) {
	catalog.clear();
	for (const entry of entries) {
		if (!entry?.code) continue;
		catalog.set(entry.code, buildEntry(entry));
	}
}

function patchIndex(entries: IndexEntry[], removals?: string[]) {
	if (Array.isArray(removals)) {
		for (const code of removals) catalog.delete(code);
	}
	for (const entry of entries || []) {
		if (!entry?.code) continue;
		catalog.set(entry.code, buildEntry(entry));
	}
}

function search(term: string, group?: string): string[] {
	const searchTerm = String(term || "").toLowerCase().trim();
	const terms = searchTerm ? searchTerm.split(/\s+/).filter(Boolean) : [];
	const filterByGroup = group && group !== "ALL";
	if (!terms.length && !filterByGroup) {
		// Empty search + ALL group → return everything in insertion
		// order. Caller paginates.
		return Array.from(catalog.keys());
	}

	const matches: string[] = [];
	for (const [code, entry] of catalog) {
		if (filterByGroup && entry.group !== group) continue;
		if (!terms.length) {
			matches.push(code);
			continue;
		}
		let ok = true;
		for (const t of terms) {
			if (!entry.idx.includes(t)) {
				ok = false;
				break;
			}
		}
		if (ok) matches.push(code);
	}
	return matches;
}

self.onmessage = (event: MessageEvent) => {
	const data = event.data || {};
	switch (data.op) {
		case "set_index":
			setIndex(Array.isArray(data.entries) ? data.entries : []);
			(self as any).postMessage({ op: "ready", size: catalog.size });
			return;
		case "patch_index":
			patchIndex(
				Array.isArray(data.entries) ? data.entries : [],
				Array.isArray(data.removals) ? data.removals : undefined,
			);
			return;
		case "search": {
			const start = performance.now();
			const codes = search(data.term, data.group);
			const took_ms = performance.now() - start;
			(self as any).postMessage({
				op: "search_result",
				id: data.id,
				codes,
				took_ms,
			});
			return;
		}
		default:
			// Unknown op — silent drop. The main-thread client gates
			// the worker behind a flag so an old worker against a new
			// protocol shouldn't surface as an error.
			return;
	}
};
