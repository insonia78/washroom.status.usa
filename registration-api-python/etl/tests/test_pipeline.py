import unittest
from unittest.mock import Mock, patch

import psycopg

from fixtures import archive
from run import main, process_archives
from storage import StorageError
from test_transform import CUTOFF


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.storage = Mock()
        self.storage.snapshot.return_value = ["refuge-restrooms/one.json", "refuge-restrooms/two.json"]
        self.storage.download.return_value = archive()
        self.connection = Mock()

    def test_delete_is_strictly_after_commit(self):
        events = []
        self.storage.delete.side_effect = lambda path: events.append(("delete", path))
        with patch("run.upsert_archive", side_effect=lambda *args: events.append(("commit", None))):
            stats = process_archives(self.storage, self.connection, cutoff=CUTOFF)
        self.assertEqual([event[0] for event in events], ["commit", "delete", "commit", "delete"])
        self.assertEqual(stats, {"processed": 2, "records": 2, "deleted": 2, "failed": 0})

    def test_db_failure_retains_archive_and_continues(self):
        with patch("run.upsert_archive", side_effect=[psycopg.DatabaseError(), None]):
            with self.assertLogs("refuge-etl", level="ERROR"):
                stats = process_archives(self.storage, self.connection, cutoff=CUTOFF)
        self.storage.delete.assert_called_once_with("refuge-restrooms/two.json")
        self.assertEqual(stats["failed"], 1)

    def test_delete_failure_is_reported_and_retried_on_next_run(self):
        self.storage.delete.side_effect = StorageError("unavailable")
        with patch("run.upsert_archive") as upsert, self.assertLogs("refuge-etl", level="ERROR"):
            stats = process_archives(self.storage, self.connection, cutoff=CUTOFF)
        self.assertEqual(upsert.call_count, 2)
        self.assertEqual(stats["failed"], 2)
        self.assertEqual(stats["deleted"], 0)

    def test_invalid_archive_never_writes_or_deletes(self):
        self.storage.download.return_value = archive(provider="zippopotam")
        with patch("run.upsert_archive") as upsert, self.assertLogs("refuge-etl", level="ERROR"):
            stats = process_archives(self.storage, self.connection, cutoff=CUTOFF)
        upsert.assert_not_called()
        self.storage.delete.assert_not_called()
        self.assertEqual(stats["failed"], 2)

    def test_dry_run_never_writes_or_deletes(self):
        with patch("run.upsert_archive") as upsert:
            stats = process_archives(self.storage, self.connection, cutoff=CUTOFF, dry_run=True)
        upsert.assert_not_called()
        self.storage.delete.assert_not_called()
        self.assertEqual(stats["processed"], 2)

    def test_command_exits_nonzero_on_missing_configuration(self):
        with patch("sys.argv", ["run.py"]), patch.dict("os.environ", {}, clear=True):
            with self.assertLogs("refuge-etl", level="ERROR"):
                self.assertEqual(main(), 1)

    def test_command_exits_nonzero_on_retained_failures_and_closes_resources(self):
        self.connection.execute.return_value.fetchone.return_value = (True,)
        env = {
            "SUPABASE_URL": "https://project.example",
            "SUPABASE_SERVICE_ROLE_KEY": "test-key", "ETL_DATABASE_URL": "test-db",
        }
        with patch("sys.argv", ["run.py"]), patch.dict("os.environ", env, clear=True):
            with patch("run.psycopg.connect") as connect, patch("run.ArchiveStorage") as storage:
                connect.return_value.__enter__.return_value = self.connection
                with patch("run.process_archives", return_value={"failed": 1}):
                    self.assertEqual(main(), 1)
                storage.return_value.close.assert_called_once()
