import frappe
from frappe import _
from frappe.utils import flt
from posawesome.posawesome.api.item_processing.barcode import _parse_scale_barcode_data


@frappe.whitelist(methods=["POST"])
def update_price_list_rate(item_code, price_list, rate, uom=None, pos_profile=None):
    """Create or update Item Price for the given item and price list.

    Scoped (audit MONEY-F3). This rewrites the price MASTER with
    ignore_permissions, and it is the exact `Item Price` row
    `assert_rates_within_band` trusts as its reference — an unguarded call moved
    the reference and the rate band became a paper wall. `assert_profile_feature`
    is the gate the button's `posa_allow_price_list_rate_change` flag stood for
    client-side: with a profile it requires membership + the flag ON + company
    match; without one (a stale bundle) it still refuses unless one of the
    caller's assigned profiles has the flag ON — so Doco Reparaciones (flag off)
    can no longer reach it even by calling the endpoint directly.
    """
    from posawesome.posawesome.api._scope import assert_profile_feature

    assert_profile_feature(
        frappe.session.user, pos_profile, "posa_allow_price_list_rate_change"
    )

    if not item_code or not price_list:
        frappe.throw(_("Item Code and Price List are required"))

    rate = flt(rate)
    filters = {"item_code": item_code, "price_list": price_list}
    if uom:
        filters["uom"] = uom
    else:
        filters["uom"] = ["in", ["", None]]

    name = frappe.db.exists("Item Price", filters)
    if name:
        doc = frappe.get_doc("Item Price", name)
        doc.price_list_rate = rate
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": item_code,
                "price_list": price_list,
                "uom": uom,
                "price_list_rate": rate,
                "selling": 1,
            }
        )
        doc.insert(ignore_permissions=True)

    # No inline frappe.db.commit(): the whitelisted request commits at its end,
    # and an inline commit here would defeat a rollback of the same request
    # (audit — "inline commit defeats request rollback").
    return _("Item Price has been added or updated")


@frappe.whitelist(methods=["GET", "POST"])
def get_price_for_uom(item_code, price_list, uom):
    """Return Item Price for the given item, price list and UOM if it exists."""
    if not (item_code and price_list and uom):
        return None

    price = frappe.db.get_value(
        "Item Price",
        {
            "item_code": item_code,
            "price_list": price_list,
            "uom": uom,
        },
        "price_list_rate",
    )
    return price
