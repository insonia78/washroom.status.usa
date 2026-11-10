UPSERT = """
insert into app_locations.restrooms as existing
 (osm_type,osm_id,name,latitude,longitude,wheelchair,fee,changing_table,unisex,
  refuge_updated_at,refuge_captured_at)
values ('refuge',%s,%s,%s,%s,%s,'unknown',%s,%s,%s,%s)
on conflict (osm_type,osm_id) do update set
 name=excluded.name, latitude=excluded.latitude, longitude=excluded.longitude,
 wheelchair=excluded.wheelchair, changing_table=excluded.changing_table, unisex=excluded.unisex,
 refuge_updated_at=excluded.refuge_updated_at, refuge_captured_at=excluded.refuge_captured_at
where existing.refuge_updated_at is null or
 (excluded.refuge_updated_at,excluded.refuge_captured_at) >
 (existing.refuge_updated_at,coalesce(existing.refuge_captured_at,'-infinity'::timestamptz))
"""


def upsert_archive(connection, rows: list[tuple]):
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.executemany(UPSERT, rows)


def acquire_lock(connection):
    locked = connection.execute(
        "select pg_try_advisory_lock(73142, 1)"
    ).fetchone()[0]
    if not locked:
        raise RuntimeError("Another Refuge ETL is already running")
