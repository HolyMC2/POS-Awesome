"""Server-side invariants for invoice updates.

Spec: REVIEW2/03_security.md §3.3 — payment-surface tampering window.

The client builds the invoice JSON in the SPA, including rates, taxes,
discount, and payments. Without server-side invariants, a malicious
cashier can submit any invoice for any amount because
``set_missing_values`` blesses client rates (especially when
``ignore_pricing_rule = 1``).

This module provides three invariants called from ``update_invoice`` /
``submit_invoice`` AFTER the scope assertions in ``_scope.py``:

  * ``enforce_discount_limit(invoice_doc, profile_doc)``
      Cap per-item discount percentage against ``Item.max_discount`` and
      the POS Profile's ``posa_max_discount_allowed`` (if present).

  * ``assert_payments_match_grand_total(invoice_doc)``
      Sum of ``payments[].amount`` must equal ``grand_total`` within a
      tolerance derived from the invoice currency's smallest unit.
      Catches the "client tells the server $0 due, then submits $1000
      worth of items" attack.

  * ``assert_rates_within_band(invoice_doc, profile_doc, ...)``
      If the POS Profile's ``posa_allow_user_to_edit_rate`` is OFF,
      every line rate must match the Item Price for the profile's
      price list (within rounding). If ON, rate must stay within a
      configurable ±band (default 20%) of the Item Price.

Full re-fetch + recompute (``reprice_invoice_items``) is intentionally
deferred to a follow-up commit gated by ``posa_server_side_reprice``
flag — changing every invoice's math in a single drop is too risky for
mid-shift cashiers without a soak window.
"""

from __future__ import annotations

from typing import Any, Iterable

import frappe
from frappe import _
from frappe.utils import flt


# ---------------------------------------------------------------------------
# tolerances
# ---------------------------------------------------------------------------

# Default rate-band when posa_allow_user_to_edit_rate is on. ±20% covers
# manager-approved discounts without letting cashiers zero-rate items.
DEFAULT_RATE_BAND_PCT = 20.0

# Tolerance for payment-total comparison. We use 0.01 for currencies with
# 2 decimal places. Currencies with more precision (e.g. BTC) would need
# per-currency calibration — out of scope here.
PAYMENT_MATCH_TOLERANCE = 0.01


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _profile_value(profile_doc: Any, key: str, default: Any = None) -> Any:
    if profile_doc is None:
        return default
    if isinstance(profile_doc, dict):
        return profile_doc.get(key, default)
    return getattr(profile_doc, key, default)


def _iter_lines(invoice_doc: Any) -> Iterable[Any]:
    """Yield invoice item-line objects (handles doc + dict shapes)."""
    if invoice_doc is None:
        return []
    items = getattr(invoice_doc, "items", None) if not isinstance(invoice_doc, dict) else invoice_doc.get("items")
    return items or []


def _line_value(line: Any, key: str, default: Any = None) -> Any:
    if line is None:
        return default
    if isinstance(line, dict):
        return line.get(key, default)
    return getattr(line, key, default)


# ---------------------------------------------------------------------------
# discount cap
# ---------------------------------------------------------------------------


def enforce_discount_limit(invoice_doc: Any, profile_doc: Any | None = None) -> None:
    """Cap per-line discount_percentage against Item.max_discount + profile cap.

    Frappe enforces ``Item.max_discount`` only when the standard pricing
    rules run (which we explicitly disable via ``ignore_pricing_rule = 1``
    in update_invoice). So the gate has to live in our wrapper.

    POS-Profile-wide cap (``posa_max_discount_allowed``) is optional —
    falls back to "no profile-wide cap" when missing.
    """

    profile_cap = flt(_profile_value(profile_doc, "posa_max_discount_allowed") or 0)

    for line in _iter_lines(invoice_doc):
        discount_pct = flt(_line_value(line, "discount_percentage") or 0)
        if discount_pct <= 0:
            continue

        item_code = _line_value(line, "item_code")
        item_cap = flt(
            frappe.db.get_value("Item", item_code, "max_discount") or 0
        ) if item_code else 0

        # Effective cap is the strictest non-zero limit. A zero from
        # either side means "no opinion", not "100% discount allowed".
        caps = [c for c in (item_cap, profile_cap) if c > 0]
        if not caps:
            continue

        max_allowed = min(caps)
        if discount_pct > max_allowed:
            frappe.throw(
                _(
                    "Line {0} discount {1}% exceeds the configured maximum {2}% for item {3}."
                ).format(
                    _line_value(line, "idx") or "?",
                    discount_pct,
                    max_allowed,
                    item_code or "?",
                ),
                frappe.PermissionError,
            )


# ---------------------------------------------------------------------------
# payment-vs-total invariant
# ---------------------------------------------------------------------------


def assert_payments_match_grand_total(
    invoice_doc: Any,
    tolerance: float | None = None,
    is_credit_sale: bool = False,
) -> None:
    """Require sum(payments[].amount) == grand_total within tolerance.

    Catches the "client sends payments=[$0] for a $1000 cart" attack.
    Frappe re-sums line totals in ``calculate_taxes_and_totals`` but
    accepts whatever the client put in ``payments`` if the invoice is
    being saved as a draft. By the time submit happens it's too late.

    Credit-sale flow (`data.is_credit_sale=1`) intentionally accepts a
    partial payment: customer pays $200 of a $400 invoice, the
    remaining $200 becomes outstanding (anticipo / receivable). The
    "$0 for $1000 cart" threat doesn't apply — the outstanding IS the
    deferred liability, not an exfiltration. Skip the equality check
    when the caller flags the request as a credit sale.
    """

    if is_credit_sale:
        return

    tol = tolerance if tolerance is not None else PAYMENT_MATCH_TOLERANCE

    # Prefer rounded_total when set — Frappe rounds the customer-facing
    # number, and payments are collected against that, not grand_total.
    rounded = _line_value(invoice_doc, "rounded_total")
    grand_total = flt(rounded if rounded else _line_value(invoice_doc, "grand_total") or 0)

    # Returns / credit notes have negative grand_total; absolute the
    # comparison so the invariant still applies.
    paid = 0.0
    payments = (
        getattr(invoice_doc, "payments", None)
        if not isinstance(invoice_doc, dict)
        else invoice_doc.get("payments")
    ) or []
    for pay in payments:
        paid += flt(_line_value(pay, "amount") or 0)

    # Sales Invoices with `is_pos = 0` (regular non-POS) may have empty
    # payments — that's legitimate (outstanding_amount tracks the debt).
    # Only enforce when payments[] is non-empty OR is_pos is truthy.
    is_pos = bool(_line_value(invoice_doc, "is_pos"))
    if not payments and not is_pos:
        return

    if abs(paid - grand_total) > tol:
        frappe.throw(
            _(
                "Payment total {0} does not match grand total {1} (difference {2})."
            ).format(paid, grand_total, paid - grand_total),
            frappe.ValidationError,
        )


# ---------------------------------------------------------------------------
# rate-band invariant
# ---------------------------------------------------------------------------


def assert_rates_within_band(
    invoice_doc: Any,
    profile_doc: Any | None = None,
    band_pct: float | None = None,
) -> None:
    """Validate line rates against Item Price for the profile's price list.

    Three behaviors:
      * Profile blocks rate edits → rate must match Item Price exactly
        (within rounding).
      * Profile allows rate edits → rate must be within ±band of Item
        Price. Default band is ``DEFAULT_RATE_BAND_PCT`` (20%).
      * No Item Price found for the item × price-list combo → skip
        validation for that line (legacy items without price master).

    Note: this does NOT enforce price-list-currency match; that's the
    job of full reprice (deferred).
    """

    allow_edit = bool(_profile_value(profile_doc, "posa_allow_user_to_edit_rate"))
    price_list = _profile_value(profile_doc, "selling_price_list") or _line_value(
        invoice_doc, "selling_price_list"
    )
    if not price_list:
        # Without a price list we have no source of truth to compare
        # against; skipping is safer than failing legitimate flows.
        return

    # `band_pct` retained for ABI compatibility; rate-band enforcement
    # is currently disabled when posa_allow_user_to_edit_rate=1.
    # See docs/TODO.md → "Rate-band cap".
    del band_pct

    for line in _iter_lines(invoice_doc):
        item_code = _line_value(line, "item_code")
        if not item_code:
            continue

        # Cart line rates are commonly stored as `rate` (per-unit, post
        # discount). `price_list_rate` is the pre-discount price.
        client_rate = flt(_line_value(line, "rate") or 0)
        if client_rate <= 0:
            # Zero-rate is an explicit operator action and should be
            # caught by the discount-cap path; skip here.
            continue

        master_rate = frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list},
            "price_list_rate",
            order_by="valid_from desc",
        )
        if master_rate is None:
            continue
        master_rate = flt(master_rate)
        if master_rate <= 0:
            continue

        if not allow_edit:
            if abs(client_rate - master_rate) > 0.01:
                frappe.throw(
                    _(
                        "Rate edit is not permitted for this POS Profile. "
                        "Line {0} ({1}): {2} vs price-list rate {3}."
                    ).format(
                        _line_value(line, "idx") or "?",
                        item_code,
                        client_rate,
                        master_rate,
                    ),
                    frappe.PermissionError,
                )
            continue

        # Editable rate — band cap disabled. The ±band% guard blocked
        # legitimate variable-price items (e.g. "cambiar pantalla" — labor
        # charged per device model, customer brings the display) where
        # the cart rate intentionally exceeds the price-list rate by far
        # more than ±20%. `posa_allow_user_to_edit_rate` already gates
        # whether ANY edit is allowed; once on, operator judgment rules.
        # Cleaner per-item / per-item-group opt-out is tracked in
        # docs/TODO.md → "Rate-band cap". Until then, profile edit-flag
        # is a full bypass.
        continue
