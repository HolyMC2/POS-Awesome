import process from "node:process";
// Run from frontend: node tests/visual/check-closing-layout.mjs
//
// What the custody corte does with the width it is given. Real components,
// simulated server, localhost only. Layout evidence — not ledger proof.
//
// The defect this answers for (live capture 2026-09-15, `closing-count.png`):
// the count/bag form ran past the fold in a left column while the whole right
// column stood empty and the payment reconciliation was a scroll away.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.env.CLOSING_LAYOUT_OUTPUT || "/tmp/pos-next-wave/layout";
const server = await createServer({
	root,
	configFile: resolve(root, "vite.config.js"),
	server: { host: "127.0.0.1", port: 0 },
	logLevel: "error",
});

/** Boxes of the regions the corte is made of, in page coordinates. */
const measure = () => {
	const box = (selector) => {
		const node = document.querySelector(selector);
		if (!node) return null;
		const { top, bottom, left, right, width, height } =
			node.getBoundingClientRect();
		return {
			top: Math.round(top),
			bottom: Math.round(bottom),
			left: Math.round(left),
			right: Math.round(right),
			width: Math.round(width),
			height: Math.round(height),
		};
	};
	const scrollers = [...document.querySelectorAll("*")]
		.filter(
			(node) =>
				node.scrollHeight - node.clientHeight > 4 &&
				["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
				node.clientHeight > 0,
		)
		.map((node) => node.className?.toString?.() || node.tagName);
	return {
		layout: box(".closing-layout"),
		body: box(".closing-body"),
		count: box(".closing-layout__count"),
		allocation: box('[data-testid="cash-closing-allocation"]'),
		countStep: box('[data-testid="cash-closing-count"]'),
		bagsStep: box('[data-testid="cash-closing-bags"]'),
		reconciliation: box(".reconciliation-section"),
		// The reconciliation table keeps its own sideways scroll when the column
		// is narrower than its six columns; on a wide corte it should not need it.
		tableOverflow: (() => {
			const wrapper = document.querySelector(
				".reconciliation-section .v-table__wrapper",
			);
			return wrapper ? wrapper.scrollWidth - wrapper.clientWidth : null;
		})(),
		band: box(".closing-band"),
		scrollers,
		documentScrollWidth: document.documentElement.scrollWidth,
		viewport: { width: innerWidth, height: innerHeight },
	};
};

let browser;
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	const url = `${origin}/assets/posawesome/dist/js/tests/visual/fixtures/closing-layout.html`;
	browser = await chromium.launch({ headless: true });
	await mkdir(out, { recursive: true });
	const errors = [];
	const evidence = [];

	/** Count two 100s and save them, which is what makes the bags step exist. */
	const countAndSave = async (page) => {
		const face = page
			.getByTestId("cash-closing-count")
			.locator('[data-face-minor="10000"]');
		await face.getByTestId("denomination-count").fill("2");
		await page.getByTestId("cash-closing-save").click();
		await expect(page.getByTestId("cash-closing-bags")).toBeVisible();
	};

	for (const [size, width, height] of [
		["wide", 1680, 1000],
		["desktop", 1440, 900],
		["tablet", 1180, 820],
		["phone", 390, 844],
	]) {
		const page = await browser.newPage({ viewport: { width, height } });
		page.on("pageerror", (error) => errors.push(`${size}: ${error.message}`));
		await page.route("**/*", (route) =>
			route.request().url().startsWith(origin)
				? route.continue()
				: route.abort(),
		);
		await page.goto(`${url}?scenario=custody`);
		await expect(page.getByTestId("cash-closing-allocation")).toBeVisible();
		await countAndSave(page);
		await page.waitForTimeout(120);
		// The count control the journey typed into scrolls the body; the corte
		// is judged from the top, where the cashier meets it.
		await page.evaluate(() => {
			document.querySelector(".closing-body").scrollTop = 0;
		});
		const m = await page.evaluate(measure);
		await page.screenshot({ path: `${out}/custody-${size}.png` });
		await page.evaluate(() => {
			const body = document.querySelector(".closing-body");
			body.scrollTop = body.scrollHeight;
		});
		await page.screenshot({ path: `${out}/custody-${size}-bottom.png` });
		await page.evaluate(() => {
			document.querySelector(".closing-body").scrollTop = 0;
		});
		evidence.push({ scenario: "custody", size, ...m });

		// 1. Nothing runs off the side, at any of the three widths.
		expect(m.documentScrollWidth, `${size} horizontal overflow`).toBeLessThanOrEqual(width + 1);

		// 2. The close action is pinned outside the scrollport and on screen.
		expect(m.band, `${size} has no band`).not.toBeNull();
		expect(m.band.bottom, `${size} band below the fold`).toBeLessThanOrEqual(height + 1);
		await expect(page.getByTestId("band-primary")).toBeVisible();

		// 3. One scrollport, never a labyrinth: only the body may scroll.
		expect(m.scrollers.length, `${size} nested scrollers: ${m.scrollers}`).toBeLessThanOrEqual(1);

		// 4. Touch stays 48px where the cashier presses.
		const save = await page.getByTestId("cash-closing-save").boundingBox();
		expect(save.height, `${size} save touch height`).toBeGreaterThanOrEqual(48);
		const step = await page
			.getByTestId("cash-closing-count")
			.locator('[data-face-minor="10000"] [data-testid="denomination-increment"]')
			.boundingBox();
		expect(step.height, `${size} stepper touch height`).toBeGreaterThanOrEqual(44);

		if (size === "desktop" || size === "wide") {
			// 5. Three columns: count · bags · payment evidence, all abreast.
			expect(m.bagsStep.left, "bags are not beside the count").toBeGreaterThanOrEqual(m.countStep.right - 1);
			expect(m.bagsStep.top, "bags start below the count").toBeLessThan(m.countStep.bottom);
			expect(
				m.reconciliation.left,
				"the payment review is not its own column",
			).toBeGreaterThanOrEqual(m.count.right - 1);
			// 6. The payment review is readable where it stands, and reachable
			//    without scrolling — the distance the live capture showed.
			expect(m.reconciliation.width, "payment review starved").toBeGreaterThanOrEqual(330);
			expect(m.reconciliation.top, "payment review below the fold").toBeLessThan(height);
			// 7. Never a screenful of nothing beside the count: the live capture
			//    scrolled a whole viewport of empty right-hand column. What is
			//    left under the evidence now has to stay under that.
			const unused = m.layout.bottom - m.reconciliation.bottom;
			expect(unused, "empty column beside the count").toBeLessThan(m.viewport.height * 0.6);
			// A screen wide enough gives the six reconciliation columns their
			// own width instead of a sideways scroll inside a column.
			if (size === "wide")
				expect(m.tableOverflow, "payment table still scrolls sideways").toBeLessThanOrEqual(1);
		} else {
			// The stacked corte: the count sits above the payment evidence, and
			// the two custody steps still share the full width where they fit.
			expect(m.reconciliation.top, `${size} keeps a side column`).toBeGreaterThanOrEqual(m.countStep.top);
			if (size === "tablet")
				expect(m.bagsStep.left, "tablet bags are not beside the count").toBeGreaterThanOrEqual(m.countStep.right - 1);
			if (size === "phone") {
				expect(m.bagsStep.top, "phone stacks the bags under the count").toBeGreaterThanOrEqual(m.countStep.bottom - 1);
				expect(m.allocation.width, "phone allocation overflows").toBeLessThanOrEqual(width);
			}
		}

		// 8. The ordinary (non-custody) corte still draws count beside evidence.
		await page.goto(`${url}?scenario=plain`);
		await expect(page.locator(".closing-layout")).toBeVisible();
		await page.waitForTimeout(120);
		const plain = await page.evaluate(measure);
		await page.screenshot({ path: `${out}/plain-${size}.png` });
		evidence.push({ scenario: "plain", size, ...plain });
		expect(plain.allocation, `${size} plain draws the custody workspace`).toBeNull();
		expect(plain.documentScrollWidth, `${size} plain horizontal overflow`).toBeLessThanOrEqual(width + 1);
		if (size === "desktop")
			expect(plain.reconciliation.left, "plain corte lost its two columns").toBeGreaterThanOrEqual(plain.count.right - 1);

		// 9. Blind count: no expected/difference figure leaks into the custody
		//    workspace, at any width.
		await page.goto(`${url}?scenario=blind`);
		await expect(page.getByTestId("cash-closing-allocation")).toBeVisible();
		await expect(page.getByTestId("cash-closing-difference")).toHaveCount(0);
		await page.screenshot({ path: `${out}/blind-${size}.png` });

		await page.close();
	}

	await writeFile(`${out}/measurements.json`, JSON.stringify({ evidence, errors }, null, 2));
	if (errors.length) throw Error([...new Set(errors)].join("\n"));
	console.log(
		JSON.stringify({
			viewports: 4,
			cases: evidence.length,
			errors: 0,
			output: out,
		}),
	);
} finally {
	await browser?.close();
	await server.close();
}
