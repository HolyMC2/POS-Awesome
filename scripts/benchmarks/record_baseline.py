#!/usr/bin/env python3
"""Record a benchmark baseline capture for a named manifest (roadmap §6).

Pulls the POS RUM/perf telemetry summary from a site, filters it to the
manifest's interaction events, snapshots dataset size, app version and the
local bundle, and writes a capture JSON stamped with the manifest hash.

Examples
--------
Lab mirror:
    python3 scripts/benchmarks/record_baseline.py \
        --manifest docs/benchmarks/manifests/counter-standard.json \
        --site doco-mirror.lab.xoloitzcuintles.com --via lab --since 2026-08-14

Production (read-only over ssh):
    ... --site ventas.docomexico.com --via prod --since 2026-08-14

The telemetry summary window is capped at 50k rows; pass a --since narrow
enough to stay under it (the capture records the API's truncated flag).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from manifest_lib import (  # noqa: E402
    evidence_class,
    extract_interactions,
    load_json,
    manifest_sha256,
    validate_manifest,
)

LAB_PREFIX = (
    "docker compose -f {compose} exec -T backend bench --site {site} execute {method}"
)
PROD_PREFIX = (
    "ssh contavm 'cd ~/muelle && docker compose exec -T backend "
    "bench --site {site} execute {method}{kwargs_sq}'"
)


def bench_execute(via, site, method, kwargs=None, compose=None):
    kwargs_json = json.dumps(kwargs or {})
    if via == "lab":
        cmd = LAB_PREFIX.format(
            compose=compose or str(pathlib.Path.home() / "muelle-host/muelle/compose.yaml"),
            site=site,
            method=method,
        ) + f" --kwargs '{kwargs_json}'"
    elif via == "prod":
        # single-quoted ssh command: embed kwargs with escaped quoting
        kwargs_sq = " --kwargs " + '"' + kwargs_json.replace('"', '\\"') + '"'
        cmd = PROD_PREFIX.format(site=site, method=method, kwargs_sq=kwargs_sq)
    else:
        raise SystemExit(f"unknown --via {via}")
    out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise RuntimeError(f"bench execute failed:\n{out.stderr[-2000:]}")
    last = out.stdout.strip().splitlines()[-1]
    return json.loads(last)


def dataset_snapshot(via, site, compose):
    row = bench_execute(
        via,
        site,
        "frappe.db.sql",
        {
            "query": (
                "SELECT (SELECT COUNT(*) FROM tabItem WHERE disabled=0) items, "
                "(SELECT COUNT(*) FROM tabCustomer WHERE disabled=0) customers"
            ),
            "as_dict": 1,
        },
        compose,
    )
    return row[0] if row else {}


def bundle_snapshot():
    dist = REPO_ROOT / "posawesome" / "public" / "dist"
    if not dist.is_dir():
        return None
    js = sum(p.stat().st_size for p in dist.rglob("*.js"))
    css = sum(p.stat().st_size for p in dist.rglob("*.css"))
    return {"js_bytes": js, "css_bytes": css, "dist": str(dist.relative_to(REPO_ROOT))}


def local_git_sha():
    out = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
    )
    return out.stdout.strip() or None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--via", choices=["lab", "prod"], required=True)
    ap.add_argument("--since", required=True, help="YYYY-MM-DD summary window start")
    ap.add_argument("--compose", help="lab compose.yaml path override")
    ap.add_argument("--out", help="output path (default: docs/benchmarks/baselines/<id>/)")
    args = ap.parse_args()

    manifest = load_json(args.manifest)
    problems = validate_manifest(manifest)
    if problems:
        raise SystemExit("invalid manifest:\n" + "\n".join(problems))

    wanted = {name for row in manifest["interactions"] for name in row.get("events") or []}
    summary_method = "posawesome.posawesome.api.telemetry.get_pos_telemetry_summary"
    kwargs = {"since": args.since, "newest": 1, "events": sorted(wanted)}
    try:
        summary = bench_execute(args.via, args.site, summary_method, kwargs, args.compose)
    except RuntimeError:
        # Site may predate the `events` filter param — fall back unfiltered
        # (the 50k row cap then limits the usable window to ~1 day on a
        # busy tenant; window.truncated in the capture tells the truth).
        kwargs.pop("events")
        print("note: site rejected the events filter — falling back to unfiltered summary")
        summary = bench_execute(args.via, args.site, summary_method, kwargs, args.compose)
    events = summary.get("events") or {}
    kept = {name: events[name] for name in sorted(wanted) if name in events}

    per_interaction = extract_interactions(manifest, kept)
    gaps = [
        row["key"]
        for row in manifest["interactions"]
        if row.get("gap") or not (per_interaction.get(row["key"]) or {}).get("events")
    ]

    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M")
    capture = {
        "manifest_id": manifest["manifest_id"],
        "manifest_sha256": manifest_sha256(args.manifest),
        "evidence_class": evidence_class(manifest),
        "captured_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "site": args.site,
        "via": args.via,
        "window": {"since": args.since, **(summary.get("window") or {})},
        "app": {"local_git_sha": local_git_sha()},
        "dataset": dataset_snapshot(args.via, args.site, args.compose),
        "bundle": bundle_snapshot(),
        "events": kept,
        "gaps": gaps,
    }

    if args.out:
        out_path = pathlib.Path(args.out)
    else:
        out_dir = REPO_ROOT / "docs" / "benchmarks" / "baselines" / manifest["manifest_id"]
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{stamp}-{args.site.split('.')[0]}.json"
    out_path.write_text(json.dumps(capture, indent=2, ensure_ascii=False) + "\n")
    print(f"capture written: {out_path}")
    print(f"evidence class:  {capture['evidence_class']}")
    print(f"events kept:     {len(kept)} / wanted {len(wanted)}")
    print(f"gaps:            {', '.join(gaps) or 'none'}")


if __name__ == "__main__":
    main()
