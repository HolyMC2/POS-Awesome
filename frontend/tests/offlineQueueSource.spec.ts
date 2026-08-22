import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { QUEUE_PROMISES } from "../src/posapp/components/pos/offline/offlineQueueModel";

/**
 * Structural guarantees for the desktop offline surface — the ones only a scan
 * can make, because they are all negatives (build plan §12 item E).
 *
 * Two of them have money behind them:
 *
 *   - **No second drain.** The surface may DISPATCH the queue's existing drain
 *     and may not contain one. A submit issued from here would bypass the
 *     write queue's lease and its idempotency bookkeeping, and the symptom is
 *     a sale billed twice with nothing on screen to show for it. A mounted
 *     test proves one render behaved; only a scan proves the code cannot.
 *   - **No unbacked reassurance.** R4's ruling, applied where the ruling came
 *     from: every "nothing is lost" line names the module that makes it
 *     checkable, and that module exists.
 *
 * No jsdom — this reads real files.
 */

const SRC = resolve(__dirname, "../src");
const OFFLINE_SURFACE = resolve(SRC, "posapp/components/pos/offline");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = resolve(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});

/**
 * Comments are stripped before every scan — template comments included.
 *
 * `useOfflineQueue.ts` names `syncOfflineInvoices` in prose precisely to
 * explain why it must not call it, and `OfflineQueueTable.vue` says in a
 * template comment that there is no folio to print. A scan that failed on the
 * explanation would push the reasoning out of the files, which is the opposite
 * of what these guards are for.
 */
const stripComments = (source: string) =>
	source
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

const surfaceFiles = walk(OFFLINE_SURFACE).filter((file) => /\.(vue|ts)$/.test(file));
const code = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("the offline surface cannot become a second writer", () => {
	it("has files to scan at all", () => {
		// A scan over zero files passes vacuously, which is the quiet way this
		// kind of guarantee stops guarding anything.
		expect(surfaceFiles.length).toBeGreaterThan(0);
	});

	it("calls the server nowhere", () => {
		const offenders = surfaceFiles.filter((file) => /frappe\s*\.\s*call\s*\(/.test(code(file)));

		expect(
			offenders.map((f) => f.replace(SRC, "…")),
			"the queue submits sales; this surface only shows them",
		).toEqual([]);
	});

	it("claims, marks and deletes nothing in the queue", () => {
		// Every one of these is a write the drain performs under a lease. Called
		// from here they race the drain over the same rows.
		const FORBIDDEN = [
			"claimRetryableQueueEntries",
			"markWriteQueueEntrySynced",
			"markWriteQueueEntryFailed",
			"markWriteQueueEntryDrafted",
			"releaseClaimedQueueEntry",
			"enqueueWriteQueueEntry",
			"deleteWriteQueueEntry",
			"clearWriteQueueEntries",
			"syncInvoiceOutboxResource",
		];
		const offenders: string[] = [];
		for (const file of surfaceFiles) {
			const source = code(file);
			for (const symbol of FORBIDDEN) {
				if (source.includes(symbol)) offenders.push(`${file.replace(SRC, "…")} → ${symbol}`);
			}
		}

		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("reaches exactly one drain, and reaches it through the shared store", () => {
		const composable = code(resolve(OFFLINE_SURFACE, "useOfflineQueue.ts"));

		expect(composable).toContain("syncPendingInvoices");
		expect(composable).toContain("stores/syncStore");
		// Importing the raw drain would skip coordinator mode, the pending-count
		// refresh and the toasts — three decisions the store already owns.
		expect(composable).not.toMatch(/import[\s\S]{0,80}syncOfflineInvoices/);
	});

	it("reads the queue through its public snapshot, not the table", () => {
		const composable = code(resolve(OFFLINE_SURFACE, "useOfflineQueue.ts"));

		expect(composable).toContain("getOfflineInvoices");
		expect(composable).not.toContain('db.table("write_queue")');
	});
});

describe("no reassurance ships without the code behind it", () => {
	it("cites a module that exists for every promise on screen", () => {
		const missing = QUEUE_PROMISES.filter(
			(promise) => !existsSync(resolve(SRC, "..", promise.backedBy)),
		);

		// A citation pointing at a deleted file is worse than none: it reads as
		// verified and cannot be checked.
		expect(missing.map((p) => `${p.id} → ${p.backedBy}`)).toEqual([]);
	});

	it("does not print the folio promise the artboard draws", () => {
		// `Offline.dc.html` says "folios reservados por adelantado". Nothing in
		// this repo reserves a folio, so the line is absent rather than
		// comforting — the same call R4 made about the rail's offline claims.
		for (const file of surfaceFiles) {
			expect(code(file).toLowerCase()).not.toContain("folio");
		}
	});
});

describe("the surface follows the dark theme", () => {
	/**
	 * Same rule and the same regex as `a11yShellDarkMode.spec.ts`, which lists
	 * four components by hand and stops at `shell/`. A1 found three of those
	 * four painting in literal hex, so the register's primary navigation
	 * rendered as a light column beside a `#121212` shell. The check is copied
	 * rather than imported because a new surface outside that list is exactly
	 * how the defect came back.
	 */
	const COLOUR_DECL =
		/(?:^|[\s;{])(color|background|background-color|border-color)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)/g;

	it("declares every colour through a token, never as a bare hex", () => {
		const offenders: string[] = [];
		for (const file of surfaceFiles) {
			for (const match of readFileSync(file, "utf8").matchAll(COLOUR_DECL)) {
				const value = match[2] ?? "";
				if (value.includes("var(")) continue;
				offenders.push(`${file.replace(SRC, "…")} → ${match[1]}: ${value.trim()}`);
			}
		}

		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("the surface spends no accent", () => {
	// `singleAccent.spec.ts` walks `components/pos/shell/**` and stops there, so
	// this directory would be unscanned — which is exactly how the sale path
	// ended up with eight saturated fills (A2, wave 3).
	const ACCENT = [
		/var\(\s*--reg-accent\s*[,)]/,
		/var\(\s*--pos-primary\s*[,)]/,
		/#0097a7/i,
		/#00838f/i,
		/#00d4ff/i,
		/#ff6b35/i,
	];

	it("fills nothing with the brand accent — the band owns the one action", () => {
		const offenders: string[] = [];
		for (const file of surfaceFiles) {
			const styles = /<style[\s\S]*?>([\s\S]*?)<\/style>/.exec(readFileSync(file, "utf8"))?.[1];
			if (!styles) continue;
			for (const declaration of styles.split(";")) {
				if (!/background|border-color|fill/.test(declaration)) continue;
				if (ACCENT.some((pattern) => pattern.test(declaration))) {
					offenders.push(`${file.replace(SRC, "…")} → ${declaration.trim()}`);
				}
			}
		}

		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});
