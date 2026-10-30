[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseHost,
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUser,
    [string]$DatabaseName = 'postgres',
    [ValidateRange(1, 65535)]
    [int]$Port = 5432,
    [string]$SqlPath = (Join-Path $HOME 'Downloads\export_fuel.sql'),
    [string]$PsqlPath = 'psql',
    [ValidateSet('app_locations', 'public')]
    [string]$TargetSchema = 'app_locations',
    [switch]$ReplaceExisting,
    [switch]$BulkCopy
)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $SqlPath).ProviderPath
$psql = Get-Command $PsqlPath -ErrorAction Stop
$temporaryPath = [System.IO.Path]::GetTempFileName()
$previousSslMode = $env:PGSSLMODE
$previousConnectTimeout = $env:PGCONNECT_TIMEOUT
$reader = $null
$writer = $null
$bulkPath = $null

try {
    if ($BulkCopy) {
        $bulkPath = [System.IO.Path]::GetTempFileName()
        & node (Join-Path $PSScriptRoot 'fuel-export-to-copy.mjs') $sourcePath $bulkPath
        if ($LASTEXITCODE -ne 0) { throw 'Fuel export COPY conversion failed; database import was not started.' }
        $sourcePath = $bulkPath
    }
    $reader = [System.IO.StreamReader]::new($sourcePath)
    $writer = [System.IO.StreamWriter]::new($temporaryPath, $false, [System.Text.UTF8Encoding]::new($false))
    $writer.WriteLine(@'
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';
SET LOCAL idle_in_transaction_session_timeout = '60s';
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS app_locations;
REVOKE ALL ON SCHEMA app_locations FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_locations TO service_role;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
SELECT set_config('search_path', format('pg_catalog, public, %I', n.nspname), true)
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'postgis';
'@)
    if ($ReplaceExisting) {
        # No CASCADE: dependent views or foreign keys must not be silently removed.
        $writer.WriteLine("DROP TABLE IF EXISTS $TargetSchema.export_fuel;")
    } else {
        $writer.WriteLine((@'
DO $guard$
BEGIN
    IF to_regclass('app_locations.export_fuel') IS NOT NULL THEN
        RAISE EXCEPTION 'app_locations.export_fuel already exists. Use -ReplaceExisting only if you intend to replace it.';
    END IF;
END
$guard$;
'@).Replace('app_locations.export_fuel', "$TargetSchema.export_fuel"))
    }

    $beginCount = 0
    $commitCount = 0
    $dropCount = 0
    $createCount = 0
    :readExport while ($null -ne ($line = $reader.ReadLine())) {
        switch -Regex ($line.Trim()) {
            '^BEGIN;$' { $beginCount++; continue readExport }
            '^COMMIT;$' { $commitCount++; continue readExport }
            '^DROP TABLE IF EXISTS "public"\."export_fuel" CASCADE;$' { $dropCount++; continue readExport }
            '^CREATE TABLE "public"\."export_fuel"\(\);$' { $createCount++ }
        }
        $writer.WriteLine($line)
    }
    if ($beginCount -ne 1 -or $commitCount -ne 1 -or $dropCount -ne 1 -or $createCount -ne 1) {
        throw 'Unexpected export structure. Expected the original GDAL public.export_fuel SQL export with one BEGIN, COMMIT, DROP TABLE and CREATE TABLE.'
    }
    if ($TargetSchema -eq 'app_locations') {
        $writer.WriteLine('ALTER TABLE public.export_fuel SET SCHEMA app_locations;')
    }
    $writer.WriteLine((@'
ALTER TABLE app_locations.export_fuel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_locations.export_fuel FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE app_locations.export_fuel_ogc_fid_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE app_locations.export_fuel TO service_role;
ANALYZE app_locations.export_fuel;
SELECT count(*) AS imported_fuel_locations,
       count(wkb_geometry) AS locations_with_geometry
FROM app_locations.export_fuel;
'@).Replace('app_locations.', "$TargetSchema."))
    $writer.Dispose()
    $writer = $null
    $reader.Dispose()
    $reader = $null

    $env:PGSSLMODE = 'require'
    $env:PGCONNECT_TIMEOUT = '15'
    Write-Host "Importing $TargetSchema.export_fuel over SSL in one transaction. psql may prompt for your database password."
    & $psql.Source -X --single-transaction --set=ON_ERROR_STOP=1 --quiet `
        --host=$DatabaseHost --port=$Port --username=$DatabaseUser --dbname=$DatabaseName `
        --file=$temporaryPath
    if ($LASTEXITCODE -ne 0) {
        throw "Import failed (psql exit code $LASTEXITCODE). The transaction was not committed."
    }
    Write-Host 'Import committed successfully. Browser roles have no access; use a server-side database role.'
} finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $reader) { $reader.Dispose() }
    $env:PGSSLMODE = $previousSslMode
    $env:PGCONNECT_TIMEOUT = $previousConnectTimeout
    Remove-Item -LiteralPath $temporaryPath -Force
    if ($null -ne $bulkPath) { Remove-Item -LiteralPath $bulkPath -Force }
}
