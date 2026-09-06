import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { observeRegisterConfiguration, probeCheckout, installBenchmarkIdentity } from './checkout_probe.mjs';
import { fixtureOperation } from './endurance_fixture_host.mjs';
import { digest } from './endurance_state.mjs';
import { durableCounts, waitForDurableDrain, recoveredAck } from './endurance_queue.mjs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');

export class EnduranceBrowser {
  constructor(fixture, identity, directory, smoke = false) {
    Object.assign(this, { fixture, identity, directory, smoke, pageErrors: [], requestIds: [], financialAllowed: false });
  }
  async open() {
    const fixture = this.fixture;
    process.env.POSA_SMOKE_BASE_URL = `https://${fixture.site}`;
    process.env.POSA_SMOKE_USER = fixture.user;
    process.env.POSA_SMOKE_PASSWORD = fixture.password;
    this.drill = await import('../../frontend/tests/e2e/support/registerDrill.ts');
    this.context = await chromium.launchPersistentContext(join(this.directory, 'browser'), {
      headless: true, baseURL: process.env.POSA_SMOKE_BASE_URL, ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(30000);
    this.page.on('pageerror', error => {
      const message = String(error.stack || error.message).replaceAll(fixture.password, '[REDACTED]').replaceAll(fixture.terminal_token, '[REDACTED]');
      this.pageErrors.push(message);
      appendFileSync(join(this.directory, 'browser-errors.jsonl'), JSON.stringify({ at: new Date().toISOString(), message }) + '\n', { mode: 0o600 });
    });
    await installBenchmarkIdentity(this.page, process.env.POSA_SMOKE_BASE_URL, fixture.user);
    await this.page.addInitScript(observeRegisterConfiguration);
    await this.page.route('**/api/method/posawesome.posawesome.api.invoices.submit_invoice', async route => {
      if (!this.financialAllowed) {
        this.pageErrors.push('Unexpected financial submit during nonposting cycle');
        return route.abort('blockedbyclient');
      }
      const payload = route.request().postDataJSON();
      const invoice = JSON.parse(payload.invoice);
      if (invoice.pos_profile !== fixture.profile || invoice.customer !== fixture.customer ||
          invoice.items?.length !== 1 || invoice.items[0].item_code !== fixture.item || Number(invoice.items[0].qty) !== 1) {
        this.pageErrors.push('Financial submit escaped private fixture');
        return route.abort('blockedbyclient');
      }
      if (!invoice.posa_client_request_id) throw Error('Financial submit has no request id');
      if (!this.requestIds.includes(invoice.posa_client_request_id)) this.requestIds.push(invoice.posa_client_request_id);
      await route.continue();
    });
    await this.drill.login(this.page);
    await this.page.goto('/posapp', { waitUntil: 'domcontentloaded' });
    await this.ready();
    if (this.smoke) await this.context.tracing.start({ snapshots: true, screenshots: true, sources: false });
    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send('Performance.enable');
  }
  async ready() {
    await expect(this.drill.searchBox(this.page)).toBeVisible({ timeout: 90000 });
    await this.page.waitForFunction(() => window.__benchConfigurationReady !== null, undefined, { timeout: 30000 });
    const status = await this.page.evaluate(async () => {
      const f = window.frappe;
      const result = await f.call({ method: 'posawesome.posawesome.api.shifts.check_opening_shift',
        args: { user: f.session.user, terminal_id: localStorage.getItem('posa_device_identifier'),
          terminal_token: localStorage.getItem('posa_terminal_secret') } });
      return { user: f.session.user, profile: result.message?.pos_profile?.name,
        shift: result.message?.pos_opening_shift?.name, owned: result.message?.terminal_status?.owned,
        build: window.posawesome_build_version };
    });
    if (status.user !== this.fixture.user || status.profile !== this.fixture.profile || status.shift !== this.fixture.shift || !status.owned) throw Error('Private cashier/shift ownership not established');
    if (status.build !== this.identity.build.version) throw Error('Build changed');
  }
  async checkBuild() {
    const response = await this.context.request.get('/assets/posawesome/dist/js/version.json', { headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok()) throw Error('Cannot verify deployed manifest');
    const body = await response.body();
    const manifest = JSON.parse(body.toString());
    if (manifest.version !== this.identity.build.version) throw Error('Build changed; run invalidated');
    if (digest(body) !== this.identity.build.manifest_sha256) throw Error('Build manifest content changed; run invalidated');
    return manifest.version;
  }
  async metrics() {
    // Vue keeps leaving controls/listeners until their transition ends. Sample
    // retained state only after that legitimate transient work has completed.
    await expect(this.page.locator('[class*="-leave-active"], [class*="-enter-active"]')).toHaveCount(0);
    await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await this.cdp.send('HeapProfiler.collectGarbage');
    const performance = await this.cdp.send('Performance.getMetrics');
    const heap = performance.metrics.find(row => row.name === 'JSHeapUsedSize')?.value;
    const counters = await this.cdp.send('Memory.getDOMCounters');
    const state = await this.durableState();
    if (!Number.isFinite(heap)) throw Error('Heap metric unavailable');
    return { heap_bytes: heap, listeners: counters.jsEventListeners, dom_nodes: counters.nodes, ...durableCounts(state),
      realtime_scripts: await this.page.locator('script[src*="/socket.io/socket.io.js"]').count() };
  }
  async durableState() {
    return this.page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('posawesome_offline');
      request.onerror = () => reject(Error('Cannot open durable queue'));
      request.onupgradeneeded = () => request.transaction.abort();
      request.onsuccess = () => {
        const database = request.result;
        try {
          const tx = database.transaction(['write_queue', 'invoice_outbox'], 'readonly');
          const queue = tx.objectStore('write_queue').getAll();
          const outbox = tx.objectStore('invoice_outbox').getAll();
          tx.onabort = tx.onerror = () => { database.close(); reject(Error('Cannot read durable queue/outbox')); };
          tx.oncomplete = () => {
            database.close();
            const clean = rows => rows.map(row => Object.fromEntries(['client_request_id', 'status',
              'invoice_name', 'server_verified'].map(key => [key, row[key]])));
            resolve({ queue: clean(queue.result), outbox: clean(outbox.result) });
          };
        } catch (error) { database.close(); reject(error); }
      };
    }));
  }
  async clearCart() {
    const back = this.page.getByTestId('pay-back-to-sale');
    if (await back.isVisible().catch(() => false)) await back.click();
    if (!await this.page.locator('[data-pos-keyboard-target="cart-row"]').count()) return;
    await this.page.getByTestId('action-chip-cancel-sale').click();
    const label = await this.page.evaluate(() => window.__('Yes, Cancel sale'));
    await this.page.getByRole('button', { name: label, exact: true }).click();
    await expect(this.page.locator('[data-pos-keyboard-target="cart-row"]')).toHaveCount(0);
  }
  async uiCycle(plan) {
    const faults = [];
    if (plan.fault === 'session_expiry') {
      // Frappe restricts logout to POST. Use this session's CSRF token just as
      // the real auth service does; never relax server method/CSRF validation.
      const csrf = await this.page.evaluate(() => window.frappe?.csrf_token || window.posawesome_csrf_token || window.csrf_token);
      const response = await this.page.request.post('/api/method/logout', { headers: { 'X-Frappe-CSRF-Token': csrf } });
      if (!response.ok()) throw Error(`Session expiry fault could not logout private cashier (HTTP ${response.status()})`);
      const check = await this.page.request.get('/api/method/frappe.auth.get_logged_user');
      const logged = await check.json();
      if (logged.message === this.fixture.user) throw Error('Session remained authenticated after logout');
      await this.page.goto('/posapp', { waitUntil: 'domcontentloaded' });
      await this.drill.login(this.page);
      await this.page.goto('/posapp', { waitUntil: 'domcontentloaded' });
      await this.ready(); faults.push('session_expiry');
    } else if (plan.fault === 'reload') {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.ready();
      await expect(this.page.locator('[data-pos-keyboard-target="cart-row"]')).toHaveCount(0);
      faults.push('reload');
    }
    if (plan.fault === 'offline') {
      await this.context.setOffline(true);
      await expect(this.drill.connectivityLabel(this.page)).toHaveText(/offline/i);
      faults.push('offline');
    }
    try {
      const result = await probeCheckout(this.page, this.fixture.item);
      if (result.checkout_status !== 'ready') throw Error(`Nonposting checkout failed: ${result.checkout_error || result.checkout_status}`);
    } finally {
      if (plan.fault === 'offline') {
        await this.context.setOffline(false);
        await expect(this.drill.connectivityLabel(this.page)).toHaveText(/online/i, { timeout: 90000 });
        faults.push('reconnect');
      }
    }
    return { faults };
  }
  async financialCycle(plan) {
    const faults = [];
    const before = fixtureOperation('audit', this.fixture);
    if (before.submitted >= 20) throw Error('Authorized financial-cycle ceiling reached');
    let ackConfirmed = false;
    const ack = ['ack_loss', 'offline_ack'].includes(plan.fault)
      ? this.drill.loseFirstAck(this.page, () => { ackConfirmed = true; }) : null;
    const recoveryReads = [];
    const responseWork = new Set();
    const observeRecovery = response => {
      const method = response.url().split('?')[0];
      const reconciliation = method.endsWith('/api/method/posawesome.posawesome.api.offline_sync.invoices.reconcile_invoice_outbox_entry');
      if (!ackConfirmed || (!reconciliation && !method.endsWith('/api/method/frappe.client.get_value'))) return;
      const work = (async () => {
        const request = response.request();
        const args = request.method() === 'GET' ? Object.fromEntries(new URL(request.url()).searchParams)
          : request.postDataJSON();
        if (!response.ok()) return;
        const body = await response.json();
        if (reconciliation) {
          const result = body.message;
          if (result?.acknowledged === true && result.client_request_id === args.client_request_id
            && Number(result.invoice?.docstatus) === 1 && result.invoice?.name) {
            recoveryReads.push({ kind: 'verified_outbox', request_id: args.client_request_id,
              invoice: result.invoice.name, docstatus: 1 });
          }
          return;
        }
        const filters = typeof args.filters === 'string' ? JSON.parse(args.filters) : args.filters;
        if (args.doctype !== 'Sales Invoice' || !filters?.name) return;
        if (Number(body.message?.docstatus) === 1) recoveryReads.push({ invoice: filters.name, docstatus: 1 });
      })().catch(() => {}).finally(() => responseWork.delete(work));
      responseWork.add(work);
    };
    if (ack) this.page.on('response', observeRecovery);
    const offlineSale = ['offline_sale', 'offline_ack'].includes(plan.fault);
    this.requestIds = [];
    this.financialAllowed = true;
    try {
      if (ack) await ack.install();
      if (offlineSale) {
        await this.context.setOffline(true);
        await expect(this.drill.connectivityLabel(this.page)).toHaveText(/offline/i);
        faults.push('offline');
      }
      await this.drill.addItem(this.page, this.fixture.item, this.fixture.item);
      await this.drill.payCashAndSubmit(this.page);
      await expect(this.page.getByText('No items in cart')).toBeVisible();
      if (offlineSale) {
        const pending = this.drill.activeRows(await this.drill.readInvoiceQueue(this.page));
        if (pending.length !== 1 || !pending[0].client_request_id) throw Error('Offline financial intent not durably queued');
        this.requestIds = [pending[0].client_request_id];
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await expect(this.drill.searchBox(this.page)).toBeVisible({ timeout: 90000 });
        const restored = this.drill.activeRows(await this.drill.readInvoiceQueue(this.page));
        if (restored.length !== 1 || restored[0].client_request_id !== this.requestIds[0]) throw Error('Reload lost queued financial intent');
        faults.push('reload');
        await this.context.setOffline(false);
        await waitForDurableDrain(() => this.durableState());
        faults.push('reconnect');
      }
      if (ack) {
        // Recovery may verify the submitted document directly or replay queued
        // work. Empty stores are valid only with the exact native/recovery proof below.
        await waitForDurableDrain(() => this.durableState());
        if (!ackConfirmed) throw Error('ACK fault did not confirm a booked upstream sale');
        this.requestIds = [...new Set(ack.seen)]; faults.push('ack_loss');
      }
      if (this.requestIds.length !== 1) throw Error('Financial cycle generated multiple request ids');
      const matches = await this.drill.waitForServerInvoices(this.page, this.requestIds[0], 1);
      if (matches.length !== 1 || matches[0].docstatus !== 1) throw Error('Financial cycle did not produce exactly one submitted invoice');
      const accounting = fixtureOperation('audit', this.fixture, { request_id: this.requestIds[0] });
      await Promise.all(responseWork);
      const ack_recovery = ack ? recoveredAck({ confirmed: ackConfirmed, seen: ack.seen, accounting,
        reads: recoveryReads, state: await this.durableState() }) : undefined;
      return { faults, accounting, ack_recovery };
    } finally {
      await this.context.setOffline(false);
      if (ack) await ack.uninstall();
      this.page.off('response', observeRecovery);
      this.financialAllowed = false;
    }
  }
  async close() {
    if (this.smoke && this.context) await this.context.tracing.stop({ path: join(this.directory, 'smoke-trace.zip') }).catch(() => {});
    await this.context?.close();
  }
}
