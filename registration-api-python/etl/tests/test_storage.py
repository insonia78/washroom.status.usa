import unittest

import httpx

from storage import ArchiveStorage, BUCKET, StorageError


class StorageTests(unittest.TestCase):
    def test_recursive_listing_download_and_precise_delete(self):
        requests = []

        def handler(request):
            requests.append(request)
            self.assertEqual(request.headers["authorization"], "Bearer test-secret")
            if "/list/" in request.url.path:
                import json
                prefix = json.loads(request.content)["prefix"]
                rows = [{"name": "2026", "id": None}] if prefix == "refuge-restrooms" else [
                    {"name": "one.json", "id": "uuid"}, {"name": "ignore.txt", "id": "uuid2"},
                ]
                return httpx.Response(200, json=rows)
            if request.method == "GET":
                return httpx.Response(200, json={"provider": "refuge-restrooms"})
            return httpx.Response(200, json=[{"name": "refuge-restrooms/2026/one.json"}])

        storage = ArchiveStorage("https://project.example", "test-secret", httpx.MockTransport(handler))
        try:
            self.assertEqual(storage.snapshot(), ["refuge-restrooms/2026/one.json"])
            self.assertEqual(storage.download(storage.snapshot()[0]), {"provider": "refuge-restrooms"})
            storage.delete("refuge-restrooms/2026/one.json")
            self.assertIn(BUCKET, requests[-1].url.path)
            for path in ["zippopotam/one.json", "refuge-restrooms/../one.json"]:
                with self.assertRaises(ValueError):
                    storage.delete(path)
        finally:
            storage.close()

    def test_http_and_deletion_confirmation_errors_are_explicit(self):
        for response in [httpx.Response(503), httpx.Response(200, json=[])]:
            storage = ArchiveStorage("https://project.example", "secret", httpx.MockTransport(lambda req: response))
            try:
                with self.assertRaises(StorageError):
                    storage.delete("refuge-restrooms/one.json")
            finally:
                storage.close()

    def test_pagination_snapshot_does_not_delete_or_skip_objects(self):
        offsets = []

        def handler(request):
            import json
            body = json.loads(request.content)
            self.assertEqual(body["prefix"], "refuge-restrooms")
            offsets.append(body["offset"])
            rows = [{"name": f"{i}.json", "id": str(i)} for i in range(1000)] if not body["offset"] else []
            return httpx.Response(200, json=rows)

        storage = ArchiveStorage("https://project.example", "secret", httpx.MockTransport(handler))
        try:
            self.assertEqual(len(storage.snapshot()), 1000)
            self.assertEqual(offsets, [0, 1000])
        finally:
            storage.close()
