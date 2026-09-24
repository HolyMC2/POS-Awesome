import frappe


def get_shift_movements(
    pos_opening_shift,
    movement_type=None,
    status=None,
    search_text=None,
    limit_start=0,
    limit_page_length=50,
):
    filters = {"pos_opening_shift": pos_opening_shift}
    if movement_type:
        filters["movement_type"] = movement_type

    if status:
        normalized = str(status).strip().lower()
        if normalized == "submitted":
            filters["docstatus"] = 1
        elif normalized == "cancelled":
            filters["docstatus"] = 2
        elif normalized == "draft":
            filters["docstatus"] = 0

    query = (search_text or "").strip()
    or_filters = None
    if query:
        like_query = f"%{query}%"
        or_filters = [
            {"name": ["like", like_query]},
            {"against_name": ["like", like_query]},
            {"sales_invoice": ["like", like_query]},
            {"remarks": ["like", like_query]},
            {"source_account": ["like", like_query]},
            {"target_account": ["like", like_query]},
            {"expense_account": ["like", like_query]},
            {"journal_entry": ["like", like_query]},
            {"user": ["like", like_query]},
        ]

    return frappe.get_all(
        "POS Cash Movement",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "posting_date",
            "company",
            "pos_profile",
            "pos_opening_shift",
            "user",
            "movement_type",
            "amount",
            "against_name",
            "sales_invoice",
            "source_account",
            "target_account",
            "expense_account",
            "remarks",
            "journal_entry",
            "docstatus",
            "modified",
            "owner",
        ],
        order_by="modified desc",
        start=limit_start,
        page_length=limit_page_length,
    )


def get_submitted_expenses(pos_opening_shift, limit_start=0, limit_page_length=50):
    return get_shift_movements(
        pos_opening_shift=pos_opening_shift,
        movement_type="Expense",
        status="submitted",
        limit_start=limit_start,
        limit_page_length=limit_page_length,
    )


def get_sales_invoice_expenses(sales_invoice):
    rows = frappe.get_all(
        "POS Cash Movement",
        filters={"sales_invoice": sales_invoice, "movement_type": "Expense", "docstatus": ["in", [1, 2]]},
        fields=[
            "name",
            "posting_date",
            "amount",
            "expense_account",
            "remarks",
            "docstatus",
            "user",
            "pos_profile",
            "pos_opening_shift",
            "journal_entry",
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=100,
    )
    users = sorted({row.user for row in rows if row.user})
    names = (
        dict(frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"], as_list=True))
        if users
        else {}
    )
    for row in rows:
        row["user_name"] = names.get(row.user) or row.user
    return rows
