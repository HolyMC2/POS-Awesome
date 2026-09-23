# 08 — Device enrollment, equipment and readiness

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome device experience; Doco/QZ and payment connectors own transports.
Requires [01](01-store-register-foundation.md); failures integrate with [06](06-operations-inbox.md).

## 1. Outcome

Employees can connect a replacement tablet, identify the correct receipt printer,
test a scanner and discover a payment-device problem before a customer waits.
Each caja remembers its equipment and supported operating mode. A manager can
see readiness across stores without being shown false green checks.

“Responsive UI on a phone” does not imply that every printer, Bluetooth device,
browser or payment terminal works on that phone. Supported capabilities are
certified by an explicit OS/browser/transport/hardware matrix. Unsupported
equipment has a clear alternative; the app must not advertise untested support.

## 2. Existing foundation

The [readiness snapshot](../../../frontend/src/posapp/components/pos/shift/readinessSnapshot.ts)
deliberately distinguishes known facts from unverified device configuration.
[Opening readiness](../../../posawesome/posawesome/api/opening_readiness.py)
verifies server configuration, while device observations belong to the client.
Existing QZ signing/print transport, browser printing and connector APIs remain
the owning integrations. This work supplies persistent device identity, truthful
evidence and employee recovery; it does not replace those transports wholesale.

## 3. Configuration and records

| Record | Contract |
| --- | --- |
| `POS Device` / binding | Identity, store/register assignment and revocation from spec 01 |
| `POS Hardware Profile` | Versioned required/optional capabilities, adapter IDs, device bindings, supported environment and test policy |
| `POS Equipment Binding` | Register/device, equipment role, adapter, opaque transport reference, allowed document/payment roles, active revision |
| `POS Device Check` | Capability, observed outcome, method (`automatic`, `operator_observed`, `configuration_only`), actor/device, time, expiry and evidence reference |
| `POS Print Job` (reuse/extend existing owner where available) | Unique business-document/print-purpose/request identity, immutable render reference, selected route/revision, attempts and acknowledgments |
| `POS Enrollment Challenge` | Single-use hash, target scope, issuer, expiry, consumed state, approved installation and audit |

Register settings contain shared equipment routing. Personal settings contain
display density, touch category navigation and other local preferences. Do not
store accounting routes or permissions as browser-only settings. Profile-level
printer defaults are inherited only until an explicit register binding exists;
resolution explains where each effective value came from.

## 4. Enrollment and replacement

1. Manager selects the named caja and **Conectar dispositivo**. The server
   creates a cryptographically random challenge, single-use and valid for five
   minutes, scoped to store/register and intended device mode.
2. Employee opens the authenticated setup route on the device and scans/enters
   the challenge. The screen prominently shows store, caja and enrollment mode.
3. Manager authorization and consuming the challenge are atomic. Challenges are
   rate-limited, hashed at rest, excluded from logs and not reusable on another
   site. A locator QR never replaces authentication/permission checks.
4. Establish possession using the approved device credential mechanism. Prefer
   a supported non-exportable WebCrypto key/challenge protocol; compatibility
   mode may use the existing protected random-secret verifier contract. Record
   the actual assurance mode; do not claim browser storage defeats XSS or theft.
5. Save binding revision and required equipment setup. Run checks. If another
   device owns an active shift, route to audited replacement recovery rather
   than issuing a second active selling capability.

Revoke invalidates subsequent online actions and subscription credentials,
increments ownership generation and creates recovery obligations for unknown
local work. It cannot remotely erase already-offline storage. Re-enrollment
after storage loss creates a new installation epoch; history remains tied to
the original device and shift. Factory reset/cache repair never auto-deletes
unsynced financial work.

## 5. Readiness semantics

Enrollment must also survive a lost successful reply: the device persists its
private key or generated secret before consuming the challenge; the server stores
only the verifier/public key. Retrying the same request with proof of that key
returns the original binding, not a second enrollment. No raw secret must be
recoverable from a server receipt. If the local key was lost, use explicit
replacement/revocation recovery rather than exposing it from historical data.

Outcomes are `Verified`, `Failed`, `Unknown`, `Unsupported` and `NotRequired`.
Every result includes method, timestamp, binding/configuration revision and
expiry. A configuration flag alone cannot produce Verified physical readiness.
Changing equipment/adapter/version invalidates affected checks.

| Capability | Sufficient evidence | Failure behavior |
| --- | --- | --- |
| Scanner | Employee scans designated sample; decoded payload matches | Offer camera/manual lookup; wedge cannot be passively proven healthy |
| Receipt printer | Correct route plus transport acknowledgment and employee confirmation of test output | Reprint/reselect/browser alternative if certified; no payment rollback |
| Cash drawer | Explicit authorized test kick and employee-observed correct drawer | Explain manual/cashless alternative under policy; connection alone is not proof |
| Payment device | Connector confirms binding/merchant/currency and supported readiness probe | Disable affected tender; show other permitted tenders |
| Customer display | Correct channel plus authenticated heartbeat/test acknowledgment | Optional warning unless mode requires it |
| Scale | Certified adapter, unit/precision configuration and measured test | Unsupported until certified; no invented integration from a profile flag |
| Local storage/offline queue | Write/read/delete of nonfinancial probe and storage availability estimate | Warn/block the offline capability, preserve queued work |
| Server configuration | Current profile/store/account/capability checks | Block invalid required configuration at opening and command boundary |

Default physical test validity is the current shift, invalidated on binding
change; transport heartbeat freshness is separately 90 seconds. Required cash/
payment routing is always revalidated server-side at the financial action.
Optional equipment failure cannot wall an otherwise valid cash sale. A required
check that is unknown on a newly certified setup blocks activation with a
specific next step. Existing legacy capability policy is not silently tightened
mid-shift; rollout declares the new requirement and effective boundary.

## 6. Worker setup and recovery journeys

Setup shows **Caja → Equipo → Pruebas → Lista para trabajar**, with progress
saved after each step. Employees choose equipment by friendly label/location,
not a long raw OS identifier. Test confirmation asks whether output reached the
expected physical device, preventing two nearby printers being confused.

On a failure during service, keep the transaction outcome visible. “Venta
registrada; ticket pendiente” differs from “No se pudo registrar la venta”.
Offer the next safe action: retry original print job, select an allowed route,
share a permitted digital receipt or call the equipment lead. Return restores
the completed sale/next customer workflow; it never reopens Pay automatically.

Manager's equipment view shows last-known status and test evidence per caja,
with filters for unsupported, stale and failed. A bulk health check is a bounded
job, not a mass drawer-open or real payment command. Hardware side effects are
visible, explicit and logged on the local station.

## 7. Print and payment device contracts

Logical commands: `devices.begin_enrollment/consume/revoke/replace`,
`equipment.configure`, `equipment.check`, `equipment.confirm_observation`,
`print_jobs.submit/status/reprint` and connector-owned terminal readiness.
Use spec 01 receipts/revisions and typed, allowlisted adapter actions.

Print identity separates original business operation from requested copy.
Creating a sale receipt job twice with the same key yields the same job. A
deliberate reprint creates a linked copy marked as such. Transport acceptance
is `Sent`; physical print is only `Confirmed` with available evidence. If a
printer processed a job but its acknowledgment was lost, show outcome unknown
and ask before printing another copy. Exactly-once physical paper output is
not promised by database idempotency.

Render from the authorized committed document and approved format. Do not
accept arbitrary executable QZ payloads or untrusted URLs as a new generic
hardware command. Preserve existing transport compatibility while adding
explicit endpoint/document/role validation with hardware regression tests.
Jobs include destination revision so replacing a printer cannot silently reroute
old sensitive documents to a different counter.

Payment devices are bound to the correct merchant/company/store and eligible
register. One active attempt occupies an exclusive terminal route where the
provider requires it. Rebinding is refused while an attempt is unresolved.
POS retains provider references and safe status only; no raw card/PIN data.
Test mode uses sandbox/approved simulators and is visibly distinct. A diagnostic
must never initiate a real charge merely to see whether the terminal works.

## 8. Security, storage and offline limits

Transport URLs/hosts and adapter types are allowlisted; browser-provided targets
cannot become server-side arbitrary network requests. Secrets live in the
appropriate server credential store/device mechanism, never profile exports,
logs, enrollment screenshots or support bundles. Signing and print authorization
remain scoped to current roles and documents.

Device health reports are authenticated and schema-limited, with per-device
rate limits and monotonic observation sequence. A heartbeat cannot mutate
accounting, extend cashier permissions or clear recovery cases. Last-seen data
has declared retention and is not covert employee location tracking.

Offline use requires the exact certified platform/capability. Cached readiness
is dated evidence, not fresh server approval. Existing offline sale policy is
unchanged; enrollment, rebind, revocation acknowledgment and new provider
authorization require online access. Browser storage eviction is a residual
risk: request persistent storage where supported, monitor capacity and provide
protected recovery/export before destructive maintenance. An offline-only
intent cannot be guaranteed recoverable after physical device destruction.

## 9. Scale, migration and observability

Store device/equipment directories are cursor-paged. Heartbeats are jittered
and coalesced; persist coarse observations or state changes rather than writing
one permanent document for every tick. Transactional ownership records are
separate from disposable presence data. A heartbeat storm must not starve sales.

Migrate existing browser credentials as explicitly legacy assurance bindings
only after proof of possession; do not enroll from a guess at user-agent strings.
Map current printer defaults with a preview, test one register, then batch by
store. Keep a compatibility route for active shifts until drained. Firmware,
adapter and browser changes go through the spec 09 canary matrix.

Track equipment failure by adapter/version, print acceptance/confirmation delay,
duplicate-copy requests, failed enrollment, invalidated bindings and local
storage pressure. Metrics use bounded labels; raw device IDs belong in scoped
logs, not high-cardinality metric labels.

## 10. Acceptance

| ID | Required evidence |
| --- | --- |
| DEV-T01 | Enrollment challenge expires, is single-use, scoped and unusable by an unauthorized account; a lost successful reply recovers the original binding through possession proof. |
| DEV-T02 | Replacement preserves caja/shift history and fences old credentials without deleting old work. |
| DEV-T03 | Unknown scanner/drawer/scale configuration never appears as a verified physical test. |
| DEV-T04 | Test receipt reaches the selected printer; a wrong nearby printer is detected before activation. |
| DEV-T05 | Printer timeout after payment yields one sale and a recoverable print job, not a second charge. |
| DEV-T06 | Deliberate reprint is linked/marked; uncertain physical delivery is disclosed honestly. |
| DEV-T07 | Payment terminal merchant/amount/currency/busy-state mismatches are refused by its owner. |
| DEV-T08 | Offline/cached readiness cannot authorize new enrollment or external payment capture. |
| DEV-T09 | Storage-full/eviction/reset drills preserve or explicitly account for unsynced work before maintenance. |
| DEV-T10 | Mobile/touch/keyboard setup has accessible controls, no side-scroll and no unreachable footer. |
| DEV-T11 | Revoked device, forged heartbeat, arbitrary transport target and unauthorized print document are rejected. |
| DEV-T12 | Physical hardware matrix and heartbeat/load soak meet spec 09; mocked transport tests alone do not certify equipment. |

Implementation order: enrollment/binding compatibility; truthful persisted
readiness; printer/scanner workflows; drawer/display adapters; connector probes;
additional hardware only after certification. No platform gets a blanket
“all equipment supported” label.
