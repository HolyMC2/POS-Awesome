#!/usr/bin/env python3
"""Find Vue component instance counts + DOM detached count.

Usage: heap_components.py <heapsnapshot file>
"""
import json
import sys

if len(sys.argv) < 2:
    sys.exit("usage: heap_components.py <heapsnapshot>")
PATH = sys.argv[1]

with open(PATH, "rb") as fh:
    data = json.load(fh)

meta = data["snapshot"]["meta"]
NODE_FIELDS = meta["node_fields"]
NODE_TYPE_NAMES = meta["node_types"][0]
nodes = data["nodes"]
strings = data["strings"]
node_count = data["snapshot"]["node_count"]

stride = len(NODE_FIELDS)
type_idx = NODE_FIELDS.index("type")
name_idx = NODE_FIELDS.index("name")
self_size_idx = NODE_FIELDS.index("self_size")
detach_idx = NODE_FIELDS.index("detachedness") if "detachedness" in NODE_FIELDS else None

# Count detached DOM nodes (detachedness=1=attached,2=detached,0=unknown)
detached_doms = 0
attached_doms = 0
total_doms = 0
detached_by_type = {}
component_names = {
    "PosApp": 0, "Pos": 0, "Invoice": 0, "Payments": 0,
    "ItemsSelector": 0, "ItemsTable": 0, "CartItemRow": 0,
    "Customer": 0, "PosOffers": 0, "PosCoupons": 0,
    "BarcodePrinting": 0, "Drafts": 0, "Returns": 0,
    "InvoiceManagement": 0, "ClosingDialog": 0, "Variants": 0,
    "MpesaPayments": 0, "NewAddress": 0,
}

# Look for HTML/SVG nodes (their type is "native" and name often starts with HTML/SVG)
for i in range(node_count):
    base = i * stride
    t = NODE_TYPE_NAMES[nodes[base + type_idx]]
    nm_id = nodes[base + name_idx]
    nm = strings[nm_id] if nm_id < len(strings) else ""
    if t == "native":
        if nm in component_names:
            component_names[nm] += 1
        # detachedness check
        if detach_idx is not None:
            d = nodes[base + detach_idx]
            if d == 2:
                detached_doms += 1
                detached_by_type[nm] = detached_by_type.get(nm, 0) + 1
            elif d == 1:
                attached_doms += 1
            total_doms += 1
    else:
        if nm in component_names:
            component_names[nm] += 1

print("=== Vue component instance counts (by class name) ===")
for k, v in sorted(component_names.items(), key=lambda x: -x[1]):
    if v > 0:
        print(f"  {v:>6}  {k}")

print()
print(f"=== DOM nodes ===")
print(f"  attached:  {attached_doms:,}")
print(f"  detached:  {detached_doms:,}  (likely-leaked DOM)")
print(f"  total:     {total_doms:,}")

print()
print("=== Top detached-DOM types (TOP retainers of leaked DOM) ===")
for nm, c in sorted(detached_by_type.items(), key=lambda x: -x[1])[:25]:
    print(f"  {c:>6}  {nm}")
