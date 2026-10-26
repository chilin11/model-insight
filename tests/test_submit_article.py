import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("submit_article", Path(__file__).resolve().parents[1] / "scripts/submit-article.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeOpener:
    def __init__(self, failure=None):
        self.calls = []
        self.failure = failure

    def open(self, req, timeout):
        self.calls.append(req)
        if req.full_url.endswith("/login"):
            result = {"authenticated": True}
        elif req.full_url.endswith("/logout"):
            result = {"authenticated": False}
        else:
            if self.failure:
                raise self.failure
            result = json.loads(req.data)
        return io.BytesIO(json.dumps(result).encode())


class SubmitArticleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("PI_SCRATCH_DIR"))
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "article.json"
        self.article = {"id": "test-opinion", "status": "draft", "title": "观点",
                        "description": "摘要", "body": "正文", "sources": [{"url": "https://linux.do/"}],
                        "publishedAt": "2026-10-26", "verifiedAt": "2026-10-26"}
        self.path.write_text(json.dumps({"article": self.article}))

    def test_site_policy(self):
        for value in ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=x", "https://example.com#fragment"]:
            with self.assertRaises(ValueError):
                module.site_url(value)
        self.assertEqual(module.site_url("https://example.com/"), "https://example.com")
        self.assertEqual(module.site_url("http://127.0.0.1:8188"), "http://127.0.0.1:8188")

    def test_draft_and_publish_do_not_modify_input(self):
        self.assertEqual(module.load_articles([self.path], False)[0]["status"], "draft")
        self.assertEqual(module.load_articles([self.path], True)[0]["status"], "published")
        self.assertEqual(json.loads(self.path.read_text())["article"]["status"], "draft")

    def test_duplicate_ids_and_keys(self):
        with self.assertRaises(ValueError):
            module.load_articles([self.path, self.path], False)
        self.path.write_text('{"article":{"id":"one","id":"two"}}')
        with self.assertRaises(ValueError):
            module.load_articles([self.path], False)

    def test_refuse_published_input_and_missing_fields(self):
        self.path.write_text('{"article":{"id":"test","status":"published"}}')
        with self.assertRaises(ValueError):
            module.load_articles([self.path], False)
        self.path.write_text('{"article":{"id":"test","status":"draft"}}')
        with self.assertRaises(ValueError):
            module.load_articles([self.path], True)

    def test_draft_uses_ingest_only(self):
        fake = FakeOpener()
        with patch.object(module.urllib.request, "build_opener", return_value=fake), contextlib.redirect_stdout(io.StringIO()):
            module.submit("https://example.com", [self.article], False, "test-api-token")
        self.assertEqual(len(fake.calls), 1)
        self.assertTrue(fake.calls[0].full_url.endswith("/api/ingest/articles"))
        self.assertEqual(fake.calls[0].get_header("Authorization"), "Bearer test-api-token")

    def test_publish_login_create_logout(self):
        fake = FakeOpener()
        articles = module.load_articles([self.path], True)
        with patch.object(module.urllib.request, "build_opener", return_value=fake), contextlib.redirect_stdout(io.StringIO()):
            module.submit("https://example.com", articles, True, "test-admin-token")
        self.assertEqual([req.full_url for req in fake.calls], ["https://example.com/api/admin/" + path for path in ["login", "articles", "logout"]])
        self.assertEqual(fake.calls[1].get_header("Origin"), "https://example.com")
        self.assertIsNone(fake.calls[1].get_header("Authorization"))

    def test_conflict_stops_batch_and_logs_out(self):
        fake = FakeOpener(urllib.error.HTTPError("https://example.com", 409, "conflict", {}, None))
        with patch.object(module.urllib.request, "build_opener", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "HTTP 409"):
                module.submit("https://example.com", [self.article, self.article], True, "test-admin-token")
        self.assertEqual(len(fake.calls), 3)
        self.assertTrue(fake.calls[-1].full_url.endswith("/logout"))

    def test_redirect_is_refused(self):
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://untrusted.invalid"))

    def test_no_credential_no_network(self):
        with patch.object(module.urllib.request, "build_opener") as build:
            with self.assertRaises(ValueError):
                module.submit("https://example.com", [self.article], False, "")
            build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
