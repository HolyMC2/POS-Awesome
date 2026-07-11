import frappe


def execute():
    """Indexes for the POS delta-sync polls + hold-resume ledger lookups.

    * `Item Price.modified` and `Bin.modified` are filtered every 60s by
      every terminal's delta poll (`_collect_delta_item_codes`) — neither is
      indexed by default, so the polls full-scan. Cheap today, real at
      muelle multi-tenant catalog scale (audit finding).
    * `POS Invoice Submission Ledger.invoice_name` is queried by
      `resume_held_submission` (hold-until-confirm) and the stuck-hold
      janitor on every resume.
    """
    for doctype, columns in (
        ("Item Price", ["modified"]),
        ("Bin", ["modified"]),
        ("POS Invoice Submission Ledger", ["invoice_name"]),
    ):
        try:
            frappe.db.add_index(doctype, columns)
        except Exception:
            # Index may already exist (re-run / manual add) — never block
            # migrate over an optimization.
            pass
