#!/usr/bin/env node
// Controlled lab-only browser capture. Credentials come from the smoke env file.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { observeRegisterConfiguration, probeCheckout, installBenchmarkIdentity } from "./checkout_probe.mjs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const baseURL = process.env.POSA_SMOKE_BASE_URL;
const target = new URL(baseURL || "http://invalid");
if (!target.hostname.endsWith(".lab.xoloitzcuintles.com") &&
    !["localhost", "127.0.0.1"].includes(target.hostname)) {
  throw new Error("Browser measurements require an explicit lab target");
}
const runs = Number(process.env.POSA_BENCH_RUNS || 5);
const diagnostics = process.env.POSA_BENCH_DIAGNOSTICS === "1";
const checkoutEnabled = process.env.POSA_BENCH_CHECKOUT !== "0";
const expectedVersion = process.env.POSA_BENCH_EXPECT_VERSION;
// The established golden-flow fixture is stocked/priced on this lab tenant.
// Other tenants opt in with their own fixture; absent one, report no proof.
const checkoutFixture = process.env.POSA_BENCH_ITEM ||
  (target.hostname === "demo-abarrotes.lab.xoloitzcuintles.com" ? "Detergente en polvo (kg)" : null);
if (!Number.isInteger(runs) || runs < 1 || runs > 30) throw new Error("Invalid run count");
const out = resolve(process.argv[2] || "/tmp/pos-register-measurement.json");
const browser = await chromium.launch({ headless: true });
const captures = [];
try {
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 } });
    try {
      const login = await context.request.post("/api/method/login", { form: {
        usr: process.env.POSA_SMOKE_USER, pwd: process.env.POSA_SMOKE_PASSWORD,
      }});
      if (!login.ok()) throw new Error(`Login failed: ${login.status()}`);
      const page = await context.newPage();
      await installBenchmarkIdentity(page, baseURL, process.env.POSA_SMOKE_USER);
      await page.addInitScript(observeRegisterConfiguration);
      await page.addInitScript((diagnostics) => {
        window.__benchLcp = 0;
        window.__benchLcpCandidates = [];
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            window.__benchLcp = entry.startTime;
            if (diagnostics) window.__benchLcpCandidates.push({ ms: entry.startTime, size: entry.size,
              tag: entry.element?.tagName, classes: String(entry.element?.className || ""),
              testid: entry.element?.getAttribute("data-testid"),
              font: entry.element ? getComputedStyle(entry.element).fontFamily : null });
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
        performance.setResourceTimingBufferSize(5000);
      }, diagnostics);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      // Fixed conditions for BOTH captures; timings are lab observations.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false, latency: 40, downloadThroughput: 625000,
        uploadThroughput: 250000, connectionType: "wifi",
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      for (const mode of ["cold", "warm"]) {
        const search = page.locator('[data-perf-tag="item-search"] input').first();
        try {
          await page.goto("/posapp", { waitUntil: "domcontentloaded", timeout: 90000 });
          await search.waitFor({ state: "visible", timeout: 90000 });
        } catch (error) {
          await page.screenshot({ path: `${out}.failure.png`, fullPage: true }).catch(() => {});
          console.error(JSON.stringify({ failed_url: page.url(), run: run + 1, mode,
            error: error.message, title: await page.title().catch(() => "unavailable"),
            body: (await page.locator("body").innerText().catch(() => "unavailable")).slice(0, 3000) }));
          throw error;
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const readyMs = await page.evaluate(() => performance.now());
        await page.waitForTimeout(2000);
        const sample = await page.evaluate(() => {
          const resources = performance.getEntriesByType("resource").filter(r =>
            r.name.includes("/assets/posawesome/dist/js/") && new URL(r.name).pathname.endsWith(".js"));
          const paths = new Map();
          for (const r of resources) {
            const path = new URL(r.name).pathname;
            if (!paths.has(path)) paths.set(path, new Set());
            paths.get(path).add(r.name);
          }
          return { build_version: window.posawesome_build_version,
            lcp_ms: window.__benchLcp, lcp_candidates: window.__benchLcpCandidates,
            fonts: performance.getEntriesByType("resource").filter(r => /\.(woff2?|ttf)(\?|$)/.test(r.name))
              .map(r => ({ path: new URL(r.name).pathname, start_ms: r.startTime, end_ms: r.responseEnd })),
            sw_controlled: !!navigator.serviceWorker?.controller,
            js_requests: resources.length,
            js_transfer_bytes: resources.reduce((n, r) => n + r.transferSize, 0),
            js_encoded_bytes: resources.reduce((n, r) => n + r.encodedBodySize, 0),
            duplicate_module_paths: [...paths].filter(([, urls]) => urls.size > 1).map(([path]) => path),
          };
        });
        if (expectedVersion && sample.build_version !== expectedVersion) {
          throw new Error(`Expected build ${expectedVersion}; page served ${sample.build_version}`);
        }
        const capture = { run: run + 1, mode, ready_ms: readyMs,
          ready_signal: "search_visible", ...sample };
        captures.push(capture);
        if (mode === "cold") {
          await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 90000 });
        }
        // Sample legacy JS/LCP metrics BEFORE exercising the payment screen.
        // The workflow duration is separate because this probe starts after
        // the original two-second sampling window and service-worker install.
        Object.assign(capture, !checkoutEnabled ? {
          checkout_ready_ms: null, checkout_status: "disabled_for_startup_comparison",
        } : mode === "warm" ? await probeCheckout(page, checkoutFixture) : {
          checkout_ready_ms: null,
          checkout_status: "measured_after_warm_sample_to_preserve_baseline_cache",
        });
        Object.assign(capture, await page.evaluate(() => ({
          register_configuration_ready_ms: window.__benchConfigurationReady,
          register_configuration: window.__benchConfiguration || null,
        })));
        console.log(JSON.stringify(capture));
      }
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(out, JSON.stringify({ captured_at: new Date().toISOString(), baseURL,
    conditions: { latency_ms: 40, download_mbps: 5, cpu_slowdown: 4, viewport: "1440x1000",
      checkout_probe_enabled: checkoutEnabled },
    captures }, null, 2));
}
