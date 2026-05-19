"""Add the P0 indexes flagged by REVIEW2/04 §2.6.

Telemetry table grows ~50 k rows/day per active tenant; without a
composite index on `(event_name, event_timestamp)` the dashboard
summary query degrades to a full scan within ~1 week of operation.

Idempotency-key lookups (`posa_client_request_id`) currently table-scan
on SI / POSI / PE / Submission-Ledger because the field is a Custom
Field with no DB index. At 10k+ submissions/day per tenant this is the
single biggest replay-protection cost.

Idempotent: each index is added only if it does not already exist
(MariaDB `KEY` lookup via `information_schema.STATISTICS`).
"""

import frappe


_INDEXES = (
    # (table, index_name, column_list)
    ("tabPOS Telemetry Event", "idx_event_time", "event_name, event_timestamp"),
    ("tabPOS Telemetry Event", "idx_terminal_time", "terminal, event_timestamp"),
    ("tabPOS Submission Ledger", "idx_client_request", "posa_client_request_id, state"),
    ("tabSales Invoice", "idx_posa_client_request", "posa_client_request_id"),
    ("tabPOS Invoice", "idx_posa_client_request", "posa_client_request_id"),
    ("tabPayment Entry", "idx_posa_client_request", "posa_client_request_id"),
)


def _index_exists(table: str, index_name: str) -> bool:
    rows = frappe.db.sql(
        """
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        LIMIT 1
        """,
        (table, index_name),
    )
    return bool(rows)


def _table_exists(table: str) -> bool:
    rows = frappe.db.sql(
        """
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        LIMIT 1
        """,
        (table,),
    )
    return bool(rows)


def _column_exists(table: str, column: str) -> bool:
    rows = frappe.db.sql(
        """
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        LIMIT 1
        """,
        (table, column),
    )
    return bool(rows)


def execute():
    """Idempotently create the P0 indexes documented in REVIEW2/04 §2.6."""
    for table, index_name, columns in _INDEXES:
        if not _table_exists(table):
            frappe.logger().info(
                f"[posawesome.add_p0_perf_indexes] skip {table}.{index_name} (table absent)"
            )
            continue

        # Spot-check the first column exists before issuing DDL —
        # `posa_client_request_id` is a Custom Field that may not have
        # been migrated on every site yet.
        first_column = columns.split(",", 1)[0].strip()
        if not _column_exists(table, first_column):
            frappe.logger().info(
                f"[posawesome.add_p0_perf_indexes] skip {table}.{index_name}"
                f" (column {first_column!r} absent — Custom Field not migrated yet)"
            )
            continue

        if _index_exists(table, index_name):
            continue

        frappe.db.sql(
            f"ALTER TABLE `{table}` ADD INDEX `{index_name}` ({columns})"
        )
        frappe.logger().info(
            f"[posawesome.add_p0_perf_indexes] added {table}.{index_name} ({columns})"
        )

    frappe.db.commit()
