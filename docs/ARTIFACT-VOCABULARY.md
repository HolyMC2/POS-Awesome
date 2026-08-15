# Artifact and certification vocabulary (2026-08-15)

Roadmap deliverable: Foundation 0 "establish the certification dashboard and
artifact/version vocabulary" ([`POS-WORLDCLASS-ROADMAP.md`](POS-WORLDCLASS-ROADMAP.md)
§8/§9.1). This names each artifact the control plane must eventually track,
where it lives TODAY, and where it does not exist yet — so later work versions
real things instead of inventing parallel ones. The dashboard itself is
Boat/Vigía scope (§9.4); this file plus the machine-readable maps below are
the vocabulary it will render.

## Certification states — machine-readable

The seven states of §8 are code, not prose, in
`doco/docoutils/giros.py`:

- `CERTIFICATION_STATES` — the closed vocabulary
  (mapped · seeded · workflow-ready · contracted-beta · limited-availability ·
  certified · marketed);
- `GIRO_CERTIFICATION` — honest current status per giro (absent = `mapped`);
- `certification(giro)` — resolver used by any surface that must gate on it;
- a **ratchet test** (`test_nothing_claims_certified_or_marketed_yet`) refuses
  `certified`/`marketed` until the reproducible certification job exists.

Current assignments: contracted-beta = celulares, restaurante, cafeteria;
seeded = electronica, abarrotes, comercio, papeleria, farmacia, carniceria,
clinica; everything else mapped.

## §9.1 artifacts — current representation and gaps

| Artifact (roadmap §9.1) | Today | Gap |
|---|---|---|
| POSAwesome application/bundle version | git SHA + `version.json` build tag; hashed asset map consumed by sw.js precache | none — versioned and observable |
| Capability schema version | `CAPABILITY_PAYLOAD_VERSION` (vertical.py, =3); stamped on payloads, opening shifts and queued offline writes | none |
| Certified mode version | **does not exist** — POS Capability Profile rows are unversioned; only the payload SCHEMA is versioned | preset content version field + bump discipline; prerequisite for cohort rollout of preset changes |
| Giro seed version | **does not exist** — abordo preset seeders are idempotent but carry no version; boat templates likewise | the F1 "thin seed manifest": catalog/accounting/profile versions, expected assertions, golden-flow ID |
| Tenant override revision | POS Profile `modified` timestamp only; overrides themselves now typed (`OVERRIDE_ALLOWLIST`) with provenance (`get_contract_provenance`) | no revision ledger — arrives with Boat's additive artifact manifest/ownership ledger |
| Hardware profile revision | hardware facts live as POS Profile fields (see [`LEGACY-FIELD-INVENTORY.md`](LEGACY-FIELD-INVENTORY.md) §5.3) | terminal hardware profile not yet extracted, so no revision of its own |
| Print/document revision | Print Format documents, `modified` only; per-register binding via preset `print_format` + doco print preferences | no version pin or compatibility record |
| Installed extension-app compatibility | `apps.txt` + lazy imports + feature detection (`frappe.db.exists("DocType", ...)` guards) | no declared compatibility matrix; preflight is implicit |

## Ownership

Certification status and the giro map are Doco-owned (`giros.py`), consumed by
boat/abordo/signup surfaces — POSAwesome does not duplicate them. Preset
(mode) versioning belongs to POSAwesome (the doctype owner). Seed manifests
and the artifact/ownership ledger are Boat scope and remain the open F1
items.
