import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


class AttrDict(dict):
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__


def _install_framework_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.only_for = lambda *args, **kwargs: None
    frappe_module.log_error = lambda *args, **kwargs: None
    frappe_module.get_traceback = lambda *args, **kwargs: "traceback"
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_module.get_doc = lambda *args, **kwargs: None
    frappe_module.db = types.SimpleNamespace(commit=lambda: None)
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda value: int(value or 0)
    sys.modules["frappe.utils"] = frappe_utils

    return frappe_module


def _load_module():
    module_name = "posawesome.posawesome.api.item_processing.thumbnails"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "thumbnails.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class _FileDoc:
    """Minimal stand-in for frappe's File document."""

    def __init__(self, name, file_url, thumbnail_url=None, raises=None, **attrs):
        self.name = name
        self.file_url = file_url
        self.thumbnail_url = thumbnail_url
        self._raises = raises
        self.calls = 0
        for key, value in attrs.items():
            setattr(self, key, value)

    def make_thumbnail(self, width=None, height=None, suffix=None):
        self.calls += 1
        if self._raises:
            raise self._raises
        self.thumbnail_url = self.file_url.replace(".jpg", f"_{suffix}.jpg")
        return self.thumbnail_url


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class ThumbnailTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe = _install_framework_stubs()
        cls.thumbs = _load_module()

    def setUp(self):
        self.get_all_calls = []

    def _get_all(self, rows_by_url):
        """A `frappe.get_all` double that records every call it receives."""

        def fake_get_all(doctype, filters=None, fields=None, **kwargs):
            self.get_all_calls.append((doctype, filters, fields, kwargs))
            if doctype != "File":
                return []
            urls = (filters or {}).get("file_url")
            wanted = list(urls[1]) if isinstance(urls, (tuple, list)) else [urls]
            rows = []
            for url in wanted:
                rows.extend(rows_by_url.get(url, []))
            return rows

        return fake_get_all


class TestUrlEligibility(ThumbnailTestCase):
    def test_accepts_local_public_raster_photos(self):
        for url in (
            "/files/paracetamol.jpg",
            "/files/paracetamol.JPEG",
            "/files/sub folder/photo.png",
            "/files/photo.webp",
        ):
            self.assertTrue(self.thumbs.is_thumbnailable_url(url), url)

    def test_skips_everything_pillow_or_privacy_rules_out(self):
        for url in (
            None,
            "",
            "   ",
            # remote — nothing local to downscale
            "https://cdn.example.com/photo.jpg",
            "http://example.com/photo.jpg",
            # private — make_thumbnail writes into public/ regardless
            "/private/files/photo.jpg",
            # vector / animated / unknown
            "/files/logo.svg",
            "/files/loop.gif",
            "/files/notes.pdf",
            "/files/noextension",
        ):
            self.assertFalse(self.thumbs.is_thumbnailable_url(url), url)


class TestGenerationHooks(ThumbnailTestCase):
    def test_item_hook_generates_for_a_new_photo(self):
        doc_file = _FileDoc("FILE-1", "/files/a.jpg")
        item = AttrDict({"image": "/files/a.jpg", "get_doc_before_save": lambda: None})

        with (
            patch.object(
                self.thumbs.frappe,
                "get_all",
                side_effect=self._get_all({"/files/a.jpg": [{"name": "FILE-1", "thumbnail_url": None, "is_private": 0}]}),
            ),
            patch.object(self.thumbs.frappe, "get_doc", return_value=doc_file),
        ):
            self.thumbs.on_item_update(item)

        self.assertEqual(doc_file.calls, 1)
        self.assertEqual(doc_file.thumbnail_url, "/files/a_small.jpg")

    def test_item_hook_is_free_when_the_photo_did_not_change(self):
        previous = AttrDict({"image": "/files/a.jpg"})
        item = AttrDict({"image": "/files/a.jpg", "get_doc_before_save": lambda: previous})

        with patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})):
            self.thumbs.on_item_update(item)

        self.assertEqual(self.get_all_calls, [])

    def test_item_hook_skips_a_photo_that_already_has_a_thumbnail(self):
        rows = {"/files/a.jpg": [{"name": "FILE-1", "thumbnail_url": "/files/a_small.jpg", "is_private": 0}]}
        item = AttrDict({"image": "/files/a.jpg", "get_doc_before_save": lambda: None})

        get_doc = Mock()
        with (
            patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all(rows)),
            patch.object(self.thumbs.frappe, "get_doc", get_doc),
        ):
            self.thumbs.on_item_update(item)

        get_doc.assert_not_called()

    def test_item_hook_never_blocks_the_save_when_pillow_fails(self):
        # get_local_image throws a ValidationError on a file Pillow cannot open;
        # uncaught, that would abort the Item save over a bad JPEG.
        doc_file = _FileDoc("FILE-1", "/files/a.jpg", raises=ValueError("Unable to read file format"))
        item = AttrDict({"image": "/files/a.jpg", "get_doc_before_save": lambda: None})
        logged = []

        with (
            patch.object(
                self.thumbs.frappe,
                "get_all",
                side_effect=self._get_all({"/files/a.jpg": [{"name": "FILE-1", "thumbnail_url": None, "is_private": 0}]}),
            ),
            patch.object(self.thumbs.frappe, "get_doc", return_value=doc_file),
            patch.object(self.thumbs.frappe, "log_error", side_effect=lambda *a, **k: logged.append(a)),
        ):
            self.thumbs.on_item_update(item)  # must not raise

        self.assertEqual(doc_file.calls, 1)
        self.assertTrue(logged)

    def test_item_hook_survives_a_broken_lookup(self):
        item = AttrDict({"image": "/files/a.jpg", "get_doc_before_save": lambda: None})

        with (
            patch.object(self.thumbs.frappe, "get_all", side_effect=RuntimeError("db gone")),
            patch.object(self.thumbs.frappe, "log_error", side_effect=lambda *a, **k: None),
        ):
            self.thumbs.on_item_update(item)  # must not raise

    def test_file_hook_ignores_attachments_that_are_not_item_photos(self):
        get_doc = Mock()
        with (
            patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})),
            patch.object(self.thumbs.frappe, "get_doc", get_doc),
        ):
            self.thumbs.on_file_insert(
                AttrDict(
                    {
                        "attached_to_doctype": "Sales Invoice",
                        "attached_to_field": "image",
                        "file_url": "/files/a.jpg",
                        "name": "FILE-1",
                    }
                )
            )
            self.thumbs.on_file_insert(
                AttrDict(
                    {
                        "attached_to_doctype": "Item",
                        "attached_to_field": "custom_datasheet",
                        "file_url": "/files/a.jpg",
                        "name": "FILE-2",
                    }
                )
            )
            self.thumbs.on_file_insert(
                AttrDict(
                    {
                        "attached_to_doctype": "Item",
                        "attached_to_field": "image",
                        "file_url": "/private/files/a.jpg",
                        "name": "FILE-3",
                    }
                )
            )

        get_doc.assert_not_called()
        self.assertEqual(self.get_all_calls, [])

    def test_file_hook_thumbnails_the_upload_in_place(self):
        # The blob is already on disk and this is the same document, so the
        # hook must not spend a get_doc round-trip on it.
        doc_file = _FileDoc(
            "FILE-9",
            "/files/nueva.jpg",
            attached_to_doctype="Item",
            attached_to_field="image",
        )
        get_doc = Mock()

        with (
            patch.object(self.thumbs.frappe, "get_doc", get_doc),
            patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})),
        ):
            self.thumbs.on_file_insert(doc_file)

        self.assertEqual(doc_file.calls, 1)
        self.assertEqual(doc_file.thumbnail_url, "/files/nueva_small.jpg")
        get_doc.assert_not_called()
        self.assertEqual(self.get_all_calls, [])

    def test_file_hook_skips_an_upload_that_arrived_with_a_thumbnail(self):
        doc_file = _FileDoc(
            "FILE-9",
            "/files/nueva.jpg",
            thumbnail_url="/files/nueva_small.jpg",
            attached_to_doctype="Item",
            attached_to_field="image",
        )

        self.thumbs.on_file_insert(doc_file)

        self.assertEqual(doc_file.calls, 0)

    def test_file_hook_never_raises_into_the_upload(self):
        doc_file = _FileDoc(
            "FILE-9",
            "/files/nueva.jpg",
            raises=OSError("cannot write"),
            attached_to_doctype="Item",
            attached_to_field="image",
        )

        with patch.object(self.thumbs.frappe, "log_error", side_effect=lambda *a, **k: None):
            self.thumbs.on_file_insert(doc_file)


class TestServeAttachment(ThumbnailTestCase):
    def test_attaches_the_thumbnail_without_touching_the_full_size_image(self):
        rows_by_url = {
            "/files/a.jpg": [{"file_url": "/files/a.jpg", "thumbnail_url": "/files/a_small.jpg"}],
            "/files/b.png": [{"file_url": "/files/b.png", "thumbnail_url": "/files/b_small.png"}],
        }
        rows = [
            {"item_code": "A", "image": "/files/a.jpg"},
            {"item_code": "B", "image": "/files/b.png"},
            {"item_code": "C", "image": "/files/c.jpg"},  # no File row
            {"item_code": "D"},  # no photo
        ]

        with patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all(rows_by_url)):
            result = self.thumbs.attach_item_thumbnails(rows)

        self.assertEqual(result[0]["posa_image_thumb"], "/files/a_small.jpg")
        self.assertEqual(result[0]["image"], "/files/a.jpg")
        self.assertEqual(result[1]["posa_image_thumb"], "/files/b_small.png")
        self.assertNotIn("posa_image_thumb", result[2])
        self.assertNotIn("posa_image_thumb", result[3])

    def test_one_lookup_for_the_whole_page(self):
        rows = [{"item_code": f"I{i}", "image": f"/files/{i}.jpg"} for i in range(50)]

        with patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})):
            self.thumbs.attach_item_thumbnails(rows)

        self.assertEqual(len(self.get_all_calls), 1)
        doctype, filters, fields, _kwargs = self.get_all_calls[0]
        self.assertEqual(doctype, "File")
        self.assertEqual(filters["file_url"][0], "in")
        self.assertEqual(len(filters["file_url"][1]), 50)
        self.assertEqual(fields, ["file_url", "thumbnail_url"])

    def test_lean_search_rows_pay_zero_queries(self):
        # A lean search drops `image` from the SELECT entirely.
        rows = [{"item_code": "A", "item_name": "Paracetamol"} for _ in range(200)]

        with patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})):
            result = self.thumbs.attach_item_thumbnails(rows)

        self.assertEqual(self.get_all_calls, [])
        self.assertIs(result, rows)

    def test_remote_and_private_photos_pay_zero_queries(self):
        rows = [
            {"item_code": "A", "image": "https://cdn.example.com/a.jpg"},
            {"item_code": "B", "image": "/private/files/b.jpg"},
            {"item_code": "C", "image": "/files/c.svg"},
        ]

        with patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})):
            self.thumbs.attach_item_thumbnails(rows)

        self.assertEqual(self.get_all_calls, [])

    def test_a_broken_lookup_serves_full_size_photos_instead_of_failing(self):
        rows = [{"item_code": "A", "image": "/files/a.jpg"}]

        with (
            patch.object(self.thumbs.frappe, "get_all", side_effect=RuntimeError("db gone")),
            patch.object(self.thumbs.frappe, "log_error", side_effect=lambda *a, **k: None),
        ):
            result = self.thumbs.attach_item_thumbnails(rows)

        self.assertEqual(result[0]["image"], "/files/a.jpg")
        self.assertNotIn("posa_image_thumb", result[0])

    def test_chunks_large_pages(self):
        rows = [{"item_code": f"I{i}", "image": f"/files/{i}.jpg"} for i in range(450)]

        with patch.object(self.thumbs.frappe, "get_all", side_effect=self._get_all({})):
            self.thumbs.attach_item_thumbnails(rows)

        self.assertEqual(len(self.get_all_calls), 3)
        for _doctype, filters, _fields, _kwargs in self.get_all_calls:
            self.assertLessEqual(len(filters["file_url"][1]), self.thumbs.LOOKUP_CHUNK_SIZE)


class TestBackfill(ThumbnailTestCase):
    def _run(self, item_images, file_rows, docs, **kwargs):
        """Run the backfill against a fake catalog. Returns (counts, docs)."""

        def fake_get_all(doctype, filters=None, fields=None, **kw):
            self.get_all_calls.append((doctype, filters, fields, kw))
            if doctype == "Item":
                return [{"image": url} for url in item_images]
            urls = (filters or {}).get("file_url")
            wanted = list(urls[1]) if isinstance(urls, (tuple, list)) else [urls]
            return [row for row in file_rows if row["file_url"] in wanted]

        with (
            patch.object(self.thumbs.frappe, "get_all", side_effect=fake_get_all),
            patch.object(self.thumbs.frappe, "get_doc", side_effect=lambda _dt, name: docs[name]),
        ):
            return self.thumbs.backfill_item_thumbnails(**kwargs)

    def test_generates_only_for_photos_missing_a_thumbnail(self):
        item_images = [
            "/files/a.jpg",
            "/files/b.jpg",
            "/files/b.jpg",  # two items share one photo
            "/files/done.jpg",
            "/files/logo.svg",
            "https://cdn.example.com/remote.jpg",
            None,
        ]
        file_rows = [
            {"name": "F-A", "file_url": "/files/a.jpg", "thumbnail_url": None, "is_private": 0},
            {"name": "F-B", "file_url": "/files/b.jpg", "thumbnail_url": "", "is_private": 0},
            {"name": "F-B2", "file_url": "/files/b.jpg", "thumbnail_url": None, "is_private": 0},
            {"name": "F-D", "file_url": "/files/done.jpg", "thumbnail_url": "/files/done_small.jpg", "is_private": 0},
        ]
        docs = {
            "F-A": _FileDoc("F-A", "/files/a.jpg"),
            "F-B": _FileDoc("F-B", "/files/b.jpg"),
            "F-B2": _FileDoc("F-B2", "/files/b.jpg"),
        }

        counts = self._run(item_images, file_rows, docs)

        self.assertEqual(counts["item_images"], 3)  # a, b, done
        self.assertEqual(counts["candidates"], 2)  # a, b — done already has one
        self.assertEqual(counts["generated"], 2)
        self.assertEqual(counts["failed"], 0)
        self.assertEqual(counts["remaining"], 0)
        # One File doc per blob, not per referencing item.
        self.assertEqual(docs["F-B2"].calls, 0)

    def test_is_idempotent(self):
        file_rows = [{"name": "F-A", "file_url": "/files/a.jpg", "thumbnail_url": None, "is_private": 0}]
        docs = {"F-A": _FileDoc("F-A", "/files/a.jpg")}

        first = self._run(["/files/a.jpg"], file_rows, docs)
        self.assertEqual(first["generated"], 1)

        # Second pass sees the thumbnail_url the first pass wrote.
        file_rows[0]["thumbnail_url"] = "/files/a_small.jpg"
        second = self._run(["/files/a.jpg"], file_rows, docs)

        self.assertEqual(second["candidates"], 0)
        self.assertEqual(second["generated"], 0)
        self.assertEqual(second["remaining"], 0)
        self.assertEqual(docs["F-A"].calls, 1)

    def test_caps_each_run_and_reports_the_rest(self):
        item_images = [f"/files/{i}.jpg" for i in range(10)]
        file_rows = [
            {"name": f"F-{i}", "file_url": f"/files/{i}.jpg", "thumbnail_url": None, "is_private": 0}
            for i in range(10)
        ]
        docs = {f"F-{i}": _FileDoc(f"F-{i}", f"/files/{i}.jpg") for i in range(10)}

        counts = self._run(item_images, file_rows, docs, limit=3)

        self.assertEqual(counts["generated"], 3)
        self.assertEqual(counts["remaining"], 7)
        self.assertEqual(sum(doc.calls for doc in docs.values()), 3)

    def test_skips_private_files(self):
        file_rows = [{"name": "F-A", "file_url": "/files/a.jpg", "thumbnail_url": None, "is_private": 1}]
        docs = {"F-A": _FileDoc("F-A", "/files/a.jpg")}

        counts = self._run(["/files/a.jpg"], file_rows, docs)

        self.assertEqual(counts["candidates"], 0)
        self.assertEqual(docs["F-A"].calls, 0)

    def test_counts_failures_without_aborting_the_batch(self):
        item_images = ["/files/a.jpg", "/files/b.jpg"]
        file_rows = [
            {"name": "F-A", "file_url": "/files/a.jpg", "thumbnail_url": None, "is_private": 0},
            {"name": "F-B", "file_url": "/files/b.jpg", "thumbnail_url": None, "is_private": 0},
        ]
        docs = {
            "F-A": _FileDoc("F-A", "/files/a.jpg", raises=OSError("truncated")),
            "F-B": _FileDoc("F-B", "/files/b.jpg"),
        }

        with patch.object(self.thumbs.frappe, "log_error", side_effect=lambda *a, **k: None):
            counts = self._run(item_images, file_rows, docs)

        self.assertEqual(counts["generated"], 1)
        self.assertEqual(counts["failed"], 1)
        self.assertEqual(counts["remaining"], 1)

    def test_counts_are_json_safe(self):
        counts = self._run([], [], {})
        self.assertEqual(json.loads(json.dumps(counts)), counts)

    def test_string_limit_from_bench_execute_kwargs(self):
        item_images = [f"/files/{i}.jpg" for i in range(5)]
        file_rows = [
            {"name": f"F-{i}", "file_url": f"/files/{i}.jpg", "thumbnail_url": None, "is_private": 0}
            for i in range(5)
        ]
        docs = {f"F-{i}": _FileDoc(f"F-{i}", f"/files/{i}.jpg") for i in range(5)}

        counts = self._run(item_images, file_rows, docs, limit="2")

        self.assertEqual(counts["generated"], 2)

    def test_requires_system_manager(self):
        with patch.object(
            self.thumbs.frappe, "only_for", side_effect=PermissionError("nope")
        ):
            with self.assertRaises(PermissionError):
                self.thumbs.backfill_item_thumbnails()


if __name__ == "__main__":
    unittest.main()
