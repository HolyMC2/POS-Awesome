from frappe.utils import flt

# Movement types that ADD cash to the register drawer. Everything else
# ("Expense", "Deposit") takes cash OUT of the drawer — the Journal Entry
# always debits target and credits source, and for those types the source
# is the drawer cash account. "Cash In" reverses the flow: back-office
# cash → drawer (change fund / fondo de cambio), so the drawer is the
# TARGET and closing reconciliation must add it to expected cash.
CASH_IN_TYPES = frozenset({"Cash In"})


def drawer_delta(movement_type, amount):
    """Signed effect of one movement on expected drawer cash."""
    magnitude = abs(flt(amount))
    if (movement_type or "").strip() in CASH_IN_TYPES:
        return magnitude
    return -magnitude
