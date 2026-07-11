"""Prometheus counters for POS server-side failure visibility.

2026-07-11 audit gap: background-submit failures, hold-resume errors and
FAILED ledger rows lived only in Error Log — invisible to vigia/Grafana.
Counters ride the shared multiproc registry, so doco's existing scrape
endpoint (`doco.docoutils.observability.endpoint.metrics`,
X-Prometheus-Token) exports them with zero endpoint work; on sites
without doco they increment harmlessly unscraped.

Pattern copied from saldo/api/telemetry.py: guarded import, `site` label,
PROMETHEUS_MULTIPROC_DIR self-heal (queue containers wipe /tmp — without
the makedirs every inc() raises and would kill the money path).

Usage: `from posawesome.posawesome.api.metrics import submit_failure` —
all helpers are try/except-safe; a metric must never break a sale.
"""

from __future__ import annotations

import frappe

try:
    import os

    from prometheus_client import Counter

    _mp = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if _mp:
        try:
            os.makedirs(_mp, exist_ok=True)
        except OSError:
            pass

    _PROM = True

    SUBMIT_FAILURES = Counter(
        "posa_submit_failures_total",
        "POS invoice submissions that failed server-side.",
        labelnames=("site", "path"),  # path: sync|background|resume|outbox
    )
    BACKGROUND_SUBMITS = Counter(
        "posa_background_submits_total",
        "Background POS submit jobs by outcome.",
        labelnames=("site", "outcome"),  # outcome: ok|error
    )
    LEDGER_PRUNED = Counter(
        "posa_ledger_rows_pruned_total",
        "Final-state submission-ledger rows removed by the daily prune.",
        labelnames=("site",),
    )
except ImportError:  # pragma: no cover
    _PROM = False
    SUBMIT_FAILURES = BACKGROUND_SUBMITS = LEDGER_PRUNED = None  # type: ignore


def _site() -> str:
    try:
        return frappe.local.site or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def submit_failure(path: str) -> None:
    if not _PROM:
        return
    try:
        SUBMIT_FAILURES.labels(site=_site(), path=path).inc()
    except Exception:  # noqa: BLE001
        pass


def background_submit(outcome: str) -> None:
    if not _PROM:
        return
    try:
        BACKGROUND_SUBMITS.labels(site=_site(), outcome=outcome).inc()
    except Exception:  # noqa: BLE001
        pass


def ledger_pruned(count: int) -> None:
    if not _PROM or not count:
        return
    try:
        LEDGER_PRUNED.labels(site=_site()).inc(count)
    except Exception:  # noqa: BLE001
        pass
