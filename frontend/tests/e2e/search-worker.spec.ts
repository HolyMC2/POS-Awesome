import { expect, test } from "@playwright/test";
import { BASE_URL, openRegister } from "./support/registerDrill";

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set");

test("compiled search worker searches and patches its index, including offline startup", async ({ page, context }) => {
	test.setTimeout(180_000);
	await openRegister(page);
	const manifest = await (await page.request.get("/assets/posawesome/dist/js/version.json")).json();
	const workerUrl = manifest.assets.chunks.find((url: string) => /\/searchWorker-[\w-]+\.js$/.test(url));
	expect(workerUrl, "search worker must be compiled JavaScript in the offline manifest").toBeTruthy();
	await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 90_000 });
	for (const offline of [false, true]) {
		await context.setOffline(offline);
		const result = await page.evaluate(async (url) => {
			const worker = new Worker(url, { type: "module" });
			try {
				const reply = (message: Record<string, unknown>, op: string): Promise<any> => new Promise((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error(`Worker ${op} timed out`)), 5000);
					worker.onerror = () => { clearTimeout(timeout); reject(new Error("Worker did not execute")); };
					worker.onmessage = ({ data }) => {
						if (data.op === op) { clearTimeout(timeout); resolve(data); }
					};
					worker.postMessage(message);
				});
				await reply({ op: "set_index", entries: [
					{ code: "A", idx: "red box barcode-a", group: "Stock" },
					{ code: "B", idx: "red box barcode-b", group: "Services" },
				] }, "ready");
				const first = await reply({ op: "search", id: 1, term: "red box", group: "Stock" }, "search_result");
				worker.postMessage({ op: "patch_index", entries: [
					{ code: "C", idx: "red box barcode-c", group: "Stock" },
				], removals: ["A"] });
				const patched = await reply({ op: "search", id: 2, term: "red box", group: "Stock" }, "search_result");
				return { first: first.codes, patched: patched.codes };
			} finally { worker.terminate(); }
		}, workerUrl);
		expect(result).toEqual({ first: ["A"], patched: ["C"] });
	}
});
