#!/usr/bin/env python3
"""Fixture-coverage guard (vertical-profiles plan C8).

Three invariants, all statically checkable — no site, no frappe import:

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
}


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
