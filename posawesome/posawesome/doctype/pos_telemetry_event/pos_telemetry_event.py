# Copyright (c) 2026, doco contributors and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class POSTelemetryEvent(Document):
    """Browser RUM event record from the POSAwesome SPA.

    Inserts arrive batched through
    `posawesome.posawesome.api.telemetry.ingest`. Per-row validation is
    kept intentionally minimal — telemetry must not block the SPA on
    server-side issues. Server-side filtering of bad rows happens in
    the ingest endpoint, not here, so the doctype stays cheap to write.
    """

    def validate(self):  # pragma: no cover - cheap
        if self.event_name:
            self.event_name = (self.event_name or "").strip()[:64]
        if self.terminal:
            self.terminal = (self.terminal or "").strip()[:64]
        if self.build_version:
            self.build_version = (self.build_version or "").strip()[:16]
        if self.user_agent and len(self.user_agent) > 512:
            self.user_agent = self.user_agent[:512]

    @staticmethod
    def get_count(filters=None):  # pragma: no cover
        return frappe.db.count("POS Telemetry Event", filters or {})
