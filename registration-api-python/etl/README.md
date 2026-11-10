# Monthly Refuge archive ETL

Python imports successful Refuge Restrooms exchanges from the private Supabase
`third-party-api-data-lake/refuge-restrooms/` prefix into
`app_locations.restrooms`. It deletes **only the individual archive whose entire
database transaction has committed**. ZIP/geocoding archives, malformed records,
failed provider responses and failed imports remain untouched. Existing restroom
records are never deleted.

## Setup

1. Apply [the migration](../../supabase-edge-functions/supabase/migrations/20261110120000_refuge_archive_etl.sql)
   after the existing application migrations. It adds Refuge identity support
   and version timestamps to the existing restroom table. The table must already
   have its unique `(osm_type, osm_id)` key. This does not provision a database.
2. Deploy the updated Places API so imported Refuge records preserve source
   identity and live Refuge results take precedence over their archived copies.
3. In GitHub **Settings → Environments**, create `data-lake-etl`. Configure
   environment secrets:
   - `SUPABASE_URL`: the HTTPS project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: server-only Storage list/read/delete credentials.
   - `ETL_DATABASE_URL`: a psycopg-compatible `postgresql://` URL with write access
     to the restroom table. Use TLS (`sslmode=require`) and a direct connection
     or Supabase **session-mode pooler**, not a transaction-mode pooler (the ETL
     uses a session advisory lock). GitHub-hosted runners may require the IPv4
     session pooler instead of the IPv6-only direct endpoint.
4. Push [the workflow](../../.github/workflows/monthly-refuge-etl.yml) to the default
   branch. It runs on the first day of each month at **03:00 UTC**. GitHub schedules
   can be delayed; they are not an exact-time guarantee. Production secrets are
   never needed by the regular CI tests.
5. First use **Actions → Monthly Refuge data-lake ETL → Run workflow**, with
   `dry_run` checked. Inspect the counters, then uncheck it to import and clean up.
   Required environment approvals also apply to scheduled runs.

No secrets, migration, production imports or deletions are deployed automatically
by adding these files. Do not copy credentials into source or workflow YAML.

## Local commands

From this directory, install `pip install -r requirements.txt`, set the three
environment variables above in your shell (no implicit `.env` loading), then:

```powershell
python run.py --dry-run
python run.py
python -m unittest discover -s tests -p "test_*.py"
```

Real PostgreSQL integration tests additionally require `ETL_TEST_DATABASE_URL`
pointing to an **empty, disposable** database named `washroom_etl_test`. Tests
create/drop only their fixture restroom table and apply the actual ETL migration.
CI supplies a dedicated PostgreSQL service and runs these tests without skips.

## Safety and retry semantics

- Identity is `('refuge', provider_id)`; a matching OSM numeric ID is not overwritten.
- All records in an archive are validated before any write. Provider timestamps
  and capture time prevent an older archive from overwriting newer imported data.
- Missing fees/hours are not fabricated; imported fees are initially `unknown`.
- Each archive writes atomically. Storage deletion happens afterward, never before
  commit. A deletion failure leaves committed data and the archive for an idempotent
  retry. Successful empty provider responses can be deleted without inserts.
- Object listing completes before deletions, avoiding pagination skips. Files
  captured after run start are retained. The whole archive must fit within 10 MiB.
- Concurrent runs are serialized by GitHub concurrency and a PostgreSQL session
  lock. Failed files log their path/error class and make the job fail, while other
  valid files continue. Counts describe processed records, not newly inserted rows.
- Unexpected schema changes/constraints cause rollback and retain the file.
  Correct malformed or failed archives manually; the ETL never discards them.
- Live provider calls still happen and create new archives; this job is not a
  replacement for live search. Keep normal database backups: deleted Storage
  archives are not a backup policy.
