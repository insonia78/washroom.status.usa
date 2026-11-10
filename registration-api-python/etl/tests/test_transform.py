import unittest
from datetime import datetime, timezone

from fixtures import archive, restroom
from transform import transform_archive

CUTOFF = datetime(2026, 4, 1, tzinfo=timezone.utc)


class TransformationTests(unittest.TestCase):
    def test_maps_provider_identity_and_does_not_invent_fee_or_hours(self):
        row = transform_archive(archive(), CUTOFF)[0]
        self.assertEqual(row[:7], (123, "Public restroom", 39.95, -75.16, "yes", "no", "yes"))
        self.assertEqual(row[7].month, 2)
        self.assertEqual(row[8].month, 3)
        self.assertEqual(transform_archive(archive([]), CUTOFF), [])

    def test_rejects_entire_file_if_any_record_is_invalid(self):
        for invalid in (
            {"id": True}, {"id": 0}, {"latitude": float("nan")}, {"longitude": 181},
            {"accessible": "yes"}, {"name": None}, {"updated_at": "2026-02-01"},
            {"updated_at": "2027-01-01T00:00:00Z"}, {"created_at": "2026-02-02T00:00:00Z"},
        ):
            with self.subTest(invalid=invalid), self.assertRaises((ValueError, TypeError)):
                transform_archive(archive([restroom(), restroom(**invalid)]), CUTOFF)

    def test_failed_or_wrong_provider_exchanges_cannot_be_deleted_as_success(self):
        for payload in (
            archive(provider="zippopotam"), archive(error="network failure"),
            archive(response={"status": 500, "body": "[]"}),
            archive(response={"status": 200, "body": "{}"}),
            archive(response={"status": 200, "body": "broken json"}),
            archive(capturedAt="2027-01-01T00:00:00Z"),
            archive(request={"method": "GET", "url": "https://example.test/"}),
        ):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                transform_archive(payload, CUTOFF)
