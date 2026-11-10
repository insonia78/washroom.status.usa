import argparse
import logging
import os
from datetime import datetime, timezone

import psycopg

from database import acquire_lock, upsert_archive
from storage import ArchiveStorage, StorageError
from transform import transform_archive

logger = logging.getLogger("refuge-etl")


def process_archives(storage, connection, *, dry_run=False, cutoff=None) -> dict[str, int]:
    cutoff = cutoff or datetime.now(timezone.utc)
    stats = {"processed": 0, "records": 0, "deleted": 0, "failed": 0}
    for path in storage.snapshot():
        try:
            rows = transform_archive(storage.download(path), cutoff)
            if not dry_run:
                upsert_archive(connection, rows)
                storage.delete(path)
                stats["deleted"] += 1
            stats["processed"] += 1
            stats["records"] += len(rows)
        except (ValueError, TypeError, OverflowError, StorageError, psycopg.Error) as error:
            stats["failed"] += 1
            # DB/provider errors can include payload values; do not log their contents.
            logger.error("Archive retained: %s (%s)", path, type(error).__name__)
    logger.info("ETL dry_run=%s %s", dry_run, stats)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Refuge archives, then delete committed archive files.")
    parser.add_argument("--dry-run", action="store_true", help="Validate only; do not write or delete.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    required = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ETL_DATABASE_URL")
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        logger.error("Missing configuration: %s", ", ".join(missing))
        return 1
    storage = None
    try:
        storage = ArchiveStorage(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        with psycopg.connect(os.environ["ETL_DATABASE_URL"], autocommit=True, connect_timeout=15) as connection:
            connection.execute("set statement_timeout = '60s'")
            acquire_lock(connection)
            stats = process_archives(storage, connection, dry_run=args.dry_run)
            return 1 if stats["failed"] else 0
    except (psycopg.Error, StorageError, ValueError, RuntimeError) as error:
        logger.error("ETL stopped (%s); unprocessed archives retained", type(error).__name__)
        return 1
    finally:
        if storage is not None:
            storage.close()


if __name__ == "__main__":
    raise SystemExit(main())
