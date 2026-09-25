// Copyright (c) 2026, Doco Mexico and contributors
// For license information, please see license.txt

// The Options table names its group by the Groups table's names. A Select
// keeps that a pick rather than a spelling test; its choices are refreshed
// from the Groups rows whenever they change. `POSCombo.validate` enforces the
// match server-side, so this is convenience, not the guard.
function refresh_group_choices(frm) {
	const names = (frm.doc.groups || [])
		.map((row) => (row.group_name || "").trim())
		.filter((name, index, all) => name && all.indexOf(name) === index);
	const grid = frm.fields_dict.options && frm.fields_dict.options.grid;
	if (!grid) return;
	grid.update_docfield_property("group_name", "options", ["", ...names].join("\n"));
	grid.refresh();
}

frappe.ui.form.on("POS Combo", {
	setup(frm) {
		// The paquete's own item: sold at its Item Price, never stocked, never
		// a bundle — the same rules `validate_choice_item` enforces.
		frm.set_query("combo_item", () => ({
			filters: { is_sales_item: 1, is_stock_item: 0, has_variants: 0, disabled: 0 },
		}));
		frm.set_query("item_code", "options", () => ({
			filters: {
				is_sales_item: 1,
				has_variants: 0,
				has_serial_no: 0,
				has_batch_no: 0,
				disabled: 0,
			},
		}));
	},

	refresh(frm) {
		refresh_group_choices(frm);
		if (frm.doc.combo_type === "Choice Groups" && frm.is_new() && !(frm.doc.groups || []).length) {
			frm.set_intro(
				__(
					"Add the groups the cashier asks for (Bebida, Pan), then the options for each. The register sells the Combo Item at its own price and adds each pick as its own line.",
				),
				"blue",
			);
		}
	},

	combo_type(frm) {
		refresh_group_choices(frm);
	},
});

frappe.ui.form.on("POS Combo Group", {
	group_name(frm) {
		refresh_group_choices(frm);
	},
	groups_remove(frm) {
		refresh_group_choices(frm);
	},
	groups_add(frm) {
		refresh_group_choices(frm);
	},
});
