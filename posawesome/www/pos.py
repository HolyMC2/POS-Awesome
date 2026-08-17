"""`/pos` — branded alias for the POS SPA (roadmap §17.4).

The SPA, its service worker, PWA manifest (`id`/`start_url`) and every
bookmark stay on `/posapp`; this route only redirects so "Muelle POS lives
at /pos" can be said out loud without forking the PWA identity. If `/pos`
ever becomes the canonical route, that is a manifest-id migration with an
SW deprecation window — not a www alias.
"""

import frappe


def get_context(context):
    frappe.local.flags.redirect_location = "/posapp"
    raise frappe.Redirect
