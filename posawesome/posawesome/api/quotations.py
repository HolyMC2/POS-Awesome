import json

import frappe
from frappe import _
from frappe.utils import cint, getdate, nowdate

from posawesome.posawesome.api.quotation_read_model import (
    QUOTATION_BUCKETS,
    bucket_counts,
    matches_search,
    shape_row,
)


def _map_delivery_dates(data):
    """Ensure mandatory delivery_date fields are populated."""

    def parse_date(value):
        if not value:
            return None
        try:
            return str(getdate(value))
        except Exception:
            return None

    if not data.get("delivery_date") and data.get("posa_delivery_date"):
        parsed = parse_date(data.get("posa_delivery_date"))
        if parsed:
            data["delivery_date"] = parsed

    for item in data.get("items", []):
        if not item.get("delivery_date"):
            delivery = item.get("posa_delivery_date") or data.get("delivery_date")
            parsed = parse_date(delivery)
            if parsed:
                item["delivery_date"] = parsed


def _ensure_customer_fields(data):
    if not isinstance(data, dict):
        return

    if data.get("doctype") != "Quotation":
        return

    customer = data.get("customer") or data.get("party_name")
    if customer:
        data["customer"] = customer
        data["party_name"] = customer
        data.setdefault("customer_name", customer)

    data.setdefault("quotation_to", "Customer")


def _normalize_quotation_row(row):
    customer = row.get("customer") or row.get("party_name") or row.get("customer_name")
    row["customer"] = customer
    row["party_name"] = customer
    row["customer_name"] = row.get("customer_name") or customer
    row["status"] = row.get("status") or ("Submitted" if int(row.get("docstatus") or 0) == 1 else "Draft")
    return row


def _assert_quotation_flow_allowed(pos_profile=None, company=None):
    """Scope + feature gate (POS-PROFILE-SPEC P2).

    `custom_allow_create_quotation` only hid the quotation flow in the UI —
    these endpoints saved/submitted with ignore_permissions and no scope
    assertion at all (unlike their sales_orders.py siblings).
    """
    from posawesome.posawesome.api._scope import assert_company, assert_profile_feature

    assert_company(frappe.session.user, company)
    assert_profile_feature(
        frappe.session.user, pos_profile, "custom_allow_create_quotation", company
    )


@frappe.whitelist(methods=["GET", "POST"])
def search_quotations(
    company,
    currency,
    quotation_name=None,
    include_draft=1,
    include_submitted=1,
    pos_profile=None,
):
    _assert_quotation_flow_allowed(pos_profile, company)
    docstatus_filters = []
    if int(include_draft or 0):
        docstatus_filters.append(0)
    if int(include_submitted or 0):
        docstatus_filters.append(1)

    if not docstatus_filters:
        return []

    filters = {
        "company": company,
        "currency": currency,
        "docstatus": ["in", docstatus_filters],
        "quotation_to": "Customer",
    }

    or_filters = []
    if quotation_name:
        search_value = f"%{quotation_name}%"
        or_filters = [
            ["name", "like", search_value],
            ["party_name", "like", search_value],
            ["customer_name", "like", search_value],
            ["currency", "like", search_value],
        ]

    quotations = frappe.get_list(
        "Quotation",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "company",
            "currency",
            "transaction_date",
            "grand_total",
            "party_name",
            "customer_name",
            "docstatus",
            "status",
            "owner",
            "modified",
            "modified_by",
        ],
        limit_page_length=0,
        order_by="modified desc",
    )

    return [_normalize_quotation_row(dict(row)) for row in quotations]


@frappe.whitelist(methods=["POST"])
def update_quotation(data, pos_profile=None):
    """Create or update a Quotation document."""
    data = json.loads(data)
    _assert_quotation_flow_allowed(
        pos_profile or data.get("pos_profile"), data.get("company")
    )
    _map_delivery_dates(data)
    _ensure_customer_fields(data)
    if data.get("name") and frappe.db.exists("Quotation", data.get("name")):
        doc = frappe.get_doc("Quotation", data.get("name"))
        doc.update(data)
    else:
        doc = frappe.get_doc(data)

    doc.flags.ignore_permissions = True
    doc.docstatus = 0
    from posawesome.posawesome.api._perms import account_perm_bypass
    with account_perm_bypass():
        doc.save()
    return doc


@frappe.whitelist(methods=["POST"])
def submit_quotation(order, pos_profile=None):
    """Submit quotation document."""
    order = json.loads(order)
    _assert_quotation_flow_allowed(
        pos_profile or order.get("pos_profile"), order.get("company")
    )
    _map_delivery_dates(order)
    _ensure_customer_fields(order)
    if order.get("name") and frappe.db.exists("Quotation", order.get("name")):
        doc = frappe.get_doc("Quotation", order.get("name"))
        doc.update(order)
    else:
        doc = frappe.get_doc(order)

    doc.flags.ignore_permissions = True
    from posawesome.posawesome.api._perms import account_perm_bypass
    with account_perm_bypass():
        doc.save()
        doc.submit()

    return {"name": doc.name, "status": doc.docstatus}


# ---------------------------------------------------------------------------
# The register's Cotizaciones lane (DOCUMENTOS_GOLDEN_FLOW §1)
# ---------------------------------------------------------------------------
#
# `search_quotations` above serves the old Drafts «Quote» tab: company +
# currency, both docstatuses, no estado at all. The lane the artboard draws
# needs the opposite shape — submitted quotes only (a draft has no folio to
# hand a customer), bucketed by validity, and carrying the conversion link —
# so it is a second read rather than a flag on the first.


#: Register-scoped columns the lane reads. Split out because a site that has
#: not run `add_quotation_conversion_fields` has none of them, and a `get_all`
#: naming a missing column raises rather than returning empty.
_QUOTATION_POSA_FIELDS = (
    "posa_converted_invoice",
    "posa_converted_invoice_doctype",
    "posa_pos_profile",
    "posa_note",
)


def _available_posa_fields():
    return [
        field
        for field in _QUOTATION_POSA_FIELDS
        if frappe.db.has_column("Quotation", field)
    ]


def profile_company(pos_profile):
    """The company a register belongs to — never taken from the client.

    Every endpoint on this lane is scoped by THIS value, not by a `company`
    argument, so a cashier cannot widen their own scope by editing a request.
    """
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    if not company:
        frappe.throw(_("POS Profile {0} has no company.").format(pos_profile))
    return company


def require_open_shift(pos_profile):
    """The acting cashier's own open shift on THIS register.

    A cotización is a promise the register makes and a nota de crédito is money
    leaving it; both belong to a shift, and a shift is what the corte reads.
    The filters repeat `check_opening_shift`'s rather than importing it,
    because that function returns a whole payload and this needs one name —
    the same reasoning `stored_value._require_open_shift` records.
    """
    user = frappe.session.user
    rows = frappe.get_all(
        "POS Opening Shift",
        filters={
            "user": user,
            "pos_closing_shift": ["is", "not set"],
            "docstatus": 1,
            "status": "Open",
        },
        fields=["name", "pos_profile"],
        order_by="period_start_date desc",
        limit_page_length=1,
    )
    if not rows:
        frappe.throw(_("Open a shift on this register before saving a quotation."))
    shift = rows[0]
    if shift.get("pos_profile") != pos_profile:
        frappe.throw(
            _(
                "Your open shift belongs to POS Profile {0}. Close it before "
                "working on {1}."
            ).format(shift.get("pos_profile"), pos_profile)
        )
    return shift.get("name")


def assert_not_walk_in(pos_profile, customer):
    """A quote is a promise to SOMEBODY.

    The register's default customer is the anonymous counter sale; naming it on
    a document that is meant to be recalled by folio a week later produces a
    promise nobody can be identified as holding — and, on the credit-note side,
    a balance nobody can ever spend.
    """
    if not customer:
        frappe.throw(_("Choose a customer first — a quotation is a promise to someone."))
    walk_in = frappe.db.get_value("POS Profile", pos_profile, "customer")
    if walk_in and customer == walk_in:
        frappe.throw(
            _(
                "«{0}» is the counter customer. Choose a real customer — a "
                "quotation is a promise to someone who can come back for it."
            ).format(customer)
        )


@frappe.whitelist(methods=["GET", "POST"])
def get_quotations(pos_profile, status_bucket=None, search=None, limit=200):
    """The Cotizaciones lane's list, bucketed and counted.

    Counts come from the WHOLE company-scoped set, the filtered rows from the
    chosen bucket: a tab reading «Vencidas 9» while the list under it shows the
    two that matched a search is the header contradicting the list. So the
    filter is applied after the count, never before it.
    """
    _assert_quotation_flow_allowed(pos_profile)
    company = profile_company(pos_profile)

    fields = [
        "name",
        "party_name",
        "customer_name",
        "transaction_date",
        "valid_till",
        "grand_total",
        "currency",
        "owner",
    ] + _available_posa_fields()

    sources = frappe.get_all(
        "Quotation",
        filters={
            "company": company,
            "quotation_to": "Customer",
            # Submitted only: a draft quotation has no folio the customer could
            # be holding, and the lane exists to answer «I have this paper».
            "docstatus": 1,
        },
        fields=fields,
        order_by="transaction_date desc, creation desc",
        limit_page_length=cint(limit) or 200,
    )

    today = nowdate()
    rows = [shape_row(dict(source), today) for source in sources]
    _attach_item_counts(rows)
    counts = bucket_counts(rows)

    bucket = str(status_bucket or "").strip()
    if bucket and bucket in QUOTATION_BUCKETS:
        rows = [row for row in rows if row["estado"] == bucket]
    rows = [row for row in rows if matches_search(row, search)]

    return {"rows": rows, "counts": counts, "today": today, "company": company}


def _attach_item_counts(rows):
    """One extra query for every row's line count, not one per row.

    Deliberately NOT `get_all(fields=["count(name) as n"])`: an aggregate in
    `fields` is rejected as unsafe over HTTP (417) even though it works in the
    bench console, which is exactly the trap that makes a read model pass its
    tests and fail on the register.
    """
    names = [row["name"] for row in rows if row.get("name")]
    if not names:
        return
    lines = frappe.get_all(
        "Quotation Item",
        filters={"parent": ["in", names]},
        fields=["parent"],
        limit_page_length=0,
    )
    tally = {}
    for line in lines:
        parent = line.get("parent")
        tally[parent] = tally.get(parent, 0) + 1
    for row in rows:
        row["items_count"] = tally.get(row["name"], 0)
