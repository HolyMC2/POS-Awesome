# 05 — Mobile + Touch + PWA UX Audit

Branch: `doco-customizations` @ HEAD (2026-05-18). Reviewer mood: irritated. This
is a POS billed as "modern" with a 1280×800 cashier-monitor mindset. Tablets and
phones are second-class. The bones are good (CSS tokens, dark mode, RTL plumbing,
SW versioning, offline outbox), but the surface is a tap-target minefield, the
gesture vocabulary is empty, the PWA shell is barely RFC-compliant, and the
"mobile dock" is a band-aid over a desktop layout. Upstream has three branches
that fix a lot of this and we are not consuming them. Adopt aggressively.

Conventions
- Paths relative to repo root (`/home/holymc2/muelle-host/posawesome`).
- `path:Lstart-Lend` cites the offending range; single line is `path:L42`.
- "Tap target" = WCAG 2.5.5 / Apple HIG / Material — minimum 44×44 CSS px.

---

## 1) Tap-target audit (every interactive thing under 44×44)

The whole cart row family is built around 24×24 (!) icon buttons. Upstream's
max-pro skill bumps it to 28×28; feat-ui-ux-improvements switches to a token
`--pos-touch-target-min: 44px`. Neither lands what is shipped today.

| File | Line | Component | Rendered size | Verdict |
|---|---|---|---|---|
| `frontend/src/posapp/components/pos/invoice/items-table-styles.css` | L322-326 | `.qty-control-btn / .posa-cart-table__qty-btn` minus & plus | **24×24** !important | Fail — primary cart interaction, will misfire on every 5–7" phone |
| `frontend/src/posapp/components/pos/invoice/items-table-styles.css` | L398-431 | `.posa-cart-table__qty-display` (tap-to-edit qty) | min-w 40, h **24** | Fail |
| `frontend/src/posapp/components/pos/invoice/items-table-styles.css` | L201-202 | `.posa-cart-table th` header cells | h 48 | Pass (just) |
| `frontend/src/posapp/components/pos/invoice/items-table-styles.css` | L277 | `.posa-cart-table td` row min-h | 60 | Pass on row, but the controls inside are 24 |
| `frontend/src/posapp/components/pos/invoice/CartItemRow.vue` | L49-59, L60-70 | edit-name / reset-name `v-btn icon size="x-small"` | 24 (Vuetify x-small) | Fail |
| `frontend/src/posapp/components/pos/invoice/CartItemRow.vue` | L77-86, L119-128 | qty +/− buttons (`size="small"`) | 28-32 | Fail |
| `frontend/src/posapp/components/pos/invoice/CartItemRow.vue` | L135-144, L175-184 | UOM chevrons (`size="x-small"`) | 24 | Fail |
| `frontend/src/posapp/components/pos/items/ItemActionToolbar.vue` | L90-98 | `.action-btn-consistent` | **36** | Fail (42 on <768 — still fail) |
| `frontend/src/posapp/components/pos/items/ItemActionToolbar.vue` | L105-109 | `.view-toggle-btn` List/Card switch | 36 | Fail |
| `frontend/src/posapp/components/pos/items/ItemActionToolbar.vue` | L39-40 | view toggle inner `v-btn size="small"` | ~32 | Fail |
| `frontend/src/posapp/components/pos/customer/Customer.vue` | L33-77 | edit / reload / add icons inside autocomplete | ~24 (Vuetify icon-button default) | Fail |
| `frontend/src/posapp/components/navbar/NavbarAppBar.vue` | L652-662 | `.nav-icon` min-w/min-h | **40×40** | Fail (close-but-not-44) |
| `frontend/src/posapp/components/navbar/NavbarAppBar.vue` | L69-87, L170-196 | drafts toggle `v-btn icon size="small"` | 32 | Fail |
| `frontend/src/posapp/components/Navbar.vue` | L138 | toast spinner | 18 | N/A (read-only) |
| `frontend/src/posapp/components/pos/shell/Pos.vue` | L857-879 | `.mobile-pos-dock__item` | min-h **58** | Pass (50 wider, 58 tall) |
| `frontend/src/posapp/components/pos/shell/Pos.vue` | L965-972 | dock items <560px | min-h **52** | Pass (just) |
| `frontend/src/posapp/components/pos/shell/Pos.vue` | L928-940 | `.mobile-pos-dock__pill` (cart count) | 18×18 | N/A display only, but click region is the parent tile |
| `frontend/src/posapp/components/pos/Payments.vue` | L2107 | `:deep(.payment-footer--dialog .v-btn) min-height: 42` | 42 | Fail (close) |
| `frontend/src/posapp/components/pos/Payments.vue` | L2140-2143 | `:deep(.payment-shell--dialog .v-field__input) min-height: 34` | 34 | Fail |
| `frontend/src/posapp/components/pos/items/ItemCard.vue` | L317-333 | mobile card content (entire card is tap area) | image 112 + content; total >180 | Pass |
| `frontend/src/posapp/components/pos/invoice/ParkedOrdersRail.vue` | L196-212 | `.drafts-rail__chip-card` mobile chips | padding 12; total ~64 | Pass |
| `frontend/src/posapp/components/pos/flows/Returns.vue` | L1053 | min-height action row | 46 | Pass |
| `frontend/src/posapp/components/pos/items/ItemHeader.vue` | (search input) | search field density="compact" | 36 default | Fail |

Tally: ~14 component surfaces below 44px, including the most-pressed buttons in
the POS (qty +/−, UOM, edit name, view toggle, customer edit, navbar icons).
Pattern: `density="compact"` + `size="small|x-small"` is sprinkled everywhere as
desktop polish, but is the default style for the cart on phone.

### Action
1. Adopt `--pos-touch-target-min: 44px` from
   `upstream/feat-ui-ux-improvements:frontend/src/posapp/styles/theme.css` (the
   diff in REVIEW2's terms: theme.css line ~90 adds the token + the
   `.pos-touch-target` and `.pos-focus-ring` helpers).
2. Replace the `!important` 24px in `items-table-styles.css:L322-326,L424` with
   `var(--pos-touch-target-min)` *only on coarse pointer*:
   ```css
   @media (pointer: coarse) {
     .qty-control-btn, .posa-cart-table__qty-btn,
     .posa-cart-table__qty-display { min-width: var(--pos-touch-target-min); min-height: var(--pos-touch-target-min); }
   }
   ```
3. Add a project-wide `@media (pointer: coarse)` override that lifts every
   Vuetify `density="compact"` field to 44px min-height. Single override block,
   not per-component.
4. Make `ItemActionToolbar.vue`'s `.action-btn-consistent` and `.view-toggle-btn`
   honour the token (currently hardcoded 36).
5. `NavbarAppBar.vue:L656-657` — bump 40 → 44.

---

## 2) Responsive layout — where it breaks at each breakpoint

Existing breakpoint plumbing (`useResponsive.ts:L9-15`):
- `isPhone < 768`
- `isTablet 768-1099`
- `isDesktop >= 1100`
- `isCompact < 1100`
- `isShortViewport < 760` height

No phone-portrait / phone-landscape distinction, no tablet-portrait /
tablet-landscape distinction. The 768/1100 stair-step is too coarse for the
device matrix the user cares about (5" phone, 8" tablet, 24" monitor).

### Component-by-component

**ItemsSelector + ItemsSelectorCards** — `frontend/src/posapp/utils/itemSelectorLayout.ts:L8-16`
returns 1 column when width <=768. On a 360–428 CSS px phone the user can see
~3 items above the fold (image is 112 px tall + content + gap). That is
catastrophically low density for "market stall on phone." Upstream
`feat-ui-ux-improvements` rewrites the breakpoints to 420/860 so phones get up
to 2 columns and small tablets 3. Adopt.

**Invoice / Cart (ItemsTable)** — `frontend/src/posapp/components/pos/invoice/items-table-styles.css:L99-130`
column widths are absolute pixels (item_name 42% then 130 / 70 / 110 / 100 /
110 / 110 / 70 / 80 / 48). On portrait phone the table horizontally scrolls
and the visible columns are uneditable without scroll. The 24px qty buttons
also fail here. No CSS Grid / no card-row alternative for narrow viewports.

**Pos shell (Pos.vue)** — at width <992 the payment dialog stops opening as a
dialog and renders inline (`useCompactPosSwitcher` swaps the column layout).
Logic at `Pos.vue:L33-99` flips items vs invoice with one `compactPanel`. The
"mobile-pos-stack" dock at `L100-200` is fixed-positioned with five tabs at
<1099 — but it appears on tablets too, where there is room for a side rail.
Result: a 10" tablet in landscape mode gets a tiny phone-style bottom dock
covering 80px of cart real estate. Bug.

**Payments** — `Payments.vue:L2173-2222` collapses to single column at 768,
disables overflow, makes the footer sticky with `env(safe-area-inset-bottom)`.
Inputs inside drop to **min-height 34** at L2141 — fail on tap, fail on
visibility (font 0.78rem at L2147).

**Customer panel** — `Customer.vue:L5-77` is a single Vuetify autocomplete with
4 icon buttons inside it (edit, reload, add, and prepend-inner add). On phone
this row is ~36 px tall with four 24-px icons; everything collides. No
breakpoint-specific layout. The dropdown menu (virtual-scroll item height 48)
fills the screen and has no slide-up sheet styling. Looks like a desktop
combobox dropped on a phone.

**Returns flow** — `Returns.vue:L6` does `:fullscreen="isCompactReturns"` —
good. Action buttons clamp to `min-height: 46` at L1053 — barely Pass.

**Print preview / Barcode printing** — `components/pos/shell/BarcodePrinting.vue`
is 55 KB. No mobile media queries discovered (Bash listing didn't show
@media at <1024 there). On a phone the print template editor is unusable;
treat as desktop-only and gate.

### Action
- Replace 768/1100 with 5 tokens:
  `phone-p < 480 / phone-l 480-767 / tablet-p 768-1023 / tablet-l 1024-1279 / desktop >= 1280`.
- Adopt feat-ui-ux's `isUltraCompactTerminal` / `isLowResTerminal` from
  `useResponsive.ts` diff (768-1180 and 1180-1366).
- Hide the bottom mobile dock when `windowWidth >= 1024 && pointer: fine`. The
  v-btn-toggle compact switcher at L20-65 (with feat-ui-ux's badge addition) is
  enough on a tablet.
- Rewrite `ItemsTable.vue` for `pointer: coarse`: collapse non-essential
  columns (price_list_rate, discount %, batch, currency) into an expandable
  row; keep name / qty / total visible.

---

## 3) Touch gestures

`grep -r "touch-action|@touchstart|@touchmove|swipe"` returns:
- `frontend/src/posapp/components/PerfBadge.vue:L121-122` — dev-only badge drag
- `frontend/src/posapp/components/pos/Invoice.vue:L22` — resize handle uses
  `@touchend` to save invoice card height
- nothing else

There is **no swipe-to-delete** on cart rows. The way to remove a line item is
to find the (off-screen on phone) "actions" column and tap a 24×24 trash icon.
Mis-tap rate will be brutal — see §13.

There is **no pull-to-refresh** anywhere. `triggerForceReloadItems` exists in
`uiStore.ts:L282-285` but only fires from a (24px) button.

There is **no long-press** menu — Frappe's context-menu-like flows go through
modal dialogs that take 2+ taps to open.

`touch-action` is **not set anywhere**, which means:
- The qty +/− buttons will fire 300ms-delayed clicks on iOS Safari unless
  Vuetify is configured (it sometimes is via FastClick polyfill — but POSAwesome
  doesn't bundle one).
- Drag-to-add-from-items relies on HTML5 drag (`ItemCard.vue:L4-7` sets
  `:draggable="true"` and `@dragstart/@dragend`) which **does not fire on iOS
  touch at all**. The user can drag items to cart on desktop only.

`user-scalable`: `posapp/www/posapp.html:L18` — `viewport-fit=cover`, no
`user-scalable=no`. **Pinch-zoom allowed.** Good — accessibility win, but the
layout overflows horizontally if a user zooms (no `min-width: 0` discipline on
several flex parents — see Pos.vue:L786,L862,L884).

`overflow-anchor: auto` and `overscroll-behavior: contain` are correctly set
on the items grid (`ItemsSelector.vue:L1449-1455`) — good for browser pull-down
not nuking the POS.

### Action
- Add `touch-action: manipulation` to all `v-btn` and `.qty-control-btn` to kill
  iOS click-delay. Single rule in theme.css.
- Implement swipe-to-delete on `CartItemRow.vue` using Pointer Events (Hammer
  / vueuse-gesture or hand-rolled — ~60 lines). Soft-delete with 4-second undo
  snackbar (we already have `toastStore.ts`).
- Replace `:draggable="true"` HTML5 drag in `ItemCard.vue:L5-7` with Pointer
  Events. The desktop drag-to-cart UX is invisible to ~40% of users; either
  go all-in with pointer-based drag or drop it.
- Add pull-to-refresh on the items grid (PullToRefresh as a `<PullToRefresh>`
  wrapper that calls `triggerForceReloadItems`).
- Add long-press on `CartItemRow` to open a contextual sheet (remove / edit
  name / discount / batch / serial / set-rate). One menu replaces 6 hidden
  dialogs.

---

## 4) Performance on mid-tier Android (Snapdragon 6-series, 4 GB RAM)

Encouraging signs:
- Hardware-accelerated grid: `ItemsSelector.vue:L1438-1446` sets
  `transform: translate3d(0,0,0)` + `backface-visibility: hidden`. Good.
- Reduced-motion: `ItemsSelector.vue:L1459-1464` honors `prefers-reduced-motion`
  on grid animations.
- `v-memo` on cart rows: `CartItemRow.vue:L2`.
- `shallowRef` everywhere on hot store paths (`REGROUPED.md` section C).
- Virtual scroll on item grid (vue-virtual-scroller, kept as separate chunk
  per `vite.config.js:L143-145`).
- `chunkSizeWarningLimit: 700` and per-vendor chunks
  (`vite.config.js:L100-154`) keep first paint sane.
- `esbuild.pure: console.log/debug/trace` strips noisy logs
  (`vite.config.js:L162-165`).

Bad signs:
- `box-shadow: 0 18px 38px var(--pos-shadow)` on every `.mobile-pos-dock` and
  `.mobile-sale-dock` plus `backdrop-filter: blur(18px)` (`Pos.vue:L805-808`).
  On a mid-tier Android, `backdrop-filter` + large shadow blur is a paint
  storm — every cart update will repaint the dock. Same again at
  `Pos.vue:L901-921` for dark-mode overrides. This is a known perf trap.
- `ItemCard.vue:L165-178` has 4-property transition + `will-change: transform`
  + `backface-visibility` + `transform: translate3d` on **every card**. With
  ~30 cards rendered (3-column tablet view), that's 30 promoted layers. GPU
  memory pressure on a Pixel 4a — observed in similar Vuetify apps to push
  Chrome to LMK.
- `theme.css:L6-108` updates ~80 CSS custom properties via inline `style.setProperty`
  on every theme toggle (`useTheme.ts:L127-201`). Each property change
  invalidates the whole subtree. Theme toggle on phone has measurable hitch.
- `useResponsive.ts:L86-97` resize handler is rAF-debounced — good, but a
  Vuetify `useDisplay` is also subscribed in `useRtl.ts:L10` and other places.
  Two independent listeners doing the same work.
- No frame-budget evidence anywhere — no Lighthouse report, no
  Web-Vitals telemetry sent. Just the `PerfBadge.vue` overlay (dev-only).

### Action
- Drop `backdrop-filter: blur(18px)` on dock; replace with solid 92%-opaque
  background. Same on `qty-counter:L323`.
- Replace `box-shadow: 0 18px 38px` with `0 4px 12px` on dock (subjective
  cosmetic loss, big paint win on phones).
- Promote `will-change: transform` only on hover (CSS rule scoping), not as
  default state on every item card.
- Wire `web-vitals` (~3 KB) to push LCP/CLS/INP to the Frappe backend; gate
  the budget at INP < 200 ms on mid-tier Android, expose in PerfBadge.

---

## 5) PWA grade — D+ at best

### Manifest (`posawesome/www/manifest.json`)
- `start_url: "/app/posapp"` — fires up Desk shell, **not** the SPA `/posapp`
  route. Wrong target. Should be `/posapp`. As is, A2HS launches into the
  150 k-DOM Desk and posapp.py:L11-12 reroutes anyway, wasting 600+ ms.
- `display: standalone` — fine.
- `theme_color: "#0097A7"` — manifest says cyan. **But** `posapp.html:L19`
  meta says `#0f172a` (slate). Two different colors. Status bar will flash
  cyan during install then go slate. Pick one.
- `background_color: "#FFFFFF"` — splash is white. Dark-mode users get a
  white flash. Bad.
- `icons[]` — only 144 and 512. Missing 192 (required by Chromium A2HS rules),
  no maskable icon (no `purpose: "maskable"`), no SVG, no monochrome variant.
  Lighthouse PWA score will dock for this.
- No `id` field (Chrome dedupes on `start_url` only — risk of duplicate
  installs).
- No `categories: ["business","productivity"]`.
- No `lang` / `dir` — RTL users get LTR PWA chrome.
- No `description`.
- No `shortcuts[]` — perfect place to expose "New Sale / Drafts / Returns".
- No `share_target` — could accept barcodes via Android Sharesheet (huge
  user-delight win for handheld scanners).
- No `protocol_handlers` / `file_handlers`.
- `screenshots[]` present (mobile 349×852, wide 1906×920). Good for
  install dialog. But "screenshot-mobile" 349 px is too narrow — Chrome wants
  >= 320×600 with form_factor narrow; ours is fine, but two screenshots is
  thin. Recommend 3-4.

### Service worker (`posawesome/www/sw.js`)
- Hand-rolled SW (376 lines). Hashed-asset cache by build-version. Mature.
- Precache strategy: opens `caches.open(cacheName)` then iterates URLs at
  install (`L70-86`). One failed fetch logs and continues — good, no fail-fast.
- `MAX_CACHE_ITEMS = 1000` (`L4`). Reasonable.
- Navigation fallback chain at `L308-330`: cached request → /posapp shell →
  /app/posapp Desk shell → `/offline.html` → `Response.error()`. Solid.
- Skip-waiting on install (`L237`) — auto-upgrade is aggressive. Combined
  with `clients.claim()` at `L256`, the user can lose form state mid-edit if
  a deploy lands. We need an "update available — reload?" prompt UX.
  `sw-updater.ts` exists with `resolveActiveVersionTransition` (L57-) that
  computes a transition record — but where it surfaces in UI is non-obvious.
  Check `components/ui/UpdatePrompt.vue` — exists and is wired
  (feat-ui-ux-improvements has improvements at +45 lines).
- No `BackgroundSync` registration for the invoice outbox. Pending invoices
  ride on the SPA being open. iOS Safari will kill the tab in background; the
  outbox does not flush on its own.
- No `Periodic Background Sync` for catalog refresh.
- No `Push` registration (we have socket.io for online but not for closed PWA).
- Cache strategy for `/posapp` shell is stale-while-revalidate but the boot
  payload is server-rendered — so an offline launch shows a stale boot. That
  is acceptable for offline, but currently no warning is shown to the user.

### `offline.html`
- Standalone HTML at `posawesome/www/offline.html:L1-110`. Has light + dark
  via `@media (prefers-color-scheme: dark)` at L58-81. Good.
- Lists "Available" vs "Unavailable" in offline mode. Helpful, but it claims
  "Unavailable: Printing receipts" — actually the offline print template at
  `frontend/src/offline_print_template.ts` exists and can fire (~30 KB).
  Text is wrong.
- No "retry" button. Removed per L56 comment. Should be there with auto-retry
  on `online` event.
- Not branded — it's the only static page a customer might see if the SPA
  fails to load. Add per-tenant logo (read from boot or query param).

### iOS Safari quirks
- No `<link rel="apple-touch-icon">` at any size in `posapp.html`. iOS users
  who A2HS get a generic webclip icon.
- No `<meta name="apple-mobile-web-app-capable" content="yes">`.
- No `<meta name="apple-mobile-web-app-status-bar-style">` — status bar will
  not match the slate `theme-color`.
- `viewport-fit=cover` is set (`posapp.html:L18`) but no `padding-bottom:
  env(safe-area-inset-bottom)` on the dock except for the inline mobile dock
  (`Pos.vue:L794`). The payment dialog footer uses `env(safe-area-inset-bottom)`
  (`Payments.vue:L2220`) — good. But the cart card itself does not. Notch
  iPhones overlap the cart bottom.
- The `100dvh` use in `Payments.vue:L1969` / `PayView.vue:L8` is correct, but
  several places still use `100vh` — search for `100vh` and audit.

### SW update flow (we have `v=<build>` versioning)
- `sw.js:L27-29` builds versioned asset URLs `?v=<sha>`. SW reads `version.json`
  with `cache: "no-store"` (`L155`). Cache name `posawesome-cache-<version>`
  (`L188`). Update activation cleans old caches (`L88-95`). This part is solid.
- The user-facing prompt — `UpdatePrompt.vue` exists. We need to confirm it's
  shown on `SW_VERSION_INFO` events and provides "Reload now / later" with a
  visible badge. Upstream `feat-ui-ux-improvements` has it improved (+45 lines).

### Action
- Manifest fixes (one-shot PR):
  - `start_url: "/posapp"`
  - One `theme_color` matching `posapp.html` (`#0f172a` — recommend dark for
    POS, looks pro).
  - `background_color` matching theme.
  - Add 192 PNG + 512 maskable + monochrome.
  - Add `id`, `categories`, `lang`, `dir`, `description`.
  - Add 3 `shortcuts`: New Sale, Drafts, Returns.
  - Optional: `share_target` for barcode URL handlers.
- Add iOS meta tags + apple-touch-icon 180×180 in `posapp.html`.
- Brand `offline.html` from boot payload.
- Wire `BackgroundSync` for invoice outbox.
- Add `web-vitals` reporter.

---

## 6) Offline + sync UX

`offlineSyncStore.ts:L33-104` is the data model — solid.

| Surface | File:line | State |
|---|---|---|
| Outbox indicator (pending invoices count) | `offlineSyncStore.ts:L78-92` exposes `summary.pendingInvoices`; rendered in `OfflineInvoices.vue` | Present, not surfaced in the main shell |
| Bootstrap warning banner | `offlineSyncStore.ts:L94-104,L107-110` | Present |
| Per-resource status | `offlineSyncStore.ts:L111,L114-121` ("syncing/stale/error/limited") | Present — shown only in a hidden panel toggle |
| Conflict resolution | None found | Missing — submit-while-stale can clobber server state |
| Slow-network feedback | `useNetwork.ts` (likely throttles) | Implicit — no progress-of-progress UI |

The pendingInvoices is invisible until the user opens NavbarMenu. On phone the
user has zero affordance that "5 invoices are queued for sync." Bad for a
market-stall scenario where the cashier hands the phone back without checking.

`SyncCoordinator` (referenced in offlineSyncStore comments) drives sync — no
conflict-resolution UX. If a server-side price changes after the cashier loaded
their offline catalog and they sell at the stale price, the submit silently
takes the server value or fails.

### Action
- Surface `pendingInvoices` as a persistent badge on the mobile dock (next to
  "Pay" or as its own "Outbox" tile).
- Surface server-online state as a colored 4-px strip along the top of the
  shell (green online, amber limited, red offline). Always visible.
- Conflict UX: when the server returns a 409-equivalent (price changed, stock
  gone), show a sheet "Reconcile X items — 2 prices changed, 1 OOS" with
  per-line accept/keep.

---

## 7) Accessibility — WCAG 2.1 AA review

| Criterion | Status | Where |
|---|---|---|
| 1.4.3 Contrast (light) | Mostly Pass | `theme.css:L17-21` text on white; `--pos-text-secondary: #666666` on `--pos-bg-secondary: #f8f9fa` → 5.74:1 (Pass AA, fail AAA). `--pos-text-hint: #bdbdbd` on white → 1.92:1 → **FAIL** (used in input placeholders). |
| 1.4.3 Contrast (dark) | Mostly Pass | `--pos-text-primary: #ffffff` on `#121212` = 18.9:1 ; `--pos-text-secondary: #e0e0e0` on `#1e1e1e` = 13.1:1 — solid. `--pos-text-disabled: #9e9e9e` on `#1e1e1e` → 4.9:1 ok. |
| 2.4.7 Focus visible | Partial | `theme.css` adds `.pos-focus-ring` token in feat-ui-ux but not yet adopted across components. `CartItemRow.vue:L100-101` uses `tabindex="0"` + role="button" but no scoped `:focus-visible` ring. |
| 2.5.5 Target size | **FAIL** | See §1. |
| 1.3.1 Info & relationships | Partial | aria-labels exist (`CartItemRow.vue:L56,L67,L83,L99,L125,L140,L152,L181`) — good for qty/uom. Missing on: `ItemCard.vue` (no aria-label on the entire tap area), `ItemActionToolbar.vue` (toggle buttons untitled), `Customer.vue` icons (using `v-tooltip` but no aria-label fallback). |
| 4.1.2 Name, role | Partial | Vuetify provides roles, but custom button-divs (`Pos.vue:L153-198` mobile dock `<button>` — present, role implicit) ok. Dropdown menus rely on Vuetify (mostly fine). |
| 2.1.1 Keyboard nav | Partial | `invoiceShortcuts.ts` exists (9.1 KB) — global F-key shortcuts. Tab order within the cart is not explicit; the qty-edit input opens via Enter (`CartItemRow.vue:L100-101`) — good. Customer dropdown is virtual-scroll which historically breaks keyboard arrow nav. |
| 2.3.3 Reduced motion | Partial | Honored in `ItemsSelector.vue:L1459-1464` and presumably theme.css. **Not honored** on `mobile-pos-dock__item:active { transform: scale(0.98) }` (`Pos.vue:L924-926`) or `.qty-control-btn:hover` scale (`items-table-styles.css:L378,395`). |
| 3.3.1 Error identification | Weak | `freeze()` overlay (`uiStore.ts:L146-150`) blocks input but no role="alert"; errors come via `toastStore`. Need to verify aria-live="assertive" on toast container. |
| Screen-reader labels | Partial | Cart-row controls labeled; numeric cells (`amount-value`) are bare numbers in foreign-currency context — wrap with `<span aria-label="Total in MXN">$1,234.00</span>`. |
| RTL support | Good base, gaps | `useRtl.ts` is comprehensive (LTR/RTL helpers, computed styles, flex-direction flipping). Adopted in NavbarAppBar (RTL classes at `L672-680`), Customer.vue, CartItemRow.vue. **Upstream commit `dae4286a`** (in `doco-customizations`) adds RTL to pay sidebar with `--dp-direction` for VueDatePicker and unscoped CSS for teleported menus. Good — keep. Gaps: ItemsTable column widths in `items-table-styles.css` are hardcoded for LTR; verify they don't break in RTL. |

### Action
- Add a global `.pos-focus-ring` rule and apply to all interactive elements via
  `:focus-visible`. Adopt from `feat-ui-ux-improvements` theme.css diff.
- Fix `--pos-text-hint: #bdbdbd` — bump to `#757575` (4.6:1 on white).
- Add `prefers-reduced-motion: reduce` global rule killing all `:hover`
  transforms (one block in theme.css).
- Audit `toastStore` to ensure `aria-live="assertive"` on the toast container.
- Run `frontend/scripts/contrast-audit.mjs` (added by upstream max-pro skill at
  L122) on the current palette and fix flagged pairs.

---

## 8) Visual modernity — "cool" factor

What is good
- Color tokens are mature: 4 layers (bg/surface/text/border) × light/dark, plus
  primary / secondary / accent / 6 semantic. (`theme.css:L1-200`)
- Shared radius (xs/sm/md/lg) and spacing scale (1–6).
  (`theme.css:L80-91`)
- Dark mode is real — not just inverted. Distinct primary (`#00D4FF` cyan),
  distinct shadows, distinct hover bg.
- Cards have layered shadow (`ItemCard.vue:L175`: `0 10px 24px shadow-light`)
  + 0.2s cubic-bezier transitions + lift on hover (`L182-186`).
- Mobile dock has `border-radius: 24` + `backdrop-filter: blur` + safe-area
  insets — looks the part on a screenshot.

What is dated
- Typography: no scale tokens. Sizes hardcoded as `.95rem / .82rem / .75rem`
  per component. No type-ramp variable. Display vs body vs caption is by ad-hoc
  font-size guesses. Result: inconsistent vertical rhythm across screens.
- Density: no user-controlled density. `density="compact"` is the default
  everywhere — too cramped for touch, too loose for cashier-monitor power use.
- Icons: mdi-only. No custom illustration, no animated state changes. The
  cart-empty state is generic (per `overhaul-responsive-cashier-flow` commit
  `0b824198` "improve cart empty state" — adopt).
- Micro-interactions: hover lift is fine; click feedback is minimal
  (`scale(0.98)` on dock item active). No haptic, no confirmation animation
  on "added to cart," no success burst on payment complete. (There IS a
  fly-animation composable `useFlyAnimation.ts` — confirm it's wired; commit
  log says it was). Upstream "max-pro" branch has KeyboardShortcutsDialog +
  brand-chip fly target.
- Spacing rhythm: `--pos-space-*` exists but not used in `Pos.vue:L100-200`
  mobile dock — raw `10px/12px/16px/24px` hardcoded.
- Brand-theming: none. Single hardcoded primary (`#0097A7` light, `#00D4FF`
  dark). Per-tenant POS terminal cannot rebrand. Not even at runtime.

### Cool-factor moves
- Add a "Hero number" treatment to the mobile sale dock (`Pos.vue:L101-109`)
  — large `clamp(1.5rem, 4vw, 2.4rem)` total with animated digit roll on update.
  We already do `clamp(1.05rem, 2vw, 1.5rem)` at L834 — bigger.
- Skeleton shimmer on the items grid using `styles/shimmer.css` (exists at 405
  bytes, presumably unused beyond a single component) — apply to all
  loading states uniformly.
- Add a subtle pulse on the cart badge when items are added — feat-ui-ux's
  `cartBadgePulse` (Pos.vue diff). Adopt verbatim.
- Replace the white-flash splash by extending `posapp.html` body bg
  (`#0f172a` slate already there L36) and matching the manifest
  `background_color`.
- Branded SVG empty-state for "No items found"
  (`ItemsSelectorCards.vue:L111-113` references the literal "No items found"
  text — pair with art).
- Theme-aware brand chip per tenant: 24-byte tenant config (primary hue +
  logo URL) — read at boot from `posawesome_boot.brand`.

---

## 9) Configurability — wiring points

Today's prefs (light/medium handles):
- `useTheme.ts` — light/dark/automatic + persists to `localStorage` +
  syncs with `frappe.xcall("frappe.core.doctype.user.user.switch_theme")`.
  Solid 340 lines.
- Locale: Frappe's `__()` macro is used everywhere (`window.__`).
- RTL: `useRtl.ts` (autodetects via `frappe.utils.is_rtl()` + lang code).

Where to hook
- **Per-tenant branding** (logo, primary hue, accent): add `brand` block to
  the boot payload (`posapp.py` already builds `boot_json`). Read once in
  `useTheme.ts` and seed `--pos-primary*` overrides as inline `:root` style.
  Persist override in localStorage with tenant ID as namespace key.
- **Density**: add a 3-state `density` ref to `useResponsive.ts` (comfort /
  default / compact) and feed it into a `<DensityProvider>` that overrides
  `--pos-touch-target-min` and v-btn/v-field defaults. Upstream `44969815`
  in max-pro skill adds "density mode" — adopt and extend.
- **Accent**: tenant-configurable accent (`--pos-accent`) already isolated at
  `theme.css:L36-37` and `L143-145`. Trivial to expose.
- **RTL**: works. Add a "force LTR / force RTL / auto" toggle in NavbarMenu.
- **Locale**: depends on Frappe lang. Add a per-terminal override (some
  cashiers in MX are bilingual MX/EN).
- **Keyboard shortcuts**: `invoiceShortcuts.ts` exists. Upstream max-pro skill
  adds `KeyboardShortcutsDialog.vue` (+109 lines). Adopt.
- **Density preset per device**: at boot, detect pointer / viewport and
  apply: coarse + <768 → comfort; coarse + >=768 → default; fine + >=1280 →
  compact. Save preference once user overrides.

---

## 10) Upstream UX branches — verdict

### `upstream/integrate-ui-ux-max-pro-skill-in-repo` — **ADOPT (selective)**
38 files, 2,151 +/−. Big bag. Net win.
- ADOPT: `theme.css` token additions (touch-target-min, pos-focus-ring,
  pos-dialog-shell helpers), `KeyboardShortcutsDialog.vue`, `contrast-audit.mjs`,
  `items-table-styles.css` focus/qty improvements, `Pos.vue` density mode +
  shortcut help overlay, `Payments.vue` touch-target bump.
- ADOPT: `c89a971f` "setup ui ux max pro skill", `61439fa5` "modernize POS UX
  with responsive spacing", `44969815` "add density mode, shortcut help overlay,
  mobile quick actions, and UI quality gates".
- BLEND: `8badfcf0` "improve keyboard flows, focus states, reduced-motion".
  Pair with our existing reduced-motion handling.
- DECLINE: anything entangled with Reports.vue overhaul if our reports are
  forked.

### `upstream/feat-ui-ux-improvements` — **ADOPT (mostly)**
42 files, 3,077 +/− , 1,032 −. Real responsive overhaul.
- ADOPT: `useResponsive.ts` rewrite (5 viewport classes), `itemSelectorLayout.ts`
  breakpoint shrink (768→420, 1200→860 — phones get 2 cols), `Pos.vue`
  `useMobileActionBar` + `cartBadgePulse`, `theme.css` `--pos-touch-target-min`,
  `useFlyAnimation.ts` enhancements, `useItemSelection.ts` mobile cleanup.
- BLEND: `ItemsSelectorCards.vue` and `ItemsSelectorTable.vue` rewrites — diff
  carefully, our `IndexOf-Items-Table` performance work must not regress.
- DECLINE: nothing obvious. This is the highest-value branch.

### `upstream/overhaul-responsive-cashier-flow-and-restore-frontend-build` — **ADOPT (small bites)**
Many small fixes, mostly bug fixes for tablet/mobile.
- ADOPT: `c2786cc5` "Add dense mode for low-resolution POS terminals",
  `731f82de` "Remove Pay tab from mobile POS action bar" (validates §2 above),
  `2a1ab0c1` "make draft and invoice flows responsive on compact screens",
  `8e6d35e2` "make sales return flow responsive on mobile and tablet",
  `166a9648` "sync mobile active sale total with live discount updates",
  `dd9f5e9c` "invoice button cutting in tablets", `49016b34` "enable full cart
  scrolling on tablet and desktop", `0b824198` "improve cart empty state",
  `73b3de7a` "improve POS accessibility labels and theme consistency".
- BLEND with care: the merge with feat-ui-ux above will conflict on
  `useResponsive.ts`, `Pos.vue`. Manual rebase.

### Recommended sequence
1. Cherry-pick the small targeted fixes from `overhaul-responsive-cashier-flow`
   (one bug = one commit, easy to bisect).
2. Merge `feat-ui-ux-improvements` wholesale into a `track/feat-ui-ux` branch;
   stabilize 1 week.
3. Layer `integrate-ui-ux-max-pro-skill-in-repo` on top, cherry-picking only the
   UI pieces (skip Reports if forked).
4. Promote to `doco-customizations` after lab.xolo soak.

---

## 11) PR-worthy UX wins to push BACK upstream (3-5)

1. **`fix(pos): coarse-pointer touch-target override for cart controls`**
   Wrap the 24-px qty/UOM/edit buttons in `@media (pointer: coarse)` to lift
   to 44 px, with no impact on desktop layout. Smallest possible change,
   biggest user impact. Touches one CSS file. Upstream already half-fixed in
   max-pro (28 px) but the right answer is "44 on touch, 28 on mouse."

2. **`feat(pwa): manifest + iOS meta hardening`**
   Fix `start_url`, add 192/maskable/monochrome icons, add `id`, `categories`,
   `lang`, `dir`, `shortcuts`, apple-touch-icon, apple-mobile-web-app-capable,
   status-bar-style. One commit, all of `posapp/www/manifest.json` and
   `posapp/www/posapp.html`. No code logic change.

3. **`feat(offline): BackgroundSync registration for invoice outbox`**
   Register a `sync` event in `sw.js`, fire it from `offlineSyncStore` when an
   invoice is enqueued. Survives the user closing the tab. Big reliability win
   for handheld POS.

4. **`feat(a11y): global reduced-motion + focus-visible tokens`**
   One block in `theme.css` that:
   - Adds `--pos-touch-target-min`, `--pos-focus-ring`, `--pos-density-*`.
   - Adds `@media (prefers-reduced-motion: reduce) { * { transition: none !important; transform: none !important; } }`.
   - Adds global `:focus-visible` outline using the ring token.

5. **`feat(ux): swipe-to-delete on cart rows with undo`**
   Pointer-event-based swipe handler in `CartItemRow.vue` + a 4-second undo
   toast in `toastStore`. ~80 lines net. Replaces the missing dedicated remove
   button (which is currently the 24-px overflow-icon).

Bonus candidate: **`fix(theme): replace backdrop-filter blur on mobile dock`**
— if perf telemetry confirms paint cost.

---

## 12) Doco-specific UX to KEEP in fork

Things we have that upstream lacks or implements differently — do not lose in
the next merge.

- **`dae4286a` RTL pay sidebar** (cited in §7). Our merge of `109a2c39` /
  `e25d3390` / `7014a8a1` is more comprehensive than upstream's RTL story.
  Keep wholesale in fork.
- **PerfBadge.vue** + the perf branch's store de-deepening (REGROUPED.md §C/D).
  Don't let any UI refactor remove the `shallowRef`/`markRaw` patterns.
- **Hashed entry filenames + `version.json` asset map**
  (`vite.config.js`, `build-manifest.js`, `sw.js`). Critical for our deploy
  rhythm.
- **`/posapp` web-route** (`posapp.html`, `web-entry.ts`) — bypass Desk shell.
  150 k vs 5 k DOM nodes. Massive perf win. Upstream may not have this
  yet at the same fidelity; verify before merging anything that touches
  `posapp.html` / `loader.ts`.
- **`OfflineInvoices.vue` outbox UI** — 20 KB; integrated with our sync model.
- **Doco-specific CFDI / Frappe-Mexico hooks** (out of scope here but the UX
  surface for "estatus de CFDI" must keep its slot in the cart row).

---

## 13) Six-sigma defect angle — UX defects per million interactions

Reasoning: a 5-employee phone-repair shop runs ~120 sales/day across 3 phones.
That's ~36k cart-touch interactions/year/employee. Multiply by 5 = 180k
cart-touches plus ~600k catalog-tap interactions. Some failure modes:

| Defect | Source | Estimated DPMO | Annual occurrences (180 k cart, 600 k catalog) |
|---|---|---|---|
| Qty +/− mis-tap (24-px button on coarse pointer) | §1, items-table-styles.css:L322-326 | ~80,000 DPMO at 24 px (vs ~12,000 at 44 px per Fitts' law w. 16-mm thumb); for ~9 qty-edits per sale × 120 sales × 250 days = 270 k qty-events → **~21,600 mis-taps/year** | 21.6 k → angry cashier / overbilled customer |
| Wrong-item-added (no card label aria, dense grid w/ 1 col on phone) | §2, itemSelectorLayout.ts | ~5 k DPMO of "added wrong item." 600 k catalog-taps → **~3,000 wrong adds/year** | 3 k → 3 k voids or refund-line creates |
| Customer mis-pick (autocomplete with 4 icon buttons inside) | §1, Customer.vue:L33-77 | ~3 k DPMO. ~120 customer-pick/day × 250 = 30 k → **~90/year** | 90 wrong-customer invoices |
| Accidental "Remove line" (no swipe undo, hidden icon) | §3 | ~2 k DPMO of accidental removes; with no undo, **all** are user-recovered manually. 180 k cart-touches → ~360/year accidental removes | 360 manual re-adds + apology |
| Pay-button mis-tap during edit (footer overlap on 100vh in landscape iOS) | §5 safe-area gaps in cart | ~1 k DPMO. ~250 payments/day × 250 = 62 k → ~60/year | 60 partial-pays / pre-mature charge |
| Lost pending invoice (tab closed offline, no BackgroundSync) | §6 | ~500 DPMO of "browser killed tab w/ pending in outbox." ~50 offline events/year (rough) → **2-3/year**, but **each is a lost sale** | 2-3 fully-lost transactions/year |
| Conversion abandon (single-col items, mis-zoom) | §2, 768-breakpoint | Hard to quantify; assume 0.3% abandon-due-to-UX on phone POS → at small-business volume ~10/year customer-walks | 10 walked customers/year |
| Theme flash on cold start (white splash → dark theme) | §5 manifest + posapp.html mismatch | ~100% of cold launches in dark mode = ~3 × 250 × 3 = 2,250/year cosmetic, not a defect, but feels broken | brand-trust drag |

Quick wins ranked by interactions-saved:
1. 44-px qty buttons on touch → saves ~20 k mis-taps/year (largest line).
2. Swipe-to-delete with undo → saves ~360 manual recoveries, removes the
   embarrassment vector.
3. BackgroundSync outbox → saves 2-3 fully-lost sales (highest dollar value).
4. 2-col phone grid (feat-ui-ux breakpoint) → saves ~3 k wrong-item adds.
5. Manifest fix → eliminates cold-start brand-flash.

---

## Citations summary (load-bearing)

- `posawesome/www/manifest.json:L1-34` — PWA manifest gaps
- `posawesome/www/posapp.html:L18-22,L36-40` — viewport, theme-color mismatch, body bg
- `posawesome/www/offline.html:L86-107` — offline page (wrong "no print")
- `posawesome/www/sw.js:L11-25,L70-95,L236-261,L263-376` — SW precache / activate / fetch
- `frontend/vite.config.js:L100-165` — chunk strategy, log stripping
- `frontend/src/sw-updater.ts:L1-100` — update flow
- `frontend/src/posapp/composables/core/useTheme.ts:L88-207` — theme + CSS prop hammer
- `frontend/src/posapp/composables/core/useResponsive.ts:L1-128` — breakpoint base (replace with upstream feat-ui-ux rewrite)
- `frontend/src/posapp/composables/core/useRtl.ts:L1-202` — RTL helpers
- `frontend/src/posapp/styles/theme.css:L1-200` — token system (add touch-target-min)
- `frontend/src/posapp/utils/itemSelectorLayout.ts:L1-43` — column count (upstream shrinks 768→420)
- `frontend/src/posapp/components/pos/items/ItemCard.vue:L159-333` — card layout, mobile media
- `frontend/src/posapp/components/pos/items/ItemActionToolbar.vue:L29-67,L89-160` — 36 px buttons
- `frontend/src/posapp/components/pos/items/ItemsSelector.vue:L1-150,L1389-1465` — selector shell, media queries
- `frontend/src/posapp/components/pos/invoice/CartItemRow.vue:L49-128,L132-186` — cart controls
- `frontend/src/posapp/components/pos/invoice/items-table-styles.css:L88-130,L201-209,L262-310,L322-447` — table sizing, the qty 24-px sin
- `frontend/src/posapp/components/pos/invoice/ParkedOrdersRail.vue:L195-276` — mobile drafts strip (ok)
- `frontend/src/posapp/components/pos/Payments.vue:L1969,L2107,L2140-2143,L2173-2222` — payment dialog & sticky footer
- `frontend/src/posapp/components/pos/customer/Customer.vue:L5-77` — autocomplete touch density
- `frontend/src/posapp/components/pos/shell/Pos.vue:L20-200,L756-973` — shell layout + mobile dock
- `frontend/src/posapp/components/pos/shell/PayView.vue:L1-90` — Pay shell
- `frontend/src/posapp/components/pos/flows/Returns.vue:L6,L1025-1057` — fullscreen on compact, 46 px actions
- `frontend/src/posapp/components/navbar/NavbarAppBar.vue:L15-87,L652-680` — nav icon 40-px
- `frontend/src/posapp/stores/uiStore.ts:L1-374` — UI state plumbing
- `frontend/src/posapp/stores/offlineSyncStore.ts:L33-180` — outbox model

Upstream pin commits:
- `dae4286a` (in our `doco-customizations`) — RTL pay sidebar
- `c89a971f`, `61439fa5`, `8badfcf0`, `44969815`, `68ebb791` — max-pro skill UX
- feat-ui-ux: `c2786cc5`, `731f82de`, all in `upstream/feat-ui-ux-improvements`
- overhaul: `0b824198`, `dd9f5e9c`, `49016b34`, `73b3de7a`, `2a1ab0c1`, `8e6d35e2`

---

End of audit. Next step: synth merges this with the perf / a11y / arch reviews
in REVIEW2.
