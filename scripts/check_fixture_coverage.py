#!/usr/bin/env python3
"""Fixture-coverage guard (vertical-profiles plan C8).

Four invariants, all statically checkable — no site, no frappe import:

1. Exactly ONE "Custom Field" entry in the hooks `fixtures` list.
   `bench export-fixtures` writes one file per doctype, so a second entry
   for the same doctype silently OVERWRITES the first's export (this
   shrank custom_field.json to 2 records on 2026-08-09).

2. Every Custom Field name listed in hooks exists in
   fixtures/custom_field.json. A name that is listed but absent means the
   definition was never exported — or the export ran against a site whose
   DB lacked the field, which silently DROPS it from the file.

3. Every `fieldname` a patch script creates appears in the hooks list
   (matched as `-<fieldname>"` against any doctype). Patch-created fields
   that skip the hooks list are invisible to fixture delivery — 30 fields
   accumulated this way before 2026-08-09.

4. Every NEW Custom Field fieldname carries a per-vertical prefix
   (VERTICAL_PROFILES_PLAN.md C8). Custom Field records are keyed
   `{dt}-{fieldname}` and are globally unique per site with LAST WRITER
   WINS, silently — and Sales Invoice on the lab tenant already carries
   51 fields from six-plus apps. A generic `posa_table` is precisely what
   a future app overwrites without a word. The 174 fieldnames that shipped
   before this rule are grandfathered by name below; anything new must
   match VERTICAL_PREFIXES.

Run: python scripts/check_fixture_coverage.py   (exits 1 on violation)
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOOKS = REPO / "posawesome" / "hooks.py"
FIXTURE_FILE = REPO / "posawesome" / "fixtures" / "custom_field.json"
PATCHES_DIR = REPO / "posawesome" / "patches"

# Patch fieldnames that intentionally have no fixture entry (document why).
PATCH_ALLOWLIST: set[str] = {
	# add_sales_person_filter_to_pos_profile.py: field inside the NEW child
	# DocType it creates (istable), not a Custom Field — the doctype schema
	# ships with the app, not via fixtures.
	"sales_person",
	# add_lean_layout_flags.py still creates it, but remove_dead_lean_wizard_flag
	# deletes it (M5 decision — never had a renderer). Not a fixture field.
	"posa_lean_wizard_layout",
}

# Prefixes a NEW Custom Field fieldname may take. One per vertical, so two
# apps naming "the table field" cannot land on the same Custom Field record.
# Adding a vertical means adding its prefix here, deliberately.
VERTICAL_PREFIXES: tuple[str, ...] = (
	"posa_rt_",  # restaurante — tables, floors, kitchen routing
	"posa_tl_",  # taller — repair vertical
	"posa_cfdi_",  # CFDI-POS glue — facturación surface (emc integration)
)

# Fieldnames that shipped BEFORE the prefix rule existed. Frozen on purpose:
# derive this from hooks at runtime and the check can never fail. Do not add
# to it — a new field takes a VERTICAL_PREFIXES prefix instead.
GRANDFATHERED_FIELDNAMES: frozenset[str] = frozenset({
	"column_break_anyol", "column_break_dqsba", "column_break_uolvm",
	"create_pos_invoice_instead_of_sales_invoice",
	"custom_allow_create_quotation", "custom_allow_select_sales_order",
	"gift_card_redemptions", "hide_expected_amount", "name_overridden",
	"pos_awesome_payments", "pos_invoice", "posa_additional_notes_section",
	"posa_allow_cancel_submitted_cash_movement", "posa_allow_cash_deposit",
	"posa_allow_change_posting_date", "posa_allow_company_dashboard_scope",
	"posa_allow_create_purchase_items", "posa_allow_create_purchase_suppliers",
	"posa_allow_credit_sale", "posa_allow_customer_purchase_order",
	"posa_allow_delete", "posa_allow_delete_cancelled_cash_movement",
	"posa_allow_delete_offline_invoice", "posa_allow_duplicate_customer_names",
	"posa_allow_free_batch_return", "posa_allow_line_item_name_override",
	"posa_allow_make_new_payments", "posa_allow_mpesa_reconcile_payments",
	"posa_allow_multi_currency",
	"posa_allow_offline_sale_without_stock_verification",
	"posa_allow_partial_payment", "posa_allow_pos_expense",
	"posa_allow_price_list_rate_change", "posa_allow_print_draft_invoices",
	"posa_allow_print_last_invoice", "posa_allow_purchase_order",
	"posa_allow_purchase_receipt", "posa_allow_reconcile_payments",
	"posa_allow_return", "posa_allow_return_without_invoice",
	"posa_allow_sales_order", "posa_allow_select_print_format_in_payments",
	"posa_allow_source_account_override",
	"posa_allow_submissions_in_background_job",
	"posa_allow_user_to_edit_additional_discount",
	"posa_allow_user_to_edit_item_discount", "posa_allow_user_to_edit_rate",
	"posa_allow_write_off_change", "posa_allowed_expense_accounts",
	"posa_allowed_source_accounts", "posa_authorization_code",
	"posa_auto_open_customer_display", "posa_auto_referral",
	"posa_auto_set_batch", "posa_auto_set_delivery_charges",
	"posa_back_office_cash_account", "posa_bank_deposit_account",
	"posa_batch_price", "posa_birthday",
	"posa_block_sale_beyond_available_qty", "posa_camera_scan_type",
	"posa_capability_profile", "posa_cash_mode_of_payment",
	"posa_cash_movement_max_amount", "posa_client_request_id",
	"posa_closing_shift_print_format", "posa_col_1", "posa_column_break_111",
	"posa_column_break_112", "posa_column_break_22", "posa_coupons",
	"posa_create_only_sales_order", "posa_customer_offer",
	"posa_dashboard_default_scope", "posa_dashboard_low_stock_alert_threshold",
	"posa_decimal_precision", "posa_default_country",
	"posa_default_expense_account", "posa_default_sales_order",
	"posa_default_source_account", "posa_delivery_charges",
	"posa_delivery_charges_rate", "posa_delivery_date", "posa_discount",
	"posa_display_additional_notes", "posa_display_authorization_code",
	"posa_display_discount_amount", "posa_display_discount_percentage",
	"posa_display_item_code", "posa_display_items_in_stock",
	"posa_enable_awesome_dashboard", "posa_enable_awesome_dashboard_global",
	"posa_enable_camera_scanning", "posa_enable_cash_movement",
	"posa_enable_customer_display", "posa_enable_return_validity",
	"posa_enable_safe_transfer", "posa_force_close_stale_shift",
	"posa_force_price_from_customer_price_list", "posa_force_reload_items",
	"posa_force_server_items", "posa_gift_card_liability_account",
	"posa_hide_closing_shift", "posa_hide_items_until_search",
	"posa_hide_variants_items", "posa_input_qty", "posa_is_offer",
	"posa_is_printed", "posa_is_replace", "posa_language",
	"posa_lean_vertical_layout", "posa_local_storage",
	"posa_low_stock_alert_threshold", "posa_max_discount_allowed",
	"posa_new_line", "posa_notes", "posa_offer_applied", "posa_offers",
	"posa_open_print_in_new_tab", "posa_pos_awesome_advance_settings",
	"posa_pos_awesome_settings", "posa_pos_opening_shift", "posa_pos_pin",
	"posa_primary_offer", "posa_print_format_rules", "posa_qz_cut_after_print",
	"posa_qz_density", "posa_qz_interpolation", "posa_qz_printer_name",
	"posa_redeemed_customer_credit", "posa_referral_campaign",
	"posa_referral_code", "posa_referral_company", "posa_referral_section",
	"posa_remaining_customer_credit_balance",
	"posa_require_cash_movement_remarks", "posa_return_valid_upto",
	"posa_return_validity_days", "posa_row_id",
	"posa_safe_transfer_max_amount", "posa_sales_persons",
	"posa_scale_barcode_start", "posa_search_batch_no", "posa_search_limit",
	"posa_search_serial_no", "posa_section_awesome_dashboard",
	"posa_section_cash_movement", "posa_section_customer_display",
	"posa_section_dashboard", "posa_section_inventory_controls",
	"posa_section_pricing_controls", "posa_section_print_delivery",
	"posa_section_sales_purchase", "posa_section_sales_returns",
	"posa_server_cache_duration", "posa_show_custom_name_marker_on_print",
	"posa_show_customer_balance", "posa_show_template_items",
	"posa_silent_print", "posa_tab", "posa_tax_inclusive",
	"posa_use_charge_requests", "posa_use_delivery_charges",
	"posa_use_gift_cards", "posa_use_limit_search",
	"posa_use_percentage_discount", "posa_use_pos_awesome_payments",
	"posa_use_server_cache", "posa_use_web_route", "use_cashback",
	"use_customer_credit",
})


def parse_hooks_fixture_entries() -> list[list[str]]:
	"""Names from each Custom Field entry in the hooks `fixtures` list."""
	tree = ast.parse(HOOKS.read_text())
	entries: list[list[str]] = []
	for node in ast.walk(tree):
		if not (isinstance(node, ast.Assign) and any(
			isinstance(t, ast.Name) and t.id == "fixtures" for t in node.targets
		)):
			continue
		for item in node.value.elts:  # type: ignore[attr-defined]
			if not isinstance(item, ast.Dict):
				continue
			mapping = {
				k.value: v for k, v in zip(item.keys, item.values)
				if isinstance(k, ast.Constant)
			}
			if mapping.get("doctype") is None:
				continue
			doctype_node = next(
				k for k in item.keys if isinstance(k, ast.Constant) and k.value == "doctype"
			)
			doctype = item.values[item.keys.index(doctype_node)]
			if not (isinstance(doctype, ast.Constant) and doctype.value == "Custom Field"):
				continue
			names = [
				n.value
				for n in ast.walk(mapping["filters"])
				if isinstance(n, ast.Constant) and isinstance(n.value, str) and "-" in n.value
			]
			# drop filter operator strings like "name"/"in"
			entries.append([n for n in names if n not in ("name", "in")])
	return entries


def patch_created_fieldnames() -> dict[str, list[str]]:
	"""fieldname -> patch files that mention it as a created Custom Field."""
	out: dict[str, list[str]] = {}
	pattern = re.compile(r"[\"']fieldname[\"']\s*:\s*[\"'](\w+)[\"']")
	for patch in sorted(PATCHES_DIR.glob("*.py")):
		text = patch.read_text()
		if "Custom Field" not in text and "create_custom_field" not in text:
			continue
		for match in pattern.finditer(text):
			out.setdefault(match.group(1), []).append(patch.name)
	return out


def unprefixed_fieldnames(hooks_names: set[str], fixture_names: set[str]) -> list[str]:
	"""New fieldnames that carry no per-vertical prefix.

	Both sides are checked: hooks is where a field is DECLARED for delivery,
	the fixture file is what actually ships. A name added to only one of them
	is caught by invariants 2/3, but it must not dodge the prefix rule on the
	way through.
	"""
	candidates = {name.split("-", 1)[1] for name in hooks_names | fixture_names if "-" in name}
	return sorted(
		fieldname
		for fieldname in candidates
		if fieldname not in GRANDFATHERED_FIELDNAMES
		and not fieldname.startswith(VERTICAL_PREFIXES)
	)


def main() -> int:
	errors: list[str] = []

	entries = parse_hooks_fixture_entries()
	if len(entries) != 1:
		errors.append(
			f"hooks.py fixtures list has {len(entries)} 'Custom Field' entries — "
			"must be exactly 1 (a second entry overwrites the first's export)."
		)
	hooks_names: set[str] = {n for entry in entries for n in entry}

	fixture_names = {r["name"] for r in json.loads(FIXTURE_FILE.read_text())}

	missing_from_file = sorted(hooks_names - fixture_names)
	if missing_from_file:
		errors.append(
			"Custom Field names listed in hooks but ABSENT from "
			f"fixtures/custom_field.json ({len(missing_from_file)}) — re-run "
			"`bench export-fixtures --app posawesome` on a fully migrated site:\n  "
			+ "\n  ".join(missing_from_file)
		)

	unlisted_in_hooks = sorted(fixture_names - hooks_names)
	if unlisted_in_hooks:
		errors.append(
			"Records in fixtures/custom_field.json not named in hooks "
			f"({len(unlisted_in_hooks)}) — the next export will silently drop them:\n  "
			+ "\n  ".join(unlisted_in_hooks)
		)

	unprefixed = unprefixed_fieldnames(hooks_names, fixture_names)
	if unprefixed:
		errors.append(
			f"Custom Field fieldname(s) with no per-vertical prefix ({len(unprefixed)}) — "
			"Custom Fields are globally unique per site as {dt}-{fieldname} and the "
			"last writer wins SILENTLY, so a generic name is a cross-app overwrite "
			f"waiting to happen (C8). Rename to one of {', '.join(VERTICAL_PREFIXES)}*, "
			"or add a new prefix to VERTICAL_PREFIXES if this is a new vertical:\n  "
			+ "\n  ".join(unprefixed)
		)

	suffixes = {name.split("-", 1)[1] for name in hooks_names}
	for fieldname, patches in sorted(patch_created_fieldnames().items()):
		if fieldname in PATCH_ALLOWLIST or fieldname in suffixes:
			continue
		errors.append(
			f"patch(es) {', '.join(patches)} create Custom Field "
			f"'{fieldname}' but no '<Doctype>-{fieldname}' is in the hooks "
			"fixtures list — add it there and re-export, or add the fieldname "
			"to PATCH_ALLOWLIST with a reason."
		)

	if errors:
		print("fixture coverage check FAILED:\n")
		for err in errors:
			print(f"- {err}\n")
		return 1
	print(
		f"fixture coverage OK: {len(hooks_names)} hooks names, "
		f"{len(fixture_names)} fixture records, 1 Custom Field entry."
	)
	return 0


if __name__ == "__main__":
	sys.exit(main())
