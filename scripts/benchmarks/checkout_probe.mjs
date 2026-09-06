import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Browser-side observer: passive configuration readiness is not checkout proof.
export function observeRegisterConfiguration() {
  window.__benchConfigurationReady = null;
  const inspect = () => {
    // Production Vue removes devtools component pointers. Observe the actual
    // rendered contract, not private framework internals or fabricated state.
    const text = (selector) => document.querySelector(selector)?.textContent?.trim();
    const customer = text('[data-testid="customer-strip-name"]');
    const missingCustomer = window.__?.("No customer") || "No customer";
    window.__benchConfiguration = {
      register_identity_rendered: Boolean(text('[data-testid="register-status-subtitle"]')),
      price_list_rendered: Boolean(text('[data-chip="price-list"]')),
      customer_loaded: Boolean(customer && customer !== missingCustomer),
      // An armed chip is an optional operator choice, not the profile default.
      tender_methods_loaded: Boolean(document.querySelector('[data-testid="tender-chip"][data-tender-mode]')),
    };
    if (Object.values(window.__benchConfiguration).every(Boolean)) {
      window.__benchConfigurationReady = performance.now();
      return;
    }
    if (performance.now() < 90000) requestAnimationFrame(inspect);
  };
  requestAnimationFrame(inspect);
}

// Exercises a real fixture through normal UI. Never changes invoice/store state
// directly, submits a sale, or pretends an empty cart should be payable.
export async function probeCheckout(page, fixture) {
  const result = { checkout_ready_ms: null, checkout_probe_started_ms: null,
    checkout_probe_duration_ms: null, checkout_status: fixture ? "pending" : "not_configured" };
  if (!fixture) return result;
  if (await page.locator('[data-pos-keyboard-target="cart-row"]').count()) {
    return { ...result, checkout_status: "existing_cart_not_modified" };
  }
  result.checkout_probe_started_ms = await page.evaluate(() => performance.now());
  const search = page.locator('[data-perf-tag="item-search"] input').first();
  try {
    await page.waitForFunction(() => window.__benchConfigurationReady !== null, undefined, { timeout: 15000 });
    await search.fill(fixture);
    const row = page.locator(".posa-catalog-row, .card-item-card").filter({ hasText: fixture }).first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    await row.click();
    await page.locator('[data-pos-keyboard-target="cart-row"]').first().waitFor({ timeout: 15000 });
    await search.fill("");
    // Clicking uses the application's own primaryEnabled/payability gate.
    await page.getByTestId("band-primary").click({ timeout: 15000 });
    await page.getByTestId("cobro-tender-pad").waitFor({ state: "visible", timeout: 15000 });
    // Cobro renders the selected tender amount on its chip; amount inputs
    // were intentionally removed so tablets use the on-screen keypad.
    await page.locator('[data-testid="cobro-methods"] [aria-pressed="true"] [data-testid^="cobro-amount-"]')
      .first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(() => {
      const action = document.querySelector('[data-testid="band-primary"]');
      const amount = document.querySelector('[data-testid="cobro-methods"] [aria-pressed="true"] [data-testid^="cobro-amount-"]');
      return action && !action.disabled && Number(amount?.textContent?.replace(/,/g, "")) > 0;
    }, undefined, { timeout: 15000 });
    Object.assign(result, await page.evaluate(() => ({
      checkout_ready_ms: performance.now(),
      checkout_realtime_connected: Boolean(window.frappe?.realtime?.socket?.connected),
    })));
    result.checkout_probe_duration_ms = result.checkout_ready_ms - result.checkout_probe_started_ms;
    result.checkout_status = "ready";
    result.checkout_signal = "fixture_default_tender_payable";
  } catch (error) {
    result.checkout_status = "failed";
    result.checkout_error = error.message;
    result.checkout_ui = (await page.locator("body").innerText()).slice(-3000);
  } finally {
    // Remove only this probe's item through the normal cancel-sale workflow.
    const back = page.getByTestId("pay-back-to-sale");
    if (await back.isVisible().catch(() => false)) await back.click();
    if (await page.locator('[data-pos-keyboard-target="cart-row"]').count()) {
      await page.getByTestId("action-chip-cancel-sale").click();
      const label = await page.evaluate(() => window.__("Yes, Cancel sale"));
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-pos-keyboard-target="cart-row"]'));
    }
    await search.fill("");
  }
  return result;
}

// Reuse the lab drill's registered terminal. Never claim or transfer a shift
// as part of a timing measurement, and never print the terminal secret.
export async function installBenchmarkIdentity(page, baseURL, user) {
  const key = createHash("sha256").update(`${baseURL}:${user}`).digest("hex").slice(0, 24);
  const path = process.env.POSA_TEST_TERMINAL_FILE || join(tmpdir(), `posa-test-terminal-${key}.json`);
  const identity = JSON.parse(await readFile(path, "utf8"));
  if (typeof identity.terminal_id !== "string" || !identity.terminal_id ||
      typeof identity.terminal_token !== "string" || !identity.terminal_token) {
    throw new Error("Benchmark requires a valid registered lab terminal fixture");
  }
  await page.addInitScript(({ terminal_id, terminal_token }) => {
    localStorage.setItem("posa_device_identifier", terminal_id);
    localStorage.setItem("posa_terminal_secret", terminal_token);
  }, identity);
}
