# -*- coding: utf-8 -*-

"""Tarjeta de cliente — the customer's own money at this register.

TWO WALLETS, NOT ONE (`walletSummary.ts`'s standing rule). Nothing in this
module touches gift cards: those are bearer value, they live in
`gift_cards.py`, and a code is their owner. Here the CUSTOMER is the owner and
the value has two halves that never merge into one figure:

  * **monedero** — pesos already paid in. ERPNext customer credit
    (unallocated advances + credit notes), read by `get_available_credit`,
    redeemable as a tender by the existing customer-credit path.
  * **cashback** — an ERPNext Loyalty Program the register designates. Points
    accrue on submit and are worth `points × conversion_factor`.

No new ledger. Deposits are Payment Entries, accruals are Loyalty Point
Entries, and this module only mints the first and reads the rest.
"""

from __future__ import unicode_literals

import frappe

from .payments import get_available_credit


# The card shows a ledger, not an archive. Callers are told the cap in the
# payload (the OrderStory convention) so a screen can say «últimos 40» rather
# than implying it drew everything.
WALLET_MOVEMENTS_LIMIT = 40


def _normalize_amount(value):
    try:
        return round(float(value or 0), 2)
    except Exception:
        return 0.0


def _to_int(value):
    try:
        return int(float(value or 0))
    except Exception:
        return 0


def _text(value):
    return str(value or "").strip()


def _doc_value(doc, key, default=None):
    if doc is None:
        return default
    if hasattr(doc, "get"):
        value = doc.get(key, default)
        if value is not None:
            return value
    return getattr(doc, key, default)


@frappe.whitelist(methods=["GET", "POST"])
def get_available_stored_value(customer=None, company=None):
    if not customer:
        frappe.throw(frappe._("Customer is required to fetch stored value."))
    if not company:
        frappe.throw(frappe._("Company is required to fetch stored value."))

    return get_available_credit(customer=customer, company=company)


@frappe.whitelist(methods=["GET", "POST"])
def get_stored_value_summary(customer=None, company=None):
    sources = get_available_stored_value(customer=customer, company=company)
    available_amount = sum(_normalize_amount(row.get("total_credit")) for row in sources)

    return {
        "available_amount": _normalize_amount(available_amount),
        "source_count": len(sources),
        "sources": sources,
    }


# ---------------------------------------------------------------------------
# Gates
#
# The gift-cards P0-3 lesson, applied before it can be repeated: a POS Profile
# flag that only hides a button is not a gate. Every write below asserts the
# flag, the register roster and an open shift SERVER-SIDE, and none of the
# three is bypassed by a System Manager the way the tenant-scope asserts are.
# ---------------------------------------------------------------------------


def _get_profile_doc(pos_profile=None):
    from posawesome.posawesome.api.employees import _resolve_profile_name

    profile_name = _resolve_profile_name(pos_profile)
    if not profile_name:
        frappe.throw(frappe._("POS profile is required."))
    return frappe.get_cached_doc("POS Profile", profile_name)


def _require_customer_cards_enabled(profile_doc):
    from frappe.utils import cint

    if not cint(_doc_value(profile_doc, "posa_use_customer_cards")):
        frappe.throw(
            frappe._("Customer cards are not enabled in POS Profile {0}.").format(
                _doc_value(profile_doc, "name") or ""
            )
        )


def _require_register_member(profile_doc):
    """The acting session user must be on this register's roster.

    Mirrors `gift_cards._require_supervisor` minus the supervisor role: a
    deposit is a cashier gesture, being on the roster is the whole gate.
    """
    from posawesome.posawesome.api.employees import _ensure_terminal_user, _get_user_doc

    profile_name = _text(_doc_value(profile_doc, "name"))
    acting_user = _text(getattr(frappe.session, "user", ""))
    if not acting_user:
        frappe.throw(frappe._("A signed-in cashier is required for this action."))

    _ensure_terminal_user(profile_name, acting_user)
    _get_user_doc(acting_user)
    return acting_user


def _require_open_shift(profile_doc, acting_user):
    """The open POS Opening Shift this deposit belongs to.

    Money that enters the drawer outside a shift has no corte to land in, so
    there is no honest way to record it. `check_opening_shift`'s filters,
    repeated here rather than imported, because that function returns a whole
    payload and this only needs the name.
    """
    profile_name = _text(_doc_value(profile_doc, "name"))
    rows = frappe.get_all(
        "POS Opening Shift",
        filters={
            "user": acting_user,
            "pos_closing_shift": ["is", "not set"],
            "docstatus": 1,
            "status": "Open",
        },
        fields=["name", "pos_profile"],
        order_by="period_start_date desc",
        limit_page_length=1,
    )
    if not rows:
        frappe.throw(
            frappe._("Open a shift on this register before taking a deposit.")
        )
    shift = rows[0]
    if _text(shift.get("pos_profile")) != profile_name:
        frappe.throw(
            frappe._(
                "Your open shift belongs to POS Profile {0}. Close it before "
                "taking a deposit on {1}."
            ).format(shift.get("pos_profile"), profile_name)
        )
    return _text(shift.get("name"))


def _profile_payment_modes(profile_doc):
    return [
        _text(_doc_value(row, "mode_of_payment"))
        for row in (_doc_value(profile_doc, "payments") or [])
        if _text(_doc_value(row, "mode_of_payment"))
    ]


def _resolve_mode_of_payment_account(profile_doc, mode_of_payment, company):
    """The account this tender lands in, for THIS company.

    A POS Profile's `payments` rows carry the mode but not the account: the
    account is `Mode of Payment Account.default_account` keyed by mode AND
    company (`opening_readiness._fetch_mode_accounts` says the same thing).
    """
    mode = _text(mode_of_payment)
    if not mode:
        frappe.throw(frappe._("Select a payment method for the deposit."))

    allowed = _profile_payment_modes(profile_doc)
    if allowed and mode not in allowed:
        frappe.throw(
            frappe._("{0} is not a payment method on this register.").format(mode)
        )

    account = _text(
        frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": mode, "parenttype": "Mode of Payment", "company": company},
            "default_account",
        )
    )
    if not account:
        frappe.throw(
            frappe._(
                "Set a default account for payment method {0} in company {1} "
                "before taking deposits."
            ).format(mode, company)
        )
    return account


# ---------------------------------------------------------------------------
# Deposit
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def deposit_stored_value(pos_profile=None, customer=None, amount=0, mode_of_payment=None):
    """Take money in and park it as customer credit.

    A submitted Payment Entry: party = the customer, `paid_to` = the tender's
    account, no references, so the whole amount stays unallocated and
    `get_available_credit` reads it as monedero the very next call.

    THE DRAWER SEES IT. `reference_no` is the open shift's name, which is the
    exact key `closing_processing/data.get_payments_entries` filters on — a
    cash deposit therefore lands in that mode's `expected_amount` on the
    closing reconciliation, signed `+` for a Receive. Dropping the field would
    make the money invisible to the corte while still being in the drawer.
    """
    from frappe.utils import nowdate

    profile_doc = _get_profile_doc(pos_profile)
    _require_customer_cards_enabled(profile_doc)
    acting_user = _require_register_member(profile_doc)
    profile_name = _text(_doc_value(profile_doc, "name"))
    company = _text(_doc_value(profile_doc, "company"))

    customer = _text(customer)
    if not customer:
        frappe.throw(frappe._("Select a customer before taking a deposit."))

    deposit_amount = _normalize_amount(amount)
    if deposit_amount <= 0:
        frappe.throw(frappe._("Deposit amount must be greater than zero."))

    from posawesome.posawesome.api._scope import (
        assert_company,
        assert_customer_in_profile,
        assert_profile,
    )

    assert_profile(acting_user, profile_name)
    assert_company(acting_user, company)
    assert_customer_in_profile(acting_user, customer, profile_name)

    if not frappe.db.exists("Customer", customer):
        frappe.throw(frappe._("Customer {0} does not exist.").format(customer))

    shift_name = _require_open_shift(profile_doc, acting_user)
    paid_to = _resolve_mode_of_payment_account(profile_doc, mode_of_payment, company)

    from erpnext.accounts.party import get_party_account

    paid_from = _text(get_party_account("Customer", customer, company))
    if not paid_from:
        frappe.throw(
            frappe._("No receivable account is set for company {0}.").format(company)
        )

    posting_date = nowdate()
    payment_entry = frappe.get_doc(
        {
            "doctype": "Payment Entry",
            "payment_type": "Receive",
            "posting_date": posting_date,
            "company": company,
            "party_type": "Customer",
            "party": customer,
            "paid_from": paid_from,
            "paid_to": paid_to,
            "paid_amount": deposit_amount,
            "received_amount": deposit_amount,
            "mode_of_payment": _text(mode_of_payment),
            # The corte's join key — see this function's docstring.
            "reference_no": shift_name,
            "reference_date": posting_date,
        }
    )
    payment_entry.flags.ignore_permissions = True

    from posawesome.posawesome.api._perms import account_perm_bypass

    with account_perm_bypass():
        payment_entry.save()
        payment_entry.submit()

    summary = get_stored_value_summary(customer=customer, company=company)
    return {
        "payment_entry": payment_entry.name,
        "customer": customer,
        "company": company,
        "amount": deposit_amount,
        "mode_of_payment": _text(mode_of_payment),
        "pos_opening_shift": shift_name,
        "posting_date": posting_date,
        "balance": summary.get("available_amount", 0),
    }


# ---------------------------------------------------------------------------
# Cashback
# ---------------------------------------------------------------------------


def _loyalty_details(customer, company, loyalty_program, current_transaction_amount=0):
    from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
        get_loyalty_program_details_with_points,
    )

    return get_loyalty_program_details_with_points(
        customer,
        loyalty_program,
        company=company,
        silent=True,
        # `make_loyalty_point_entry` reads the customer's WHOLE history to pick
        # the tier, expired entries included. Reading it any other way would
        # preview a tier the accrual will not use.
        include_expired_entry=True,
        current_transaction_amount=current_transaction_amount,
    )


def _customer_loyalty_program(customer):
    return _text(frappe.db.get_value("Customer", customer, "loyalty_program"))


@frappe.whitelist(methods=["GET", "POST"])
def get_cashback_preview(customer=None, company=None, eligible_amount=0):
    """«Acumula $Y con esta compra», computed the way the accrual will be.

    Line for line from `SalesInvoice.make_loyalty_point_entry`:

        collection_factor = lp_details.collection_factor or 1.0
        points_earned     = cint(eligible_amount / collection_factor)

    `cint` TRUNCATES, and the tier is chosen with the sale's own amount folded
    into total spent (`current_transaction_amount`), so a purchase that crosses
    a tier boundary previews at the tier it will actually earn. A preview that
    disagreed with the posted accrual would be worse than no preview: the
    cashier reads it aloud.

    The programme's own date window is honoured too — `make_loyalty_point_entry`
    writes nothing outside `from_date`..`to_date`, so neither does this.
    """
    from frappe.utils import cint, getdate, nowdate

    customer = _text(customer)
    company = _text(company)
    if not customer:
        frappe.throw(frappe._("Customer is required to preview cashback."))
    if not company:
        frappe.throw(frappe._("Company is required to preview cashback."))

    absent = {
        "customer": customer,
        "company": company,
        "enrolled": False,
        "program": None,
        "points": 0,
        "value": 0.0,
        "collection_factor": 0.0,
        "conversion_factor": 0.0,
        "eligible_amount": _normalize_amount(eligible_amount),
    }

    loyalty_program = _customer_loyalty_program(customer)
    if not loyalty_program:
        return absent

    amount = _normalize_amount(eligible_amount)
    details = _loyalty_details(customer, company, loyalty_program, current_transaction_amount=amount)
    if not details:
        return absent

    posting_date = nowdate()
    from_date = details.get("from_date")
    to_date = details.get("to_date")
    if from_date and getdate(from_date) > getdate(posting_date):
        return dict(absent, enrolled=True, program=loyalty_program)
    if to_date and getdate(to_date) < getdate(posting_date):
        return dict(absent, enrolled=True, program=loyalty_program)

    collection_factor = float(details.get("collection_factor") or 0) or 1.0
    conversion_factor = float(details.get("conversion_factor") or 0)
    points = cint(amount / collection_factor) if amount > 0 else 0

    return {
        "customer": customer,
        "company": company,
        "enrolled": True,
        "program": loyalty_program,
        "points": points,
        "value": _normalize_amount(points * conversion_factor),
        "collection_factor": collection_factor,
        "conversion_factor": conversion_factor,
        "eligible_amount": amount,
    }


@frappe.whitelist(methods=["POST"])
def enroll_customer_card(pos_profile=None, customer=None):
    """One tap: put the customer on the register's designated programme.

    Enrolment IS `Customer.loyalty_program` — there is no separate membership
    record — so this refuses rather than overwrites when the customer already
    carries a different one, and says which.
    """
    profile_doc = _get_profile_doc(pos_profile)
    _require_customer_cards_enabled(profile_doc)
    acting_user = _require_register_member(profile_doc)
    profile_name = _text(_doc_value(profile_doc, "name"))
    company = _text(_doc_value(profile_doc, "company"))

    customer = _text(customer)
    if not customer:
        frappe.throw(frappe._("Select a customer before activating a card."))

    program = _text(_doc_value(profile_doc, "posa_customer_card_program"))
    if not program:
        frappe.throw(
            frappe._(
                "No cashback program is set on POS Profile {0}. Set "
                "«Customer Card Program» before activating cards."
            ).format(profile_name)
        )

    from posawesome.posawesome.api._scope import (
        assert_company,
        assert_customer_in_profile,
        assert_profile,
    )

    assert_profile(acting_user, profile_name)
    assert_company(acting_user, company)
    assert_customer_in_profile(acting_user, customer, profile_name)

    if not frappe.db.exists("Customer", customer):
        frappe.throw(frappe._("Customer {0} does not exist.").format(customer))

    # ERPNext rejects the accrual at submit when the programme belongs to
    # another company ("The Loyalty Program isn't valid for the selected
    # company"). Refusing here means the cashier learns it now, not at Cobro.
    program_company = _text(frappe.db.get_value("Loyalty Program", program, "company"))
    if program_company and company and program_company != company:
        frappe.throw(
            frappe._("Cashback program {0} belongs to company {1}, not {2}.").format(
                program, program_company, company
            )
        )

    current = _customer_loyalty_program(customer)
    if current and current != program:
        frappe.throw(
            frappe._(
                "{0} already has cashback program {1}. Remove it before "
                "activating {2}."
            ).format(customer, current, program)
        )

    already = current == program
    if not already:
        frappe.db.set_value("Customer", customer, "loyalty_program", program)

    return {
        "customer": customer,
        "program": program,
        "enrolled": True,
        "already_enrolled": already,
    }


# ---------------------------------------------------------------------------
# The unified ledger
# ---------------------------------------------------------------------------


def _movement_sort_key(row):
    return (
        _text(row.get("posting_date")),
        _text(row.get("creation")),
        _text(row.get("reference_name")),
    )


def _deposit_movements(customer, company, limit):
    """Money the customer paid in that was not spent on an invoice at the till.

    A Receive Payment Entry with no allocations is a deposit; one with
    allocations is an invoice being paid, and only its UNALLOCATED remainder
    ever reached the monedero.
    """
    from frappe.utils import flt

    rows = frappe.get_all(
        "Payment Entry",
        filters={
            "docstatus": 1,
            "payment_type": "Receive",
            "party_type": "Customer",
            "party": customer,
            "company": company,
        },
        fields=[
            "name",
            "posting_date",
            "creation",
            "paid_amount",
            "unallocated_amount",
            "mode_of_payment",
            "owner",
        ],
        order_by="posting_date desc, creation desc",
        limit_page_length=limit,
    )
    if not rows:
        return []

    names = [row.get("name") for row in rows if row.get("name")]
    allocated = {
        _text(ref.get("parent"))
        for ref in frappe.get_all(
            "Payment Entry Reference",
            filters={"parent": ["in", names], "parenttype": "Payment Entry"},
            fields=["parent"],
        )
    }

    movements = []
    for row in rows:
        name = _text(row.get("name"))
        amount = (
            _normalize_amount(row.get("unallocated_amount"))
            if name in allocated
            else _normalize_amount(row.get("paid_amount"))
        )
        if flt(amount) <= 0:
            continue
        movements.append(
            {
                "type": "deposit",
                "label": frappe._("Deposit"),
                "amount": amount,
                "posting_date": row.get("posting_date"),
                "creation": row.get("creation"),
                "reference_doctype": "Payment Entry",
                "reference_name": name,
                "mode_of_payment": row.get("mode_of_payment"),
                "cashier": row.get("owner"),
            }
        )
    return movements


def _credit_note_movements(customer, company, limit):
    rows = frappe.get_all(
        "Sales Invoice",
        filters={
            "docstatus": 1,
            "is_return": 1,
            "customer": customer,
            "company": company,
        },
        fields=["name", "posting_date", "creation", "grand_total", "owner"],
        order_by="posting_date desc, creation desc",
        limit_page_length=limit,
    )
    movements = []
    for row in rows:
        amount = abs(_normalize_amount(row.get("grand_total")))
        if amount <= 0:
            continue
        movements.append(
            {
                "type": "credit_note",
                "label": frappe._("Credit note"),
                "amount": amount,
                "posting_date": row.get("posting_date"),
                "creation": row.get("creation"),
                "reference_doctype": "Sales Invoice",
                "reference_name": row.get("name"),
                "cashier": row.get("owner"),
            }
        )
    return movements


def _redemption_movements(customer, company, limit):
    """Sales that were paid, wholly or partly, out of the monedero.

    `posa_redeemed_customer_credit` is patch-only schema
    (`add_customer_credit_invoice_fields`), so a site that has not migrated
    simply contributes no rows rather than raising.
    """
    movements = []
    for doctype in ("Sales Invoice", "POS Invoice"):
        if not frappe.db.exists("DocType", doctype):
            continue
        if not frappe.db.has_column(doctype, "posa_redeemed_customer_credit"):
            continue
        rows = frappe.get_all(
            doctype,
            filters={
                "docstatus": 1,
                "customer": customer,
                "company": company,
                "posa_redeemed_customer_credit": [">", 0],
            },
            fields=[
                "name",
                "posting_date",
                "creation",
                "posa_redeemed_customer_credit",
                "owner",
            ],
            order_by="posting_date desc, creation desc",
            limit_page_length=limit,
        )
        for row in rows:
            amount = _normalize_amount(row.get("posa_redeemed_customer_credit"))
            if amount <= 0:
                continue
            movements.append(
                {
                    "type": "monedero_payment",
                    "label": frappe._("Paid with wallet"),
                    "amount": -amount,
                    "posting_date": row.get("posting_date"),
                    "creation": row.get("creation"),
                    "reference_doctype": doctype,
                    "reference_name": row.get("name"),
                    "cashier": row.get("owner"),
                }
            )
    return movements


def _cashback_movements(customer, company, loyalty_program, conversion_factor, limit):
    if not loyalty_program:
        return []

    rows = frappe.get_all(
        "Loyalty Point Entry",
        filters={
            "customer": customer,
            "company": company,
            "loyalty_program": loyalty_program,
        },
        fields=[
            "name",
            "posting_date",
            "creation",
            "loyalty_points",
            "purchase_amount",
            "invoice",
            "invoice_type",
            "redeem_against",
            "owner",
        ],
        order_by="posting_date desc, creation desc",
        limit_page_length=limit,
    )

    movements = []
    for row in rows:
        points = _to_int(row.get("loyalty_points"))
        if not points:
            continue
        spent = points < 0
        movements.append(
            {
                "type": "cashback_spent" if spent else "cashback_earned",
                "label": frappe._("Cashback used") if spent else frappe._("Cashback earned"),
                # Pesos, so one column can carry every row; the points are
                # alongside for the screens that name them.
                "amount": _normalize_amount(points * conversion_factor),
                "points": points,
                "posting_date": row.get("posting_date"),
                "creation": row.get("creation"),
                "reference_doctype": _text(row.get("invoice_type")) or "Loyalty Point Entry",
                "reference_name": _text(row.get("invoice")) or _text(row.get("name")),
                "cashier": row.get("owner"),
            }
        )
    return movements


@frappe.whitelist(methods=["GET", "POST"])
def get_customer_wallet(customer=None, company=None, limit=None):
    """Both halves of the customer's value, plus one ledger that explains them.

    `stored_value` and `cashback` are reported apart on purpose: they are
    different promises, and a screen that added them together would tell the
    customer they can spend points at the till today.
    """
    customer = _text(customer)
    company = _text(company)
    if not customer:
        frappe.throw(frappe._("Customer is required to fetch the wallet."))
    if not company:
        frappe.throw(frappe._("Company is required to fetch the wallet."))

    cap = _to_int(limit) or WALLET_MOVEMENTS_LIMIT
    cap = max(1, min(cap, WALLET_MOVEMENTS_LIMIT))

    summary = get_stored_value_summary(customer=customer, company=company)

    loyalty_program = _customer_loyalty_program(customer)
    points = 0
    conversion_factor = 0.0
    if loyalty_program:
        details = _loyalty_details(customer, company, loyalty_program)
        points = _to_int(details.get("loyalty_points"))
        conversion_factor = float(details.get("conversion_factor") or 0)

    movements = []
    movements.extend(_deposit_movements(customer, company, cap))
    movements.extend(_credit_note_movements(customer, company, cap))
    movements.extend(_redemption_movements(customer, company, cap))
    movements.extend(
        _cashback_movements(customer, company, loyalty_program, conversion_factor, cap)
    )
    movements.sort(key=_movement_sort_key, reverse=True)
    truncated = len(movements) > cap
    movements = movements[:cap]

    return {
        "customer": customer,
        "company": company,
        "stored_value": {
            "balance": summary.get("available_amount", 0),
            "source_count": summary.get("source_count", 0),
            "sources": summary.get("sources", []),
        },
        "cashback": {
            "enrolled": bool(loyalty_program),
            "program": loyalty_program or None,
            "points": points,
            "value": _normalize_amount(points * conversion_factor),
            "conversion_factor": conversion_factor,
        },
        "movements": movements,
        "movements_limit": cap,
        "movements_truncated": truncated,
    }
