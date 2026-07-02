# Web-route reliability + perf bundle

Three small, focused fixes for issues observed in production POS flows on
Frappe v16 / ERPNext v16. All independent; commits are bisect-safe.

## Commits

### 1. `fix(perf): yield to main thread between background-sync batches`

`useItemsSync.ts` runs the catalog delta-sync in chunks, but the loop was
a single synchronous burst. On stores with ≥10 k items the loop pegged
the main thread for ~300–800 ms per refresh window, which the operator
felt as the search box "eating keystrokes" while a background sync was
mid-flight.

Yield between batches via `requestIdleCallback` (250 ms idle deadline)
with a `setTimeout(0)` fallback for browsers that don't support it.
Throughput unchanged; input latency restored.

### 2. `fix(realtime): short-circuit waits when shim socket not connected`

`socketStore.waitForInvoiceProcessed` and `waitForPostSubmitPayments`
unconditionally entered `withTimeout` with a 45-second budget. If the
realtime socket failed to complete its handshake (proxy not forwarding
the WebSocket Upgrade, namespace mismatch, expired session cookie, etc.)
every PAY → print blocked the full 45 s before falling through.

Add `isRealtimeConnected()` that reads `frappe.realtime.socket.connected`.
When false, resolve the waits optimistically:

- `waitForInvoiceProcessed` returns `{status: "processed"}` so the print
  flow's existing `fetchSubmittedInvoiceDoc` fallback fetches the doc
  from the DB and confirms.
- `waitForPostSubmitPayments` returns `{status: "completed"}` — the
  invoice is already submitted by the time the wait fires, and the bg
  job's payment entries land in the DB regardless of whether we
  delivered the realtime ack.

Trade-off: live realtime UX is lost when the socket is dead, but the
print/submit critical path runs without the 45 s hang. When realtime is
healthy the original event-driven path runs untouched.

Test stub: `socketStore.spec.ts` stubs `frappe.realtime.socket.connected:
true` so existing tests still exercise the event-driven resolution
path. Spec contract is unchanged.

### 3. `fix(sw): skip caching for font files`

Recurring "broken font / tofu icons" pathology across deploys:

1. SW caches the hashed CSS chunk (e.g. `style-DyXwykpg.css`).
2. The CSS contains absolute references to hashed font files
   (`url(/assets/.../materialdesignicons-webfont-CSr8KVlo.woff2)`).
3. Next deploy: every CSS + font hash changes. `cleanupObsoleteCaches`
   deletes the old cache on activate.
4. But the browser still has the old CSS in its own http/memory cache,
   asks for an old font hash, the SW intercepts, cache misses, fetches
   from network → **404** because the file no longer exists on disk.
5. `@font-face` fails → Vuetify/Roboto/MDI fall back to system fonts →
   tofu icons + chunky text until the operator hard-refreshes or
   manually unregisters the SW.

Fix: let the SW pass font requests through to the network. Fonts are
content-hashed, so URL collisions are impossible; the browser's HTTP
cache (Cache-Control + Etag from Frappe's static handler) already
keeps them warm. Catch by `destination === "font"` AND `.woff/.woff2/
.ttf/.eot/.otf` path-suffix (Safari has historically been unreliable
about populating `request.destination`).

## Test plan

- [x] `vitest run` — 598/598 pass on `posawesome/frontend` (152 spec
      files). Includes existing `socketStore.spec.ts`, `sw.spec.ts`,
      `useItemSync.spec.ts`.
- [x] `vue-tsc --noEmit` — no type errors.
- [x] Lab smoke (Vue 3 + Vuetify 3 + Frappe v16 build): SPA boots, cart
      build + PAY → print fires without 45 s hang, font icons render
      correctly across hard-refresh + soft-reload.
- [ ] (Reviewer) confirm no behaviour change when realtime socket is
      healthy — the new guard short-circuits only when `connected:
      false`.

## Risk

LOW per commit:
- `useItemsSync` change is additive (one extra yield inside an
  existing loop; throughput unchanged).
- `socketStore` change only fires when realtime is broken; on healthy
  systems the new branch is dead code.
- `sw.js` change removes a caching layer for a class of resources;
  worst case is one extra cold-cache hit per font file per cache
  generation (browser HTTP cache catches it after that).

Reverts are clean: each commit touches one logical area; revert any
without affecting the others.

---

Co-authored with Claude Opus 4.7. Cherry-picked from `HolyMC2/POS-Awesome`
fork (`doco-customizations` branch), where these fixes have been running
in production at ~200 transactions/day since 2026-05-20.
