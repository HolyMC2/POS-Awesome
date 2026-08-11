"""Restaurant / cafeteria table service API (docs/RESTAURANT_TABLES_SPEC.md).

Module map:

* ``_tickets``  — THE open-order predicate, occupancy reconcile, realtime.
                  Every other module in this package calls it; diverging from
                  it is how table state and ledger state start disagreeing.
* ``floors``    — floor snapshot (one grouped query) + floor layout save.
* ``orders``    — open / update / transfer / cancel the Record-Only ticket.
* ``settle``    — materialise + submit the accounting document at settle.
* ``kot``       — kitchen-ticket projection diffed against `last_fired`.
"""
