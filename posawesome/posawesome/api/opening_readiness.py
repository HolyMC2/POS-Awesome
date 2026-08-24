# Copyright (c) 2026, doco contributors
"""What the register can VERIFY before it opens (roadmap §5.1, artboard `Apertura.dc.html`).

The Apertura panel's promise is *«no se pregunta, se comprueba»*, and until
this module existed it could not keep it at the moment that promise is worth
something. Its ten points are assembled by `readinessSnapshot.ts` out of the
register's own caches, and at a FIRST opening those caches are empty BY
CONSTRUCTION: the opening payload is written when a shift opens, so the one
screen that opens the first shift has nothing to read. Nine of the ten points
rendered «no verificado» — including the point with money behind it, *«una
caja no abre si a una forma de pago le falta cuenta»*, which was unanswerable
from the browser for a second reason: the account lives in `Mode of Payment
Account`, keyed by mode AND company, and no opening payload carries it.

Everything below is a fact the server already holds and the browser does not.
Nothing below is a fact the browser holds and the server does not — devices,
the offline cache and the floor stay where they are, because a server that
claimed to know whether this counter's printer answered would be inventing
exactly the green tick the panel exists to refuse.

## The contract with the client

Keys, never sentences. The SPA holds `es.csv` and `openingReadiness.ts` owns
what an answer MEANS; this module only says what is true. It returns
snake_case groups that map one-to-one onto that module's input types, and a
group it could not compute is OMITTED rather than guessed — an absent group
renders as «no verificado», which is the same degradation as a server that
never answered at all. Half an answer must look like no answer, never like a
pass.

## Read-only on purpose

Nothing here writes, commits or enqueues, which is what makes `GET` safe on
it (see `reference_frappe_get_is_not_inert`: the decorator is not the reason —
the end-of-request rollback is, and an inline commit would defeat it). The
scope gate is the same one `charge_requests`'s reads use: the caller must be
assigned to the register, and the register's company must be one of theirs.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint

from posawesome.posawesome.api._scope import assert_company, assert_profile
from posawesome.posawesome.api.employees import POS_SUPERVISOR_ROLE
from posawesome.posawesome.api.vertical import opening_capability_payload

# The three words `ReadinessContract.status` understands. `vertical.py` has a
# fourth — `temporarily_unavailable`, a last-known-good replay — and it is a
# RESOLVED contract as far as this screen is concerned: it is what the shift
# would actually open under.
CONTRACT_RESOLVED = "resolved"
CONTRACT_INVALID = "invalid"
CONTRACT_UNCONFIGURED = "unconfigured"


def _text(value: object) -> str:
    return str(value).strip() if value is not None else ""


def _answer(group: str, build):
    """One group's answer, or ``None`` when it could not be computed.

    A group that raises is omitted from the payload and the point renders
    unverified. That is deliberate and it is not defensive padding: this
    endpoint feeds the one screen whose entire promise is that it never claims
    to have checked something nobody checked, so a partial answer has to be
    indistinguishable from no answer. The traceback goes to the Error Log,
    because a point that is PERMANENTLY unverified is a bug rather than a
    state, and nothing else would ever surface it.
    """
    try:
        return build()
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"posawesome.opening_readiness.{group}")
        return None


# --------------------------------------------------------------- the answers
# Every `describe_*` below is pure — plain values in, a plain dict out — so the
# judgement each one encodes is testable without a site. The `_fetch_*` helpers
# beside them are the only part that needs one.


def describe_contract(payload: dict | None, company: str | None) -> dict:
    """Point 1 — the capability contract, in the vocabulary the check reads.

    Only `invalid` stops the register, and it stops for the same reason
    `assert_capability_configuration` throws at the money moment: a register
    allowed to open on an unresolvable contract fails at its first sale
    instead of here, where somebody can still fix it.
    """
    if not payload:
        # No preset linked. A legitimate state, not a gap — the shipped retail
        # behaviour is what most registers run.
        return {
            "status": CONTRACT_UNCONFIGURED,
            "mode": None,
            "giro": None,
            "company": company or None,
        }
    status = _text((payload.get("resolution") or {}).get("status"))
    return {
        "status": CONTRACT_INVALID if status == CONTRACT_INVALID else CONTRACT_RESOLVED,
        "mode": _text(payload.get("name")) or None,
        "giro": _text(payload.get("vertical")) or None,
        "company": company or None,
    }


def describe_catalogue(
    warehouse: str | None,
    price_list: str | None,
    warehouse_row: dict | None,
    company: str | None,
    priced_items: int | None,
) -> dict:
    """Point 2 — warehouse, price list, and whether the warehouse can sell.

    That last judgement is the reason this endpoint exists for point 2 at all:
    `readinessSnapshot.ts` says in as many words that presence is everything a
    payload can show, and that a group node, a disabled warehouse and one
    belonging to another company all look exactly like a working one from a
    name. Here they do not.

    `priced_items` counts what the PRICE LIST holds, not what this device
    cached. A cold cache says nothing about whether the register is configured,
    and confusing the two put a zero on point 2 that belonged to point 9.
    """
    sells = None
    if warehouse:
        sells = bool(
            warehouse_row
            and not cint(warehouse_row.get("is_group"))
            and not cint(warehouse_row.get("disabled"))
            and (not company or _text(warehouse_row.get("company")) == _text(company))
        )
    return {
        "warehouse": warehouse or None,
        "price_list": price_list or None,
        "warehouse_sells": sells,
        "priced_items": priced_items,
    }


def describe_fiscal(stamping_enabled: object, tax_template: str | None, tax_rows) -> dict:
    """Point 3 — the register's fiscal posture.

    CFDI version, régimen and timbres restantes are emc's facts and stay out
    of this payload rather than being guessed here; the check renders them
    only when somebody who actually holds them hands them in.
    """
    rate = None
    for row in tax_rows or []:
        try:
            value = float(row.get("rate"))
        except (TypeError, ValueError):
            continue
        if rate is None or value > rate:
            rate = value
    return {
        "stamping_enabled": bool(cint(stamping_enabled)),
        "tax_template": tax_template or None,
        "tax_rate": rate,
    }


def describe_tenders(modes, accounts: dict | None) -> dict:
    """Point 4 — every mode of payment WITH the account it posts to.

    `accounts_reported` is unconditionally true because this function LOOKED.
    That is the whole point: «the payload carries no account field» and «this
    mode has no account» are the same shape in JavaScript, only one of them is
    a reason not to open, and the client could not tell them apart. An empty
    string here is the second one, and it is what stops the opening.
    """
    rows = []
    for mode in modes or []:
        name = _text(mode)
        if not name:
            continue
        rows.append({"mode": name, "account": _text((accounts or {}).get(name))})
    return {"rows": rows, "accounts_reported": True}


def describe_formats(
    ticket_format: str | None,
    ticket_format_exists: bool | None,
    return_note_format: str | None,
    cfdi_pdf: object,
) -> dict:
    """Point 5 — the formats the register hands over paper with.

    A named format that no longer exists is a different failure from an
    unconfigured one and the check says so, because «falta el formato del
    ticket» is repaired by picking one and a dangling link is repaired by
    restoring it.

    `return_note_format` is always None and that is the honest answer, not a
    gap: `posa_print_format_rules` carries `customer_group` + `print_format`
    (a per-group override) and nothing in this app resolves a return note.
    """
    return {
        "ticket_format": ticket_format or None,
        "ticket_format_exists": ticket_format_exists,
        "return_note_format": return_note_format or None,
        "cfdi_pdf": bool(cint(cfdi_pdf)),
    }


def describe_people(cashier: str | None, sellers, authorisers) -> dict:
    """Point 7 — who sells and who authorises.

    `authorisers` is a list, always, never null: this function looked at the
    roster, so «nobody may authorise» is a finding rather than an absence. The
    two had to stay distinguishable and from the browser they never were.
    """
    return {
        "cashier": cashier or None,
        "seller_count": len(list(sellers or [])),
        "authorisers": list(authorisers or []),
    }


def describe_test_sale(reversal: dict | None) -> dict:
    """Point 8 — whether this register has made a sale and reversed it.

    THE EVIDENCE IS THE RETURN. No doctype, field or marker in this app
    records a certification test sale, so a server that answered «unknown»
    would only be repeating what the client already said. A submitted return
    on this register, against a sale on this register, is the point's own
    wording — «hecha y revertida, quedó en cero» — proved by documents instead
    of by a checkbox nobody ticks.

    No evidence answers `performed: false`, which point 8 (optional) turns
    into a warning rather than a wall. That is the honest reading: nothing has
    been proved on this register, and saying so is what the panel is for.
    """
    if not reversal:
        return {"performed": False, "reverted_on": None, "reversal": None}
    return {
        "performed": True,
        # ISO, never a formatted date: this module does not know the tenant's
        # date format and inventing one would ship a string `es.csv` never sees.
        "reverted_on": _text(reversal.get("posting_date")) or None,
        "reversal": _text(reversal.get("name")) or None,
    }


# --------------------------------------------------------------- the fetching


def _fetch_warehouse(warehouse: str | None) -> dict | None:
    if not warehouse:
        return None
    return frappe.db.get_value(
        "Warehouse", warehouse, ["is_group", "disabled", "company"], as_dict=True
    )


def _fetch_priced_item_count(price_list: str | None) -> int | None:
    if not price_list:
        return None
    # Dict filters, not a hand-written fragment: `frappe.db.count` builds the
    # WHERE clause itself. The HTTP path refuses SQL the bench console runs
    # happily, and this endpoint is only ever reached over HTTP.
    return frappe.db.count("Item Price", {"price_list": price_list, "selling": 1})


def _fetch_tax_rows(template: str | None) -> list:
    if not template:
        return []
    return frappe.get_all(
        "Sales Taxes and Charges",
        filters={"parent": template, "parenttype": "Sales Taxes and Charges Template"},
        fields=["rate"],
        ignore_permissions=True,
    )


def _fetch_mode_accounts(modes, company: str | None) -> dict:
    """`Mode of Payment Account.default_account` for these modes and THIS company.

    Keyed by mode AND company, which is precisely why the opening payload
    could never carry it: the POS Profile's `payments` rows do not know which
    company they are being read for.
    """
    names = sorted({_text(mode) for mode in modes or [] if _text(mode)})
    if not names or not company:
        return {}
    rows = frappe.get_all(
        "Mode of Payment Account",
        filters={"parent": ["in", names], "parenttype": "Mode of Payment", "company": company},
        fields=["parent", "default_account"],
        ignore_permissions=True,
    )
    return {row.get("parent"): row.get("default_account") for row in rows if row.get("parent")}


def _fetch_roster(users) -> tuple[list, list]:
    """Enabled sellers on this register and, of those, who may authorise.

    Two queries rather than one per user: `employees.get_terminal_employees`
    asks `frappe.get_roles` per row, which is right for a dialog somebody
    opened and wrong for a screen that must cost nothing. `POS_SUPERVISOR_ROLE`
    is imported from that module rather than repeated, so the two definitions
    of «who authorises» cannot drift apart.
    """
    names = [_text(user) for user in users or [] if _text(user)]
    if not names:
        return [], []
    fields = ["name", "full_name"]
    legacy = bool(frappe.db.has_column("User", "posa_is_pos_supervisor"))
    if legacy:
        fields.append("posa_is_pos_supervisor")
    rows = frappe.get_all(
        "User",
        filters={"name": ["in", names], "enabled": 1},
        fields=fields,
        ignore_permissions=True,
    )
    by_name = {row.get("name"): row for row in rows}
    with_role = {
        row.get("parent")
        for row in frappe.get_all(
            "Has Role",
            filters={"parent": ["in", names], "parenttype": "User", "role": POS_SUPERVISOR_ROLE},
            fields=["parent"],
            ignore_permissions=True,
        )
    }
    sellers: list[str] = []
    authorisers: list[str] = []
    for user in names:
        row = by_name.get(user)
        # A disabled user cannot open anything, so they are not somebody who
        # sells here — the roster is who CAN, not who is listed.
        if not row:
            continue
        label = _text(row.get("full_name")) or user
        sellers.append(label)
        if user in with_role or (legacy and cint(row.get("posa_is_pos_supervisor"))):
            authorisers.append(label)
    return sellers, authorisers


def _people_facts(users) -> tuple[str | None, list, list]:
    """`describe_people`'s three arguments, fetched in one place.

    The cashier is the session's own full name — the one fact on this screen
    the browser could already answer, and the server answers it identically so
    an offline apertura and an online one name the same person.
    """
    cashier = _text(frappe.db.get_value("User", frappe.session.user, "full_name")) or None
    sellers, authorisers = _fetch_roster(users)
    return cashier, sellers, authorisers


def _fetch_reversal(pos_profile: str, company: str | None) -> dict | None:
    """The most recent submitted return this register made against its own sale.

    Both invoice doctypes are asked because this fork writes either one
    depending on the register's mode, and the first evidence found is enough —
    the question is whether the round trip has ever been made, not how often.
    """
    for doctype in ("Sales Invoice", "POS Invoice"):
        if not frappe.db.exists("DocType", doctype):
            continue
        filters = {
            "pos_profile": pos_profile,
            "is_return": 1,
            "docstatus": 1,
            "return_against": ["is", "set"],
        }
        if company:
            filters["company"] = company
        rows = frappe.get_all(
            doctype,
            filters=filters,
            fields=["name", "posting_date", "return_against"],
            order_by="posting_date desc, creation desc",
            limit=1,
            ignore_permissions=True,
        )
        if rows:
            return rows[0]
    return None


# -------------------------------------------------------------- the endpoint


@frappe.whitelist(methods=["GET", "POST"])
def get_opening_readiness(pos_profile):
    """The server's half of the ten-point check, for ONE register.

    Answers points 1–5, 7 and 8. Point 6 (devices) and points 9–10 (the
    offline cache and the floor) are the browser's own facts and are not
    touched here — see the module header.
    """
    assert_profile(frappe.session.user, pos_profile)
    profile = frappe.get_cached_doc("POS Profile", pos_profile)
    company = _text(profile.get("company")) or None
    assert_company(frappe.session.user, company)

    warehouse = _text(profile.get("warehouse")) or None
    price_list = _text(profile.get("selling_price_list")) or None
    tax_template = _text(profile.get("taxes_and_charges")) or None
    stamping = profile.get("posa_cfdi_enable_stamping")
    # `print_format_for_online` does not exist on every tenant's POS Profile —
    # `.get()` rather than attribute access for exactly that reason. The
    # precedence matches the client's, so an offline apertura and an online one
    # name the same format.
    ticket = _text(profile.get("print_format_for_online")) or _text(profile.get("print_format"))
    modes = [row.get("mode_of_payment") for row in (profile.get("payments") or [])]
    users = [row.get("user") for row in (profile.get("applicable_for_users") or [])]

    payload = {
        "pos_profile": pos_profile,
        "company": company,
        "contract": _answer(
            "contract",
            lambda: describe_contract(opening_capability_payload(pos_profile), company),
        ),
        "catalogue": _answer(
            "catalogue",
            lambda: describe_catalogue(
                warehouse,
                price_list,
                _fetch_warehouse(warehouse),
                company,
                _fetch_priced_item_count(price_list),
            ),
        ),
        "fiscal": _answer(
            "fiscal",
            lambda: describe_fiscal(stamping, tax_template, _fetch_tax_rows(tax_template)),
        ),
        "tenders": _answer(
            "tenders",
            lambda: describe_tenders(modes, _fetch_mode_accounts(modes, company)),
        ),
        "formats": _answer(
            "formats",
            lambda: describe_formats(
                ticket,
                bool(frappe.db.exists("Print Format", ticket)) if ticket else None,
                None,
                stamping,
            ),
        ),
        "people": _answer("people", lambda: describe_people(*_people_facts(users))),
        "test_sale": _answer(
            "test_sale", lambda: describe_test_sale(_fetch_reversal(pos_profile, company))
        ),
    }
    return payload
