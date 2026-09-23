"""Durable command receipts and the transactional outbox (spec 01 §6).

A receipt row is the FIRST lock of every command (lock order, spec 01 §7).
Its unique ``receipt_key`` = ``namespace::request_id`` serializes duplicates:
a concurrent twin blocks on the unique index until the first commits, then
reads its result. Receipt, business records and outbox event commit in one
database transaction, so no success precedes commit.
"""

from __future__ import annotations

import json
from contextlib import contextmanager

import frappe
from frappe.utils import now_datetime

from .errors import correlation_id, fail
from .model import payload_hash

_DUPLICATE = (frappe.DuplicateEntryError, frappe.UniqueValidationError)


@contextmanager
def service_write():
    previous = getattr(frappe.local, "posa_register_service", False)
    frappe.local.posa_register_service = True
    try:
        yield
    finally:
        frappe.local.posa_register_service = previous


def insert(doc):
    with service_write():
        doc.insert(ignore_permissions=True)
    return doc


def save(doc):
    with service_write():
        doc.save(ignore_permissions=True)
    return doc


def _existing(key, lock=True):
    return frappe.db.get_value(
        "POS Register Command Receipt", {"receipt_key": key},
        ["name", "payload_hash", "actor", "status", "result_json", "store"],
        as_dict=True, for_update=lock)


def _replay(prior, digest, actor):
    if prior.actor != actor or prior.payload_hash != digest:
        fail("validation_failed", "This request ID was already used for a different instruction.")
    if prior.status != "Completed":
        fail("outcome_unknown", "The original request is still being verified. Retry shortly.")
    return json.loads(prior.result_json or "{}")


class Receipt:
    """Begin → (replay | perform) → complete, inside one transaction."""

    def __init__(self, namespace, request_id, payload, store=None):
        self.namespace = namespace
        self.request_id = request_id
        self.actor = frappe.session.user
        self.key = f"{namespace}::{request_id}"
        self.digest = payload_hash(namespace, self.actor, payload)
        self.store = store
        self.doc = None
        self.replayed = None

    def begin(self):
        """Return the original result on replay, else hold a Pending receipt."""
        prior = _existing(self.key)
        if prior:
            self.replayed = _replay(prior, self.digest, self.actor)
            return self.replayed
        doc = frappe.get_doc({
            "doctype": "POS Register Command Receipt", "namespace": self.namespace,
            "request_id": self.request_id, "receipt_key": self.key,
            "payload_hash": self.digest, "actor": self.actor, "store": self.store,
            "status": "Pending", "correlation_id": correlation_id(),
        })
        try:
            insert(doc)
        except _DUPLICATE:
            # A twin committed while we waited on the unique index.
            prior = _existing(self.key)
            if not prior:
                raise
            self.replayed = _replay(prior, self.digest, self.actor)
            return self.replayed
        self.doc = doc
        return None

    def complete(self, result, target_doctype=None, target_name=None, store=None):
        values = {"status": "Completed", "result_json": json.dumps(result, default=str, sort_keys=True),
                  "target_doctype": target_doctype, "target_name": target_name}
        if store or self.store:
            values["store"] = store or self.store
        with service_write():
            frappe.db.set_value("POS Register Command Receipt", self.doc.name, values, update_modified=True)
        return result


def emit(event_type, aggregate_type, aggregate_id, revision=None, store=None,
         receipt=None, payload=None, safe=None):
    """Append an outbox event in the caller's transaction (at-least-once)."""
    body = dict(payload or {})
    if "System Manager" in frappe.get_roles(frappe.session.user):
        body.setdefault("admin_actor", True)
    return insert(frappe.get_doc({
        "doctype": "POS Register Event", "event_type": event_type,
        "aggregate_type": aggregate_type, "aggregate_id": aggregate_id,
        "aggregate_revision": revision, "schema_version": 1, "store": store, "safe": safe,
        "receipt": receipt.doc.name if getattr(receipt, "doc", None) else receipt,
        "actor": frappe.session.user, "occurred_at": now_datetime(),
        "payload_json": json.dumps(body, default=str, sort_keys=True),
    }))
