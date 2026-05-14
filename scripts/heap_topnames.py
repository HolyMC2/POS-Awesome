#!/usr/bin/env python3
"""Stream a Chrome heapsnapshot and report top retained class names.

Usage: heap_topnames.py <heapsnapshot file>
"""
import json
import sys
import collections

if len(sys.argv) < 2:
    sys.exit("usage: heap_topnames.py <heapsnapshot>")
PATH = sys.argv[1]

# Heap-snapshot files are valid JSON but large. Loading whole thing is ~ 1 GB RAM
# for a 200 MB snapshot. We do it directly because there is no streaming API.
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

# Aggregate by (node_type_name, name_string)
agg_count = collections.Counter()
agg_size = collections.Counter()

for i in range(node_count):
    base = i * stride
    t = NODE_TYPE_NAMES[nodes[base + type_idx]]
    nm = strings[nodes[base + name_idx]] if nodes[base + name_idx] < len(strings) else ""
    sz = nodes[base + self_size_idx]
    key = (t, nm)
    agg_count[key] += 1
    agg_size[key] += sz

print("=== Top 40 by COUNT ===")
for (t, nm), c in agg_count.most_common(40):
    s = agg_size[(t, nm)]
    print(f"  {c:>10}  {s/1024/1024:>8.1f} MB  {t:<14}  {nm[:80]}")

print()
print("=== Top 40 by SELF SIZE ===")
for (t, nm), s in agg_size.most_common(40):
    c = agg_count[(t, nm)]
    print(f"  {s/1024/1024:>8.1f} MB  {c:>10}  {t:<14}  {nm[:80]}")
