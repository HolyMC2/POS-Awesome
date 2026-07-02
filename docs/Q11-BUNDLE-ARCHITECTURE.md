# Q11 — POSAwesome Client Bundle: Architecture Plan

> Status: PLAN / RFC. No code in this doc. No commits.
> Date: 2026-05-19. Branch context: `doco-customizations`.
> Builds on `posawesome/docs/QZ-BUNDLE-SCOPE.md` (Stream-Q scope, 305 lines).
> Authored against `REVIEW2/02_system_architecture.md`,
> `REVIEW2/03_security.md §1.6, §9.5`, `REVIEW2/PLAN-6SIGMA.md` (P2/P3),
> `REVIEW2/ROADMAP-SAAS.md M-01..M-05`.

Stream-Q has landed the three in-repo print pathology fixes
(in-flight dedupe, WS re-prewarm, render-config tuning). Q11 is
scoped purely to **SaaS-onboarding velocity + fleet observability** —
the second justification track from `QZ-BUNDLE-SCOPE.md §3.1`.

---

## 1. Problem statement

### 1.1 Operator pain today

New POS terminal silent-print today requires **four error-prone manual
steps** per machine:

1. Install QZ Tray 2.2.x CE from `qz.io` (MSI / .deb / .rpm wizard).
2. Download our cert from POS Profile (`api/qz.py:81`).
3. Import cert into QZ Tray's allow-list (edit `~/.qz/allowed.pem` or
   Site Manager menu); restart QZ Tray.
4. Verify trust state — untrusted state pops an "Allow?" modal on
   every print, blocking the cashier line.

Field reality: ~30% get step 3 wrong (path, CRLF/BOM, no restart);
0% re-import on cert rotation (today never rotated — 11,499-day cert
per `03_security.md §9.5`); ~10% skip step 1 entirely and fall back
to the browser-print modal (`plugins/print.ts:425-476`). Telemetry
fires *after* a failed print (`qzTray.ts:13-33`), never proactively.

### 1.2 Why this matters for SaaS

`PLAN-6SIGMA.md §1` targets four-sigma (233 DPMO). The manual-install
path has an unmeasured but clearly thousands-DPMO failure rate
applied to day-1 (worst possible day for tenant confidence).
`ROADMAP-SAAS.md §1` envelope: 5,000 tenants × 10 terminals = 50,000
endpoints. At 30% step-3 failure rate that's 15,000 broken terminals
per fleet sweep. A 30-min Marco-on-the-phone fix per terminal is
7,500 hours — not feasible.

**The install path must be zero-touch or the SaaS plan dies on
operator onboarding.**

### 1.3 What the bundle is NOT for (full list in §10)

Not the Stream-Q pathologies (closed). Not browser/iOS print
enablement. Not server-side Jinja latency.

---

## 2. Three viable architectures

### 2.1 Architecture A — Wrapper installer

Signed installer (MSI/PKG/.deb/.rpm/AppImage) that bundles **upstream
QZ Tray as-is** plus our extras. First-run actions:

1. Silently install QZ Tray CE.
2. Write tenant root cert to `~/.qz/override.crt` (QZ's documented
   auto-trust path).
3. Drop `posa-print-beacon` as a sibling user-service (systemd user
   unit / LaunchAgent / Windows Service).
4. Run the enrollment dance with boat to bind to a tenant (§4).
5. Register auto-update channel signed by doco (§6).

Beacon (~6 MB Go, statically linked):
- Tails QZ Tray log for print start/finish/error.
- Heartbeat WSS to `wss://beacon.boat.<saas-zone>/ingest` (per-tenant,
  per-terminal JWT).
- Local health check every 30s (QZ pid, cert, printer enumerable).
- Local-loopback `/health` + `/sign` + `/print` on `127.0.0.1:9182`.
- Owns local-agent job dedupe (`QZ-BUNDLE-SCOPE.md §3.4`).

**Pros**: lowest eng risk; QZ pipeline (Java + headless Chromium)
mature, no internals touched. License-clean (QZ CE = Apache-2.0).
Smallest attack-surface delta (signing oracle stays on Frappe,
already hardened). Per-OS tooling exists. Reversible: uninstall
wrapper, manual QZ keeps working.

**Cons**: two daemons (QZ + beacon, ~200 MB total RAM). HTML render
still inside QZ's Chromium — render-time fixes need operator config
or wait for QZ upstream release. ~250 MB install footprint (QZ
bundles its own JDK).

**Eng-days**: 17–25 (matches `QZ-BUNDLE-SCOPE.md §6`).
**Maint**: 2–4 hrs/mo.
**Attack-surface**: cert-on-disk distribution shifts from
operator-imports to bundle-embeds; signing oracle goes loopback for
bundled terminals. Net: neutral, with much better cert-rotation
hygiene.
**OS**: Win10/11, macOS 13+, .deb/.rpm/AppImage. Not Android/iOS/
ChromeOS (rules in C territory).

### 2.2 Architecture B — Forked QZ Tray ("posawesome-print")

Fork QZ Tray, sign with our key, embed our cert, embed beacon,
distribute as single signed binary.

**Pros**: single daemon. We control the HTML render pipeline — only
arch that lets us close `QZ-BUNDLE-SCOPE.md §1.6` render-time stripe
causes without operator action. Cert statically embedded.

**Cons**: forking a Java + Chromium-embedding app (~80 kLOC Java +
Maven + JxBrowser / JCEF) is a real maintenance burden — every QZ
release needs a rebase, every Chromium CVE becomes "POSAwesome ships
unpatched Chrome". **License risk**: JxBrowser is paid commercial
(teamdev); QZ CE's redistribution rights to JxBrowser may not extend
to our fork. Either swap JCEF (+3 weeks) or pay teamdev. EV-cert
"reputation build-up" period for a new publisher. Mac builds need
a real Mac runner.

**Eng-days**: 50–80. **Maint**: 16–24 hrs/mo (half-FTE indefinitely).
**Attack-surface**: same key-on-endpoint as A, **plus** a Chromium
runtime under our brand (every Chromium CVE is ours), **plus** our
brand-signed binary is a high-value supply-chain target.
**OS**: same as A but with per-OS+per-arch JCEF native libs; ARM64
Linux gets ugly.

### 2.3 Architecture C — Browser-only (Web Crypto + WebUSB / WebHID)

Eliminate the native daemon. Web Crypto SubtleCrypto.sign for
signing. WebUSB / WebHID directly to thermal printer with native
ESC/POS bytes.

**Pros**: zero install. Native ESC/POS bytestream is banding-immune
(closes all stripe causes permanently). Per-terminal cert isolation
trivial — cert in IndexedDB, scoped to origin. No Java, no embedded
Chromium, no code-signing cert ($300/yr saved). Works on ChromeOS.

**Cons**: **Chromium-only** (no Safari, no Firefox; iPad dead).
Print formats today are Jinja HTML — ESC/POS is raw bytes (alignment,
font-size opcodes, embedded bitmap logos). **Rewriting print
formats is 4–8 weeks per family** (we have ~5 families in prod).
No "fleet visibility" beacon — phone-home only while tab open.
WebUSB needs per-terminal `requestDevice()` consent gesture (re-
consent after browser profile reset). Chrome blocks WebUSB to USB
class 7 (printer) on some platforms — vendor allow-list or WebHID
or WebSerial; matrix is non-trivial. PEM-imported Web Crypto keys
are extractable; must generate in-browser.

**Eng-days**: 30–60 (driver + print-format rewrite dominates).
**Maint**: 3–6 hrs/mo (Chromium WebUSB/WebHID breaking changes
every ~6 months).
**Attack-surface**: cert never leaves origin (better), but SPA gets
direct USB access — XSS-blast-radius worsens significantly.
**OS**: Chromium browsers only.

### 2.4 Comparison

| Axis | A. Wrapper | B. Forked QZ | C. Browser-only |
|---|---|---|---|
| Eng days (build) | 17–25 | 50–80 | 30–60 |
| Maint hrs/mo | 2–4 | 16–24 | 3–6 |
| OS surface | Win/Mac/Linux | Win/Mac/Linux | Chromium only |
| Chromium runtime ours? | no | **yes** | no |
| Cert never leaves origin | no | no | **yes** |
| Tab-closed telemetry | yes | yes | no |
| Print-format rewrite needed | no | no | **yes (big)** |
| Code-sign cert ($/yr) | $300 + $99 Mac | $300 + $99 Mac | $0 |
| Bus factor | low | **high** | medium |
| XSS-blast radius | low | low | **high** |
| Onboarding velocity | 1-click | 1-click | 1-click + USB consent |

---

## 3. Recommended path: Architecture A

Honest rationale:

1. **Only one that closes the SaaS-onboarding problem at a cost
   matching its value.** B costs 3× for benefits we don't need (stripes
   already fixed via Stream-Q render-config tuning). C requires a
   print-format content-pipeline rewrite unrelated to onboarding.

2. **Reversible.** Uninstall wrapper → manual QZ keeps working. B's
   escape requires installing real-QZ. C has no escape on non-Chromium.

3. **Maintenance burden matches team shape.** 2–4 hrs/mo of A fits in
   one dev's slack. B's 16–24 hrs/mo is a half-FTE we don't have.

4. **Attack-surface delta is neutral.** Trades operator-manual-cert-
   import for bundle-embedded-cert. Same key, different distribution.
   B adds Chromium under our brand. C adds USB to the SPA. A is
   least new-surface.

5. **Plays well with existing roadmap.** Beacon's telemetry feeds
   `boat`, which `PLAN-6SIGMA.md §3.6 P2` already wants Prometheus/
   Grafana on. Bundle adds an observability source the platform
   was going to need anyway.

6. **Phaseable without flag day.** Tenants opt in. Manual installs
   keep working. Deprecation is a 2027 problem.

B is the alternative *only if* stripes re-surface and QZ upstream
rejects our render PR. Even then, file the upstream issue first.
C is a 2027+ strategic question tied to leaving the JVM behind.

---

## 4. Per-tenant cert isolation

### 4.1 Current state

`sites/<tenant>/private/qz/{digital-certificate.crt, private-key.pem}`
(`api/qz.py:32-37`). One pair per Frappe site — tenant-scoped at rest,
**not terminal-scoped**. Every operator terminal in a tenant shares
the same cert. Per `03_security.md §1.6`: any logged-in user could
historically call sign_message with arbitrary input. Stream-Q
hardened that with envelope + role + POST gates; the residual risk
is the shared key.

### 4.2 Enrollment dance

Goal: per-terminal short-lived signing cert, chained to per-tenant
intermediate, rooted at the existing site cert (reframed as tenant
root).

Install-time flow:

1. Marco enables "Bundle install" on tenant in boat. Boat mints a
   **bootstrap token** (one-time, 24h expiry). Shows it to Marco or
   emails directly to operator.
2. Operator downloads `posa-print-1.0.0-x86_64.msi`. Runs it
   (interactive or `msiexec /i ... /quiet TOKEN=...`).
3. Beacon calls `enroll_terminal` with the token. **Generates RSA-
   2048 keypair locally on the terminal.** Sends only CSR
   (public key + CN = terminal hostname).
4. Server validates token (one-time, expiry, tenant binding). Signs
   CSR with tenant root key. Returns terminal cert + tenant root
   cert + 30-day renewal token.
5. Beacon writes:
   - `<install>/keys/terminal.key` (private, chmod 600, ACL
     SYSTEM+Admin on Windows).
   - `<install>/keys/terminal.crt` (public).
   - `<install>/keys/tenant-root.crt` (public).
   - Renewal token in OS keychain (Windows Credential Manager,
     macOS Keychain, libsecret).
6. Beacon writes `tenant-root.crt` → `~/.qz/override.crt`. QZ trusts
   the chain without operator action.
7. SPA's QZ-shim sign-callback routes to beacon `127.0.0.1:9182/sign`
   (signs with terminal key locally). Server-side `sign_message`
   stays for legacy/fallback only.

**Private key never leaves the terminal. Tenant root never leaves
the server.**

### 4.3 Renewal + rotation

- Terminal cert validity: 30 days. Beacon auto-renews at 7d
  remaining via rolling renewal token (one-time-use rotation).
- Tenant root validity: 365 days, rotated annually
  (`03_security.md §9.5` policy gap closed).
- Revocation: terminal serials revokable via boat → broadcast to
  beacons every 6h → beacons rewrite `override.crt`.

### 4.4 Boat orchestration

Boat adds three endpoints (in boat repo, not posawesome):
`POST /api/v1/tenants/<id>/bundle/{enrollment,csr,revoke}`. Boat is
the SaaS control plane per `PLAN-6SIGMA.md §3.7` and
`boat/SAAS_ROADMAP.md`; bundle enrollment is a natural fit.

---

## 5. Telemetry beacon

### 5.1 What it phones home

**Health beat (30s):** terminal_id (UUID), tenant_id, qz_pid_alive,
qz_version, qz_cert_status, printer_name, printer_enumerable,
bundle_version, os_name/version/arch, uptime_s.

**Print event (per job):** job_id, started_at, finished_at,
duration_ms, status (succeeded/failed/timeout/cancelled), bytes_sent,
printer_name, format (html/pdf/raw), error_class if failed
(cert_untrusted / printer_offline / ws_dead / timeout).

**Queue gauge (30s):** pending_jobs, oldest_pending_age_s.

### 5.2 PII zero

- No invoice payload, item names, SKUs, totals.
- No customer name, address, phone, email, RFC.
- No print content — only metadata.
- No clipboard, no keystrokes, no screenshots.
- No raw OS hostname (mapped to UUID at enrollment).
- No external IP in payload (boat sees connection origin at TLS).
- No cashier identity.

### 5.3 PII scrub

Bytewise scrubber runs before send:

- `[\w.+-]+@[\w-]+\.[\w.-]+` → reject.
- `\b\d{10,15}\b` (phone-like) → reject.
- `[A-ZÑ&]{3,4}\d{6}[A-Z\d]{0,3}` (RFC pattern) → reject.
- IPv4/IPv6 literals → reject.

Trip → write `pii_scrub_block.log` locally with field name + payload
hash (not contents); increment `pii_blocks_today` counter; counter
ships up, contents never do. `>0` → alert (means payload schema
regressed).

### 5.4 Opt-in / opt-out

**Opt-in at tenant level.** Default off for new tenants. Toggled by
POS Manager on POS Profile / boat tenant settings. Bundle works
without telemetry; only basic alive-heartbeat is always-on.

**Opt-out at terminal level.** Even after tenant opt-in, operator
can pause via tray-icon menu. Boat records "paused" event; printing
not retaliated against.

Per `03_security.md §9.2` + `PLAN-6SIGMA.md §3.1 P3` LFPDPPP context:
operator-equipment telemetry collection in MX requires informed
consent. Opt-in is the compliance posture we need.

---

## 6. Auto-update channel

| OS | Updater | Signing |
|---|---|---|
| Windows | Squirrel.Windows | Authenticode EV (doco) |
| macOS | Sparkle | Apple Developer ID + notarization |
| Linux .deb/.rpm | apt/yum repo (doco-signed) | GPG (doco) |
| Linux AppImage | AppImageUpdate (zsync) | GPG on AppImage |

All four read the same manifest at
`https://updates.<saas-zone>/posa-print/<channel>/manifest.json`.
Channels: `stable`, `beta`, `canary`. doco-internal terminals on
`canary` (eat-own-food).

### 6.1 Integrity chain

- Manifest signed Ed25519 by **offline key on Marco's laptop** (or
  air-gapped HSM). Build server produces binaries; only Marco
  publishes.
- Signature-verified *before* OS installer step.
- Update-signing key is separate from terminal cert chain
  (different blast radius).

### 6.2 Threat: lateral movement via compromised update server

Highest-leverage bundle threat — compromise → ~50k endpoints owned
at once. Defenses:

- **Offline signing key** (above).
- **Reproducible builds** + per-release attestation. Same standard
  as `PLAN-6SIGMA.md §3.6 P3` SLSA L2 for the SPA.
- **Rate-limited rollout.** Manifest carries `min_install_age_h`
  (24h for `stable`, 0h for `canary`). Stable gets a free window
  to notice canary exploded before bad update propagates.
- **Kill-switch.** Boat broadcasts "halt updates"; beacons honor
  within next heartbeat.
- **CDN integrity.** R2 origin behind Cloudflare; public-key pin in
  beacon; CDN compromise delays, doesn't poison.

### 6.3 Cadence

Stable quarterly, beta monthly, canary weekly. CVE hot-patches can
shortcut to stable after 24h canary soak.

---

## 7. Security threat model

### 7.1 Surface delta

| Surface | Today | Bundle (A) | Delta |
|---|---|---|---|
| Private key location | Frappe server, one per site | Per-terminal short-lived key; tenant root server-side | **+N keys on endpoints, but each scoped + revocable** |
| Signing oracle | Server endpoint (role+envelope gated) | Loopback beacon for bundled terminals | **−** oracle goes loopback |
| Cert validity | 11,499 days (out of policy) | 30d terminal, 365d root, CRL-checkable | **− − −** big win |
| Cert distribution | Manual import (failure-prone, no rotation) | Auto via override.crt | **− −** operator-error path closed |
| Update integrity | n/a | Squirrel/Sparkle/apt, offline-signed manifest | new surface, mitigated §6.2 |
| Telemetry pipe | server events | beacon → boat WSS, opt-in | narrow scope, PII-scrubbed |
| Endpoint compromise blast | session = own this terminal | terminal key for ≤30d, revocable | comparable, revocation is new + better |

### 7.2 "Ship key per tenant to endpoints" — how bad?

Worst-feeling line item. Answer: not as bad as it feels, **if** we
follow §4.2:

- Terminal key is *terminal*, not *tenant root*. Root stays server-
  side.
- Compromised terminal key compromises ≤30 days of that terminal's
  prints, with revocation available immediately.
- Today's model effectively exposes the tenant root to every
  cashier on every terminal via the sign_message endpoint (we
  hardened the call shape but the key still signs everything).
  Bundle changes "one key signs for all terminals indefinitely" to
  "each terminal has its own key, 30d validity". **Net improvement.**

### 7.3 Scenarios

| Threat | Lik | Impact | Mitigation |
|---|---|---|---|
| Operator dumps terminal.key | M | 1 terminal, ≤30d | Revoke via boat; key rotates anyway |
| Compromised update server | L | fleet RCE | Offline signing + rate-limited rollout |
| Beacon /health exposed beyond loopback | L | local enum + sign oracle | Bind 127.0.0.1; firewall check at install |
| Stolen bootstrap token | L | 1 terminal cert to attacker | One-time, 24h, rotation on use |
| Tenant root compromise | VL | tenant-wide forgery | §4.3 rotation; CRL via boat |
| Beacon ships PII | VL | LFPDPPP breach | §5.3 scrubber + alert |
| Code-sign cert theft | L | fleet RCE for ~1y | HSM-fronted EV cert |
| Supply chain (build, deps) | M | fleet RCE | SLSA L2 + reproducible + Dependabot |
| Coerced enrollment | M | 1 terminal in attacker tenant | Token requires POS Manager role |

### 7.4 Non-negotiables

- Tenant root key **never** ships to a terminal.
- Terminal private key **never** ships to the server.
- Update-manifest signing key **never** lives on the build server.
- Code-sign cert **never** lives on build-server fs without HSM.

---

## 8. Phased rollout

| Milestone | Eng-days | P-alignment |
|---|---|---|
| **M-Q11-1** Enrollment + boat endpoints | 5 | P2 (boat repo gate) |
| **M-Q11-2** Beacon binary | 6 | P2 (`§3.6 Prometheus`) |
| **M-Q11-3** Installer matrix Win/Mac/Linux | 5 | P2 |
| **M-Q11-4** SPA integration (sign-callback routing, POS Profile UI) | 2 | P2 |
| **M-Q11-5** Auto-update channel + fleet dashboard | 4 | P2/P3 (`§3.6 P3 blue/green`) |
| Contingency (15%) | 3.5 | — |
| **Build total** | **~25.5** | P2 window (90d) |
| M-Q11-6 manual-install deprecation | 1.5 | 2027 (not before) |

### Per-milestone exit criteria

- **M-Q11-1**: bootstrap-token → CSR → signed terminal cert end-to-end
  on lab.xolo. Token replay attempts fail. 365-day tenant root
  cuts over from 11,499-day legacy.
- **M-Q11-2**: 7-day soak on doco-internal POS box. No leak, no
  crash. PII scrubber counter zero.
- **M-Q11-3**: 1-click install on Win10, Win11, Ubuntu 22.04/24.04,
  Fedora 40, macOS 14/15. Uninstall clean.
- **M-Q11-4**: Manual-QZ terminals keep working. Bundle terminals
  see sub-100ms sign latency (loopback) vs ~50ms server-roundtrip.
- **M-Q11-5**: synthetic "bad update" sandboxed to canary rolls back
  automatically. doco fleet count visible in boat.
- **M-Q11-6**: doco fleet 100% bundle; non-doco tenants offered;
  manual path no longer default.

### Sequencing

```
M-Q11-1 enrollment ──┐
                     ├─► M-Q11-2 beacon ──► M-Q11-3 installer ──► M-Q11-4 SPA ──► M-Q11-5 updates
boat M-04 prep ──────┘                                            │
                                                                  └─► [shadow 30d doco-internal] ──► M-Q11-6
```

Critical predecessor: boat ships enrollment endpoints (M-Q11-1)
before beacon (M-Q11-2) can be tested end-to-end.

---

## 9. Decision gates for Marco (kick-off blockers)

Listed in dependency order. M-Q11-1 cannot start until Q11-NN-1 and
-NN-2 have answers.

**Q11-NN-1 — Signing-cert acquisition.** Self-sign (today's model,
rotated to 365d) vs paid CA. Recommendation: self-signed for the
QZ trust chain; paid EV separately for code-signing (Q11-NN-3).
QZ trusts whatever's in `override.crt`; paying for a CA buys
nothing on that axis.

**Q11-NN-2 — Beacon language.** Go vs Rust. Recommendation: Go
(smaller team ramp; perf ceiling not the bottleneck).

**Q11-NN-3 — Code-signing cert vendor + legal entity.** DigiCert
EV ~$400/yr · Sectigo EV ~$300/yr · SSL.com EV ~$250/yr. Plus
Apple Developer ID $99/yr. **Which legal entity registers the
cert** ("Doco SaaS S.A. de C.V." vs a US LLC) is a corp-structure
question, not tech. Marco call.

**Q11-NN-4 — Update server hosting.** R2+Cloudflare CDN vs S3+
CloudFront vs boat self-host. Recommendation: R2+Cloudflare
(~$5/mo at fleet target; same domain family as boat).

**Q11-NN-5 — Linux distribution channels.** apt + rpm + AppImage,
**skip snap/flatpak** (USB sandboxing kills them).

**Q11-NN-6 — Brand: posa-print / doco-print / neutral.**
Recommendation: `posa-print` with "by doco" subtitle. Reconsider
if SaaS goes white-label.

**Q11-NN-7 — Telemetry data residency.** MX vs US. Forced by where
boat physically runs today. LFPDPPP + CFDI auditors will ask.

**Q11-NN-8 — Phased rollout cohort.** Recommendation: doco-internal
60 days, then 1 volunteer tenant 30 days, then GA.

---

## 10. What this bundle does NOT solve

(Extends `QZ-BUNDLE-SCOPE.md §4`.)

1. Stream-Q's three pathologies — already closed; bundle inherits.
2. Print on machines without QZ today — bundle *replaces* manual
   install; doesn't enable new platforms (that's Arch C).
3. Server-side Jinja print-format latency.
4. The stripes / banding root cause — addressed by Stream-Q render-
   config tuning; bundle doesn't change QZ's render path under A.
5. CFDI stamping latency (`erpnext_mexico_compliance`).
6. Bad print formats (`@font-face`, oversized logos, wide tables).
7. Operator-induced double-prints — Stream-Q dedupe handles the
   inadvertent case; deliberate reprint still works via
   `bypassDedupe` shipped in `qzTray.ts`.
8. Network-down printing — IndexedDB/SW story unchanged.
9. Multi-cashier-on-one-terminal cert isolation — bundle binds keys
   to terminal, not cashier.
10. Browser-print fallback (`plugins/print.ts:425-476`) — untouched.

---

## 11. Cost estimate

### 11.1 Eng-days

| Phase | Days |
|---|---|
| M-Q11-1..5 build | 22 |
| Contingency 15% | 3.5 |
| **Total build** | **~25.5** |
| M-Q11-6 deprecation (2027) | 1.5 |

### 11.2 Sustaining

| Item | Hrs/mo |
|---|---|
| QZ upstream release watch + version bumps | 2 |
| Bundle quarterly stable + canary churn | 3 |
| Beacon ops alerts triage | 2 |
| Update-server / CDN ops | 1 |
| Fleet dashboard answer + cert rotation tickets | 2 |
| **Total** | **~10** |

### 11.3 Annual fixed cost

| Item | $/yr |
|---|---|
| Authenticode EV (Sectigo) | ~300 |
| Apple Developer ID | ~99 |
| R2 update artifacts (fleet target) | ~60 |
| Cloudflare CDN egress | ~120 |
| Telemetry DB (TimescaleDB on boat) | ~240 |
| YubiHSM2 (one-time y1 only) | 650 |
| **Total y1 / steady state** | **~1,470 / ~820** |

### 11.4 Vs not-bundling

`QZ-BUNDLE-SCOPE.md §6` math: 30 min Marco-on-phone × 50,000
terminals = 25,000 hours of onboarding support at SaaS target.
At $40/hr = $1M+ over SaaS lifetime, not counting reputation damage.

Bundle: ~25 eng-days + 10 hrs/mo + $820/yr = roughly **20× cheaper
at fleet target**. At 10 tenants today it's a luxury. At 100 it
pays for itself in a year. At 1,000+, not having it is malpractice.

---

## 12. Closing call

Build Architecture A (wrapper installer). Phase M-Q11-1..M-Q11-5
over ~25 eng-days inside `PLAN-6SIGMA.md` P2 (90 days), alongside
the edge-gateway + feature-flag work the beacon's telemetry will
feed.

B (forked QZ) is not justified by 2026 evidence. C (browser-only)
is a 2027+ strategic question about leaving the JVM.

Stream-Q's in-repo fixes already solved the three pathologies. Q11
is purely the SaaS-onboarding investment — and the cheapest viable
form of it is the wrapper.

— Q11 architect, 2026-05-19. Builds on `QZ-BUNDLE-SCOPE.md` (Stream-Q).
