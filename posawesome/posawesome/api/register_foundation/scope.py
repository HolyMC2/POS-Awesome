"""Store scope = site ∩ company ∩ store grant ∩ profile eligibility ∩ action.

Grants are rows in ``POS Store Assignment`` (store or company subtree scope),
evaluated at request time — a revoked or expired grant stops queries and
commands on the next request. System Manager is the tenant administrator and
bypasses grants; that bypass is recorded on every mutating command event.
"""

from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from .errors import denied
from .model import BUNDLES, READ_CAPABILITIES

_CACHE = "_posa_store_scope"


def is_admin(user=None) -> bool:
    user = user or frappe.session.user
    return bool(user and user != "Guest" and "System Manager" in frappe.get_roles(user))


def _bucket():
    bucket = getattr(frappe.local, _CACHE, None)
    if bucket is None:
        bucket = {}
        setattr(frappe.local, _CACHE, bucket)
    return bucket


def clear_cache():
    setattr(frappe.local, _CACHE, {})


def grants(user=None) -> list[dict]:
    """Currently valid grants for ``user`` (one indexed query per request)."""
    user = user or frappe.session.user
    if not user or user == "Guest":
        return []
    bucket = _bucket()
    if user in bucket:
        return bucket[user]
    if not frappe.db.table_exists("POS Store Assignment"):
        bucket[user] = []
        return []
    rows = frappe.db.sql(
        """SELECT a.scope_type, a.store, a.company, a.bundle
        FROM `tabPOS Store Assignment` a
        INNER JOIN `tabUser` u ON u.name = a.user AND u.enabled = 1
        WHERE a.user = %(user)s AND a.enabled = 1
          AND (a.valid_from IS NULL OR a.valid_from <= %(now)s)
          AND (a.valid_to IS NULL OR a.valid_to > %(now)s)""",
        {"user": user, "now": now_datetime()}, as_dict=True)
    bucket[user] = rows
    return rows


def store_capabilities(user, store_name, company) -> set:
    if is_admin(user):
        return set().union(*BUNDLES.values())
    caps = set()
    for grant in grants(user):
        if (grant.scope_type == "Store" and grant.store == store_name) or (
                grant.scope_type == "Company" and grant.company == company):
            caps |= BUNDLES.get(grant.bundle, set())
    return caps


def company_capabilities(user, company) -> set:
    """Company-subtree grants only (store creation / regional views)."""
    if is_admin(user):
        return set().union(*BUNDLES.values())
    caps = set()
    for grant in grants(user):
        if grant.scope_type == "Company" and grant.company == company:
            caps |= BUNDLES.get(grant.bundle, set())
    return caps


def load_store(store, capability=None, user=None, for_update=False):
    """Scoped store read; missing and forbidden are indistinguishable."""
    user = user or frappe.session.user
    if not store or not isinstance(store, str) or len(store) > 140:
        denied()
    row = frappe.db.get_value("POS Store", store, "*", as_dict=True, for_update=for_update)
    if not row:
        denied()
    caps = store_capabilities(user, row.name, row.company)
    needed = {capability} if capability else READ_CAPABILITIES
    if not caps & needed:
        denied()
    row.capabilities = caps
    return row


def load_register(register, capability=None, user=None, for_update=False):
    user = user or frappe.session.user
    if not register or not isinstance(register, str) or len(register) > 140:
        denied()
    row = frappe.db.get_value("POS Register", register, "*", as_dict=True, for_update=for_update)
    if not row:
        denied()
    store = frappe.db.get_value("POS Store", row.store, "*", as_dict=True)
    if not store:
        denied()
    caps = store_capabilities(user, store.name, store.company)
    needed = {capability} if capability else READ_CAPABILITIES
    if not caps & needed:
        denied()
    row.capabilities = caps
    return row, store


def bundles_with(capabilities) -> list[str]:
    wanted = set(capabilities)
    return sorted(name for name, caps in BUNDLES.items() if caps & wanted)


def store_predicate(user, alias="s", capabilities=READ_CAPABILITIES):
    """SQL predicate limiting ``alias`` (a POS Store) to granted stores."""
    if is_admin(user):
        return "1=1", {}
    bundles = bundles_with(capabilities)
    if not bundles:
        return "1=0", {}
    return (f"""EXISTS (SELECT 1 FROM `tabPOS Store Assignment` ga
        INNER JOIN `tabUser` gu ON gu.name = ga.user AND gu.enabled = 1
        WHERE ga.user = %(scope_user)s AND ga.enabled = 1
          AND (ga.valid_from IS NULL OR ga.valid_from <= %(scope_now)s)
          AND (ga.valid_to IS NULL OR ga.valid_to > %(scope_now)s)
          AND ga.bundle IN %(scope_bundles)s
          AND ((ga.scope_type = 'Store' AND ga.store = {alias}.name)
            OR (ga.scope_type = 'Company' AND ga.company = {alias}.company)))""",
            {"scope_user": user, "scope_now": now_datetime(), "scope_bundles": tuple(bundles)})


# --- Desk / REST enforcement -------------------------------------------------

_BY_STORE = {
    "POS Store": "name", "POS Register": "store", "POS Register Runtime": "store",
    "POS Device": "store", "POS Device Binding": "store", "POS Enrollment Challenge": "store",
    "POS Store Assignment": "store", "POS Register Command Receipt": "store",
    "POS Register Event": "store",
}


def _condition(doctype, user=None):
    user = user or frappe.session.user
    if is_admin(user):
        return ""
    field = _BY_STORE[doctype]
    clause, params = store_predicate(user, alias="ps")
    if clause == "1=0":
        return "1=0"
    # frappe list conditions are raw SQL; escape the bound values ourselves.
    rendered = clause.replace("%(scope_user)s", frappe.db.escape(params["scope_user"]))
    rendered = rendered.replace("%(scope_now)s", frappe.db.escape(str(params["scope_now"])))
    rendered = rendered.replace("%(scope_bundles)s", "(" + ",".join(frappe.db.escape(b) for b in params["scope_bundles"]) + ")")
    own = ""
    if doctype == "POS Store Assignment":
        own = f" OR `tabPOS Store Assignment`.user = {frappe.db.escape(user)}"
    return (f"(`tab{doctype}`.`{field}` IN (SELECT ps.name FROM `tabPOS Store` ps WHERE {rendered}){own})")


def query_store(user=None): return _condition("POS Store", user)
def query_register(user=None): return _condition("POS Register", user)
def query_register_runtime(user=None): return _condition("POS Register Runtime", user)
def query_device(user=None): return _condition("POS Device", user)
def query_binding(user=None): return _condition("POS Device Binding", user)
def query_challenge(user=None): return _condition("POS Enrollment Challenge", user)
def query_assignment(user=None): return _condition("POS Store Assignment", user)
def query_receipt(user=None): return _condition("POS Register Command Receipt", user)
def query_event(user=None): return _condition("POS Register Event", user)


def query_cashier_runtime(user=None):
    user = user or frappe.session.user
    if is_admin(user):
        return ""
    return f"`tabPOS Cashier Runtime`.user = {frappe.db.escape(user)}"


def has_permission(doc, ptype=None, user=None, debug=False):
    """Row-level gate for Desk/REST. Mutations of service records are refused
    by their controllers; this hook makes reads scoped as well."""
    user = user or frappe.session.user
    if is_admin(user):
        return True
    if doc.doctype == "POS Cashier Runtime":
        return ptype in (None, "read", "print", "report") and doc.user == user
    if ptype not in (None, "read", "print", "report", "export"):
        return False
    if doc.doctype == "POS Store Assignment" and doc.user == user:
        return True
    store = doc.name if doc.doctype == "POS Store" else doc.get(_BY_STORE[doc.doctype])
    if not store:
        return False
    company = frappe.db.get_value("POS Store", store, "company")
    return bool(store_capabilities(user, store, company) & READ_CAPABILITIES)
