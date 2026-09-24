"""Cash photo evidence: scope, image hygiene, retry safety and immutable files.

Runs without a site: frappe and the custody scope helpers are stubbed so the
endpoint's own rules are what gets asserted. Pillow is real — the image checks
are the point.
"""
import base64
import importlib.util
import io
import pathlib
import struct
import sys
import types
import unittest
import zlib
from unittest.mock import patch

try:
    from PIL import Image, features
    from PIL.PngImagePlugin import PngInfo
except ImportError:  # pragma: no cover - Pillow ships with every Frappe bench
    Image = None


class _Permission(Exception):
    pass


class _Validation(Exception):
    pass


_previous_modules = {key: sys.modules.get(key) for key in ("frappe",)}


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.PermissionError = _Permission
    frappe_module.ValidationError = _Validation

    def throw(message, exc=_Validation):
        raise exc(message)

    frappe_module.throw = throw
    frappe_module._ = lambda message, *args, **kwargs: message
    frappe_module.session = types.SimpleNamespace(user="ana@example.com")
    frappe_module.local = types.SimpleNamespace()
    sys.modules["frappe"] = frappe_module
    return frappe_module


FRAPPE = _install_stubs()


def _load_module():
    name = "_custody_photos_under_test"
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name("photos.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


try:
    photos = _load_module()
finally:
    # Native Frappe test discovery must retain the real framework modules.
    for key, previous in _previous_modules.items():
        if previous is None:
            sys.modules.pop(key, None)
        else:
            sys.modules[key] = previous


class _Record(dict):
    """A custody record. Any attempt to write it fails the test."""

    def __getattr__(self, key):
        return self.get(key)

    def _forbidden(self, *args, **kwargs):
        raise AssertionError("photo upload must never write the custody record")

    save = db_set = submit = cancel = delete = _forbidden


class _NewFile(dict):
    def __init__(self, site, values):
        super().__init__(values)
        self.site = site
        self.flags = types.SimpleNamespace(in_insert=True)

    def __getattr__(self, key):
        return self.get(key)

    def get_doc_before_save(self):
        return None

    def insert(self, ignore_permissions=False):
        self.site.inserts.append(dict(ignore_permissions=ignore_permissions,
                                      flag=getattr(FRAPPE.local, "cash_custody_photo", False)))
        # The real hooks run inside insert; they must accept the endpoint's own file.
        photos.guard_file(self, "before_insert")
        number = len(self.site.files) + 1
        self.update(name=f"FILE-{number:03d}", file_url="/private/files/" + self["file_name"],
                    creation=f"2026-09-23 10:00:{number:02d}.000001", owner=FRAPPE.session.user)
        photos.guard_file(self, "on_update")
        self.site.files.append(dict(self))
        return self


class _Site:
    """Routes the frappe calls photos.py makes at an in-memory site."""

    def __init__(self, user="ana@example.com", roles=("POS User",), profiles=("Custody QA",), supervisor=False):
        self.user, self.roles, self.profiles, self.supervisor = user, list(roles), set(profiles), supervisor
        self.records, self.files, self.inserts, self.calls = {}, [], [], []
        self.role_read = True
        self.add("POS Cash Bag", "CASH-BAG-00014", prepared_by="ana@example.com")
        self.add("POS Cash Bag", "CASH-BAG-00015", prepared_by="ana@example.com")
        self.add("POS Cash Bag", "CASH-BAG-00099", pos_profile="Other Register", company="Other Co")
        self.add("POS Cash Count", "CASH-COUNT-00031", counted_by="ana@example.com")
        self.add("POS Cash Count", "CASH-COUNT-00032", counted_by="beto@example.com")

    def add(self, doctype, name, **values):
        record = dict(doctype=doctype, name=name, pos_profile="Custody QA", company="Grupo Doco",
                      state="Available", amount=900)
        record.update(values)
        self.records[(doctype, name)] = _Record(record)

    def permitted(self, doc, user):
        # Mirrors documents.permitted for reads: register scope and own counts.
        self.calls.append(("permitted", doc.name, "read"))
        if doc.doctype == "POS Cash Count" and not self.supervisor and doc.counted_by != user:
            return False
        return doc.pos_profile in self.profiles

    def _matches(self, row, filters):
        return all(row.get(key) == value for key, value in filters.items())

    def exists(self, doctype, name):
        self.calls.append(("exists", doctype, name))
        return (doctype, name) in self.records

    def get_value(self, doctype, name, field, for_update=False, **kwargs):
        self.calls.append(("lock" if for_update else "get_value", doctype, name))
        if doctype == "File":
            row = next((f for f in self.files if f["name"] == name), None)
            return row and row.get(field)
        return name if (doctype, name) in self.records else None

    def sql(self, query, values=(), as_dict=False):
        self.calls.append(("sql", query))
        if "FOR UPDATE" not in query:
            raise AssertionError("the retry/limit read must be a locking read")
        doctype, name, marker = values
        return [dict(f) for f in self.files if self._matches(f, dict(
            attached_to_doctype=doctype, attached_to_name=name, attached_to_field=marker, is_private=1))]

    def get_all(self, doctype, filters=None, fields=None, **kwargs):
        self.calls.append(("get_all", doctype))
        return [{key: f.get(key) for key in fields} for f in self.files if self._matches(f, filters)]

    def get_doc(self, doctype, name=None, **kwargs):
        if isinstance(doctype, dict):
            return _NewFile(self, doctype)
        return self.records[(doctype, name)]

    def __enter__(self):
        FRAPPE.session.user = self.user
        FRAPPE.local = types.SimpleNamespace()
        FRAPPE.db = types.SimpleNamespace(exists=self.exists, get_value=self.get_value, sql=self.sql)
        FRAPPE.get_all = self.get_all
        FRAPPE.get_doc = self.get_doc
        FRAPPE.get_roles = lambda user=None: list(self.roles)
        FRAPPE.has_permission = lambda doctype=None, ptype="read", doc=None, user=None, **kw: self.role_read
        self._patches = [patch.object(photos, "_permitted", self.permitted),
                         patch.object(photos, "_supervisor", lambda user: self.supervisor)]
        for item in self._patches:
            item.start()
        return self

    def __exit__(self, *args):
        for item in self._patches:
            item.stop()

    def used_files(self):
        return [call for call in self.calls if call[0] in {"lock", "sql", "get_all"}]


def _b64(data):
    return base64.b64encode(data).decode()


def _jpeg(size=(40, 20), color=(200, 30, 30), orientation=None, maker=None):
    image = Image.new("RGB", size, color)
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if maker:
        exif[0x010F] = maker
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif.tobytes())
    return out.getvalue()


def _png_header(width, height):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"")) + chunk(b"IEND", b""))


@unittest.skipUnless(Image, "Pillow is required")
class TestAccess(unittest.TestCase):
    def test_rejects_other_doctypes_before_any_lookup(self):
        for doctype in ["Journal Entry", "POS Cash Safe", "POS Cash Custody Event", "File", None]:
            with self.subTest(doctype=doctype), _Site() as site:
                with self.assertRaises(_Validation):
                    photos.list_photos(doctype, "X")
                with self.assertRaises(_Validation):
                    photos.upload_photo(doctype, "X", "a.jpg", _b64(_jpeg()))
                self.assertEqual(site.calls, [])

    def test_missing_and_out_of_scope_records_look_the_same(self):
        messages = []
        for name in ["CASH-BAG-404", "CASH-BAG-00099"]:
            with _Site() as site, self.assertRaises(_Permission) as caught:
                photos.list_photos("POS Cash Bag", name)
            self.assertEqual(site.used_files(), [])
            messages.append(str(caught.exception))
        self.assertEqual(messages[0], messages[1])

    def test_out_of_scope_upload_stores_nothing(self):
        with _Site() as site, self.assertRaises(_Permission):
            photos.upload_photo("POS Cash Bag", "CASH-BAG-00099", "a.jpg", _b64(_jpeg()))
        self.assertEqual((site.files, site.used_files()), ([], []))

    def test_role_read_grant_is_also_required(self):
        with _Site() as site, self.assertRaises(_Permission):
            site.role_read = False
            photos.list_photos("POS Cash Bag", "CASH-BAG-00014")
        self.assertEqual(site.used_files(), [])

    def test_counts_follow_own_count_visibility(self):
        with _Site() as site:
            with self.assertRaises(_Permission):
                photos.list_photos("POS Cash Count", "CASH-COUNT-00032")
            with self.assertRaises(_Permission):
                photos.upload_photo("POS Cash Count", "CASH-COUNT-00032", "a.jpg", _b64(_jpeg()))
            self.assertTrue(photos.list_photos("POS Cash Count", "CASH-COUNT-00031")["can_upload"])
            self.assertIn(("permitted", "CASH-COUNT-00032", "read"), site.calls)
        with _Site(supervisor=True, roles=("POS Awesome Supervisor",)):
            photos.upload_photo("POS Cash Count", "CASH-COUNT-00032", "a.jpg", _b64(_jpeg()))

    def test_reader_without_a_custody_role_cannot_upload(self):
        with _Site(roles=("Accounts User",)) as site:
            self.assertFalse(photos.list_photos("POS Cash Bag", "CASH-BAG-00014")["can_upload"])
            with self.assertRaises(_Permission):
                photos.upload_photo("POS Cash Bag", "CASH-BAG-00014", "a.jpg", _b64(_jpeg()))
        self.assertEqual(site.files, [])

    def test_guest_is_refused(self):
        with _Site(user="Guest") as site, self.assertRaises(_Permission):
            photos.list_photos("POS Cash Bag", "CASH-BAG-00014")
        self.assertEqual(site.calls, [])


@unittest.skipUnless(Image, "Pillow is required")
class TestUpload(unittest.TestCase):
    def upload(self, site, name="CASH-BAG-00014", data=None, doctype="POS Cash Bag"):
        return photos.upload_photo(doctype, name, "IMG_0001.HEIC.jpg", _b64(data or _jpeg()))

    def test_stores_a_private_marked_file_under_the_service_flag(self):
        with _Site() as site:
            row = self.upload(site)
            self.assertFalse(getattr(FRAPPE.local, "cash_custody_photo", False))
        stored = site.files[0]
        self.assertEqual(site.inserts, [dict(ignore_permissions=True, flag=True)])
        self.assertEqual(stored["is_private"], 1)
        self.assertEqual(stored["attached_to_doctype"], "POS Cash Bag")
        self.assertEqual(stored["attached_to_name"], "CASH-BAG-00014")
        self.assertEqual(stored["attached_to_field"], photos.PHOTO_FIELD)
        self.assertTrue(stored["file_url"].startswith("/private/files/cash-bag-CASH-BAG-00014-"))
        self.assertNotIn("IMG_0001", stored["file_name"])
        self.assertEqual(set(row), {"name", "file_url", "file_name", "creation", "owner"})
        self.assertEqual(row["owner"], "ana@example.com")
        self.assertIsInstance(row["creation"], str)

    def test_stored_photo_is_upright_and_carries_no_metadata(self):
        with _Site() as site:
            self.upload(site, data=_jpeg(size=(40, 20), orientation=6, maker="SECRET-PHONE-MODEL"))
        content = site.files[0]["content"]
        self.assertNotIn(b"SECRET-PHONE-MODEL", content)
        with Image.open(io.BytesIO(content)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.size, (20, 40))
            self.assertEqual(len(image.getexif()), 0)

    def test_png_with_transparency_and_text_is_flattened(self):
        info = PngInfo()
        info.add_text("Comment", "SECRET-LOCATION")
        out = io.BytesIO()
        Image.new("RGBA", (12, 12), (0, 0, 0, 0)).save(out, "PNG", pnginfo=info)
        with _Site() as site:
            self.upload(site, data=out.getvalue())
        content = site.files[0]["content"]
        self.assertNotIn(b"SECRET-LOCATION", content)
        with Image.open(io.BytesIO(content)) as image:
            self.assertEqual(image.getpixel((5, 5)), (255, 255, 255))

    @unittest.skipUnless(Image and features.check("webp"), "Pillow built without WebP")
    def test_webp_is_accepted(self):
        out = io.BytesIO()
        Image.new("RGB", (16, 16), (10, 120, 10)).save(out, "WEBP")
        with _Site() as site:
            self.upload(site, data=out.getvalue())
        self.assertEqual(len(site.files), 1)

    def test_large_photos_are_scaled_down(self):
        with _Site() as site:
            self.upload(site, data=_jpeg(size=(3000, 1500)))
        with Image.open(io.BytesIO(site.files[0]["content"])) as image:
            self.assertLessEqual(max(image.size), photos.STORED_SIDE)

    def test_data_url_prefix_is_accepted(self):
        with _Site() as site:
            photos.upload_photo("POS Cash Bag", "CASH-BAG-00014", "a.jpg",
                                "data:image/jpeg;base64," + _b64(_jpeg()))
        self.assertEqual(len(site.files), 1)

    def test_retry_returns_the_same_photo_without_a_second_file(self):
        data = _jpeg()
        with _Site() as site:
            first = self.upload(site, data=data)
            again = self.upload(site, data=data)
        self.assertEqual(first, again)
        self.assertEqual(len(site.files), 1)
        lock = site.calls.index(("lock", "POS Cash Bag", "CASH-BAG-00014"))
        first_read = next(i for i, call in enumerate(site.calls) if call[0] == "sql")
        self.assertLess(lock, first_read)

    def test_same_picture_on_two_records_is_kept_for_each(self):
        data = _jpeg()
        with _Site() as site:
            self.upload(site, "CASH-BAG-00014", data)
            self.upload(site, "CASH-BAG-00015", data)
            self.assertEqual(len(photos.list_photos("POS Cash Bag", "CASH-BAG-00014")["photos"]), 1)
        self.assertEqual([f["attached_to_name"] for f in site.files], ["CASH-BAG-00014", "CASH-BAG-00015"])

    def test_limit_is_enforced_but_a_retry_still_resolves(self):
        with _Site() as site:
            images = [_jpeg(color=(i * 30, 10, 10)) for i in range(photos.MAX_PHOTOS)]
            for data in images:
                self.upload(site, data=data)
            listed = photos.list_photos("POS Cash Bag", "CASH-BAG-00014")
            self.assertFalse(listed["can_upload"])
            with self.assertRaises(_Validation):
                self.upload(site, data=_jpeg(color=(1, 250, 1)))
            self.assertEqual(self.upload(site, data=images[0])["name"], "FILE-001")
        self.assertEqual(len(site.files), photos.MAX_PHOTOS)

    def test_list_contract(self):
        with _Site() as site:
            self.upload(site)
            listed = photos.list_photos("POS Cash Bag", "CASH-BAG-00014")
        self.assertEqual(set(listed), {"photos", "can_upload", "max_photos", "max_bytes"})
        self.assertEqual((listed["max_photos"], listed["max_bytes"]), (6, 5 * 1024 * 1024))
        self.assertEqual(listed["photos"][0]["file_url"], site.files[0]["file_url"])
        self.assertTrue(listed["can_upload"])

    def test_marked_but_public_files_are_not_listed(self):
        with _Site() as site:
            site.files.append(dict(name="F-PUBLIC", attached_to_doctype="POS Cash Bag", is_private=0,
                                   attached_to_name="CASH-BAG-00014", attached_to_field=photos.PHOTO_FIELD,
                                   file_url="/files/x.jpg", file_name="x.jpg", creation="c", owner="o"))
            self.assertEqual(photos.list_photos("POS Cash Bag", "CASH-BAG-00014")["photos"], [])


@unittest.skipUnless(Image, "Pillow is required")
class TestRejectedInput(unittest.TestCase):
    def assertRejected(self, content, fragment=None):
        with _Site() as site, self.assertRaises(_Validation) as caught:
            photos.upload_photo("POS Cash Bag", "CASH-BAG-00014", "a.jpg", content)
        # Refused before locking the record or touching files.
        self.assertEqual((site.files, site.used_files()), ([], []))
        message = str(caught.exception)
        self.assertNotIn("Traceback", message)
        if fragment:
            self.assertIn(fragment, message)

    def test_missing_or_malformed_content(self):
        for content in [None, "", "   ", b"\xff\xd8", 42, "not base64!!", "QUJD=="]:
            with self.subTest(content=content):
                self.assertRejected(content)

    def test_non_images_are_refused(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        html = b"<!doctype html><script>alert(1)</script>"
        for data in [svg, html, b"%PDF-1.7\n", b"MZ\x90\x00"]:
            with self.subTest(data=data[:8]):
                self.assertRejected(_b64(data), "not a readable photo")
        self.assertRejected("data:text/html,<script>alert(1)</script>")

    def test_other_raster_formats_are_refused(self):
        out = io.BytesIO()
        Image.new("RGB", (8, 8)).save(out, "GIF")
        self.assertRejected(_b64(out.getvalue()), "not a readable photo")

    def test_truncated_jpeg_is_refused(self):
        data = _jpeg(size=(400, 300))
        self.assertRejected(_b64(data[: len(data) // 2]))

    def test_oversized_upload_is_refused(self):
        self.assertRejected(_b64(b"\xff" * (photos.MAX_BYTES + 1)), "5 MB")
        self.assertRejected("A" * (photos.MAX_ENCODED + 8), "5 MB")

    def test_giant_dimensions_are_refused_before_decoding(self):
        self.assertRejected(_b64(_png_header(8000, 8000)), "too large")
        self.assertRejected(_b64(_png_header(photos.MAX_SIDE + 1, 10)), "too large")
        # Far past Pillow's own bomb limit: refused at open.
        self.assertRejected(_b64(_png_header(40000, 40000)))


class _HookFile(dict):
    def __init__(self, previous=None, in_insert=False, **values):
        super().__init__(values)
        self.flags = types.SimpleNamespace(in_insert=in_insert)
        self.previous = previous

    def __getattr__(self, key):
        return self.get(key)

    def get_doc_before_save(self):
        return self.previous


def _marked_file(**overrides):
    values = dict(name="FILE-001", attached_to_doctype="POS Cash Bag", attached_to_name="CASH-BAG-00014",
                  attached_to_field=photos.PHOTO_FIELD, is_private=1, file_url="/private/files/a.jpg")
    values.update(overrides)
    return values


class TestFileHooks(unittest.TestCase):
    def setUp(self):
        self.site = _Site().__enter__()

    def tearDown(self):
        self.site.__exit__()

    def test_file_read_follows_parent_even_for_its_uploader(self):
        doc = _HookFile(**_marked_file())
        self.assertTrue(photos.file_permission(doc, 'read'))
        self.site.profiles.clear()
        self.assertFalse(photos.file_permission(doc, 'read'))

    def test_file_metadata_and_mutation_cannot_bypass_own_count_scope(self):
        doc = _HookFile(**_marked_file(attached_to_doctype='POS Cash Count', attached_to_name='CASH-COUNT-00032'))
        self.assertFalse(photos.file_permission(doc, 'read'))
        self.assertFalse(photos.file_permission(_HookFile(**_marked_file()), 'write'))
        self.assertTrue(photos.file_permission(_HookFile(attached_to_doctype='Item'), 'write'))

    def test_url_alias_cannot_turn_a_photo_into_an_owned_unattached_file(self):
        with patch.object(FRAPPE.db, 'exists', return_value=True):
            with self.assertRaises(_Permission):
                photos.guard_file(_HookFile(in_insert=True, file_url='/private/files/a.jpg'))

    def test_generic_marked_attachment_is_refused(self):
        for event in ["before_insert", "before_validate"]:
            with self.subTest(event=event), self.assertRaises(_Permission):
                photos.guard_file(_HookFile(in_insert=True, **_marked_file()), event)

    def test_service_flag_admits_the_endpoint_insert(self):
        with photos._writing():
            photos.guard_file(_HookFile(in_insert=True, **_marked_file()), "before_insert")
        self.assertFalse(FRAPPE.local.cash_custody_photo)

    def test_unmarked_files_are_untouched_and_cost_no_query(self):
        photos.guard_file(_HookFile(in_insert=True, attached_to_doctype="POS Cash Bag",
                                    attached_to_name="CASH-BAG-00014"), "before_insert")
        photos.guard_file(_HookFile(previous=_HookFile(attached_to_doctype="Item"), attached_to_doctype="Item"),
                          "before_validate")
        photos.protect_file(_HookFile(attached_to_doctype="Sales Invoice"), "on_trash")
        self.assertEqual(self.site.calls, [])

    def test_marked_photo_cannot_be_detached_published_or_moved(self):
        previous = _HookFile(**_marked_file())
        for change in [dict(attached_to_field=None), dict(is_private=0), dict(attached_to_name="CASH-BAG-00015"),
                       dict(file_url="/files/a.jpg"), dict(attached_to_doctype="Item", attached_to_field="image")]:
            with self.subTest(change=change), self.assertRaises(_Permission):
                photos.guard_file(_HookFile(previous=previous, **_marked_file(**change)), "before_validate")

    def test_marked_state_is_read_from_the_database_when_no_snapshot_exists(self):
        self.site.files.append(_marked_file())
        with self.assertRaises(_Permission):
            photos.guard_file(_HookFile(**_marked_file(attached_to_field=None)), "on_update")

    def test_marked_photo_cannot_be_deleted(self):
        with self.assertRaises(_Permission):
            photos.protect_file(_HookFile(**_marked_file()), "on_trash")

    def test_hooks_are_registered_next_to_the_existing_file_handler(self):
        hooks = pathlib.Path(__file__).parents[3].joinpath("hooks.py").read_text()
        self.assertIn('"after_insert": "posawesome.posawesome.api.item_processing.thumbnails.on_file_insert"', hooks)
        for event, handler in [("before_insert", "guard_file"), ("before_validate", "guard_file"),
                               ("on_update", "guard_file"), ("on_trash", "protect_file")]:
            self.assertIn(f'_append_hook("File", "{event}", f"{{_CASH_PHOTOS}}.{handler}")', hooks)


if __name__ == "__main__":
    unittest.main()
