# PROD deploy runbook — 2026-07-11 batch — ✅ DONE 2026-07-12 (v39 cell roll)

> Executed 2026-07-12 morning window. Reality answer to §1a: contavm is
> HYBRID — posawesome/saldo bind-mounted (git pull) + image v39 recreate;
> SPA via posawesome-push-prod. All §2 steps green, §3.1 hold flipped ON
> (docomexico), §3.3 real-recarga e2e + §3.4 vigia panel still pending.
> Kept for the §4 watch list + §5 rollback levers.

Everything below is LAB-verified + pushed. Prod baseline: posawesome
`158b3621` (deployed 2026-07-03). Pending: `373ea4f2..e124a14c` (~69
commits) + saldo `1f08067..e6bfd03` (hold-until-confirm + fixes).
Written 2026-07-11; re-verify reality before acting (memories drift).

## 0. Context to load

- Memories: `feedback_muelle_docker_deploy_workflow`, `feedback_prod_readonly`,
  `feedback_check_reality_before_touching`, `feedback_contavm_apps_bindmounted`
  (CORRECTED 2026-07-11: contavm = pure baked image, deploy = rebake+retag —
  **but** `posawesome-push-prod.sh` rsyncs the SPA bundle out-of-band and
  earlier prod deploys used `prod-refresh.sh` for Python; **STEP 1a resolves
  this conflict against live reality, do not assume either way**),
  `project_saldo_hold_until_confirm`, `project_posawesome_audit_2026_07_11`.
- Repo docs: `CHANGELOG.md` (2026-07-11 entry), `docs/ROADMAP.md`,
  `docs/POS-PROFILE-SPEC.md`, `docs/UPSTREAM.md`, `docs/AUDIT-2026-07-11-full.md`.
- Site tz America/Mazatlan. Prod tenants: ventas.docomexico.com (busy, saldo)
  + ventas.mumulenceria.com (near-idle, NO saldo ever).

## 1. PRE-FLIGHT (read-only, prod)

a. **Deploy mechanism reality**: on contavm, check whether the muelle stack
   bind-mounts app dirs or runs pure-baked images
   (`ssh contavm 'cd ~/muelle && grep -A3 "posawesome" compose.yaml | head'`).
   - Bind-mounted → `prod-refresh.sh posawesome --migrate --restart-py --yes`
     covers Python; SPA bundle still needs `posawesome-push-prod.sh`.
   - Pure-baked → new image (v37+) must include posawesome `e124a14c` +
     saldo `e6bfd03`; coordinate with the B20/AP-6 v37 build if it hasn't
     shipped yet (one rebake carries everything).

b. **Profile flag audit — MANDATORY.** New server gates enforce flags that
   were client-only. If a prod profile has a flag OFF but cashiers use the
   action daily, the gate will block them at the worst moment. Per tenant:

   ```
   bench --site <site> execute frappe.client.get_list --kwargs "{'doctype':'POS Profile','filters':{'disabled':0},'fields':['name','posa_allow_return','posa_allow_delete','posa_allow_change_posting_date','posa_use_gift_cards','use_customer_credit','posa_use_delivery_charges','posa_allow_line_item_name_override','posa_allow_credit_sale']}"
   ```

   Expectations (fix BEFORE deploy if they differ):
   - `posa_allow_return` = 1 wherever returns happen (docomexico: daily!).
   - `use_customer_credit` = 1 wherever credit redemptions happen
     (docomexico redeems customer credit — the corte tile ships this batch).
   - `posa_allow_delete`, `posa_allow_change_posting_date`: match current
     practice; OFF = the endpoint now actually blocks.
   - `posa_use_gift_cards`, `posa_use_delivery_charges`: expected 0/unused;
     OFF now blocks those endpoints (that's the point).

c. `prometheus_metrics_token` present in both prod site_configs (vigia
   already scrapes doco metrics — posa_* counters appear automatically).

d. No live stale shifts about to hit the restart→migrate window (2026-07-02
   lesson); check open shifts in site tz.

e. Working-tree drift on contavm (`git status` in app dirs if bind-mounted;
   memory `reference_contavm_muelle_drift`: local commits ARE live prod —
   pull --rebase --autostash).

## 2. DEPLOY

1. SPA bundle: `./scripts/posawesome-push-prod.sh --build --yes`
   (script does NOT migrate; restarts py BEFORE migrate).
2. Python (path per 1a): prod-refresh both apps (posawesome + saldo) OR the
   v37 rebake.
3. `bench --site <each tenant> migrate` — expected patches:
   `add_customer_credit_invoice_fields`, `add_pos_delta_sync_indexes`,
   `remove_dead_pos_profile_fields` (+ saldo Settings field reload on
   docomexico).
4. Worker restart (scripts/muelle-restart equivalent on contavm — use their
   coordinated script, never raw restart).
5. Smoke per tenant: `/posapp` 200 after the proxy's ~30s stale-upstream
   window (2026-07-02: prod-refresh's internal smoke false-fails — re-smoke
   externally before trusting exit codes); one real sale; print out.

## 3. SETUP (post-deploy, docomexico only unless noted)

1. Flip `Saldo Settings.hold_submit_until_success = 1` (ventas.docomexico
   ONLY — saldo never on mumu). Marco already approved the flip; still
   announce to cashiers: saldo ticket now prints AFTER TAECEL confirms
   (seconds), badge shows pending/failed, red = reintentar con otro número.
2. Terminals hard-refresh (Ctrl+Shift+R); SW cache may need one reload
   cycle (`feedback_sw_cache_blocks_fixes`).
3. Verify hold e2e with one real small recarga: badge → auto-submit+print.
4. vigia (dockervm, separate session ok): Grafana panel for
   `posa_submit_failures_total` + alert `rate(...[15m]) > 0` → Telegram
   (matches existing 20-alert pattern).

## 4. WATCH (first 24-48h)

- `warn:qz_failure` rows — FIRST-EVER QZ failure data (prefix was dropped at
  ingest until now); a storm on one terminal = its QZ tray died.
- `posa_*` counters in the doco scrape; background failures should be ~0.
- `pos:sale_cycle_ms` + boot LCP (baseline p95 4.6s — preload + injected
  bundle URL should cut it).
- `hold.*` saldo events (created/resumed wait_seconds/failed/retried).
- `recover_stuck_holds` janitor: should log ~nothing; resumes >0 = look.
- Dead-letter badge: any pulsing red on terminals = offline sales stuck —
  panel → Reintentar.
- Corte: customer-credit tile shows numbers on shifts with redemptions.

## 5. Rollback levers (cheap → heavy)

- Hold flow: flip `hold_submit_until_success = 0` → classic behavior
  instantly (no code rollback).
- A profile gate blocking a legit action: flip that profile flag ON — the
  flag IS the control; no code change needed.
- SPA regression: re-run posawesome-push-prod from the previous commit's
  build. Python: previous image tag (baked) / git checkout (bind-mounted).
- Patches are additive/idempotent; `remove_dead_pos_profile_fields` removed
  only zero-consumer fields (re-creatable from fixture history if ever).

## 6. After success

- Update memories: `project_saldo_hold_until_confirm` (PROD LIVE),
  `project_posawesome_audit_2026_07_11`, POSAwesome fork memory; mark this
  file DONE (rename or note at top).
- `bench export-fixtures` eventually re-adds the customer-credit fields to
  fixtures (cosmetic).
- Refresh `AGENTS.md` patches-active-on-prod section (newest-first).
