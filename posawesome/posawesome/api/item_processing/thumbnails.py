"""Item photo thumbnails for the POS catalog grid.

Item photos are uploaded straight off a phone camera — the live catalog
averages ~590KB per attachment — and the card grid renders them into a 132px
slot. Every catalog page therefore pulls tens of MB of pixels it throws away
at paint time.

Frappe already ships the machinery: ``File.make_thumbnail()`` writes a
downscaled copy next to the original and records it on ``tabFile.thumbnail_url``.
Nothing in core calls it for Item images (v16 core only exercises it from
``test_file.py``), so this module wires the three missing pieces:

* generation — ``Item.on_update`` / ``File.after_insert`` doc events;
* backfill — :func:`backfill_item_thumbnails` for photos already on disk;
* serving — :func:`attach_item_thumbnails`, called from the item search so
  each row carries ``posa_image_thumb`` alongside the untouched full-size
  ``image``.

Every entry point is fail-open. A thumbnail is an optimisation, never a
precondition: Pillow failures, unreadable files and permission errors are
logged and swallowed so the Item/File write always completes, and the SPA
falls back to the full-size photo whenever the thumb is missing or stale.
This matters more than it looks — ``File.make_thumbnail`` reaches
``get_local_image``, which ``frappe.throw``s a ValidationError on a file
Pillow cannot open, and an uncaught throw inside ``on_update`` would abort
the Item save over a bad JPEG.
"""

from typing import Any, Dict, Iterable, List, Optional, Sequence

import frappe
from frappe.utils import cint

# Attached to each search row next to `image`. `image` itself is left alone:
# the cart, the item-detail dialog and the print path all want the original.
THUMBNAIL_FIELD = "posa_image_thumb"

# Matches frappe's own default so a photo that already went through some other
# `make_thumbnail()` caller is reused rather than rewritten.
THUMBNAIL_SUFFIX = "small"
THUMBNAIL_WIDTH = 300
THUMBNAIL_HEIGHT = 300

# `tabFile` carries a `file_url(100)` prefix index (frappe's
# File.on_doctype_update), so an `IN (...)` lookup is indexed. Chunked anyway
# to keep the statement (and the placeholder list) bounded on big pages.
LOOKUP_CHUNK_SIZE = 200

DEFAULT_BACKFILL_LIMIT = 200

# Formats Pillow can both read and re-encode losslessly enough for a 300px
# thumbnail. SVG is already tiny and Pillow cannot rasterise it; GIF would
# lose its animation; anything else falls through to the full-size photo.
THUMBABLE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")

# Item fields that hold a photo the POS renders.
ITEM_IMAGE_FIELDS = ("image",)


def _log(title: str) -> None:
    """Record a swallowed failure without ever raising from the log call."""

    try:
        frappe.log_error(frappe.get_traceback(), title)
    except Exception:
        pass


def is_thumbnailable_url(file_url: Optional[str]) -> bool:
    """Return True for a local, public raster image we can safely downscale.

    Rejects remote/external URLs (nothing local to resize, and generating one
    would fetch the image on every save), private files (``make_thumbnail``
    writes into ``public/`` regardless of the source, so a private original
    would leak or fail), SVGs and unknown extensions.
    """

    url = (file_url or "").strip()
    if not url.startswith("/files/"):
        return False

    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    return path.endswith(THUMBABLE_EXTENSIONS)


def _run_make_thumbnail(file_doc) -> Optional[str]:
    """Run ``File.make_thumbnail`` on a File document. Never raises."""

    try:
        return (
            file_doc.make_thumbnail(
                width=THUMBNAIL_WIDTH,
                height=THUMBNAIL_HEIGHT,
                suffix=THUMBNAIL_SUFFIX,
            )
            or None
        )
    except Exception:
        _log("POS Awesome - Item thumbnail generation failed")
        return None


def _generate_thumbnail(file_name: str) -> Optional[str]:
    """Load one File row by name and thumbnail it. Never raises."""

    try:
        file_doc = frappe.get_doc("File", file_name)
    except Exception:
        _log("POS Awesome - Item thumbnail generation failed")
        return None

    return _run_make_thumbnail(file_doc)


def _file_rows_for_urls(urls: Sequence[str], fields: Sequence[str]) -> List[Dict[str, Any]]:
    """Fetch File rows for the given ``file_url`` values. Never raises."""

    rows: List[Dict[str, Any]] = []
    for start in range(0, len(urls), LOOKUP_CHUNK_SIZE):
        chunk = urls[start : start + LOOKUP_CHUNK_SIZE]
        try:
            rows.extend(
                frappe.get_all(
                    "File",
                    filters={"file_url": ("in", list(chunk))},
                    fields=list(fields),
                )
                or []
            )
        except Exception:
            _log("POS Awesome - Item thumbnail lookup failed")
    return rows


def ensure_thumbnail_for_url(file_url: Optional[str]) -> bool:
    """Generate the thumbnail for ``file_url`` when it has none yet.

    Returns True only when a thumbnail was actually written, so callers can
    count real work. Idempotent: a File row that already carries a
    ``thumbnail_url`` is left alone.
    """

    if not is_thumbnailable_url(file_url):
        return False

    # The same blob can be referenced by several File rows (each attach
    # creates one). Any row already carrying a thumbnail means the file on
    # disk exists, so there is nothing left to do.
    rows = _file_rows_for_urls([file_url], ["name", "thumbnail_url", "is_private"])
    pending = []
    for row in rows:
        if row.get("is_private"):
            continue
        if row.get("thumbnail_url"):
            return False
        pending.append(row.get("name"))

    for name in pending:
        if name and _generate_thumbnail(name):
            return True
    return False


def on_item_update(doc, method=None):
    """``Item.on_update``: keep the thumbnail in step with the item photo.

    Only fires real work when the photo is new or changed, so ordinary item
    saves (price, description, stock settings) pay nothing.
    """

    try:
        image = getattr(doc, "image", None)
        if not is_thumbnailable_url(image):
            return

        read_previous = getattr(doc, "get_doc_before_save", None)
        previous = read_previous() if callable(read_previous) else None
        if previous is not None and getattr(previous, "image", None) == image:
            return

        ensure_thumbnail_for_url(image)
    except Exception:
        _log("POS Awesome - Item thumbnail hook failed")


def on_file_insert(doc, method=None):
    """``File.after_insert``: photo uploaded straight onto an Item image field.

    Covers the paths that never re-save the Item document — code that creates
    the attachment and then writes ``Item.image`` with ``frappe.db.set_value``
    bypasses Item doc events entirely. Guarded so the 99% of File writes that
    have nothing to do with items (invoice attachments, backups, print files)
    return on a single attribute read.
    """

    try:
        if getattr(doc, "attached_to_doctype", None) != "Item":
            return
        if getattr(doc, "attached_to_field", None) not in ITEM_IMAGE_FIELDS:
            return
        if getattr(doc, "is_folder", 0):
            return

        file_url = getattr(doc, "file_url", None)
        if not is_thumbnailable_url(file_url):
            return
        if getattr(doc, "thumbnail_url", None):
            return

        # The uploaded blob is already on disk (File.before_insert wrote it),
        # and this is the same document, so thumbnail it in place rather than
        # re-fetching it.
        _run_make_thumbnail(doc)
    except Exception:
        _log("POS Awesome - File thumbnail hook failed")


def _thumbnail_map(urls: Sequence[str]) -> Dict[str, str]:
    """Map ``file_url`` -> ``thumbnail_url`` for the given URLs."""

    mapping: Dict[str, str] = {}
    for row in _file_rows_for_urls(urls, ["file_url", "thumbnail_url"]):
        thumb = row.get("thumbnail_url")
        url = row.get("file_url")
        # First non-empty wins: duplicate File rows for one blob are normal
        # and only the row that went through make_thumbnail carries the URL.
        if url and thumb and url not in mapping:
            mapping[url] = thumb
    return mapping


def attach_item_thumbnails(rows: Optional[Iterable[Dict[str, Any]]]):
    """Attach ``posa_image_thumb`` to search rows whose photo has a thumbnail.

    One indexed ``file_url IN (...)`` lookup per batch. Rows that carry no
    ``image`` at all — every lean search, which drops the image field from the
    query — cost zero queries.
    """

    if not rows:
        return rows

    urls = set()
    for row in rows:
        if isinstance(row, dict) and is_thumbnailable_url(row.get("image")):
            urls.add(row["image"])

    if not urls:
        return rows

    mapping = _thumbnail_map(sorted(urls))
    if not mapping:
        return rows

    for row in rows:
        if not isinstance(row, dict):
            continue
        thumb = mapping.get(row.get("image"))
        if thumb:
            row[THUMBNAIL_FIELD] = thumb

    return rows


@frappe.whitelist()
def backfill_item_thumbnails(limit=DEFAULT_BACKFILL_LIMIT):
    """Generate thumbnails for item photos that predate the doc events.

    Idempotent and capped: each run picks up at most ``limit`` photos still
    missing a thumbnail, so re-running converges and a run on a large catalog
    cannot monopolise a worker.

        bench --site <site> execute \\
            posawesome.posawesome.api.item_processing.thumbnails.backfill_item_thumbnails \\
            --kwargs '{"limit": 200}'
    """

    frappe.only_for("System Manager")

    limit = cint(limit) or DEFAULT_BACKFILL_LIMIT

    image_rows = (
        frappe.get_all(
            "Item",
            filters={"image": ("is", "set")},
            fields=["image"],
            distinct=True,
        )
        or []
    )

    urls = sorted({row.get("image") for row in image_rows if is_thumbnailable_url(row.get("image"))})

    # A blob can have several File rows; one of them carrying a thumbnail_url
    # means the thumbnail is on disk and the whole URL is done.
    done_urls = set()
    pending_by_url: Dict[str, str] = {}
    for row in _file_rows_for_urls(urls, ["name", "file_url", "thumbnail_url", "is_private"]):
        url = row.get("file_url")
        if not url or row.get("is_private"):
            continue
        if row.get("thumbnail_url"):
            done_urls.add(url)
        elif url not in pending_by_url:
            pending_by_url[url] = row.get("name")

    candidates: List[str] = [
        name for url, name in pending_by_url.items() if name and url not in done_urls
    ]

    generated = 0
    failed = 0
    for file_name in candidates[:limit]:
        if _generate_thumbnail(file_name):
            generated += 1
        else:
            failed += 1

    if generated:
        frappe.db.commit()

    return {
        "item_images": len(urls),
        "candidates": len(candidates),
        "generated": generated,
        "failed": failed,
        # Non-zero means "run me again" — either the cap truncated the batch or
        # some files could not be read.
        "remaining": len(candidates) - generated,
    }
