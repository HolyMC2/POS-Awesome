/**
 * Register surface capture — the visual evidence lane for the Riel y Cajón
 * redesign (docs/POS-RIEL-Y-CAJON-BUILD.md §5).
 *
 * This is NOT an assertion suite. It exists so the redesign can be judged
 * against `muelle-site/design/register-hifi` rather than described, and so a
 * BEFORE set captured on the baseline commit can be laid beside the AFTER set
 * captured on the integrated shell.
 *
 * Three things this lane learned the hard way on its first run, all encoded
 * below:
 *
 * 1. A surface that cannot be reached is RECORDED, not thrown. A harness that
 *    aborts on the first unreachable dialog captures nothing at all, which is
 *    the one outcome that makes the lane worthless. The run fails only if it
 *    captured nothing anywhere.
 * 2. The register must be driven onto a KNOWN profile. The lab bot was
 *    carrying an eleven-day-old shift on a restaurant preset, so a 1440x900
 *    capture rendered the mobile dock with a Floor tab — the capability
 *    preset, not the viewport, was choosing the layout. The screenshot looked
 *    plausible enough to accept, which is exactly the failure mode.
 * 3. The cart must have real lines. The redesign's whole claim is about
 *    density under a real ticket; an empty register is not evidence either
 *    way, so the sale surfaces are captured with a basket in them.
 *
 * Output: docs/design-evidence/<label>/<viewport>/<surface>.png plus a
 * manifest.json recording what was captured, what was missed, and which
 * profile and layout mode actually answered — a thin AFTER set should be
 * visibly thin rather than quietly pass as complete coverage.
 *
 *   POSA_VISUAL_LABEL    "before" | "after" | any tag (default "before")
 *   POSA_VISUAL_PROFILE  POS Profile to capture on (default "Doco Ventas" —
 *                        retail, no capability preset, so the desktop
 *                        two-column register is what renders)
 *   POSA_VISUAL_COMPANY  default "Grupo Doco"
 *   POSA_VISUAL_PATH     POS entry (default /posapp)
 * plus the smoke lane's POSA_SMOKE_BASE_URL / _USER / _PASSWORD.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_VISUAL_PATH || "/posapp";
const LABEL = process.env.POSA_VISUAL_LABEL || "before";
const PROFILE = process.env.POSA_VISUAL_PROFILE || "Doco Ventas";
const COMPANY = process.env.POSA_VISUAL_COMPANY || "Grupo Doco";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidenceRoot = resolve(repoRoot, "docs/design-evidence", LABEL);

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set — skipping visual capture.");

/**
 * The shared config leaves `actionTimeout` and `navigationTimeout` at
 * Playwright's default of 0 — meaning NO timeout. That is defensible for the
 * assertion lanes, where a click that never resolves should fail loudly on the
 * test timeout. It is wrong for this one: a capture lane's whole design is
 * "try the surface, record the miss, move on", and an un-timed `.click()` on a
 * control this profile does not offer blocks forever, so the `.catch()` that
 * was supposed to record the miss never runs and the run dies at 300s having
 * written nothing. Scoped to this file so the other two lanes keep the strict
 * behaviour they want.
 */
test.use({ actionTimeout: 8_000, navigationTimeout: 45_000 });

/**
 * 1440x900 and 390x844 are the canvas's own artboard sizes, so a capture drops
 * straight beside the .dc.html it is meant to match. 1024x768 sits inside the
 * 769-1099 band, where the compact switcher shows one panel and `.page-content`
 * still scrolls — the band that is easiest to break and hardest to notice.
 */
const VIEWPORTS = [
	{ name: "desktop-1440", width: 1440, height: 900 },
	{ name: "tablet-1024", width: 1024, height: 768 },
	{ name: "phone-390", width: 390, height: 844 },
] as const;

/** Demo SKUs that exist on the lab retail catalogue. */
const BASKET: Array<[string, string]> = [
	["Anillo Case", "Anillo Case"],
	["Adaptador", "Adaptador"],
];

async function login(page: Page) {
	const user = process.env.POSA_SMOKE_USER;
	const password = process.env.POSA_SMOKE_PASSWORD;
	if (!user || !password) {
		throw new Error("Visual capture requires POSA_SMOKE_USER and POSA_SMOKE_PASSWORD");
	}
	const response = await page.request.post("/api/method/login", {
		form: { usr: user, pwd: password },
	});
	expect(response.ok(), `login returned HTTP ${response.status()}`).toBeTruthy();
}

async function shoot(page: Page, dir: string, id: string) {
	mkdirSync(dir, { recursive: true });
	await page.screenshot({ path: resolve(dir, `${id}.png`), fullPage: false });
}

/**
 * Single-option autocompletes arrive PRE-SELECTED, and clicking one for a
 * dropdown stalls on the field's own selection text. Skip a field that already
 * shows the wanted value — the same trap the golden-flow spec documents.
 */
async function pickIfNeeded(page: Page, label: string, value: string) {
	const field = page.locator(`.v-input:has-text('${label}')`).first();
	const shown = await field.innerText().catch(() => "");
	if (shown.includes(value)) return;
	await field.locator("input").first().click().catch(() => {});
	await page
		.locator(`.v-overlay-container .v-list-item:has-text('${value}')`)
		.first()
		.click()
		.catch(() => {});
	await page.waitForTimeout(700);
}

/** Anything modal that survived a previous surface. Cheap and idempotent. */
/**
 * Snackbars only. Safe to call at ANY point, including while a dialog the run
 * still needs is open.
 *
 * Split out from `dismissOverlays` after that helper ate the opening dialog
 * twice: it presses Escape at any `.v-overlay--active`, and the opening dialog
 * IS one — so calling it before the profile was chosen dismissed the dialog the
 * run existed to fill in, and the capture silently photographed whatever preset
 * the register happened to resume. `railPresent: false` on a wave that had just
 * shipped a rail.
 */
async function dismissSnackbars(page: Page) {
	const snackClose = page
		.locator(".v-snackbar")
		.getByRole("button", { name: /^(close|cerrar)$/i })
		.first();
	if (await snackClose.isVisible().catch(() => false)) {
		await snackClose.click().catch(() => {});
		await page.waitForTimeout(400);
	}
}

/** Aggressive: presses Escape. NEVER call while a needed dialog is open. */
async function dismissOverlays(page: Page) {
	// Snackbars are not overlays but they intercept clicks all the same, and
	// the close-shift flow reliably raises one ("ticket print failed" — QZ is
	// not present in a headless browser). At 390px it sits directly over the
	// opening dialog's Submit, which is how a phone run got stuck on the
	// dialog and photographed it as the sale screen.
	await dismissSnackbars(page);
	for (let attempt = 0; attempt < 3; attempt++) {
		const overlay = page.locator(".v-overlay--active").first();
		if (!(await overlay.isVisible().catch(() => false))) return;
		const close = page.getByRole("button", { name: /^(close|cerrar|cancel|cancelar)$/i }).first();
		if (await close.isVisible().catch(() => false)) {
			await close.click().catch(() => {});
		} else {
			await page.keyboard.press("Escape");
		}
		await page.waitForTimeout(600);
	}
}

async function openActionsMenu(page: Page): Promise<boolean> {
	const trigger = page.getByRole("button", { name: /open actions menu/i }).first();
	if (!(await trigger.isVisible().catch(() => false))) return false;
	const opened = await trigger
		.click()
		.then(() => true)
		.catch(() => false);
	await page.waitForTimeout(900);
	return opened;
}

/**
 * Drive the register onto POSA_VISUAL_PROFILE, closing a resumed shift on a
 * different profile through the UI rather than through the database — the
 * close-shift flow is itself a surface worth exercising, and a data edit would
 * capture a state the app never produces.
 *
 * Returns the profile actually in play, so the manifest can say so instead of
 * the reader assuming.
 */
async function ensureProfile(page: Page, dir: string, captured: string[]): Promise<string> {
	const opening = page.getByText("Create POS Opening Shift");
	const asked = await opening
		.waitFor({ timeout: 12_000 })
		.then(() => true)
		.catch(() => false);

	if (!asked) {
		// A shift was resumed. Close it so the opening dialog comes back and we
		// can name the profile we actually want to photograph.
		if (await openActionsMenu(page)) {
			// `isVisible()` answers about THIS instant and does not wait, so it
			// reports false while the menu is still animating in — which is how
			// the first run silently skipped the close and photographed the
			// wrong profile. Wait for the state instead.
			const closeShift = page.locator('[data-test="quick-action-close-shift"]').first();
			const closeShiftReady = await closeShift
				.waitFor({ state: "visible", timeout: 6_000 })
				.then(() => true)
				.catch(() => false);
			if (closeShiftReady) {
				await closeShift.click().catch(() => {});
				await page.waitForTimeout(2_000);
				await shoot(page, dir, "corte");
				captured.push("corte");
				await page.getByRole("button", { name: /^submit$/i }).first().click().catch(() => {});
				await page.waitForTimeout(6_000);
			} else {
				await page.keyboard.press("Escape");
			}
		}
		await opening.waitFor({ timeout: 20_000 }).catch(() => {});
	}

	if (await opening.isVisible().catch(() => false)) {
		await pickIfNeeded(page, "Company", COMPANY);
		await page.waitForTimeout(900);
		await pickIfNeeded(page, "POS Profile", PROFILE);
		await page.waitForTimeout(1_200);
		await shoot(page, dir, "apertura");
		captured.push("apertura");
		await page.locator(".v-table input, table input").last().fill("500").catch(() => {});
		// On a 390px viewport the dialog scrolls and Submit starts below the
		// fold. Playwright scrolls on click, but a snackbar over the button
		// wins the hit test, so clear that first and scroll explicitly.
		await dismissSnackbars(page);
		const submit = page.getByRole("button", { name: /^(submit|enviar)$/i }).first();
		await submit.scrollIntoViewIfNeeded().catch(() => {});
		await submit.click().catch(() => {});
		await opening.waitFor({ state: "hidden", timeout: 40_000 }).catch(() => {});
		await page.waitForTimeout(3_000);
		return PROFILE;
	}
	return "unknown (opening dialog never appeared)";
}

async function fillBasket(page: Page): Promise<number> {
	const box = page
		.locator(".v-input:has-text('Search, scan or browse') input, input[placeholder*='scan']")
		.first();
	let added = 0;
	for (const [term, rowText] of BASKET) {
		try {
			await box.click({ timeout: 5_000 });
			await box.fill(term);
			await page.waitForTimeout(1_400);
			await page.getByText(rowText, { exact: false }).first().click({ timeout: 5_000 });
			await page.waitForTimeout(700);
			await box.fill("");
			added++;
		} catch {
			/* catalogue differs on this tenant — recorded via the count */
		}
	}
	return added;
}

/**
 * Surfaces are named for what the OPERATOR calls them, not for the component
 * that renders them today. In the BEFORE set most are dialogs; in the AFTER
 * set they are rail destinations. The lane's whole value is that
 * `devolucion.png` compares to `devolucion.png` across that change.
 *
 * `viaMenu` entries live behind the actions menu and are selected by the
 * stable `data-test="quick-action-<id>"` hooks NavbarMenu.vue already ships.
 */
/**
 * AFTER-set surfaces, reached through the rail rather than the actions menu.
 *
 * One harness serves both sets on purpose. The BEFORE register has no rail, so
 * these are skipped and the menu path answers; the AFTER register has one, so
 * these answer and the menu path is skipped for the destinations it duplicates.
 * Two harnesses would drift, and a drifted evidence lane compares two things
 * that were never photographed the same way.
 *
 * Ids are the registry's, from `composables/pos/shell/railDestinations.ts` —
 * English, one namespace, per ruling R1. `sale` is omitted because it is
 * already captured as `venta`.
 */
const RAIL_SURFACES: Array<{ id: string; destination: string }> = [
	{ id: "explorar", destination: "browse" },
	{ id: "orden", destination: "serviceOrder" },
	{ id: "gasto", destination: "expense" },
	{ id: "borradores", destination: "drafts" },
	{ id: "facturas", destination: "invoices" },
	{ id: "devolucion", destination: "return" },
	{ id: "recarga", destination: "recharge" },
	{ id: "corte", destination: "closing" },
];

async function captureRailSurfaces(
	page: Page,
	dir: string,
	captured: string[],
	missed: string[],
): Promise<boolean> {
	const rail = page.locator('[data-testid="register-rail"]').first();
	if (!(await rail.isVisible().catch(() => false))) {
		return false; // BEFORE register, or a viewport below the rail's breakpoint
	}
	await shoot(page, dir, "riel");
	captured.push("riel");

	for (const surface of RAIL_SURFACES) {
		const item = page.locator(`[data-rail-destination="${surface.destination}"]`).first();
		if (!(await item.isVisible().catch(() => false))) {
			// Absent, not disabled — a gated destination does not appear at all
			// (ruling R3), so this is information about the preset, not a miss.
			missed.push(`${surface.id} (not on this preset's rail)`);
			continue;
		}
		await item.click().catch(() => {});
		await page.waitForTimeout(1_800);
		await shoot(page, dir, surface.id);
		captured.push(surface.id);
		// A destination that renders as a sheet covers the rail, so the NEXT
		// item's visibility check answers false and the manifest reports
		// "not on this preset's rail" about a rail item plainly visible in the
		// screenshot just taken. Clear it before asking again.
		await dismissOverlays(page);
	}

	// Back to the sale, then photograph the cajón open — the drawer IS the
	// redesign's density argument, so a set without it is missing the point.
	const sale = page.locator('[data-rail-destination="sale"]').first();
	await sale.click().catch(() => {});
	await page.waitForTimeout(1_500);
	await page.keyboard.press("Alt+b");
	await page.waitForTimeout(1_200);
	const drawer = page.locator('[data-testid="catalog-drawer"]').first();
	const openState = await drawer.getAttribute("data-drawer-state").catch(() => null);
	if (openState === "open" || openState === "opening") {
		await shoot(page, dir, "cajon-abierto");
		captured.push("cajon-abierto");
		await page.keyboard.press("Escape");
		await page.waitForTimeout(900);
	} else {
		missed.push(`cajon-abierto (drawer state was ${String(openState)})`);
	}
	return true;
}

const MENU_SURFACES: Array<{ id: string; action: string }> = [
	{ id: "orden", action: "charge-requests" },
	{ id: "facturacion", action: "facturacion" },
	{ id: "sincronizar", action: "sync-offline-sales" },
];

for (const viewport of VIEWPORTS) {
	test(`capture ${LABEL} · ${viewport.name}`, async ({ page }) => {
		test.setTimeout(300_000);
		const dir = resolve(evidenceRoot, viewport.name);
		const captured: string[] = [];
		const missed: string[] = [];

		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await login(page);
		await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(7_000);

		// Overlays FIRST. `ensureProfile` has to open the actions menu to reach
		// Close Shift, and at boot the register may still be sitting under a
		// dialog left by a previous session — the menu trigger is then covered,
		// the click is swallowed, and the profile switch silently does not
		// happen. Two capture runs photographed the wrong preset that way, and
		// on a lean-vertical preset the rail does not render at all, so the
		// AFTER set would have shown no redesign.
		await dismissSnackbars(page);
		await page.waitForTimeout(1_500);
		const profileUsed = await ensureProfile(page, dir, captured);
		await dismissOverlays(page);

		await shoot(page, dir, "venta-vacia");
		captured.push("venta-vacia");

		const lines = await fillBasket(page);
		if (lines === 0) missed.push("basket (no demo SKU matched)");
		await shoot(page, dir, "venta");
		captured.push("venta");

		// The dock is the mobile nav; its presence on a 1440 capture means a
		// capability preset forced lean vertical, and the manifest should say so
		// rather than leave the reader to notice it in the image.
		const dockVisible = await page
			.locator(".mobile-dock__tabs")
			.first()
			.isVisible()
			.catch(() => false);

		const railAnswered = await captureRailSurfaces(page, dir, captured, missed);

		if (await openActionsMenu(page)) {
			await shoot(page, dir, "menu");
			captured.push("menu");
			// The rail is the desktop nav once it exists; the menu keeps only
			// what was never a destination (settings, printing, cashier tools).
			for (const surface of railAnswered ? [] : MENU_SURFACES) {
				const item = page.locator(`[data-test="quick-action-${surface.action}"]`).first();
				if (!(await item.isVisible().catch(() => false))) {
					missed.push(`${surface.id} (action not offered by this profile)`);
					continue;
				}
				await item.click().catch(() => {});
				await page.waitForTimeout(2_000);
				await shoot(page, dir, surface.id);
				captured.push(surface.id);
				await dismissOverlays(page);
				if (!(await openActionsMenu(page))) break;
			}
			await dismissOverlays(page);
		} else {
			missed.push("menu (actions trigger not found)");
		}

		// Payment last: it is the surface most likely to leave state behind.
		const pay = page.getByRole("button", { name: /^(pay|pagar)$/i }).first();
		if (lines > 0 && (await pay.isVisible().catch(() => false))) {
			await pay.click().catch(() => {});
			await page.waitForTimeout(3_000);
			await shoot(page, dir, "cobro");
			captured.push("cobro");
			await dismissOverlays(page);
		} else {
			missed.push("cobro (no basket or pay not offered)");
		}

		mkdirSync(dir, { recursive: true });
		writeFileSync(
			resolve(dir, "manifest.json"),
			JSON.stringify(
				{
					label: LABEL,
					viewport: viewport.name,
					capturedAt: new Date().toISOString(),
					posProfile: profileUsed,
					cartLines: lines,
					mobileDockVisible: dockVisible,
					railPresent: railAnswered,
					captured,
					missed,
				},
				null,
				2,
			) + "\n",
		);

		expect(
			captured.length,
			`captured nothing at ${viewport.name} — misses: ${missed.join(", ")}`,
		).toBeGreaterThan(0);
	});
}
