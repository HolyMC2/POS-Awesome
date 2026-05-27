"""Heal the POS Awesome workspace Shortcut to point at /posapp via URL.

History
-------
- `f2d99d12` switched the workspace shortcut + 2 links to
  `link_type=URL link_to=/posapp` to skip the Desk-shell bounce.
- `95352acf` reverted ALL THREE rows to `link_type=Page link_to=posapp`
  after `bench migrate` blew up on the LINK rows with
  `DocType URL not found` (Workspace Link doctype has no `url` column
  on v16, and the sidebar JS reads `this.item.url` for URL types).
- Discovered today (2026-05-26) that **Workspace Shortcut DOES have a
  `url` column** — URL type works there. Only the Workspace Link
  doctype is broken under URL. So the shortcut can go direct without
  the redirect hop while links stay on Page+posapp.

What this patch does
--------------------
On every migrate, ensures the "POS Awesome App" shortcut on the
"POS Awesome" workspace is:

    type      = "URL"
    url       = "/posapp"
    link_to   = ""        (cleared — the URL branch in sidebar JS
                          uses `url`, not `link_to`)

Idempotent — no-op when already aligned. Does NOT touch Workspace
Link rows; they stay `link_type=Page link_to=posapp` and rely on
`posawesome/page/posapp/posapp.js` to `window.location.replace()`
to `/posapp` on hit (1 extra tick, negligible).

Operator experience
-------------------
- Sidebar shortcut icon → direct `/posapp` (zero Desk-shell flash).
- Sidebar card link → `/app/posapp` → `posapp.js` redirect → `/posapp`
  (1 tick, no visible flash).
"""

import frappe


def execute() -> None:
    if not frappe.db.exists("Workspace", "POS Awesome"):
        return
    rows = frappe.db.sql(
        """SELECT name, type, link_to, url
             FROM `tabWorkspace Shortcut`
            WHERE parent='POS Awesome' AND label='POS Awesome App'""",
        as_dict=True,
    )
    for r in rows:
        if r["type"] == "URL" and r["url"] == "/posapp" and not r["link_to"]:
            continue
        # Force-update via raw SQL — the Shortcut child-row save path
        # otherwise re-syncs against the parent Workspace's JSON copy
        # and races our edit on the same transaction.
        frappe.db.sql(
            """UPDATE `tabWorkspace Shortcut`
                  SET type='URL', url=%s, link_to=''
                WHERE name=%s""",
            ("/posapp", r["name"]),
        )
    frappe.db.commit()
