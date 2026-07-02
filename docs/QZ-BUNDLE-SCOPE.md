# POSAwesome Client Bundle — Scope

Status: SCOPE / RFC. No code changes proposed in this doc.
Branch context: `doco-customizations` (currently on hotfix `doco-hotfix-p0-security`).
Date: 2026-05-18.

Audience: Marco + maintainers. Goal: decide whether to ship a client-side
installer bundle, or land cheaper targeted fixes, to close three operator-
reported print pathologies.

---

## 0. The three pathologies we are scoping

| # | Symptom | Operator workaround | Cost |
|---|---|---|---|
| 1 | Silent print delay: usually <1 s, sometimes ~30 s | wait | line slowdown |
| 2 | "Print Last Invoice" workaround fires twice → 2 paper copies | toss the duplicate | paper, customer confusion |
| 3 | Horizontal stripes/banding on receipt — but printer self-test page is clean | none (cosmetic-ish) | unreadable receipts |

The third is decisive: the printer's own self-test page is clean.
That isolates the fault to **our render → raster → ESC/Raster pipeline**,
not hardware (ribbon, head, paper, USB cable).

---

## 1. Current state — how QZ Tray prints today

### 1.1 Path

All four silent-print call sites route through one function:
`printDocumentViaQz()` at `frontend/src/posapp/services/qzTray.ts:559`.

Call sites:
- `frontend/src/posapp/composables/pos/payments/usePaymentPrinting.ts:171` — pay flow receipt
- `frontend/src/posapp/composables/core/useLastInvoicePrinting.ts:133` — "Print Last Invoice" menu
- `frontend/src/posapp/components/pos/shell/PayView.vue:409` — Payment Entry receipt
- `frontend/src/posapp/components/pos/flows/InvoiceManagement.vue:~2613` — reprint from history

Per-call pipeline:

1. Frontend `frappe.call("frappe.www.printview.get_html_and_style", …)` — pulls Jinja-rendered HTML + CSS string (`qzTray.ts:571-581`).
2. `inlineImagesForQz(html)` — DOM-parses, fetches each `<img src>` via `fetch(credentials:"include")`, base64-encodes via `FileReader`, replaces `src` with `data:` URL. Per-URL `Map` cache. Per-image 5 s abort timeout (`qzTray.ts:115-165`).
3. `buildPrintHtml(html, style, widthMm)` wraps in `<html>` with `@page { size: <w>mm auto; margin:0 }` + body `padding:0 4mm` + `font-size: 10pt` (`qzTray.ts:86-107`).
4. `printHtmlViaQz()` — ensures websocket open, resolves printer name (option → localStorage → POS profile field `posa_qz_printer_name` → first found), builds `qz.configs.create(printer, { size:{width, height:null}, units:"mm", orientation:"portrait", margins:{0,0,0,0}, colorType:"grayscale", interpolation:"nearest-neighbor" })` (`qzTray.ts:535-545`).
5. `qz.print(config, [{ type:"pixel", format:"html", flavor:"plain", data: html }])` — QZ Tray local agent **rasterizes the HTML in its own headless Chromium**, then sends ESC/Raster commands to the configured printer.

### 1.2 Security envelope

- `posawesome/posawesome/api/qz.py:97-141` — `sign_message` is POST-only, role-gated to `_QZ_SIGN_ROLES`, envelope-validated to `{"call":"qz.*"}`. PKCS1v15-SHA512. Hardened in current branch.
- Per-tenant cert + key live on the server at `private/qz/digital-certificate.crt` and `private-key.pem` (`api/qz.py:32-37`). Cert is 11,499-day self-signed (`api/qz.py:194`) — flagged in `docs/REVIEW2/03_security.md:531`.
- Client trusts cert by importing the `.crt` into QZ Tray's allow-list once, per machine. Operator-led, no installer.

### 1.3 Pre-warm + state

- `frontend/src/posapp/components/pos/shell/Pos.vue:518-528` — on POS Profile load with `posa_silent_print`, calls `connectQzTray()` (websocket + cert + signing round-trip) so the first job pays no handshake cost.
- `qzTray.ts:57-64` — module-level refs (`qzConnected`, `qzConnecting`, `qzCertStatus`, `qzPrinters`, `selectedQzPrinter`, `qzCertReady`, `qzReconnectPaused`). `connectPromise` singleflight guard (`qzTray.ts:68`). Singleton, not Pinia.
- localStorage keys: `posa_qz_printer_name`, `posa_qz_cert_ready`, `posa_qz_manual_disconnect`.

### 1.4 Where the latency lives

End-to-end budget for a single silent print, hot path:

| Step | Cold | Hot | Notes |
|---|---|---|---|
| `printview.get_html_and_style` round-trip | 600–1500 ms | 200–400 ms | Server Jinja + letterhead expansion. `docs/REVIEW2/04_performance.md:43` benchmarks "print (QZ Tray)" at p99 = 2.5 s, mostly from this step |
| Image inlining (`fetchImageAsDataUrl`) | 200–800 ms | <5 ms | Cached after first call. Logos + signatures only |
| WS handshake + cert + sign | 800–2000 ms | 0 ms | Pre-warmed (`Pos.vue:520`). When pre-warm fails or socket died (laptop sleep, USB reset), back to cold |
| `qz.print` → QZ headless-Chromium render | 400–1500 ms | 400–1500 ms | **Not measured.** This is QZ's blackbox. HTML→raster on a low-end client = the long tail |
| ESC/Raster transfer to printer | 100–400 ms | 100–400 ms | USB/serial, paper width × DPI |

Total hot-path realistic: ~700–1500 ms. Total cold or wedged: 3–30 s.

### 1.5 Where the double-fire comes from

Direct read of the code:

- `frontend/src/posapp/composables/core/useLastInvoicePrinting.ts:25-156` — `printLastInvoice()` has **no in-flight guard, no debounce, no disabled-state on the menu item**.
- `frontend/src/posapp/components/navbar/NavbarMenu.vue:417-422,630-633` — menu action invokes the handler synchronously. Clicking again fires another full pipeline.
- `printDocumentViaQz()` itself (`qzTray.ts:559-613`) is also non-idempotent: each call fetches HTML server-side and submits an independent `qz.print()` job.

The sequence the operator hits:

1. Click pay → first job fires → QZ pre-warm stalled or socket lost → frontend awaits `qz.print` for many seconds with no visible feedback (`usePaymentPrinting.ts:170-182` only `console.warn` on failure).
2. Operator thinks "nothing happened" → opens menu → "Print Last Invoice".
3. Meanwhile job #1 unstalls and prints.
4. Job #2 prints too → **2 copies**.

The "Print Last Invoice" button has no notion that a different job for the same `name` is mid-flight in another caller. Even the same caller has no notion: rapidly clicking "Print Last Invoice" twice queues two `qz.print` jobs.

### 1.6 Where the stripes originate (hypotheses)

The printer's self-test page is clean → not hardware. So the banding is
inside our render→raster path. Most plausible sources, in our code:

a) **`interpolation: "nearest-neighbor"` + `colorType: "grayscale"` on rasterized HTML** (`qzTray.ts:543-544`). Nearest-neighbor scaling of grayscale text from a CSS viewport whose pixel grid does not align with the printer's dot rows produces classic banding — rows of dots that should be filled get rounded to white, rows that should be partially filled get rounded to black. The fix usually wanted here is `interpolation:"bicubic"` or `lanczos`, or — better — bump source DPI so 1 source px ≥ 1 printer dot.

b) **No explicit `density` / `dpi` in the QZ config**. QZ defaults to ~150 DPI for HTML pixel jobs. On an 80mm = 576-dot printer (203 DPI), that's a fractional re-scale → moiré bands.

c) **Base64 logos sized in CSS px, scaled to mm** (`qzTray.ts:99` `img { max-width: 100%; height: auto; }`). Logos load at their intrinsic PNG resolution then get nearest-neighbor downscaled in step (4). Bands tend to ride the logo strip and the cashier doesn't notice unless they look at the header.

d) **Letterhead via `frappe.www.printview.get_html_and_style`** can return CSS with `@font-face` or remote font URLs that fail in QZ's renderer (no base URL — same root cause as `6aa28fbd` had for images). Glyphs fall back to QZ's bundled system font; the fallback font's hinting at 10pt/203dpi can show stripe artifacts on certain letters. Worth ruling out by checking the rendered HTML for `@font-face` references — we never inline fonts, only images.

e) **CSS `line-height: 1.3` + `font-size: 10pt`** (`qzTray.ts:97`). On a 203 DPI printer this places baselines on fractional dot rows, every other line lands on a different sub-dot position → alternating "thicker / thinner" line banding.

f) **Re-render via Pinia store mutation triggering a second QZ job mid-print** — read of the code shows `qzTray.ts` is **not** wired through Pinia, only module-level refs. **Ruled out.** This was a candidate hypothesis from the brief; the evidence does not support it.

g) **`format:"pixel"` instead of `"raw"` ESC/POS** — we always send a rasterized image, never native ESC/POS text. Native text would be banding-immune but loses the Jinja layout. Out of scope for current pipeline.

---

## 2. Root-cause hypotheses, ranked

| # | Hypothesis | Pathology | Likelihood | Evidence | How to confirm |
|---|---|---|---|---|---|
| H1 | "Print Last Invoice" has no in-flight guard | #2 double-fire | **near-certain** | `useLastInvoicePrinting.ts:25-156` and `NavbarMenu.vue:630-633` show zero guard | Add `console.log` on entry, click rapidly, observe N entries → N prints |
| H2 | QZ websocket silently drops (laptop sleep, USB reset, Windows TCP reset) and the pre-warm `watch` in `Pos.vue:520` only fires on POS Profile change — not on reconnect-needed | #1 lag | high | `qzTray.ts:369-373` clears `qzConnected` on close-callback but pre-warm does not re-fire; next print awaits cold reconnect | Disconnect QZ Tray mid-session, time next print |
| H3 | `qz.print` HTML-render is slow on weak terminals (4 GB RAM Win10, headless Chromium spin-up) | #1 lag | high | QZ Tray's HTML renderer is well-known for variable latency; not measured in our telemetry today | Add a `track("qz:print_ms", duration)` around `qz.print()` in `printHtmlViaQz` |
| H4 | `interpolation: "nearest-neighbor"` + default DPI mismatch with 80mm 203-DPI printer | #3 stripes | high | `qzTray.ts:543-544`. Theory matches the symptom shape (horizontal bands on text, self-test clean) | Side-by-side: `nearest-neighbor` vs `bicubic`; or set explicit DPI matching printer (203 DPI for 80mm thermal, 180 for some Epson) |
| H5 | Cold `printview.get_html_and_style` round-trip (Jinja + letterhead + ERPNext hook chain) | #1 lag | medium | `docs/REVIEW2/04_performance.md:43` benchmarks p99 at 2.5 s | Time the `frappe.call` server-side in a `before_request` hook |
| H6 | CSS `line-height: 1.3` + 10pt on 203 DPI = sub-dot banding | #3 stripes contributor | medium | `qzTray.ts:97`; matches the alternating-line banding pattern operators sometimes describe | Print same content with `line-height: 1` and an integer-pt size matching the printer's native font height |
| H7 | Logo PNG nearest-neighbor downscale on the rasterized image | #3 stripes (header only) | medium | `qzTray.ts:99-101`. Test by hiding logos | Print a receipt without letterhead, check if banding moves / disappears |
| H8 | Multiple print callers race on the same invoice (pay flow finishes a beat before "Print Last Invoice" menu fires) | #2 double-fire (cross-caller) | medium | Four call sites all hit `printDocumentViaQz` with no shared dedupe; only the local fn has any state | Add a module-level `inFlight: Map<docKey, Promise>` in `qzTray.ts` |
| H9 | Browser tab throttling when terminal switches away (operator opens another app) → `qz.print` awaits indefinitely | #1 lag | low-medium | No timeout on `qz.print`; modern Chrome throttles bg tabs heavily | Set a 10 s timeout wrapper around `qz.print` and surface to telemetry |
| H10 | `@font-face` fonts in print format CSS not inlined, fallback font has bad hinting → stripe-like glyph artifacts | #3 stripes | low-medium | We inline images (`6aa28fbd`) but not fonts; printview CSS may reference them | `grep -n "@font-face" <rendered html>` from `get_html_and_style` |
| H11 | Pinia store mutation re-trigger | #1/#3 | **ruled out** | `qzTray.ts` uses module-level `ref()`, not Pinia. No mutation-driven re-render of QZ state |  |
| H12 | Per-tenant cert mis-trust (intermittent "untrusted" prompt on the operator's screen they dismiss) | #1 lag | low | Pre-warm masks this. Telemetry `qz:failure / cert_empty` would fire (`qzTray.ts:23-32`) | Query `tabPOS Telemetry Event WHERE event_name='qz:failure'` |

The takeaway: pathologies #1 and #2 do **not** require a bundle.
Pathology #3 (stripes) **also** does not require a bundle —
it's a render-config tuning problem inside `qzTray.ts`.

---

## 3. The "POSAwesome Client Bundle" — what it would be

### 3.1 Goal of a bundle

Eliminate per-terminal operator setup (download cert → import to QZ Tray
→ install QZ Tray → trust local CA), and put a thin native shim under
our control so we can: time print jobs, detect socket drops and reconnect
proactively, dedupe jobs at the OS layer, and ship raster-mode toggles
without a frontend deploy.

### 3.2 Bundle contents

a) **QZ Tray Community Edition** — bundled as-is, MSI for Windows, .deb / .rpm / AppImage for Linux. License permits redistribution; verify before ship.

b) **Per-tenant cert provisioning** — two options:

   - **Option A — Pre-shipped cert + key, per build**: every tenant gets a custom installer with cert + key baked in. Reproducible. Auditable. **Worst-case key compromise = re-ship one tenant.** Requires a build server keyed per tenant.

   - **Option B — Provisioning API**: installer ships generic, on first run calls a `/api/method/posawesome.posawesome.api.qz.provision_terminal` with a one-time bootstrap token. Server returns cert + a *per-terminal* key. Better isolation, more moving parts, more failure modes during install.

   Recommendation: **Option B**, with the bootstrap token printed once on POS Profile setup screen. Re-issuable.

c) **Native telemetry beacon** — a tiny Go or Rust binary, ~5 MB, that:

   - sits next to QZ Tray as a sibling local service on `127.0.0.1:9182` or unix socket;
   - watches the QZ Tray log for print starts/finishes/errors;
   - emits structured rows to `/api/method/posawesome.posawesome.api.telemetry.ingest_print_event` with `{terminal, job_id, started_at, finished_at, status, printer, bytes, ms}`;
   - exposes `/health` for monitoring;
   - is the layer that owns the OS-level job dedupe (see §3.4).

d) **Auto-update channel** — optional. Cargo of code, sccm-style, signed updates served from the same domain as the SaaS. Recommend: defer. The bundle changes maybe twice a year; pushing operators a "click Update" button is fine.

e) **Taskbar/tray UI** — minimal: "connected to <tenant>", last 5 print attempts with status, "reconnect" button, "send diagnostic dump" button. Cuts the support loop by half.

f) **Code-signing certificate** — Windows SmartScreen / macOS gatekeeper. Annual EV cert, ~$300/yr. Required or every install pops a malware-style scary warning.

### 3.3 Deploy model

- Windows: signed MSI. Headless install supported (`msiexec /i ... /quiet TENANT=foo TOKEN=bar`). Service registered. Cert imported into QZ Tray allow-list on first run.
- Linux: .deb + .rpm + AppImage. systemd user unit.
- Per-terminal: cashier downloads installer from the POS Profile page after Marco enables them; double-click; done.
- Updates: tray UI shows "Update available"; clicks update; binary swap; service restart.

### 3.4 What it solves vs current setup

| Pathology | Bundle component that addresses it | How |
|---|---|---|
| #1 lag (cold WS) | Telemetry beacon + tray UI | Beacon keeps the WS warm with its own pinger independent of the SPA tab being focused. Operator sees "QZ disconnected" in the tray before they click pay |
| #1 lag (server Jinja) | None | Server-side problem, bundle does not help |
| #1 lag (QZ HTML render) | None directly | But the beacon's `qz:print_ms` rows give us the data to decide whether to switch to raw ESC/POS |
| #2 double-fire | Telemetry beacon's job dedupe (`{terminal, doctype, name, since: <3s}`) | Bundle drops duplicate prints at the local agent — even if 4 SPA callers race |
| #3 stripes | None directly | Bundle does **not** change the QZ Tray render config. Stripes are a render-pipeline tuning issue. The bundle could ship a preset `qz.configs.create` with `interpolation:"bicubic"` and `density:203` — but we can do that today without a bundle |

The bundle is a **trust + observability + dedupe** play, not a render-fix
play. Be clear about that.

---

## 4. What the bundle would NOT fix

- **Server-side Jinja latency** — `printview.get_html_and_style` is on the slow path. p99 = 2.5 s today. Bundle does not touch the server.
- **The actual stripe banding** — that's a QZ raster-config problem; a bundle that ships QZ-as-is inherits the same problem.
- **Print format authoring mistakes** — `@font-face`, oversized logos, table cells overflowing the 72mm printable area. Bundle cannot fix bad Jinja.
- **Operator-induced double-prints** — if the operator clicks "Print" twice intentionally because the first receipt jammed, the dedupe window will block the second. We need a manual override path that bypasses dedupe (e.g. ctrl-click). Bundle must ship that or it creates a new pathology.
- **Driver / paper jam / ribbon out** — physical printer faults are still physical.
- **Cross-platform parity gotchas** — Windows ESC/Raster handling differs from CUPS. Bundling doesn't make the underlying OS print stack consistent.

---

## 5. Smallest viable scope

**The minimum set of changes that demonstrably closes #1 and #2** does
not require a bundle. It's three edits inside `qzTray.ts` and one inside
`useLastInvoicePrinting.ts`:

1. **In-flight dedupe** in `qzTray.ts` — module-level `Map<string, Promise<void>>` keyed by `${doctype}::${name}::${printer}`. If a key is mid-flight, return the existing promise instead of issuing a second `qz.print`. Configurable 3 s post-resolution window so a back-to-back duplicate within 3 s of completion is also dropped. Closes #2 across all four callers.  Implementation site: wrap `printDocumentViaQz()` body at `qzTray.ts:559-613`.

2. **WS re-prewarm on close** in `Pos.vue` — change `qzTray.ts:369-373` so the close-callback re-fires the pre-warm if `posa_silent_print` is on and `qzReconnectPaused` is false. Today the pre-warm only fires on POS Profile change. Closes the majority of #1 cold-WS cases.

3. **`qz.print` timeout + telemetry** — wrap `await qz.print(config, data)` at `qzTray.ts:556` with a 10 s `Promise.race` against a timeout. On timeout, emit `track("qz:print_timeout", 1, …)` (telemetry hook already exists from `48a87102`). On success, emit `track("qz:print_ms", ms, …)`. Gives us the data to decide on stripes / bundle later.

4. **Disable the "Print Last Invoice" menu item while a print is in flight** — `NavbarMenu.vue:417-422` + a `printing` ref from the composable. Even with H1 dedupe, the visible disabled state stops the operator's confused second click.

Smallest scope **does not address #3 (stripes)**. Stripes need a separate
investigation:

- Step A: add `?qz_force_bicubic=1` URL flag → set `interpolation:"bicubic"` in `qz.configs.create`. Operator prints with and without. Photo of both receipts. ~30 min of operator time.
- Step B: try explicit `density: 203` (most 80mm thermal) or `density: 180` (some Epson). Same A/B test.
- Step C: if neither helps, suspect `@font-face` fallback (H10) — grep the rendered HTML.

---

## 6. Cost estimate

Engineering days (Marco-only, assume context familiar):

| Item | Days |
|---|---|
| Smallest viable scope (§5 items 1–4) + tests + manual verify | **1.5–2** |
| Stripes investigation A/B/C (§5 follow-up) | 0.5–1 |
| Telemetry dashboard for `qz:print_ms` + `qz:print_timeout` + `qz:failure` (already partially built) | 0.5 |
| Full bundle — Option B provisioning, beacon, MSI, Linux packages, tray UI, code-signing setup, install/upgrade tests across Win10/11/Ubuntu | **15–25** |
| Bundle ongoing maintenance (per quarter) | 1–2 |
| Bundle code-signing cert | $300/yr + 0.5 day setup |

Ratio: ~**1 day** of cheap fixes captures most of the benefit the bundle
would deliver for #1 and #2. The bundle pays off only when we want
per-terminal observability, tenant-isolated keys, and a real auto-update
channel.

---

## 7. Cheap-fix alternatives that don't need a bundle

- **Client-side dedupe** (closes #2): §5 item 1. ~3 hours.
- **`?force-raster=bicubic` mode** (maybe closes #3): expose a POS Profile field `posa_qz_interpolation: bicubic|nearest-neighbor` and read it in `qz.configs.create`. ~2 hours, plus operator A/B time.
- **Explicit printer DPI** (likely helps #3): add `posa_qz_density` field, default empty, pass to `qz.configs.create` when set. ~1 hour.
- **WS reconnect pre-warm** (closes most of #1): §5 item 2. ~2 hours.
- **`qz.print` timeout + telemetry** (data for #1): §5 item 3. ~2 hours.
- **Disabled-button state on Print Last Invoice** (UX backstop for #2): §5 item 4. ~1 hour.
- **Reduce cert validity to 365 days** + rotation job (out of policy per `docs/REVIEW2/03_security.md:531`): independent of this scope, but pair with cheap-fix sweep. ~0.5 day.
- **Inline `@font-face` like we inline `<img>`** (rules out H10 for stripes): extend `inlineImagesForQz` to also walk CSS `url(...)` for fonts. ~0.5 day.

---

## 8. Decision recommendation — phased

**Phase 1, this sprint (~2 eng-days, no install footprint):**

1. Land §5 items 1–4. Closes #2 (double-fire), closes most of #1 (cold WS).
2. Land the bicubic + density POS Profile fields. Operator runs the A/B against a real receipt with banding. If banding goes away → close #3 done.
3. Add `qz:print_ms` telemetry rows. Two weeks of production data tell us whether the remaining tail of #1 is server Jinja, QZ render, or socket-drop.

**Phase 2, only if Phase 1 telemetry shows a persistent tail (~30 days later):**

4. If `qz:print_ms` p99 is mostly in `qz.print` HTML render, evaluate ESC/POS raw mode for a stripped-down receipt format. (Native ESC/POS is banding-immune.) Bigger change than a bundle but addresses root cause for #1 and #3 at once.
5. If `qz:failure` cert/sign rows are non-trivial, **then** the bundle's per-terminal provisioning starts to pay off.

**Phase 3, only on platform readiness for SaaS multi-tenant install (`docs/REVIEW2/ROADMAP-SAAS.md`):**

6. Build the bundle. Justification at that point: per-tenant cert isolation, install-time CA trust without operator instructions, and the telemetry beacon's job dedupe + WS keepalive as a defense in depth on top of the SPA-side fixes from Phase 1.

**Do not build the bundle to fix the three pathologies in the brief.**
They are addressable in ~2 eng-days of in-repo work. The bundle is a SaaS-
platform investment that is justified by tenant-scaling concerns, not by
these three bugs.

---

## Appendix — file:line index

- `frontend/src/posapp/services/qzTray.ts:11-33` — telemetry-emitter cap
- `frontend/src/posapp/services/qzTray.ts:86-107` — `buildPrintHtml` viewport + 4mm body inset
- `frontend/src/posapp/services/qzTray.ts:115-165` — image base64 inlining
- `frontend/src/posapp/services/qzTray.ts:257-318` — `setupSecurity` cert + signing
- `frontend/src/posapp/services/qzTray.ts:345-394` — `connectQzTray` singleflight
- `frontend/src/posapp/services/qzTray.ts:369-373` — close-callback (no re-prewarm)
- `frontend/src/posapp/services/qzTray.ts:502-557` — `printHtmlViaQz` — raster config
- `frontend/src/posapp/services/qzTray.ts:535-545` — `qz.configs.create` (`interpolation`, `colorType`)
- `frontend/src/posapp/services/qzTray.ts:559-613` — `printDocumentViaQz` (dedupe site)
- `frontend/src/posapp/composables/core/useLastInvoicePrinting.ts:25-156` — `printLastInvoice` (no in-flight guard)
- `frontend/src/posapp/composables/pos/payments/usePaymentPrinting.ts:30-191` — `printViaQz` + `loadPrintPage`
- `frontend/src/posapp/components/pos/shell/PayView.vue:396-426` — Payment Entry receipt path
- `frontend/src/posapp/components/pos/shell/Pos.vue:518-528` — pre-warm watch
- `frontend/src/posapp/components/navbar/NavbarMenu.vue:417-422,630-633` — Print Last Invoice menu
- `frontend/src/posapp/plugins/print.ts:425-476` — `silentPrint` + `watchPrintWindow` browser fallback
- `posawesome/posawesome/api/qz.py:68-141` — cert + sign endpoints
- `posawesome/posawesome/api/qz.py:144-215` — `setup_qz_certificate` (11,499-day validity at line 194)
- `docs/REVIEW2/04_performance.md:42-43` — print latency benchmarks
- `docs/REVIEW2/03_security.md:108-115,531` — QZ security findings, cert-validity policy gap
- Commits: `9ce815b7` profile printer name · `6aa28fbd` base64 letterhead · `30e39cc7` viewport pin · `b9db3616` 4mm inset · `660ec6f8` pre-warm · `48a87102` telemetry hook
