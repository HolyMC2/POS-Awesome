"""Dead-letter surface for the SERVER half of the durable-submission machinery.

The frontend write_queue got its dead-letter panel/badge in audit r2 (A2) —
every entity type that exhausts retries stays visible and requeueable. The
submission ledger had no equivalent: non-final rows are deliberately kept
forever as the repair trail (see ``prune_submission_ledger``), but recovery
only ever ran when the CLIENT happened to replay the same
``client_request_id``. A row stuck in SUBMITTED — invoice live, post-submit
money work (change / credit Payment Entries) missing — whose client entry was
deleted, dead-lettered locally, or lost with the device, sat invisible
forever. Roadmap Product 2: "finish dead-letter recovery for every financial
write queue"; this module is that recovery surface.

Report-only by design: the repair path (``repair_invoice_submission``) writes
Payment Entries, and money writes stay operator-triggered (the same rule that
keeps ``draft_review`` manual on the client). The sweep makes stuck rows LOUD
— Prometheus gauge for vigia/Grafana plus one grouped Error Log row — and the
whitelisted summary hands a supervisor the exact ``client_request_id`` set
that ``repair_invoice_submission`` takes.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime

from posawesome.posawesome.api.invoice_processing.creation import (
    LEDGER_DOCTYPE,
    STATE_DRAFT_CREATED,
    STATE_FAILED,
    STATE_RECEIVED,
    STATE_SUBMITTED,
)

# Hours a non-final row may age before it counts as stuck. SUBMITTED is the
# short fuse: the invoice exists but its Payment Entries do not, and the
# transition normally happens in the same request — an hour already means the
# client is not coming back. DRAFT_CREATED is the long fuse: hold gates
# (saldo/TAECEL) park drafts there legitimately, and a cashier may be told to
# fix or delete a draft on their own clock.
STUCK_GRACE_HOURS = {
    STATE_SUBMITTED: 1,
    STATE_RECEIVED: 4,
    STATE_DRAFT_CREATED: 24,
    STATE_FAILED: 24,
}

# Enough for the Error Log row to be actionable without dumping the table.
_SUMMARY_ROW_CAP = 200


def find_stuck_ledger_rows(now=None):
    """Non-final ledger rows older than their per-state grace window."""
    now = now or now_datetime()
    conditions = []
    values = []
    for state, grace_hours in STUCK_GRACE_HOURS.items():
        conditions.append("(state = %s AND modified < %s)")
        values.extend([state, add_to_date(now, hours=-grace_hours)])

    return frappe.db.sql(
        """SELECT name, client_request_id, state, company, pos_profile,
                  document_type, invoice_name, modified
           FROM `tab{doctype}`
           WHERE {conditions}
           ORDER BY modified ASC
           LIMIT {cap}""".format(
            doctype=LEDGER_DOCTYPE,
            conditions=" OR ".join(conditions),
            cap=_SUMMARY_ROW_CAP,
        ),
        tuple(values),
        as_dict=True,
    )


def sweep_stuck_submission_ledger():
    """Daily scheduler: gauge + one grouped Error Log when anything is stuck.

    Sets the gauge for EVERY tracked state, zeros included — a state that
    drained must clear its alarm, and skipping the set would leave the last
    non-zero value on the scrape forever.
    """
    from posawesome.posawesome.api.metrics import ledger_stuck

    rows = find_stuck_ledger_rows()
    counts = {state: 0 for state in STUCK_GRACE_HOURS}
    for row in rows:
        counts[row.state] = counts.get(row.state, 0) + 1

    for state, count in counts.items():
        ledger_stuck(state, count)

    if rows:
        frappe.log_error(
            title="POS submission ledger: stuck non-final rows",
            message=json.dumps(
                {
                    "counts": {k: v for k, v in counts.items() if v},
                    "grace_hours": STUCK_GRACE_HOURS,
                    "recovery": (
                        "repair_invoice_submission(client_request_id, company, "
                        "pos_profile, document_type) — idempotent, replays "
                        "missing post-submit money work"
                    ),
                    "rows": [
                        {
                            "client_request_id": row.client_request_id,
                            "state": row.state,
                            "invoice_name": row.invoice_name,
                            "pos_profile": row.pos_profile,
                            "modified": str(row.modified),
                        }
                        for row in rows[:20]
                    ],
                },
                indent=1,
                default=str,
            ),
        )

    return {"ok": True, "stuck": counts, "total": len(rows)}


@frappe.whitelist()
def get_stuck_submission_ledger_summary():
    """Supervisor view of stuck rows, keyed by what the repair call needs."""
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
        is_closing_supervisor,
    )

    if not is_closing_supervisor():
        frappe.throw(
            _("Only a closing supervisor may inspect stuck POS submissions"),
            frappe.PermissionError,
        )

    rows = find_stuck_ledger_rows()
    return {
        "total": len(rows),
        "grace_hours": STUCK_GRACE_HOURS,
        "rows": rows,
    }
