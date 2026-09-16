// Run from frontend: node tests/visual/check-closing.mjs
// Starts a localhost-only preview. All server responses come from the fixture.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.env.CLOSING_REVIEW_OUTPUT || "/tmp/pos-closing-review";
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
	const url = `${origin}/assets/posawesome/dist/js/tests/visual/fixtures/closing.html`;
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) =>
		route.request().url().startsWith(origin)
			? route.continue()
			: route.abort(),
	);
	await mkdir(output, { recursive: true });
	await page.goto(`${url}?scenario=cashier`);
	await expect(page.getByTestId("closing-terminal-help")).toBeVisible();
	await expect(page.getByTestId("closing-recover")).toHaveCount(0);
	await expect(page.getByTestId("closing-register-released")).toHaveCount(0);
	await expect(page.getByTestId("band-primary")).toBeDisabled();
	await page.screenshot({ path: `${output}/cashier-handoff.png` });
	await page.getByTestId("closing-terminal-help").click();
	await expect(page.locator('[data-test="offline-status-panel"]')).toBeVisible();
	await page.locator('.offline-status-panel__close').click();
	await expect(page.getByTestId("closing-terminal-help")).toBeVisible();
	await page.goto(`${url}?scenario=released`);
	await page.getByTestId("closing-register-released").click();
	await expect(page.getByText("This browser is ready to close the shift.", { exact: true })).toBeVisible();

	await page.goto(`${url}?scenario=legacy`);
	await expect(page.getByTestId("closing-recovery-reviewed")).toBeVisible();
	await expect(page.getByTestId("band-primary")).toBeDisabled();
	await page.screenshot({ path: `${output}/legacy-desktop.png` });
	await page.getByTestId("closing-recovery-reviewed").check();
	await page
		.getByTestId("closing-recovery-reason")
		.fill("Checked previous browser: no unsynced sales or cash movements.");
	await page.getByTestId("closing-recover").click();
	await expect(
		page.getByText("This browser is ready to close the shift.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(page.getByTestId("band-primary")).toBeDisabled();
	await page.getByTestId("closing-review-accept").check();
	const input = page.locator('[data-face-minor="100000"] input').first();
	await input.fill("1");
	await page.getByTestId("band-primary").click();
	await expect(page.getByTestId("closing-error")).toBeVisible();
	await expect(input).toHaveValue("1");
	await page.screenshot({ path: `${output}/refused-desktop.png` });

	await page.goto(`${url}?scenario=ready`);
	await expect(
		page.getByText("This browser is ready to close the shift.", {
			exact: true,
		}),
	).toBeVisible();
	await page.getByTestId("closing-review-accept").check();
	await page.screenshot({ path: `${output}/ready-desktop.png` });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByTestId("band-primary")).toBeInViewport();
	await expect(page.getByTestId("movil-corte")).toHaveCount(0);
	await page.screenshot({ path: `${output}/ready-phone.png` });
	await page.goto(`${url}?scenario=blind`);
	await expect(page.getByTestId("closing-submit")).toBeVisible();
	await expect(page.getByTestId("action-band")).toHaveCount(0);
	await expect(page.getByTestId("movil-corte-note")).toHaveCount(0);
	await expect(
		page.getByText("Expected in drawer", { exact: true }),
	).toHaveCount(0);
	if (errors.length) throw Error(errors.join("\n"));
	console.log(
		`PASS: recovery, consent, retained count, responsive footer and blind-count privacy. Screenshots: ${output}`,
	);
} finally {
	await browser?.close();
	await server.close();
}
