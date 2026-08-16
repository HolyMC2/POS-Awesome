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
| Giro seed version | boat templates carry `template_version` + sha256 content hash, recorded per apply in the `Doco Applied Artifact` ledger; doco dataset registry carries `version` per dataset; boat `seed_manifests.py` pins all of them per giro bundle (first: `abarrotes-comercio-thin`) | abordo preset seeders still unversioned (provision-path half); golden-flow/provision automation marked `manual` in the manifest |
| Tenant override revision | POS Profile `modified` timestamp only; overrides themselves now typed (`OVERRIDE_ALLOWLIST`) with provenance (`get_contract_provenance`); artifact-LEVEL apply history now in `Doco Applied Artifact` | still no per-override revision ledger — needs the per-field reconciliation slice (§9.1 later work) |
| Hardware profile revision | hardware facts live as POS Profile fields (see [`LEGACY-FIELD-INVENTORY.md`](LEGACY-FIELD-INVENTORY.md) §5.3) | terminal hardware profile not yet extracted, so no revision of its own |
| Print/document revision | Print Format documents, `modified` only; per-register binding via preset `print_format` + doco print preferences | no version pin or compatibility record |
| Installed extension-app compatibility | `apps.txt` + lazy imports + feature detection (`frappe.db.exists("DocType", ...)` guards) | no declared compatibility matrix; preflight is implicit |

## Ownership

Certification status and the giro map are Doco-owned (`giros.py`), consumed by
boat/abordo/signup surfaces — POSAwesome does not duplicate them. Preset
(mode) versioning belongs to POSAwesome (the doctype owner). Seed manifests
(`boat/muelle/seed/seed_manifests.py`) and the artifact ledger
(`Doco Applied Artifact` + `boat/muelle/artifacts.py`) are Boat-owned and
shipped 2026-08-15; the tenant-side assertion runner is Doco-owned
(`doco/docoutils/seed_verify.py`) — assertion keys are a cross-repo contract
pinned by tests on both sides.
