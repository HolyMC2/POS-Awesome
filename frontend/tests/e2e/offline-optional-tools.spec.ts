import { expect, test } from "@playwright/test";
import { BASE_URL, openRegister } from "./support/registerDrill";

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set");

test("optional tools stay out of startup and first-load offline; receipt text cannot execute", async ({ page, context }) => {
	test.setTimeout(180_000);
	await openRegister(page);
	const manifest = await (await page.request.get("/assets/posawesome/dist/js/version.json")).json();
	const renderer = manifest.assets.chunks.find((url: string) => /\/offline_print_template-[\w-]+\.js$/.test(url));
	expect(renderer).toBeTruthy();
	const eagerTools = await page.evaluate(() => performance.getEntriesByType("resource")
		.filter((entry) => /\/(calendar|receipt|camera)-vendor-/.test(entry.name)).map((entry) => entry.name));
	expect(eagerTools).toEqual([]);
	await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 90_000 });
	await context.setOffline(true);
	const result = await page.evaluate(async ({ renderer, offlineIndex }) => {
		const app = (document.querySelector("[data-v-app]") as any)?.__vue_app__;
		if (!app) throw new Error("The register Vue app is not mounted");
		const calendar = await app.component("VueDatePicker").__asyncLoader();
		const cache = await import(offlineIndex);
		const previous = { template: cache.getPrintTemplate(), terms: cache.getTermsAndConditions() };
		const frame = document.createElement("iframe");
		(window as any).__receiptExecuted = false;
		try {
			cache.setPrintTemplate('<html><head><style>.total{font-weight:bold}</style></head><body><h1>{{ doc.customer_name }}</h1><p class="total">{{ doc.paid_amount }}</p>{{ terms|safe }}</body></html>');
			cache.setTermsAndConditions('<b>Keep your receipt</b><script>parent.__receiptExecuted=true</script><img src="missing" onerror="parent.__receiptExecuted=true">');
			const { default: render } = await import(renderer);
			const customer = '<img src="missing" onerror="parent.__receiptExecuted=true">';
			const html = await render({ name: "LOCAL-PRINT-CHECK", customer_name: customer, is_credit_sale: 1,
				grand_total: 100, payments: [{ amount: 20 }], items: [] });
			frame.srcdoc = html;
			document.body.append(frame);
			await new Promise((resolve) => setTimeout(resolve, 300));
			const doc = frame.contentDocument!;
			return { calendarReady: typeof calendar.setup === "function" || typeof calendar.render === "function",
				customer: doc.querySelector("h1")?.textContent, expectedCustomer: customer,
				paid: doc.querySelector(".total")?.textContent,
				terms: doc.querySelector("b")?.textContent,
				unsafe: !!doc.querySelector("script, [onerror], iframe"), executed: (window as any).__receiptExecuted };
		} finally {
			frame.remove(); cache.setPrintTemplate(previous.template); cache.setTermsAndConditions(previous.terms);
			delete (window as any).__receiptExecuted;
		}
	}, { renderer, offlineIndex: manifest.assets.offlineIndex });
	expect(result.calendarReady).toBe(true);
	expect(result.customer).toBe(result.expectedCustomer);
	expect(result.paid).toBe("20");
	expect(result.terms).toBe("Keep your receipt");
	expect(result.unsafe).toBe(false);
	expect(result.executed).toBe(false);
});
