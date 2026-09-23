import process from "node:process";
// Real UI components; simulated server. Live ledger proof uses tests/e2e/cash-custody-*-lab.mjs.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = process.cwd(),
	out = process.env.POSA_CUSTODY_ARTIFACTS || "/tmp/pos-cash-workspace-20260922/visual";
await mkdir(out, { recursive: true });
const server = await createServer({
	root,
	configFile: resolve(root, "vite.config.js"),
	server: { host: "127.0.0.1", port: 0 },
	logLevel: "error",
});
let browser;
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({ headless: true });
	const errors = [],
		evidence = [];
	const path = `${origin}/assets/posawesome/dist/js/tests/visual/fixtures/custody.html`;
	for (const [size, width, height] of [
		["desktop", 1440, 900],
		["touch", 1024, 768],
		["phone", 390, 844],
	]) {
		const page = await browser.newPage({ viewport: { width, height } });
		page.on("pageerror", (e) => errors.push(e.message));
		await page.route("**/*", (r) =>
			r.request().url().startsWith(origin) ? r.continue() : r.abort(),
		);
		for (const scenario of [
			"cashier",
			"supervisor",
			"closing",
			"empty",
			"error",
		]) {
			await page.goto(
				`${path}?scenario=${scenario}&theme=${size === "touch" ? "dark" : "light"}`,
			);
			await expect(
				page.getByTestId(
					scenario === "closing"
						? "cash-closing-allocation"
						: "cash-custody",
				),
			).toBeVisible();
			await page.waitForTimeout(150);
			const metrics = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				viewport: innerWidth,
				buttons: [...document.querySelectorAll("button")]
					.filter((b) => b.getBoundingClientRect().height > 0)
					.map((b) => ({
						text: b.textContent.trim(),
						height: Math.round(b.getBoundingClientRect().height),
					})),
			}));
			await page.screenshot({
				path: `${out}/${scenario}-${size}.png`,
				fullPage: true,
			});
			evidence.push({ scenario, size, ...metrics });
			expect(
				metrics.scrollWidth,
				`${scenario}/${size} horizontal overflow`,
			).toBeLessThanOrEqual(width + 1);
		}
		// Selecting the suggested task moves keyboard focus to its record and exposes the next action.
		await page.goto(`${path}?scenario=cashier&theme=dark`);
		await page
			.getByRole("button", { name: /Bags you can count and receive/ })
			.click();
		await expect(page.locator(".record-detail h3")).toBeFocused();
		await page
			.getByRole("button", { name: "Receive into drawer", exact: true })
			.click();
		await expect(page.locator("form")).toBeVisible();
		await expect(page.locator("form")).toContainText(
			"Count the cash you received",
		);
		await page.screenshot({
			path: `${out}/receive-${size}.png`,
			fullPage: true,
		});
		// Real counting controls and allocation contract: edit after save must revoke readiness.
		await page.goto(`${path}?scenario=closing&theme=dark`);
		const drawer = page.getByTestId("cash-closing-count");
		const face = drawer.locator('[data-face-minor="10000"]');
		await face.getByTestId("denomination-count").fill("2");
		await expect(drawer.getByTestId("cash-count-total")).toContainText(
			"200.00",
		);
		const hit = await face
			.getByTestId("denomination-increment")
			.boundingBox();
		expect(hit.width, "count stepper touch width").toBeGreaterThanOrEqual(
			44,
		);
		expect(hit.height, "count stepper touch height").toBeGreaterThanOrEqual(
			44,
		);
		await page.getByTestId("cash-closing-save").click();
		await page.getByLabel("Bag seal / ID").fill("FLOAT-NEW");
		await expect(page.getByTestId("cash-closing-ready")).toBeVisible();
		expect(
			await page.evaluate(
				() =>
					window.custodyFixture.events.prepared.bags[0].count
						.denominations,
			),
		).toEqual([{ value: 100, quantity: 2 }]);
		await face.getByTestId("denomination-increment").click();
		await expect(page.getByTestId("cash-closing-ready")).toHaveCount(0);
		await expect(page.getByTestId("cash-closing-saved")).toContainText(
			"Unsaved changes",
		);
		await page.getByTestId("cash-closing-save").click();
		await page.getByTestId("cash-closing-fill").click();
		await expect(page.getByTestId("cash-closing-ready")).toBeVisible();
		await page.screenshot({
			path: `${out}/closing-ready-${size}.png`,
			fullPage: true,
		});
		await page.goto(`${path}?scenario=closing&lang=es&theme=dark`);
		await expect(
			page.getByRole("heading", {
				name: "Cuenta el efectivo de la caja",
			}),
		).toBeVisible();
		await page.screenshot({
			path: `${out}/closing-spanish-${size}.png`,
			fullPage: true,
		});
		await page.close();
	}
	await writeFile(
		out + "/measurements.json",
		JSON.stringify({ evidence, errors }, null, 2),
	);
	if (errors.length) throw Error([...new Set(errors)].join("\n"));
	console.log(
		JSON.stringify({
			layoutCases: evidence.length,
			interactiveJourneys: 6,
			spanishCases: 3,
			errors: 0,
			output: out,
		}),
	);
} finally {
	await browser?.close();
	await server.close();
}
