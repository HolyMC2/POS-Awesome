"""Photo evidence for cash bags and counts.

Custody records are server-controlled: no role holds write on them, so Frappe's
generic upload cannot attach anything to a bag or count. ``upload_photo`` is
the one narrow path. It never saves the custody record itself; it only inserts
a private ``File`` attached to it, marked with ``attached_to_field =
PHOTO_FIELD``.

The marker is what the File hooks below protect: a marked File is created only
while this module holds its service flag, and is never edited, re-pointed, made
public or deleted afterwards. Unmarked files keep Frappe's normal behaviour.

Downloading goes through Frappe's private-file handler, which asks the attached
record for ``read`` — the same custody scope rule (register, company, own
counts) every other custody read uses.
"""
import base64
import binascii
import hashlib
import io
import re
import warnings
from contextlib import contextmanager

import frappe
from frappe import _

PHOTO_DOCTYPES = ('POS Cash Bag', 'POS Cash Count')
# File.attached_to_field marker. Not a field on either record, so nothing in
# Frappe mistakes a photo for an Attach field value.
PHOTO_FIELD = 'posa_cash_photo'
MAX_PHOTOS = 6
MAX_BYTES = 5 * 1024 * 1024
MAX_ENCODED = 4 * ((MAX_BYTES + 2) // 3)
# A header can claim any size; refuse before Pillow allocates the pixels.
MAX_SIDE = 12000
MAX_PIXELS = 50_000_000
# Stored copy: enough to read a seal number or a note serial, small on disk.
STORED_SIDE = 2560
FORMATS = {'JPEG', 'PNG', 'WEBP'}
# The roles that already work custody records (read grant on bag and count).
UPLOAD_ROLES = {'POS User', 'Sales User', 'POS Awesome Supervisor', 'System Manager'}
FIELDS = ['name', 'file_url', 'file_name', 'creation', 'owner']
_FLAG = 'cash_custody_photo'


@contextmanager
def _writing():
    old = getattr(frappe.local, _FLAG, False)
    setattr(frappe.local, _FLAG, True)
    try:
        yield
    finally:
        setattr(frappe.local, _FLAG, old)


# Imported on use: the File hooks load this module for every File write on the
# site and need none of the custody or closing machinery.
def _permitted(doc, user):
    from posawesome.posawesome.api.cash_custody.documents import permitted
    return permitted(doc, user, 'read')


def _supervisor(user):
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
        is_closing_supervisor,
    )
    return bool(is_closing_supervisor(user))


def _denied():
    # Same answer for missing and out-of-scope records: a name is not a key.
    frappe.throw(_('This cash record does not exist or belongs to a register you cannot access.'),
                 frappe.PermissionError)


def _record(doctype, name):
    if doctype not in PHOTO_DOCTYPES:
        frappe.throw(_('Photos can only be kept on a cash bag or a cash count.'))
    if not isinstance(name, str) or not name.strip() or len(name) > 140:
        frappe.throw(_('Choose a cash bag or count.'))
    user = frappe.session.user
    if not user or user == 'Guest':
        frappe.throw(_('Sign in to see cash photos.'), frappe.PermissionError)
    if not frappe.db.exists(doctype, name):
        _denied()
    doc = frappe.get_doc(doctype, name)
    # Role grant plus the custody scope rule, checked explicitly as well.
    if not frappe.has_permission(doctype, 'read', doc=doc, user=user) or not _permitted(doc, user):
        _denied()
    return doc


def _may_upload(user):
    return bool(UPLOAD_ROLES.intersection(frappe.get_roles(user) or [])) or _supervisor(user)


def _when(value):
    # One shape whether the row came from the insert (string) or a query (datetime).
    if not value:
        return None
    return value[:19] if isinstance(value, str) else value.strftime('%Y-%m-%d %H:%M:%S')


def _row(row):
    return dict({key: row.get(key) for key in FIELDS}, creation=_when(row.get('creation')))


def _photos(doc, lock=False):
    if lock:
        # A current read: a waited row lock does not refresh the transaction's
        # earlier snapshot, and a retry must see the photo it is retrying.
        rows = frappe.db.sql('''SELECT name, file_url, file_name, creation, owner FROM `tabFile`
            WHERE attached_to_doctype=%s AND attached_to_name=%s AND attached_to_field=%s AND is_private=1
            ORDER BY creation ASC, name ASC FOR UPDATE''', (doc.doctype, doc.name, PHOTO_FIELD), as_dict=True)
    else:
        rows = frappe.get_all('File', filters={'attached_to_doctype': doc.doctype, 'attached_to_name': doc.name,
            'attached_to_field': PHOTO_FIELD, 'is_private': 1}, fields=FIELDS,
            order_by='creation asc, name asc', limit_page_length=50)
    return [_row(row) for row in rows]


def _decoded(content):
    if not isinstance(content, str) or not content.strip():
        frappe.throw(_('Take or choose a photo first.'))
    text = content.strip()
    if text.startswith('data:'):
        head, _sep, text = text.partition(',')
        if not head.endswith(';base64'):
            frappe.throw(_('This file is not a photo. Take a JPEG, PNG or WebP photo and try again.'))
    text = re.sub(r'\s+', '', text)
    if len(text) > MAX_ENCODED:
        frappe.throw(_('The photo is larger than 5 MB. Take it again at a lower resolution.'))
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        frappe.throw(_('The photo did not arrive complete. Try again.'))
    if not raw:
        frappe.throw(_('Take or choose a photo first.'))
    if len(raw) > MAX_BYTES:
        frappe.throw(_('The photo is larger than 5 MB. Take it again at a lower resolution.'))
    return raw


def _unreadable():
    frappe.throw(_('This file is not a readable photo. Take a JPEG, PNG or WebP photo and try again.'))


def _normalized(raw):
    """Decode a raster photo and re-encode a clean JPEG: upright, no metadata."""
    from PIL import Image, ImageOps

    def fits(size):
        width, height = size
        return 0 < width <= MAX_SIDE and 0 < height <= MAX_SIDE and width * height <= MAX_PIXELS

    with warnings.catch_warnings():
        # Pillow's own bomb guard warns below 2x its limit; treat it as fatal.
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        kind, size, verified = None, (0, 0), False
        try:
            # Only the header is read here; pixels are decoded after the size check.
            with Image.open(io.BytesIO(raw)) as probe:
                kind, size = probe.format, probe.size
                if kind in FORMATS and fits(size):
                    probe.verify()
                    verified = True
        except Exception:
            verified = False
        if kind in FORMATS and not fits(size):
            frappe.throw(_('This photo is too large to keep. Take it again at a lower resolution.'))
        if not verified:
            _unreadable()
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if kind == 'JPEG':
                    image.draft('RGB', (STORED_SIDE, STORED_SIDE))
                image.load()
                upright = ImageOps.exif_transpose(image)
                upright.thumbnail((STORED_SIDE, STORED_SIDE))
                rgba = upright.convert('RGBA')
                # A fresh canvas carries no EXIF, GPS, ICC or text chunks.
                clean = Image.new('RGB', rgba.size, (255, 255, 255))
                clean.paste(rgba, mask=rgba.getchannel('A'))
                out = io.BytesIO()
                clean.save(out, 'JPEG', quality=85, optimize=True)
        except Exception:
            out = None
    if out is None:
        _unreadable()
    data = out.getvalue()
    if not data or len(data) > MAX_BYTES:
        _unreadable()
    return data


def _file_name(doc, digest):
    kind = 'bag' if doc.doctype == 'POS Cash Bag' else 'count'
    return 'cash-' + kind + '-' + re.sub(r'[^A-Za-z0-9_-]', '-', doc.name)[:60] + '-' + digest + '.jpg'


@frappe.whitelist()
def list_photos(doctype, name):
    doc = _record(doctype, name)
    photos = _photos(doc)
    return {'photos': photos, 'can_upload': _may_upload(frappe.session.user) and len(photos) < MAX_PHOTOS,
            'max_photos': MAX_PHOTOS, 'max_bytes': MAX_BYTES}


@frappe.whitelist(methods=['POST'])
def upload_photo(doctype, name, filename=None, content=None):
    """Attach one private photo to a bag or count. Safe to retry.

    ``filename`` is accepted for the client's convenience but never stored:
    the server names the file after the record and the image hash.
    """
    doc = _record(doctype, name)
    if not _may_upload(frappe.session.user):
        frappe.throw(_('Your role cannot add photos to cash records.'), frappe.PermissionError)
    raw = _decoded(content)
    # Retries resend the same bytes; the stored copy is keyed to them.
    digest = hashlib.sha256(raw).hexdigest()[:24]
    image = _normalized(raw)
    # Serialize photo writes per record; limit and retry are decided under this lock.
    frappe.db.get_value(doc.doctype, doc.name, 'name', for_update=True)
    photos = _photos(doc, lock=True)
    for row in photos:
        if digest in (row.get('file_name') or ''):
            return row
    if len(photos) >= MAX_PHOTOS:
        frappe.throw(_('This record already has {0} photos, the most it can keep.').format(MAX_PHOTOS))
    file = frappe.get_doc({'doctype': 'File', 'file_name': _file_name(doc, digest), 'is_private': 1,
        'attached_to_doctype': doc.doctype, 'attached_to_name': doc.name,
        'attached_to_field': PHOTO_FIELD, 'content': image})
    with _writing():
        file.insert(ignore_permissions=True)
    return _row(file)


# File hooks -----------------------------------------------------------------
def _marked(doc):
    return doc is not None and doc.get('attached_to_field') == PHOTO_FIELD


def _was_marked(doc):
    if doc.flags.in_insert:
        return False
    previous = doc.get_doc_before_save()
    if previous is not None:
        return _marked(previous)
    return bool(doc.name) and frappe.db.get_value('File', doc.name, 'attached_to_field') == PHOTO_FIELD


def guard_file(doc, method=None):
    """File before_insert / before_validate / on_update.

    Only ``upload_photo`` may create a marked photo, and nobody may change one:
    not its record, marker, privacy, URL or name.
    """
    if getattr(frappe.local, _FLAG, False):
        return
    if _marked(doc) or _was_marked(doc):
        frappe.throw(_('Cash photos are added from the cash record and cannot be changed afterwards.'),
                     frappe.PermissionError)
    # A new File pointing at an evidence URL would otherwise grant its new
    # owner download access through Frappe's ordinary owner shortcut.
    if doc.get('file_url') and frappe.db.exists('File', {
        'file_url': doc.file_url, 'attached_to_field': PHOTO_FIELD,
    }):
        frappe.throw(_('Cash photos cannot be copied or attached to another record.'), frappe.PermissionError)


def protect_file(doc, method=None):
    """File on_trash: photo evidence is kept with its cash record."""
    if _marked(doc) and not getattr(frappe.local, _FLAG, False):
        frappe.throw(_('Cash photos are kept as evidence and cannot be deleted. Add a new photo instead.'),
                     frappe.PermissionError)


def file_permission(doc, ptype=None, user=None, debug=False):
    """Evidence access follows the parent even if its uploader changes shops."""
    if not _marked(doc):
        return True
    user = user or frappe.session.user
    if (ptype not in (None, 'read', 'select', 'print') or user == 'Guest' or not doc.is_private
            or doc.attached_to_doctype not in PHOTO_DOCTYPES or not doc.attached_to_name):
        return False
    if not frappe.db.exists(doc.attached_to_doctype, doc.attached_to_name):
        return False
    parent = frappe.get_doc(doc.attached_to_doctype, doc.attached_to_name)
    return bool(frappe.has_permission(parent.doctype, 'read', doc=parent, user=user)
                and _permitted(parent, user))


class CashPhotoFile:
    """Native File.is_downloadable calls its module function, bypassing hooks.

    Frappe v16's extension seam lets marked evidence use the stricter parent
    check; ordinary files retain the framework's behaviour.
    """
    def is_downloadable(self):
        if _marked(self):
            return file_permission(self, 'read')
        return super().is_downloadable()


def file_query(user=None):
    from .documents import count_query, query
    user = user or frappe.session.user
    parents = []
    for doctype in PHOTO_DOCTYPES:
        scope = (count_query(user) if doctype == 'POS Cash Count' else query(doctype, user)) or '1=1'
        parents.append("(`tabFile`.attached_to_doctype=" + frappe.db.escape(doctype)
                       + " AND EXISTS (SELECT 1 FROM `tab" + doctype
                       + "` WHERE `tab" + doctype + "`.name=`tabFile`.attached_to_name AND (" + scope + ")))")
    return "(COALESCE(`tabFile`.attached_to_field,'')!=" + frappe.db.escape(PHOTO_FIELD) + " OR (" + ' OR '.join(parents) + "))"
