import os
import unittest
from pathlib import Path
from unittest.mock import Mock

import psycopg

from database import acquire_lock, upsert_archive
from fixtures import archive, restroom
from run import process_archives
from storage import StorageError
from test_transform import CUTOFF
from transform import transform_archive


@unittest.skipUnless(os.environ.get("ETL_TEST_DATABASE_URL"), "Requires isolated ETL_TEST_DATABASE_URL")
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.connection = psycopg.connect(os.environ["ETL_TEST_DATABASE_URL"], autocommit=True)
        if cls.connection.info.dbname != "washroom_etl_test":
            cls.connection.close()
            raise RuntimeError("Integration tests require a dedicated database named washroom_etl_test")
        cls.connection.execute("create schema if not exists app_locations")
        cls.connection.execute("""
            create table app_locations.restrooms (
             id bigint generated always as identity primary key,
             osm_type text not null check (osm_type in ('node','way','relation')),
             osm_id bigint not null, name text, latitude double precision, longitude double precision,
             wheelchair text, fee text, changing_table text, unisex text, opening_hours text,
             unique(osm_type,osm_id), check (name <> 'force-database-error')
            )
        """)
        migration = Path(__file__).resolve().parents[3] / "supabase-edge-functions" / "supabase" / "migrations"
        cls.connection.execute((migration / "20261110120000_refuge_archive_etl.sql").read_text())

    @classmethod
    def tearDownClass(cls):
        cls.connection.execute("drop table app_locations.restrooms")
        cls.connection.close()

    def setUp(self):
        self.connection.execute("truncate app_locations.restrooms")

    def test_upsert_is_idempotent_preserves_osm_and_never_regresses_versions(self):
        self.connection.execute("""
          insert into app_locations.restrooms(osm_type,osm_id,name) values ('node',123,'OSM original')
        """)
        rows = transform_archive(archive(), CUTOFF)
        upsert_archive(self.connection, rows)
        upsert_archive(self.connection, rows)
        older = archive([restroom(name="Older", updated_at="2026-01-15T00:00:00Z")])
        upsert_archive(self.connection, transform_archive(older, CUTOFF))
        names = self.connection.execute("select osm_type,name from app_locations.restrooms order by osm_type").fetchall()
        self.assertEqual(names, [("node", "OSM original"), ("refuge", "Public restroom")])
        newer = archive([restroom(name="Renamed", updated_at="2026-02-15T00:00:00Z")])
        upsert_archive(self.connection, transform_archive(newer, CUTOFF))
        self.assertEqual(self.connection.execute(
            "select name,fee from app_locations.restrooms where osm_type='refuge'"
        ).fetchone(), ("Renamed", "unknown"))

    def test_constraint_failure_rolls_back_whole_archive(self):
        rows = transform_archive(archive([restroom(), restroom(id=124, name="force-database-error")]), CUTOFF)
        with self.assertRaises(psycopg.errors.CheckViolation):
            upsert_archive(self.connection, rows)
        self.assertEqual(self.connection.execute("select count(*) from app_locations.restrooms").fetchone()[0], 0)
        upsert_archive(self.connection, transform_archive(archive(), CUTOFF))
        self.assertEqual(self.connection.execute("select count(*) from app_locations.restrooms").fetchone()[0], 1)

    def test_commit_survives_storage_failure_and_retry_deletes_without_duplicates(self):
        storage = Mock()
        storage.snapshot.return_value = ["refuge-restrooms/one.json"]
        storage.download.return_value = archive()
        storage.delete.side_effect = StorageError("unavailable")
        with self.assertLogs("refuge-etl", level="ERROR"):
            self.assertEqual(process_archives(storage, self.connection, cutoff=CUTOFF)["failed"], 1)
        self.assertEqual(self.connection.execute("select count(*) from app_locations.restrooms").fetchone()[0], 1)
        storage.delete.side_effect = None
        self.assertEqual(process_archives(storage, self.connection, cutoff=CUTOFF)["deleted"], 1)
        self.assertEqual(self.connection.execute("select count(*) from app_locations.restrooms").fetchone()[0], 1)

    def test_session_lock_blocks_overlapping_imports(self):
        with psycopg.connect(os.environ["ETL_TEST_DATABASE_URL"], autocommit=True) as second:
            acquire_lock(self.connection)
            try:
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    acquire_lock(second)
            finally:
                self.connection.execute("select pg_advisory_unlock(73142, 1)")
