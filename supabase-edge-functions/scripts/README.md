# Import the fuel SQL export into Supabase

`Import-FuelExport.ps1` imports the GDAL/PostGIS `export_fuel.sql` export into
`public.export_fuel`. It does not change the source file or wire this table into
Places API searches.

To connect the imported table to Places API, separately apply
`../supabase/migrations/20261022153000_search_fuel_locations.sql` and then deploy
Places API. The migration adds a server-only spatial RPC; the backend normalizes
and deduplicates stored fuel with other place results. The import alone does not
apply this migration.

## Requirements

- PowerShell 5.1 or newer.
- PostgreSQL client tools (`psql`). If it is not on PATH, pass
  `-PsqlPath 'C:\Program Files\PostgreSQL\17\bin\psql.exe'` with your installed version.
- Your Supabase **database** password and connection details from the project's
  **Connect** dialog, not an anon key or service-role API key.
- An administrative database user able to enable PostGIS and create tables.

Use the direct database connection if your network supports IPv6, or the
Supabase **session pooler** connection for IPv4. Copy the exact host, username,
database, and port from the Connect dialog. Do not use the transaction pooler
or the Supabase HTTPS API URL.

## Run from the repository root

```powershell
.\supabase-edge-functions\scripts\Import-FuelExport.ps1 `
  -SqlPath "$HOME\Downloads\export_fuel.sql" `
  -DatabaseHost 'YOUR_SESSION_POOLER_HOST' `
  -DatabaseUser 'postgres.YOUR_PROJECT_REF' `
  -DatabaseName 'postgres' `
  -Port 5432 `
  -BulkCopy
```

`-BulkCopy` requires Node.js and converts INSERT statements into a single
PostgreSQL `COPY` stream before connecting. It preserves sparse columns, SQL
NULLs, Unicode, apostrophes, backslashes, tabs, and multiline strings. Unsupported
input fails before database execution. Temporary converted files are removed.
This avoids a network round trip for every exported row. Omit the switch to use
the original INSERT-based import.

`psql` prompts for the database password when needed. Do not place passwords
in the script or command line; a PostgreSQL password file is also supported.
SSL is required.

If the table already exists, the import fails without modifying it. To
intentionally replace it, rerun with `-ReplaceExisting`. This deletes the old
table and its data **only if the complete import succeeds**. Dependencies such
as views prevent replacement rather than being removed with `CASCADE`.

The importer enables PostGIS if needed and uses its actual extension schema.
It removes the export's outer `BEGIN`/`COMMIT` and destructive `DROP ... CASCADE`,
then runs everything, including replacement, inside one fail-fast transaction.
Errors roll back the import. Do not run untrusted SQL files: this wrapper is for
the inspected GDAL export, not a general SQL sanitizer.

Import-only transaction settings allow up to ten minutes per statement, fail
after fifteen seconds waiting on locks, and close idle transactions after sixty
seconds if a client disconnect leaves a pooler session behind.

On success, it prints the row count and geometry count. The source export's GiST
spatial index is retained. Row-level security is enabled and permissions are
revoked from `PUBLIC`, `anon`, and `authenticated`, so importing into the exposed
`public` schema does not automatically grant browser access. No public policies
are created; access should stay in server-side backends.

No live database import is performed merely by adding this script.

Run converter regression tests with:

```powershell
node --test .\supabase-edge-functions\scripts\fuel-export-to-copy.test.mjs
```
