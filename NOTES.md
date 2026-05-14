# POSAwesome — open notes for the next focused session

## Open issues (need a longer session)

### 1. Scanner state machine still has rough edges (partial fix shipped)

**What's fixed in 6a17091b** (`fix(scanner): self-heal scanner lock on dialog close + drop persistent`):
- `setTimeout(15000)` safety auto-release inside `showScanError`.
- `watch(scanErrorDialog)` drops `scannerLocked` whenever the dialog closes, regardless of how.
- Removed `persistent` from `<v-dialog>` so tap-outside / back-button dismissal works on small screens.

**Still TODO**:
- The scanner has TWO `showScanError` functions (one in `useScannerInput.ts` that locks, one in `useScanProcessor.ts` that doesn't). The local non-locking one masks the locking one for "Item not found" but doesn't surface anything to the operator. Consolidate into a single function that always opens the dialog.
- The `keyCodeMapper` keyboard heuristic (`/^\d$/`, `minLength=12`) kills any scan that's not pure digits — breaks Code 128, VINs, our `ITM-`/`UBI-` prefixes. Switch to keystroke-velocity detection (< 25 ms inter-key interval + Enter terminator) so the prefix scheme works.
- The `_scannerAttached` global on `document` is fragile across Vue reroutes. Rewrite `initScanner` to track its handler in a closure-local ref and tear it down properly on unmount.
- `OpenCV.js` is bundled even when not used (~11 MB). Lazy-load behind an explicit "modo lectura difícil" toggle.

### 2. POS mobile UX

- `<ScanErrorDialog>` body gets clipped behind the soft keyboard on Android. Fix shipped (drop `persistent`), but the dialog max-width=420 + Vuetify's vh sizing on small phones can still cut off the OK button. Add `:fullscreen="$vuetify.display.smAndDown"` so it goes fullscreen on phones.
- Item search field receives focus mid-scan if the user taps the keyboard area to dismiss; the next keyup is captured as a "search" instead of a scan. Investigate whether `focusSearchHandler` is racing with the scan callback.

### 3. Item Barcode quirks

- `posa_uom` Custom Field on `Item Barcode` couples this fork to a non-standard field. Plan: drop the CF, move per-barcode UOM to a new doctype `Mercado Item Barcode UOM` so we don't fight upstream ERPNext.
- Multiple Items can share the same barcode (Frappe doesn't enforce UNIQUE). Today the resolver picks the most recently modified — fine for the dominant case, but should surface a picker UI when count > 1.

### 4. Settings reload on every scan

- `useScanProcessor` re-fetches the full POS Profile + Stock Settings doc on every scan to read `allow_negative_stock` etc. Move to a one-shot fetch at boot + realtime subscription for changes.

### 5. Tests

- No unit tests for the scanner state machine. Add Vitest coverage for:
  - `scannerLocked` cycle: lock → dialog open → dialog close → lock cleared.
  - 15 s safety timeout.
  - Watch-based release on programmatic dialog close.
  - The two `showScanError` paths produce same UX.

## Reference

- Phase 7 architecture: `/home/holymc2/muelle-host/mercado/docs/scanner/ARCHITECTURE.md`
- POSAwesome scanner research (pre-fix): `/home/holymc2/muelle-host/mercado/docs/scanner/POSAWESOME_SCANNER_RESEARCH.md`
- Bug report: scan IPN0003151 on Android froze the POS on `ventas.lab.xoloitzcuintles.com` (item didn't exist in `tabItem` — pure not-found edge case).

## Suggested order for the next focused session

1. Consolidate the two `showScanError` paths (15 min)
2. Fullscreen dialog on smAndDown (10 min)
3. Replace digit-only heuristic with velocity-based detection (1 h)
4. Add Vitest suite for the lock state machine (1 h)
5. `Mercado Item Barcode UOM` doctype + migration off `posa_uom` (2 h)
6. Lazy-load OpenCV.js (45 min)

Total: half-day focused session.
