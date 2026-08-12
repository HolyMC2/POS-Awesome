import frappe


def execute():
    name = "restaurante-mesas"
    if not frappe.db.exists("POS Capability Profile", name):
        return
    capabilities = [
        part.strip()
        for part in (frappe.db.get_value("POS Capability Profile", name, "capabilities") or "").split(",")
        if part.strip()
    ]
    if "tips" not in capabilities:
        capabilities.append("tips")
        frappe.db.set_value("POS Capability Profile", name, "capabilities", ", ".join(capabilities))

    labels = frappe.parse_json(
        frappe.db.get_value("POS Capability Profile", name, "labels") or "{}"
    )
    if labels.get("Tip") != "Propina":
        labels["Tip"] = "Propina"
        frappe.db.set_value("POS Capability Profile", name, "labels", frappe.as_json(labels))
