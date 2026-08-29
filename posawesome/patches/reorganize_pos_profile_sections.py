"""The one layout authority for POS Awesome's POS Profile settings.

2026-08-29 rework (settings audit): all POS Awesome fields move into their
own **POS Awesome tab** at the end of the form (the ``posa_tab`` Tab Break
existed since earlier, anchored right after ``more_info_tab`` — where it
swallowed the native UTM fields into an otherwise empty tab and left More
Info blank; it now anchors after ``utm_medium``, the last native field).

``ORDERED_CHAIN`` is the complete, collision-free order of every POS
Awesome field. It used to cover only part of the set, so later patches
anchored their fields with their own ``insert_after`` and five anchors
ended up claimed twice (three fields all "after posa_silent_print", etc.)
— Frappe resolves such ties by sync order, i.e. nondeterministically, and
fields rendered under the wrong section header. The chain also carried the
pre-rename ``pose_use_limit_search`` name, silently skipping two fields.

This patch runs LAST in after_migrate (see hooks.py): every creator patch
may anchor its field wherever history put it — the chain re-anchors the
whole set afterwards, every migrate, so the order here is the only order.

``FIELD_PROPS`` is the label/description/depends_on repair list from the
same audit — wrong descriptions rewritten from what the code actually
does (the background-submit description used to describe printing!),
empty ones filled for every money-relevant switch, and broken
``depends_on`` unhooked:

  * posa_search_limit depended on ``pose_use_limit_search`` — a fieldname
    renamed away in 2026, so the field was PERMANENTLY INVISIBLE in Desk.
  * posa_allow_credit_sale depended on the unrelated Allow Partial
    Payment.
  * posa_hide_variants_items depended on Show Template Items although the
    code applies the two independently.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


TAB_FIELD = {
    "fieldname": "posa_tab",
    "label": "POS Awesome",
    "fieldtype": "Tab Break",
    "insert_after": "utm_medium",
}

SECTION_FIELDS = [
    {
        "fieldname": "posa_pos_awesome_settings",
        "label": "General",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_pricing_controls",
        "label": "Pricing and Discounts",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_sales_returns",
        "label": "Sales and Returns",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_sales_purchase",
        "label": "Orders and Purchasing",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_inventory_controls",
        "label": "Items and Inventory",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_print_delivery",
        "label": "Printing and Delivery",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_cash_movement",
        "label": "Cash Movement",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_customer_display",
        "label": "Customer Display",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_section_awesome_dashboard",
        "label": "Dashboard",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "pos_awesome_payments",
        "label": "POS Awesome Payments",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
    {
        "fieldname": "posa_pos_awesome_advance_settings",
        "label": "Performance and Advanced",
        "fieldtype": "Section Break",
        "collapsible": 1,
    },
]


ORDERED_CHAIN = [
    "posa_tab",
    # ---- General -----------------------------------------------------
    "posa_pos_awesome_settings",
    "posa_capability_profile",
    "posa_cash_mode_of_payment",
    "posa_language",
    "posa_default_country",
    "posa_decimal_precision",
    "create_pos_invoice_instead_of_sales_invoice",
    "posa_col_1",
    "posa_show_customer_balance",
    "posa_hide_closing_shift",
    "posa_force_close_stale_shift",
    "posa_allow_change_posting_date",
    "posa_allow_delete",
    "posa_allow_multi_currency",
    "posa_use_charge_requests",
    "posa_cfdi_enable_stamping",
    "posa_ux_keymap_id",
    "posa_lean_vertical_layout",
    # ---- Pricing and Discounts --------------------------------------
    "posa_section_pricing_controls",
    "posa_allow_user_to_edit_rate",
    "posa_px_max_rate_change_pct",
    "posa_allow_price_list_rate_change",
    "posa_force_price_from_customer_price_list",
    "posa_px_enable_price_list_dropdown",
    "posa_tax_inclusive",
    "posa_allow_user_to_edit_additional_discount",
    "posa_allow_user_to_edit_item_discount",
    "posa_use_percentage_discount",
    "posa_max_discount_allowed",
    "posa_display_discount_percentage",
    "posa_display_discount_amount",
    # ---- Sales and Returns ------------------------------------------
    "posa_section_sales_returns",
    "posa_allow_credit_sale",
    "use_customer_credit",
    "use_cashback",
    "posa_allow_write_off_change",
    "posa_allow_return",
    "posa_allow_return_without_invoice",
    "posa_allow_free_batch_return",
    "posa_enable_return_validity",
    "posa_return_validity_days",
    "posa_column_break_112",
    "posa_use_gift_cards",
    "posa_gift_card_liability_account",
    "posa_use_customer_cards",
    "posa_customer_card_program",
    "posa_sales_persons",
    "hide_expected_amount",
    # ---- Orders and Purchasing --------------------------------------
    "posa_section_sales_purchase",
    "posa_allow_sales_order",
    "custom_allow_select_sales_order",
    "posa_create_only_sales_order",
    "posa_default_sales_order",
    "posa_allow_customer_purchase_order",
    "custom_allow_create_quotation",
    "posa_quotation_validity_days",
    "posa_allow_purchase_order",
    "posa_allow_purchase_receipt",
    "posa_allow_create_purchase_items",
    "posa_allow_create_purchase_suppliers",
    # ---- Items and Inventory ----------------------------------------
    "posa_section_inventory_controls",
    "posa_display_items_in_stock",
    "posa_display_item_code",
    "posa_enable_camera_scanning",
    "posa_camera_scan_type",
    "posa_gr_embedded_barcode_scheme",
    "posa_show_template_items",
    "posa_hide_variants_items",
    "posa_hide_items_until_search",
    "posa_auto_set_batch",
    "posa_search_batch_no",
    "posa_search_serial_no",
    "posa_block_sale_beyond_available_qty",
    "posa_allow_offline_sale_without_stock_verification",
    "posa_allow_line_item_name_override",
    "posa_show_custom_name_marker_on_print",
    "posa_input_qty",
    "posa_new_line",
    # ---- Printing and Delivery --------------------------------------
    "posa_section_print_delivery",
    "posa_use_delivery_charges",
    "posa_auto_set_delivery_charges",
    "posa_display_additional_notes",
    "posa_display_authorization_code",
    "posa_allow_print_last_invoice",
    "posa_allow_print_draft_invoices",
    "posa_open_print_in_new_tab",
    "posa_allow_select_print_format_in_payments",
    "posa_print_format_rules",
    "posa_closing_shift_print_format",
    "posa_silent_print",
    "posa_qz_printer_name",
    "posa_qz_interpolation",
    "posa_qz_density",
    "posa_qz_cut_after_print",
    # ---- Cash Movement ----------------------------------------------
    "posa_section_cash_movement",
    "posa_enable_cash_movement",
    "posa_allow_pos_expense",
    "posa_allow_cash_deposit",
    "posa_default_expense_account",
    "posa_allowed_expense_accounts",
    "posa_default_source_account",
    "posa_allow_source_account_override",
    "posa_allowed_source_accounts",
    "posa_back_office_cash_account",
    "posa_allow_cancel_submitted_cash_movement",
    "posa_allow_delete_cancelled_cash_movement",
    "posa_require_cash_movement_remarks",
    "posa_cash_movement_max_amount",
    # ---- Customer Display -------------------------------------------
    "posa_section_customer_display",
    "posa_enable_customer_display",
    "posa_auto_open_customer_display",
    # ---- Dashboard --------------------------------------------------
    "posa_section_awesome_dashboard",
    "posa_enable_awesome_dashboard",
    "posa_allow_company_dashboard_scope",
    "posa_low_stock_alert_threshold",
    # ---- POS Awesome Payments ---------------------------------------
    "pos_awesome_payments",
    "posa_use_pos_awesome_payments",
    "posa_allow_partial_payment",
    "column_break_uolvm",
    "posa_allow_make_new_payments",
    "posa_allow_reconcile_payments",
    "posa_allow_mpesa_reconcile_payments",
    # ---- Performance and Advanced -----------------------------------
    "posa_pos_awesome_advance_settings",
    "posa_allow_submissions_in_background_job",
    "posa_use_web_route",
    "column_break_dqsba",
    "posa_use_server_cache",
    "posa_server_cache_duration",
    "posa_local_storage",
    "posa_force_server_items",
    "column_break_anyol",
    "posa_use_limit_search",
    "posa_search_limit",
    "posa_force_reload_items",
    "posa_allow_duplicate_customer_names",
    "posa_allow_delete_offline_invoice",
]


# Label / description / depends_on repairs. Every entry states what the
# reader of the FORM needs: what the switch actually does at runtime, who
# enforces it (server vs register UI), and the non-obvious consequences.
# Keys present are written; absent keys are left untouched.
FIELD_PROPS = {
    "posa_allow_submissions_in_background_job": {
        "label": "Submit Invoices in Background",
        "description": (
            "Defer the invoice submit to a background queue and return to "
            "the cashier immediately. Leave OFF: an inline submit measures "
            "well under a second even with hundreds of thousands of "
            "invoices, while queue pickup adds 3-7 seconds — and delays of "
            "45-230 seconds were measured in production when the shared "
            "queue was busy, with a failed background submit looking to "
            "the cashier like a completed sale. Only consider it with a "
            "dedicated, uncontended queue."
        ),
    },
    "posa_use_server_cache": {
        "description": (
            "Cache item prices, item details, UOM maps and the customer "
            "list in Redis on the server, pre-warmed on a schedule. Speeds "
            "up busy registers; price edits may take up to Server Cache "
            "Duration to reach the till."
        ),
    },
    "posa_server_cache_duration": {
        "depends_on": "eval:doc.posa_use_server_cache==1",
        "description": (
            "Server cache lifetime in MINUTES (blank = 30). Read only "
            "while Use Server Cache is on."
        ),
    },
    "posa_use_limit_search": {
        "description": (
            "Search the catalog on the server (item name/code, 2+ "
            "characters) instead of downloading every item into the "
            "browser. Essential for large catalogs. Results are paged at "
            "Search Limit Number."
        ),
    },
    "posa_search_limit": {
        "depends_on": "eval:doc.posa_use_limit_search==1",
        "mandatory_depends_on": "",
        "description": (
            "Page size for server-side item search (default 500). Read "
            "only while Use Limit Search is on."
        ),
    },
    "posa_force_reload_items": {
        "label": "Unlimited Search Results",
        "depends_on": "eval:doc.posa_use_limit_search==1",
        "description": (
            "With Use Limit Search on, return the FULL result set instead "
            "of paging at Search Limit Number. Rarely wanted: an unbounded "
            "result on a big catalog can freeze the register. No effect "
            "when Use Limit Search is off."
        ),
    },
    "posa_local_storage": {
        "description": (
            "Cache the sales-person list and POS offers in the browser. "
            "Despite the broad name that is all it does — the offline "
            "stack (items, queued invoices) does not use this switch."
        ),
    },
    "posa_force_server_items": {
        "description": (
            "Skip the browser's item cache and query the server on every "
            "search. Warning: cashiers can flip this from the register's "
            "Item Settings dialog, and the change applies to every "
            "terminal using this profile."
        ),
    },
    "posa_qz_printer_name": {
        "description": (
            "Exact QZ Tray printer name for silent printing, overriding "
            "the browser-saved pick. Warning: saving a printer from the "
            "register's QZ dialog writes it here — for every terminal "
            "using this profile."
        ),
    },
    "create_pos_invoice_instead_of_sales_invoice": {
        "description": (
            "Create POS Invoices (consolidated into Sales Invoices at "
            "shift close — the standard ERPNext POS flow) instead of one "
            "submitted Sales Invoice per sale. Changes the accounting "
            "doctype for every sale, shift-close consolidation, "
            "receivables and returns. Do not flip on a live register."
        ),
    },
    "posa_allow_delete": {
        "label": "Allow Deleting Draft Invoices",
        "description": (
            "Permits deleting draft invoices from the register, and "
            "purges leftover drafts automatically when the shift closes."
        ),
    },
    "posa_language": {
        "description": (
            "Applies only to the few messages the server translates in "
            "POS responses. It does NOT change the register interface "
            "language."
        ),
    },
    "posa_default_country": {
        "default": "",
        "description": (
            "Country pre-filled when creating a customer from the "
            "register. Blank = no pre-fill."
        ),
    },
    "posa_max_discount_allowed": {
        "label": "Max Discount Percentage Allowed",
        "description": (
            "Profile-wide cap on discounts, in percent. 0 or blank = no "
            "profile cap (each Item's own Max Discount still applies). "
            "Enforced server-side at submit."
        ),
    },
    "posa_display_items_in_stock": {
        "description": (
            "Show only items with available stock: items at zero or "
            "negative stock disappear from search and browse."
        ),
    },
    "posa_allow_user_to_edit_rate": {
        "description": (
            "Lets the cashier type a unit price. Typed prices are still "
            "validated at submit: they must stay within the rate band "
            "(Max Rate Change Percentage) around the sale's price list, "
            "unless the item or its group carries Skip POS Rate Band."
        ),
    },
    "posa_allow_credit_sale": {
        "depends_on": "",
        "description": (
            "Lets a sale be submitted with part (or none) of the total "
            "collected; the remainder becomes outstanding on the "
            "customer."
        ),
    },
    "posa_hide_variants_items": {
        "depends_on": "",
        "description": (
            "Hide item variants from the catalog. Independent of Show "
            "Template Items — the two can be combined freely."
        ),
    },
    "posa_return_validity_days": {
        "depends_on": "eval:doc.posa_enable_return_validity==1",
    },
    "posa_display_discount_percentage": {
        "description": (
            "Seeds the default cart columns the first time a register "
            "loads; once a cashier customises columns, their saved "
            "preference wins."
        ),
    },
    "posa_display_discount_amount": {
        "description": (
            "Seeds the default cart columns the first time a register "
            "loads; once a cashier customises columns, their saved "
            "preference wins."
        ),
    },
    "use_cashback": {
        "description": (
            "On returns, offer the cashier the choice between cash back "
            "and other refund shapes. Register-side flow choice only."
        ),
    },
    "posa_create_only_sales_order": {
        "description": (
            "The register creates Sales Orders instead of invoices. Note: "
            "enforced by the register UI, not by the server."
        ),
    },
    "posa_allow_purchase_order": {
        "description": (
            "Shows the Purchase Orders page on this register. Every "
            "purchase action is also enforced server-side."
        ),
    },
    "posa_use_pos_awesome_payments": {
        "description": (
            "Enables the Receivables surface (create and reconcile "
            "Payment Entries from the register). Enforced server-side; "
            "the page is hidden when off."
        ),
    },
    "posa_sales_persons": {
        "description": (
            "Restrict the Sales Person picker to these entries. Empty = "
            "every enabled sales person."
        ),
    },
    "posa_gift_card_liability_account": {
        "description": (
            "Liability account the outstanding gift-card balance is "
            "booked to on issue/top-up and relieved from on redemption."
        ),
    },
    "posa_customer_card_program": {
        "description": (
            "ERPNext Loyalty Program used when activating customer "
            "cards; activation is refused while this is blank."
        ),
    },
    "posa_lean_vertical_layout": {
        "description": (
            "Stack the cart under the item selector and hide the extras "
            "toolbar. Note: when the capability preset pins lean layout "
            "on, a register cannot turn it back off (enable-only merge)."
        ),
    },
    "posa_show_custom_name_marker_on_print": {
        "description": (
            "Appends a marker to renamed lines on OFFLINE receipts only; "
            "server-rendered print formats do not see this flag."
        ),
    },
    "posa_use_charge_requests": {
        "description": (
            "Show external charge requests (e.g. repairs ready to bill) "
            "at the register. Superseded by the capability preset's "
            "external-document checkout — either one enables the queue."
        ),
    },
    "posa_hide_closing_shift": {
        "description": (
            "Hides the Close Shift menu entry on this register; the "
            "closing endpoints stay available to managers."
        ),
    },
    "posa_allow_change_posting_date": {
        "description": (
            "Lets the cashier redate a sale (server-validated). Can post "
            "into earlier accounting periods — leave off unless needed."
        ),
    },
    "hide_expected_amount": {
        "description": (
            "Blind close: hides the system-expected cash in the closing "
            "dialog so the cashier counts without seeing the target."
        ),
    },
    "posa_cash_mode_of_payment": {
        "description": (
            "Mode of Payment that counts as physical cash — drives "
            "closing reconciliation, cash movements, change and the "
            "dashboard. Default: Cash."
        ),
    },
    "posa_block_sale_beyond_available_qty": {
        "description": (
            "Hard-block selling more than available stock (instead of a "
            "warning). Also enforced server-side at submit."
        ),
    },
    "posa_new_line": {
        "description": (
            "Shows the 'new line per scan' toggle in the cashier's Item "
            "Settings dialog; the toggle itself is saved per browser."
        ),
    },
}


def _ensure_tab():
    cf_name = f"POS Profile-{TAB_FIELD['fieldname']}"
    if not frappe.db.exists("Custom Field", cf_name):
        create_custom_field("POS Profile", dict(TAB_FIELD))
    else:
        frappe.db.set_value(
            "Custom Field",
            cf_name,
            {
                "label": TAB_FIELD["label"],
                "fieldtype": "Tab Break",
                "insert_after": TAB_FIELD["insert_after"],
            },
            update_modified=False,
        )


def _ensure_section_fields():
    for field in SECTION_FIELDS:
        fieldname = field["fieldname"]
        cf_name = f"POS Profile-{fieldname}"
        if not frappe.db.exists("Custom Field", cf_name):
            create_custom_field(
                "POS Profile",
                {
                    **field,
                    "insert_after": "posa_tab",
                },
            )
        else:
            frappe.db.set_value(
                "Custom Field",
                cf_name,
                {
                    "label": field["label"],
                    "fieldtype": "Section Break",
                    "collapsible": 1,
                },
                update_modified=False,
            )


def _set_insert_after(fieldname, insert_after):
    cf_name = f"POS Profile-{fieldname}"
    if not frappe.db.exists("Custom Field", cf_name):
        return False
    frappe.db.set_value(
        "Custom Field",
        cf_name,
        "insert_after",
        insert_after,
        update_modified=False,
    )
    return True


def _reanchor_fields():
    # The tab anchors to the last native field; everything else chains.
    _set_insert_after("posa_tab", TAB_FIELD["insert_after"])

    previous = None
    for fieldname in ORDERED_CHAIN:
        cf_name = f"POS Profile-{fieldname}"
        if not frappe.db.exists("Custom Field", cf_name):
            continue
        if previous and previous != fieldname:
            _set_insert_after(fieldname, previous)
        previous = fieldname


def _apply_field_props():
    for fieldname, props in FIELD_PROPS.items():
        cf_name = f"POS Profile-{fieldname}"
        if not frappe.db.exists("Custom Field", cf_name):
            continue
        frappe.db.set_value("Custom Field", cf_name, props, update_modified=False)


def execute():
    _ensure_tab()
    _ensure_section_fields()
    _reanchor_fields()
    _apply_field_props()
    frappe.clear_cache(doctype="POS Profile")
