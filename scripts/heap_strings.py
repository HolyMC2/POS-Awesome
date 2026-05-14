#!/usr/bin/env python3
"""Inspect the strings table for POSAwesome / Frappe-related keys + counts.

Usage: heap_strings.py <heapsnapshot file>
"""
import json
import sys
import re

if len(sys.argv) < 2:
    sys.exit("usage: heap_strings.py <heapsnapshot>")
PATH = sys.argv[1]

with open(PATH, "rb") as fh:
    data = json.load(fh)

strings = data["strings"]

# Look for keys that suggest specific store entries / DOM hot spots
patterns = {
    "_search_index": 0,
    "posa_row_id": 0,
    "customer_name": 0,
    "item_code": 0,
    "pricing rule": 0,
    "RefImpl": 0,
    "EffectScope": 0,
    "ReactiveEffect": 0,
    "v-data-table": 0,
    "v-list-item": 0,
    "v-overlay": 0,
    "v-menu": 0,
    "v-autocomplete": 0,
    "Frappe": 0,
    "frappe": 0,
    "Pinia": 0,
    "subscribers": 0,
    "Listener": 0,
    "EventBus": 0,
    "eventBus": 0,
    "items_per_page": 0,
}

for s in strings:
    if not isinstance(s, str):
        continue
    for k in patterns:
        if k in s:
            patterns[k] += 1

# Also: count IDs of the form "IPN" (item codes)
n_ipn = sum(1 for s in strings if isinstance(s, str) and re.match(r"^IPN\d+", s))
n_pos = sum(1 for s in strings if isinstance(s, str) and "posa_" in s.lower())
n_inv = sum(1 for s in strings if isinstance(s, str) and re.match(r"^SINV-", s))

print("=== string occurrences (count of distinct string entries containing the key) ===")
for k, v in patterns.items():
    print(f"  {v:>10}  {k}")

print()
print(f"  {n_ipn:>10}  ^IPN\\d+ (item codes)")
print(f"  {n_pos:>10}  posa_*")
print(f"  {n_inv:>10}  ^SINV- (sales invoices)")
print()
print(f"Total strings: {len(strings):,}")
