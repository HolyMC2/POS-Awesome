import frappe
import json
from frappe import _
from frappe.utils import nowdate, flt, fmt_money, cint
from erpnext.accounts.party import get_party_account
from erpnext.accounts.doctype.payment_reconciliation.payment_reconciliation import reconcile_dr_cr_note
from erpnext.accounts.utils import get_account_currency, reconcile_against_document
from erpnext.setup.utils import get_exchange_rate
from posawesome.posawesome.api.m_pesa import submit_mpesa_payment
from posawesome.posawesome.api.payment_processing.creation import create_payment_entry
from posawesome.posawesome.api.payment_processing.integrity import lock_payment_party, payment_amount, run_reconciliation
from posawesome.posawesome.api.idempotency import (
    find_payment_entries_by_client_request_id,
    normalize_client_request_id,
    payment_method_request_id,
)
from posawesome.posawesome.api._scope import (
    assert_company,
    assert_customer_in_profile,
    assert_profile,
)


def _amounts_match(left, right):
    return abs(flt(left) - flt(right)) < 0.0001


def _get_entry_amount(entry):
    if entry.get("payment_type") == "Receive":
        return flt(entry.get("received_amount"))
    if entry.get("payment_type") == "Pay":
        return flt(entry.get("paid_amount"))
    return flt(entry.get("paid_amount")) or flt(entry.get("received_amount"))


def _get_value(source, key, default=None):
    if isinstance(source, dict):
        return source.get(key, default)

    getter = getattr(source, "get", None)
    if callable(getter):
        try:
            return getter(key, default)
        except TypeError:
            pass

    return getattr(source, key, default)


def _expected_lookup_errors():
    errors = [PermissionError]

    for attr_name in ("DoesNotExistError", "PermissionError"):
        error_type = getattr(frappe, attr_name, None)
        if isinstance(error_type, type) and error_type not in errors:
            errors.append(error_type)

    return tuple(errors)


def _assert_accounting_document_access(
    doctype,
    name,
    company,
    party,
    party_type,
    pos_profile,
):
    """Validate a client-selected accounting document before using it."""
    if not name:
        frappe.throw(_("Accounting document name is required"))

    frappe.has_permission(doctype, "read", name, throw=True)
    document = frappe.get_cached_doc(doctype, name)

    if _get_value(document, "company") != company:
        frappe.throw(
            _("Not permitted to use {0} {1} for company {2}.").format(
                doctype,
                name,
                company,
            ),
            frappe.PermissionError,
        )

    document_party_type = None
    document_party = None
    if doctype == "Sales Invoice":
        document_party_type = "Customer"
        document_party = _get_value(document, "customer")
    elif doctype == "Purchase Invoice":
        document_party_type = "Supplier"
        document_party = _get_value(document, "supplier")
    elif doctype == "Payment Entry":
        document_party_type = _get_value(document, "party_type")
        document_party = _get_value(document, "party")

    if document_party_type != party_type or document_party != party:
        frappe.throw(
            _("Not permitted to use {0} {1} for party {2}.").format(
                doctype,
                name,
                party,
            ),
            frappe.PermissionError,
        )

    if document_party_type == "Customer":
        assert_customer_in_profile(frappe.session.user, document_party, pos_profile)

    return document


def _selected_payment_doctype(payment, party_type):
    invoice_type = "Purchase Invoice" if party_type == "Supplier" else "Sales Invoice"
    doctype = payment.get("voucher_type") or (invoice_type if cint(payment.get("is_credit_note")) else "Payment Entry")
    if doctype not in ("Payment Entry", invoice_type):
        frappe.throw(_("Selected payment document does not match the party type."), frappe.PermissionError)
    return doctype


def _assert_selected_accounting_documents(data, company, party, party_type, pos_profile):
    expected_invoice_doctype = "Purchase Invoice" if party_type == "Supplier" else "Sales Invoice"

    for invoice in data.get("selected_invoices") or []:
        doctype = invoice.get("voucher_type") or "Sales Invoice"
        if doctype != expected_invoice_doctype:
            frappe.throw(
                _("Not permitted to use {0} for party type {1}.").format(doctype, party_type),
                frappe.PermissionError,
            )
        _assert_accounting_document_access(
            doctype,
            invoice.get("voucher_no") or invoice.get("name"),
            company,
            party,
            party_type,
            pos_profile,
        )

    for payment in data.get("selected_payments") or []:
        doctype = _selected_payment_doctype(payment, party_type)
        document = _assert_accounting_document_access(
            doctype,
            payment.get("name"),
            company,
            party,
            party_type,
            pos_profile,
        )
        if doctype == "Payment Entry" and document.get("payment_type") != ("Pay" if party_type == "Supplier" else "Receive"):
            frappe.throw(_("Selected payment has the wrong payment direction for reconciliation."), frappe.PermissionError)


def _to_public_entry(entry):
    return {
        "doctype": _get_value(entry, "doctype"),
        "name": _get_value(entry, "name"),
        "paid_amount": _get_value(entry, "paid_amount"),
        "received_amount": _get_value(entry, "received_amount"),
        "amount": _get_value(entry, "amount"),
        "posting_date": _get_value(entry, "posting_date"),
        "mode_of_payment": _get_value(entry, "mode_of_payment"),
        "party": _get_value(entry, "party"),
        "party_type": _get_value(entry, "party_type"),
        "docstatus": _get_value(entry, "docstatus"),
        "posa_client_request_id": _get_value(entry, "posa_client_request_id"),
        "unallocated_amount": _get_value(entry, "unallocated_amount"),
        "outstanding_amount": _get_value(entry, "outstanding_amount"),
    }



def _to_public_entries(entries):
    return [_to_public_entry(entry) for entry in entries or []]


def _requested_reconciled_amount(payment):
    for fieldname in ("allocated_amount", "amount", "unallocated_amount", "outstanding_amount"):
        value = payment.get(fieldname)
        if value is None:
            continue
        # Invoice balances are signed; selected allocation amounts are not.
        value = abs(flt(value)) if fieldname == "outstanding_amount" else value
        amount = payment_amount(value, allow_zero=True)
        if amount > 0:
            return amount
    return 0


def _get_currency_precision():
    try:
        precision = flt(frappe.db.get_default("currency_precision"))
    except Exception:
        precision = 0
    return precision or 2


def _build_completed_reconciliation_summaries(selected_payments, completed_documents):
    completed_by_name = {
        _get_value(document, "name"): document
        for document in completed_documents or []
        if _get_value(document, "name")
    }
    summaries = []

    for payment in selected_payments or []:
        payment_name = payment.get("name")
        document = completed_by_name.get(payment_name)
        if not document:
            continue

        allocated_amount = _requested_reconciled_amount(payment)
        if not allocated_amount and (
            _get_value(document, "doctype") == "Payment Entry"
            or payment.get("voucher_type") != "Sales Invoice"
        ):
            allocated_amount = max(
                flt(_get_value(document, "paid_amount")) - flt(_get_value(document, "unallocated_amount")),
                0,
            )

        summaries.append(
            {
                "payment_entry": payment_name,
                "allocated_amount": allocated_amount,
            }
        )

    return summaries


def _partition_payment_methods(existing_entries, payment_methods):
    unmatched_entries = list(existing_entries or [])
    matched_entries = []
    missing_payment_methods = []

    for payment_method in payment_methods or []:
        amount = flt(payment_method.get("amount"))
        if not amount:
            continue

        mode_of_payment = payment_method.get("mode_of_payment")
        matched_index = next(
            (
                index
                for index, entry in enumerate(unmatched_entries)
                if cint(entry.get("docstatus")) == 1
                and entry.get("mode_of_payment") == mode_of_payment
                and _amounts_match(_get_entry_amount(entry), amount)
            ),
            None,
        )

        if matched_index is None:
            missing_payment_methods.append(payment_method)
            continue

        matched_entries.append(unmatched_entries.pop(matched_index))

    return matched_entries, missing_payment_methods, unmatched_entries


def _partition_completed_mpesa_payments(selected_mpesa_payments, customer):
    completed_entries = []
    pending_payments = []
    lookup_errors = _expected_lookup_errors()

    for mpesa_payment in selected_mpesa_payments or []:
        payment_name = mpesa_payment.get("name")
        if not payment_name:
            pending_payments.append(mpesa_payment)
            continue

        try:
            mpesa_doc = frappe.get_doc("Mpesa Payment Register", payment_name)
            linked_customer = getattr(mpesa_doc, "customer", None)
            payment_entry_name = getattr(mpesa_doc, "payment_entry", None)
            if (
                cint(getattr(mpesa_doc, "docstatus", 0)) == 1
                and payment_entry_name
                and (not linked_customer or linked_customer == customer)
            ):
                completed_entries.append(frappe.get_doc("Payment Entry", payment_entry_name))
                continue
        except lookup_errors:
            pending_payments.append(mpesa_payment)
            continue
        except Exception as err:
            frappe.log_error(
                "Unexpected M-Pesa replay lookup failure for {0}: {1}\nContext: {2}".format(
                    payment_name,
                    str(err),
                    json.dumps(mpesa_payment, default=str),
                ),
                "POS Payment Replay Check Error",
            )
            raise

        pending_payments.append(mpesa_payment)

    return completed_entries, pending_payments


def _partition_completed_reconciliations(selected_payments):
    completed_docs = []
    pending_payments = []
    lookup_errors = _expected_lookup_errors()

    for payment in selected_payments or []:
        payment_name = payment.get("name")
        if not payment_name:
            pending_payments.append(payment)
            continue

        is_credit_note = cint(payment.get("is_credit_note")) or payment.get("voucher_type") == "Sales Invoice"
        doctype = "Sales Invoice" if is_credit_note else "Payment Entry"

        try:
            payment_doc = frappe.get_doc(doctype, payment_name)
            if is_credit_note:
                if _amounts_match(abs(flt(getattr(payment_doc, "outstanding_amount", 0))), 0):
                    completed_docs.append(payment_doc)
                    continue
            elif flt(getattr(payment_doc, "unallocated_amount", 0)) <= 0:
                completed_docs.append(payment_doc)
                continue
        except lookup_errors:
            pending_payments.append(payment)
            continue
        except Exception as err:
            frappe.log_error(
                "Unexpected payment replay lookup failure for {0}: {1}\nContext: {2}".format(
                    payment_name,
                    str(err),
                    json.dumps(payment, default=str),
                ),
                "POS Payment Replay Check Error",
            )
            raise

        pending_payments.append(payment)

    return completed_docs, pending_payments


@frappe.whitelist(methods=["POST"])
def process_pos_payment(payload):
    operation = json.loads(payload).get("operation")
    if operation == "refund_customer_advance":
        from posawesome.posawesome.api.payment_processing.advance_refunds import refund_customer_advance
        return refund_customer_advance(payload)
    if operation:
        frappe.throw(_("Unsupported POS payment operation."))
    from posawesome.posawesome.api.payment_processing.integrity import retry_before_financial_writes

    return retry_before_financial_writes(_process_pos_payment, payload)


def _process_pos_payment(payload):
    data = json.loads(payload)
    data = frappe._dict(data)
    client_request_id = normalize_client_request_id(data.get("client_request_id"))

    party = data.get("party") or data.get("customer")
    party_type = data.get("party_type") or "Customer"
    payment_type = data.get("payment_type") or ("Pay" if party_type == "Supplier" else "Receive")
    allocation_sign = 1 if payment_type == ("Pay" if party_type == "Supplier" else "Receive") else -1
    if party_type not in ("Customer", "Supplier") or payment_type not in ("Receive", "Pay"):
        frappe.throw(_("Unsupported payment party or direction."))
    for method in data.get("payment_methods") or []:
        method["amount"] = payment_amount(method.get("amount"), allow_zero=True)
    if data.get("exchange_rate") is not None:
        payment_amount(data.exchange_rate)

    # validate data
    if not party:
        frappe.throw(_("Party is required"))
    if not data.currency:
        frappe.throw(_("Currency is required"))
    if not data.pos_profile_name:
        frappe.throw(_("POS Profile is required"))
    if not data.pos_opening_shift_name:
        frappe.throw(_("POS Opening Shift is required"))

    profile = frappe.get_cached_doc("POS Profile", data.pos_profile_name)
    if not profile:
        frappe.throw(_("POS Profile {0} was not found").format(data.pos_profile_name))

    assert_profile(frappe.session.user, profile.name)
    assert_company(frappe.session.user, profile.company)
    if party_type == "Customer":
        assert_customer_in_profile(frappe.session.user, party, profile.name)

    if not cint(profile.get("posa_use_pos_awesome_payments")):
        frappe.throw(_("POS Awesome Payments is not enabled for this POS Profile"))

    company = profile.company
    if not company:
        frappe.throw(_("Company is required"))
    currency = data.currency
    customer = party
    pos_opening_shift_name = data.pos_opening_shift_name
    allow_make_new_payments = cint(profile.get("posa_allow_make_new_payments"))
    allow_reconcile_payments = cint(profile.get("posa_allow_reconcile_payments"))
    allow_mpesa_reconcile_payments = cint(profile.get("posa_allow_mpesa_reconcile_payments"))
    posting_date = data.get("posting_date") or nowdate()
    selected_mpesa_payments = list(data.selected_mpesa_payments or [])
    selected_payments = list(data.selected_payments or [])
    payment_methods = list(data.payment_methods or [])
    for index, method in enumerate(payment_methods):
        method["_client_request_id"] = payment_method_request_id(client_request_id, index)
    allowed_modes = {row.get("mode_of_payment") for row in (profile.get("payments") or [])}
    for method in payment_methods:
        mode = method.get("mode_of_payment")
        if not mode or (allowed_modes and mode not in allowed_modes):
            frappe.throw(_("Mode of payment is not available on this POS Profile."), frappe.PermissionError)

    if payment_methods and flt(data.total_payment_methods) > 0 and not allow_make_new_payments:
        frappe.throw(_("Creating new payments is not enabled for this POS Profile"), frappe.PermissionError)
    if selected_payments and flt(data.total_selected_payments) > 0 and not allow_reconcile_payments:
        frappe.throw(_("Reconciling payments is not enabled for this POS Profile"), frappe.PermissionError)
    if (
        selected_mpesa_payments
        and flt(data.total_selected_mpesa_payments) > 0
        and not allow_mpesa_reconcile_payments
    ):
        frappe.throw(_("Reconciling M-Pesa payments is not enabled for this POS Profile"), frappe.PermissionError)

    _assert_selected_accounting_documents(
        data,
        company,
        party,
        party_type,
        profile.name,
    )

    # Audit r2 P1: the opening shift was taken from the client and used as the
    # Payment Entry reference_no, but never bound to this profile/company/
    # cashier. A cashier could name another shift (or supply an arbitrary
    # reference_no) so the PE lands in someone else's corte, which closing
    # aggregates by reference_no == pos_opening_shift. Bind it to a submitted,
    # open shift the acting cashier owns before any write.
    from posawesome.posawesome.api.shift_terminal import assert_terminal_access
    assert_terminal_access(pos_opening_shift_name, data.get("terminal_id"),
                           data.get("terminal_generation"), data.pop("terminal_token", None))
    _shift = frappe.db.get_value(
        "POS Opening Shift",
        pos_opening_shift_name,
        ["pos_profile", "company", "status", "docstatus", "user"],
        as_dict=True,
        for_update=True,
    )
    if not _shift:
        frappe.throw(
            _("POS Opening Shift {0} was not found").format(pos_opening_shift_name),
            frappe.PermissionError,
        )
    if _shift.get("pos_profile") != profile.name or _shift.get("company") != company:
        frappe.throw(
            _("POS Opening Shift {0} does not belong to this register.").format(
                pos_opening_shift_name
            ),
            frappe.PermissionError,
        )
    from posawesome.posawesome.api.shifts import is_demo_pos_site

    if not is_demo_pos_site():
        if cint(_shift.get("docstatus")) != 1 or _shift.get("status") != "Open":
            frappe.throw(
                _("POS Opening Shift {0} is not open.").format(pos_opening_shift_name),
                frappe.PermissionError,
            )
        if _shift.get("user") != frappe.session.user:
            frappe.throw(
                _("POS Opening Shift {0} belongs to another user.").format(
                    pos_opening_shift_name
                ),
                frappe.PermissionError,
            )

    lock_payment_party(party_type, party)
    # All source/target locks precede the durable receipt's first write, so
    # snapshot conflicts can still restart the whole read-only request safely.
    document_locks = {(row.get("voucher_type") or ("Purchase Invoice" if party_type == "Supplier" else "Sales Invoice"),
                       row.get("voucher_no") or row.get("name")) for row in data.selected_invoices or []}
    document_locks.update((_selected_payment_doctype(row, party_type), row.get("name")) for row in selected_payments)
    for doctype, name in sorted(document_locks, key=lambda pair: (pair[0] == "Payment Entry", pair[0], pair[1] or "")):
        frappe.get_doc(doctype, name, for_update=True)
    request = None
    if selected_payments and flt(data.total_selected_payments) > 0:
        from posawesome.posawesome.api.payment_processing.request_ledger import claim_financial_request
        intent = dict(party_type=party_type, party=party, payment_type=payment_type,
            currency=currency, shift=pos_opening_shift_name, posting_date=data.get("posting_date"),
            invoices=[(row.get("voucher_type") or ("Purchase Invoice" if party_type == "Supplier" else "Sales Invoice"),
                       row.get("voucher_no") or row.get("name")) for row in data.selected_invoices or []],
            payments=[(_selected_payment_doctype(row, party_type), row.get("name"), _requested_reconciled_amount(row))
                      for row in selected_payments],
            methods=[{key: row.get(key) for key in ("mode_of_payment", "amount", "bank_account")} for row in payment_methods],
            mpesa=[row.get("name") for row in selected_mpesa_payments], exchange_rate=data.get("exchange_rate"))
        request = claim_financial_request("reconciliation", client_request_id, company, profile.name, intent)
        if request.response is not None:
            return dict(request.response, replayed=True)
    existing_entries = find_payment_entries_by_client_request_id(client_request_id, for_update=True)
    for existing_entry in existing_entries:
        if existing_entry.get("payment_type") != payment_type:
            frappe.throw(_("Payment request was already recorded with a different payment direction."))
        _assert_accounting_document_access(
            "Payment Entry",
            existing_entry.get("name"),
            company,
            party,
            party_type,
            profile.name,
        )
    matched_existing_entries, pending_payment_methods, unmatched_existing_entries = (
        _partition_payment_methods(
            existing_entries,
            payment_methods,
        )
    )
    draft_entries = [entry for entry in unmatched_existing_entries if cint(entry.get("docstatus")) == 0]
    if draft_entries:
        draft_names = ", ".join(entry.get("name") for entry in draft_entries if entry.get("name"))
        frappe.throw(
            _("Payment request {0} has draft Payment Entry records pending review: {1}").format(
                client_request_id or _("unknown request"),
                draft_names or _("draft payment entries"),
            )
        )

    is_replay_attempt = bool(existing_entries)
    if unmatched_existing_entries:
        frappe.throw(_("Payment request was already recorded with different payment methods or amounts."))
    if is_replay_attempt:
        # Bind the replay to the SAME invoice set. A retry that reuses the
        # client_request_id but targets different invoices would get the
        # cached Payment Entries back and believe those invoices were paid
        # — double-allocating the original cash. Compare the cached
        # entries' references against the invoices in this request.
        requested_invoices = {
            (inv.get("voucher_no") or inv.get("name"))
            for inv in (data.selected_invoices or [])
            if inv.get("voucher_no") or inv.get("name")
        }
        entry_names = [entry.get("name") for entry in existing_entries if entry.get("name")]
        if entry_names:
            referenced_invoices = {
                row.reference_name
                for row in frappe.get_all(
                    "Payment Entry Reference",
                    filters={"parent": ["in", entry_names]},
                    fields=["reference_name"],
                )
                if row.reference_name
            }
            if referenced_invoices and not referenced_invoices <= requested_invoices:
                frappe.throw(
                    _(
                        "Payment request {0} was already recorded against different "
                        "invoices ({1}). Refresh the POS and retry the payment."
                    ).format(
                        client_request_id,
                        ", ".join(sorted(referenced_invoices - requested_invoices)),
                    )
                )
    completed_mpesa_entries, pending_mpesa_payments = ([], [])
    if is_replay_attempt and allow_mpesa_reconcile_payments and data.total_selected_mpesa_payments > 0:
        completed_mpesa_entries, pending_mpesa_payments = _partition_completed_mpesa_payments(
            selected_mpesa_payments,
            customer,
        )
    else:
        pending_mpesa_payments = selected_mpesa_payments

    completed_reconciliations, pending_selected_payments = ([], [])
    if not request and is_replay_attempt and allow_reconcile_payments and data.total_selected_payments > 0:
        completed_reconciliations, pending_selected_payments = _partition_completed_reconciliations(
            selected_payments
        )
    else:
        pending_selected_payments = selected_payments

    completed_reconciliation_summaries = _build_completed_reconciliation_summaries(
        selected_payments,
        completed_reconciliations,
    )
    if request:
        for payment in selected_payments:
            key = _selected_payment_doctype(payment, party_type) + ":" + payment["name"]
            completed = request.completed(key)
            if completed:
                completed_reconciliation_summaries.append(completed["summary"])
                completed_reconciliations.append(completed["entry"])
        pending_selected_payments = [payment for payment in pending_selected_payments
            if not request.completed(_selected_payment_doctype(payment, party_type) + ":" + payment["name"])]
    cached_entries = list(matched_existing_entries) + completed_mpesa_entries + completed_reconciliations
    if (
        existing_entries
        and not pending_payment_methods
        and not unmatched_existing_entries
        and not pending_mpesa_payments
        and not pending_selected_payments
    ):
        replay_response = {
            "new_payments_entry": _to_public_entries(matched_existing_entries),
            "all_payments_entry": _to_public_entries(cached_entries),
            "reconciled_payments": completed_reconciliation_summaries,
            "errors": [],
            "replayed": True,
        }
        if request:
            request.finish(replay_response)
        return replay_response

    # prepare invoice list once so allocations can update remaining amounts
    remaining_invoices = []

    def add_remaining_invoices(invoices):
        seen = set()
        for invoice in invoices or []:
            invoice_name = invoice.get("voucher_no") or invoice.get("name")
            voucher_type = invoice.get("voucher_type") or "Sales Invoice"
            if not invoice_name or (voucher_type, invoice_name) in seen:
                continue
            seen.add((voucher_type, invoice_name))
            document = frappe.get_doc(voucher_type, invoice_name, for_update=True)
            outstanding = flt(document.outstanding_amount)
            conversion_rate = flt(document.conversion_rate) or 1
            if outstanding * allocation_sign < 0:
                frappe.throw(_("Selected invoice balance does not match the payment direction."))
            if not outstanding:
                continue
            remaining_invoices.append(
                {
                    "name": invoice_name,
                    "outstanding_amount": outstanding,
                    "voucher_type": voucher_type,
                    "conversion_rate": conversion_rate,
                    "due_date": document.get("due_date") or document.get("posting_date"),
                }
            )

    add_remaining_invoices(data.selected_invoices)

    new_payments_entry = []
    all_payments_entry = list(cached_entries)
    reconciled_payments = list(completed_reconciliation_summaries)
    errors = []
    exchange_gain_loss_summary = []
    net_gain_loss = 0

    # first process mpesa payments
    if (
        allow_mpesa_reconcile_payments
        and len(pending_mpesa_payments) > 0
        and data.total_selected_mpesa_payments > 0
    ):
        for mpesa_payment in pending_mpesa_payments:
            frappe.db.savepoint("pos_mpesa_payment")
            try:
                new_mpesa_payment = submit_mpesa_payment(
                    mpesa_payment.get("name"), customer, expected_company=company
                )
                new_payments_entry.append(new_mpesa_payment)
                all_payments_entry.append(new_mpesa_payment)
            except Exception as e:
                frappe.db.rollback(save_point="pos_mpesa_payment")
                errors.append(str(e))

    # then reconcile selected payments with invoices
    if allow_reconcile_payments and len(pending_selected_payments) > 0 and data.total_selected_payments > 0:
        for pay in pending_selected_payments:
            frappe.db.savepoint("pos_reconcile_payment")
            balances_before = [dict(invoice) for invoice in remaining_invoices]
            payment_name = pay.get("name")
            try:
                from posawesome.posawesome.api.payment_processing.source_reconciliation import reconcile_source
                doctype = _selected_payment_doctype(pay, party_type)
                source = frappe.get_doc(doctype, payment_name, for_update=True)
                source, allocated = reconcile_source(source, remaining_invoices, company, party_type, party,
                    _requested_reconciled_amount(pay) or None)
                summary = {"payment_entry": payment_name, "allocated_amount": allocated}
                if request:
                    request.complete_step(doctype + ":" + payment_name,
                        {"summary": summary, "entry": _to_public_entry(source)})
                reconciled_payments.append(summary)
                all_payments_entry.append(source)
            except Exception as e:
                frappe.db.rollback(save_point="pos_reconcile_payment")
                remaining_invoices[:] = balances_before
                errors.append(str(e))
                frappe.log_error(f"Error allocating payment {payment_name}: {str(e)}", "POS Payment Error")

    # then process the new payments and allocate invoices
    if allow_make_new_payments and len(pending_payment_methods) > 0 and data.total_payment_methods > 0:
        for payment_method in pending_payment_methods:
            frappe.db.savepoint("pos_new_payment")
            try:
                amount = flt(payment_method.get("amount"))
                if not amount:
                    continue
                mode_of_payment = payment_method.get("mode_of_payment")
                payment_entry = create_payment_entry(
                    company=company,
                    currency=currency,
                    amount=amount,
                    mode_of_payment=mode_of_payment,
                    customer=customer,
                    party=party,
                    party_type=party_type,
                    payment_type=payment_type,
                    exchange_rate=data.get("exchange_rate"),
                    posting_date=posting_date,
                    # Derive from the validated shift, never the client — a
                    # POS payment's reference_no is how closing attributes it
                    # to the corte (audit r2 P1).
                    reference_no=pos_opening_shift_name,
                    reference_date=data.get("reference_date") or posting_date,
                    cost_center=profile.get("cost_center"),
                    submit=0,
                    client_request_id=payment_method.get("_client_request_id"),
                    bank_account=payment_method.get("bank_account"),
                )

                party_account = get_party_account(party_type, party, company)
                party_account_currency = get_account_currency(party_account)

                first_inv = remaining_invoices[0] if remaining_invoices else {}
                exchange_rate_val = flt(data.get("exchange_rate", 1))
                precision = _get_currency_precision()

                bank_currency = (
                    getattr(payment_entry, "paid_to_account_currency", None)
                    if payment_type == "Receive"
                    else getattr(payment_entry, "paid_from_account_currency", None)
                ) or currency
                bank_amount = (
                    getattr(payment_entry, "received_amount", None)
                    if payment_type == "Receive"
                    else getattr(payment_entry, "paid_amount", None)
                )
                bank_amount = flt(bank_amount or getattr(payment_entry, "amount", 0) or amount, precision)

                company_currency = (
                    frappe.get_cached_value("Company", company, "default_currency")
                    or getattr(payment_entry, "company_currency", None)
                    or currency
                )

                # The Payment Entry already contains the conversion to party currency.
                # ERPNext invoice outstanding_amount uses that currency as well.
                from posawesome.posawesome.api.payment_processing.allocations import allocate_payment_references

                total_allocated, party_amount = allocate_payment_references(
                    payment_entry, remaining_invoices, party_type, payment_type,
                    party_account_currency, precision,
                )
                payment_entry.total_allocated_amount = total_allocated
                payment_entry.unallocated_amount = flt(party_amount - total_allocated, precision)

                invoice_exchange_rate = flt(first_inv.get("conversion_rate", 0))
                ref_names = ", ".join(r.reference_name for r in payment_entry.references)
                verb = "received" if payment_type == "Receive" else "paid"
                party_label = "from" if payment_type == "Receive" else "to"
                party_label_amount = party_amount
                invoice_type = "Sales Invoice" if party_type == "Customer" else "Purchase Invoice"
                reference_no_str = data.get("reference_no") or pos_opening_shift_name
                reference_date_str = data.get("reference_date") or posting_date

                if invoice_exchange_rate and not _amounts_match(invoice_exchange_rate, exchange_rate_val):
                    rate_note = f"\nExchange Rate: 1 {bank_currency} = {exchange_rate_val} {party_account_currency}"
                else:
                    rate_note = ""

                payment_entry.remarks = (
                    f"Amount {bank_currency} {flt(bank_amount)} {verb} {party_label} {party}\n"
                    f"Transaction reference no {reference_no_str or ''} dated {reference_date_str or ''}\n"
                    f"Amount {party_account_currency} {flt(party_label_amount)} against {invoice_type} {ref_names}{rate_note}"
                )

                pe_exchange_rate = (
                    getattr(payment_entry, "target_exchange_rate", None)
                    if payment_type == "Receive"
                    else getattr(payment_entry, "source_exchange_rate", None)
                )

                # Build a map of reference rows by invoice name
                ref_map = {}
                for ref in payment_entry.references:
                    ref_map[ref.reference_name] = ref

                # Calculate gain/loss for ERPNext reconciliation and UI notification
                exchange_gain_loss_summary = []
                net_gain_loss = 0
                for inv in remaining_invoices:
                    inv_rate = flt(inv.get("conversion_rate")) or 1
                    if inv_rate and pe_exchange_rate and inv_rate != pe_exchange_rate:
                        ref = ref_map.get(inv["name"])
                        if ref and ref.allocated_amount:
                            # Gain/loss in company currency using ERPNext pattern:
                            # base at payment rate - base at reference/invoice rate
                            # allocated_amount is in party account currency
                            ref_rate = flt(ref.exchange_rate) or 1
                            allocated_base = flt(ref.allocated_amount * pe_exchange_rate, precision)
                            allocated_base_at_ref_rate = flt(ref.allocated_amount * ref_rate, precision)
                            gl_value = allocated_base - allocated_base_at_ref_rate
                            ref.exchange_gain_loss = flt(gl_value, precision)
                        else:
                            inv_doc = frappe.get_cached_doc(inv.get("voucher_type") or "Sales Invoice", inv["name"])
                            # Fallback to full invoice amount in company currency
                            allocated_base = flt(inv_doc.base_rounded_total or inv_doc.base_grand_total, precision)
                            gl_value = 0
                        if gl_value:
                            amount = abs(gl_value)
                            gl_type = "gain" if gl_value > 0 else "loss"
                            exchange_gain_loss_summary.append({
                                "payment": payment_entry.name,
                                "invoice": inv["name"],
                                "amount": amount,
                                "currency": company_currency,
                                "type": gl_type
                            })
                            net_gain_loss += gl_value

                # Add gain/loss info to Payment Entry remarks (with deduplication)
                if exchange_gain_loss_summary:
                    gl_parts = []
                    for item in exchange_gain_loss_summary:
                        gl_parts.append(f"{item['type'].title()}: {item['amount']} {item['currency']}")
                    gl_remark = f"Exchange Gain/Loss: {'; '.join(gl_parts)}"
                    if gl_remark not in (payment_entry.remarks or ""):
                        payment_entry.remarks += f"\n{gl_remark}"

                payment_entry.save(ignore_permissions=True)
                previous_ignore_permissions = frappe.flags.ignore_permissions
                frappe.flags.ignore_permissions = True
                try:
                    payment_entry.submit()
                finally:
                    frappe.flags.ignore_permissions = previous_ignore_permissions

                new_payments_entry.append(payment_entry)
                all_payments_entry.append(payment_entry)
            except Exception as e:
                frappe.db.rollback(save_point="pos_new_payment")
                errors.append(str(e))
                frappe.log_error(f"Error creating payment entry: {str(e)}", "POS Payment Error")

    # Old allocation logic disabled
    # then show the results
    msg = ""
    if len(new_payments_entry) > 0:
        msg += "<h4>New Payments</h4>"
        msg += "<table class='table table-bordered'>"
        msg += "<thead><tr><th>Payment Entry</th><th>Amount</th></tr></thead>"
        msg += "<tbody>"
        for payment_entry in new_payments_entry:
            msg += "<tr><td>{0}</td><td>{1}</td></tr>".format(
                payment_entry.get("name"),
                payment_entry.get("paid_amount") or payment_entry.get("amount"),
            )
        msg += "</tbody>"
        msg += "</table>"
    if len(reconciled_payments) > 0:
        msg += "<h4>Reconciled Payments</h4>"
        msg += "<table class='table table-bordered'>"
        msg += "<thead><tr><th>Payment Entry</th><th>Allocated</th></tr></thead>"
        msg += "<tbody>"
        for payment in reconciled_payments:
            msg += "<tr><td>{0}</td><td>{1}</td></tr>".format(
                payment.get("payment_entry"),
                payment.get("allocated_amount"),
            )
        msg += "</tbody>"
        msg += "</table>"
    if len(errors) > 0:
        msg += "<h4>Errors</h4>"
        msg += "<table class='table table-bordered'>"
        msg += "<thead><tr><th>Error</th></tr></thead>"
        msg += "<tbody>"
        for error in errors:
            msg += "<tr><td>{0}</td></tr>".format(error)
        msg += "</tbody>"
        msg += "</table>"
    if len(msg) > 0:
        frappe.msgprint(msg)

    response = {
        "new_payments_entry": _to_public_entries(new_payments_entry),
        "all_payments_entry": _to_public_entries(all_payments_entry),
        "reconciled_payments": reconciled_payments,
        "errors": errors,
        "exchange_gain_loss_summary": exchange_gain_loss_summary,
        "net_gain_loss": net_gain_loss,
    }

    if request:
        request.finish(response, complete=not errors)
    return response
