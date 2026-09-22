// Run from frontend: node tests/visual/check-mobile-scroll.mjs
// Isolated long-cart, payment and short-screen closing regression checks.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const out =
	process.env.MOBILE_SCROLL_OUTPUT || "/tmp/pos-mobile-work/scroll-evidence";
const server = await createServer({
	root: process.cwd(),
	configFile: resolve("vite.config.js"),
	server: { host: "127.0.0.1", port: 0 },
	logLevel: "error",
});
let browser;
const errors = [];
const results = [];
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	const base = `${origin}/assets/posawesome/dist/js/tests/visual/fixtures`;
	browser = await chromium.launch();
	await mkdir(out, { recursive: true });
	for (const [width, height] of [
		[320, 568],
		[390, 720],
		[390, 430],
		[844, 390],
		[768, 1024],
		[1024, 768],
	]) {
		const page = await browser.newPage({
			viewport: { width, height },
			hasTouch: true,
		});
		page.on("pageerror", (error) => errors.push(error.message));
		await page.route("**/*", (route) =>
			route.request().url().startsWith(origin)
				? route.continue()
				: route.abort(),
		);
		for (const screen of ["cart", "pay", "closing", "dashboard"]) {
			await page.goto(
				`${base}/${screen === "closing" ? "responsive-closing.html" : `mobile-scroll.html?screen=${screen}`}`,
			);
			if (screen === "dashboard") {
				await page
					.getByRole("button", { name: "Inventory", exact: true })
					.or(
						page.getByRole("tab", {
							name: "Inventory",
							exact: true,
						}),
					)
					.filter({ visible: true })
					.click();
				await expect(
					page.locator(".list-stack:visible .insight-row").last(),
				).toBeAttached();
			}
			const target =
				screen === "dashboard"
					? page.locator(".list-stack:visible .insight-row").last()
					: page.getByTestId(
							screen === "cart"
								? "movil-primary"
								: screen === "pay"
									? "movil-collect"
									: "movil-corte-primary",
						);
			await expect(target).toBeVisible();
			if (screen === "cart") {
				await expect(page.getByTestId("movil-cart-line")).toHaveCount(
					24,
				);
				await page.getByTestId("movil-cart-line").last().click();
			}
			if (screen === "pay") {
				await page.getByTestId("movil-key-2").click();
				await page.getByTestId("movil-key-0").click();
				await expect(
					page.getByTestId("movil-keyed-amount"),
				).toContainText("20");
			}
			await target.scrollIntoViewIfNeeded();
			await expect(target).toBeInViewport({ ratio: 0.99 });
			const geometry = await page.evaluate(() => {
				const scrollers = [...document.querySelectorAll("*")].filter(
					(el) =>
						el.clientHeight > 0 &&
						el.scrollHeight > el.clientHeight + 3 &&
						/auto|scroll/.test(getComputedStyle(el).overflowY),
				);
				return {
					width: document.documentElement.scrollWidth,
					height: document.documentElement.scrollHeight,
					nested: scrollers
						.filter((el) =>
							scrollers.some(
								(parent) =>
									parent !== el && parent.contains(el),
							),
						)
						.map((el) => el.className),
					bodyHeight:
						document.querySelector(".closing-body")?.clientHeight,
				};
			});
			expect(
				geometry.width,
				`${screen} sideways overflow at ${width}`,
			).toBeLessThanOrEqual(width + 1);
			expect(
				geometry.height,
				`${screen} document scrolls at ${height}`,
			).toBeLessThanOrEqual(height + 1);
			expect(geometry.nested, `${screen} nested scroll`).toEqual([]);
			if (screen === "closing")
				expect(
					geometry.bodyHeight,
					"closing body starved",
				).toBeGreaterThan(100);
			await page.screenshot({
				path: `${out}/${screen}-${width}x${height}.png`,
			});
			results.push({ screen, width, height, ...geometry });
		}
		await page.close();
	}
	expect(errors).toEqual([]);
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	console.log(JSON.stringify({ cases: results.length, errors, output: out }));
} finally {
	await browser?.close();
	await server.close();
}
