# Independent Audit — POSAwesome World-Class Roadmap v1

Status: complete, read-only audit incorporated into roadmap v2  
Date: 2026-08-13

## Verdict

V1 was a strong vision catalogue but not yet a safe executable roadmap for a
small team.

| Dimension | V1 score | Main reason |
|---|---:|---|
| Vision | 8/10 | Coherent operator- and SaaS-level ambition |
| Complete POS definition | 6/10 | Missing universal lifecycle and owner/back-office boundaries |
| Fast by proof | 5/10 | Targets lacked named devices, data and measurement boundaries |
| Bounded configurability | 5/10 | Seven layers exceeded the current capability substrate |
| Small-team deliverability | 3/10 | Six modes plus control plane were committed together |

## P0 findings accepted into v2

1. **Unsafe fallback contradiction.** Current resolution can turn a failed
   capability load into the feature-rich retail default. V2 requires explicit
   `unconfigured`, `invalid` and `temporarily_unavailable` states plus a stamped
   last-known-good contract.
2. **Artifact lifecycle did not exist.** Boat templates/imports are insert-only
   and lack record ownership, merge, removal and transactional rollback. V2
   moves an additive artifact manifest/ownership ledger into Foundation 1 and
   limits rollback claims to doctypes with explicit semantics.
3. **Certification preceded seeds.** V1 required seeds for certification but
   scheduled their factory afterward. V2 delivers seed + accounting assertion
   + browser flow inside each vertical slice.
4. **Offline intent was confused with approved value.** V2 separates cart/order
   intent, deferred invoice, collected cash and external payment authorization;
   queued never means approved or paid.
5. **No credible product cut.** V2 commits to Scan Retail and Repair + Retail,
   keeps restaurant as a gated contracted beta, and moves other modes behind
   evidence gates.

## P1 corrections accepted into v2

- Added the universal transaction lifecycle including promotions, loyalty,
  refund, reconciliation, fulfillment and ERPNext boundaries.
- Added an explicit Mexican fiscal compatibility boundary; the compliance app
  owns SAT rules and POS owns status/data-collection UX.
- Defined the work required before POS Charge Request can be called a versioned
  integration contract.
- Added named benchmark profiles and separated UI, API, WAN, queue, ERP submit,
  terminal and physical-print measurements.
- Reduced runtime configuration to three layers and deferred the broad studio.
- Added POSAwesome/Doco/Boat/Muelle/Vigía/vertical-app ownership.
- Added RPO/RTO, restore, device revocation, support access, clock, storage quota
  and control-plane-outage acceptance.

## P2 corrections accepted into v2

- Defined the north-star cohort, window, sample threshold and exclusions.
- Scoped accessibility to WCAG 2.2 AA first-party flows with documented
  third-party/hardware constraints.
- Added contracted-beta and limited-availability states so current commitments
  are not mislabeled as certified GA.

## Re-audit triggers

Re-audit before:

- committing a Later mode;
- expanding the override allowlist or configuration studio;
- claiming generic template rollback/removal;
- enabling a new offline money/value class;
- promoting restaurant from beta to GA;
- declaring a new giro certified or publicly tailored.
