-- Run against an isolated database after the supermarket-search migration.
begin;
set local search_path = pg_catalog, public, extensions;

do $permissions$
begin
  if has_function_privilege('anon', 'app_locations.find_nearby_supermarkets(double precision,double precision,double precision,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'app_locations.find_nearby_supermarkets(double precision,double precision,double precision,integer,integer)', 'execute')
     or not has_function_privilege('service_role', 'app_locations.find_nearby_supermarkets(double precision,double precision,double precision,integer,integer)', 'execute') then
    raise exception 'Supermarket search must be restricted to the service role';
  end if;
  if not exists (
    select 1 from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_am am on am.oid = idx.relam
    where i.indrelid = 'app_locations.supermarkets'::regclass
      and idx.relname = 'supermarkets_geography_idx'
      and idx.relnamespace = 'app_locations'::regnamespace
      and am.amname = 'gist' and i.indisvalid
  ) then
    raise exception 'Supermarket search needs a valid geography GiST index';
  end if;
end;
$permissions$;

set local role service_role;
insert into app_locations.supermarkets (id, name, properties, geom) values
  (-9223372036854775707, 'Near test',
    '{"@id":"node/900000000000001","shop":"supermarket","toilets":"yes","toilets:wheelchair":"yes","private_test":"not returned"}',
    ST_Project(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 1608.344, radians(90))::geometry),
  (-9223372036854775706, 'Far test',
    '{"@id":"node/900000000000002","shop":"supermarket"}',
    ST_Project(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 1610.344, radians(90))::geometry),
  (-9223372036854775705, 'Other shop',
    '{"@id":"node/900000000000003","shop":"convenience"}',
    ST_SetSRID(ST_MakePoint(0, 0), 4326)),
  (-9223372036854775704, 'Polygon test',
    '{"@id":"way/900000000000004","shop":"supermarket"}',
    ST_GeomFromText('POLYGON((0.002 -0.001,0.004 -0.001,0.004 0.001,0.002 0.001,0.002 -0.001))', 4326)),
  (-9223372036854775703, 'Empty test',
    '{"@id":"node/900000000000005","shop":"supermarket"}',
    ST_GeomFromText('POINT EMPTY', 4326));

do $test$
declare
  result record;
  invalid record;
begin
  select * into strict result from app_locations.find_nearby_supermarkets(0, 0, 1609.344, 0, 500)
  where osm_identity = 'node/900000000000001';
  if result.tags->>'toilets' <> 'yes' or result.tags->>'toilets:wheelchair' <> 'yes'
     or result.tags ? 'private_test' then
    raise exception 'Search did not preserve restroom tags or returned unrelated properties';
  end if;
  if exists (
    select 1 from app_locations.find_nearby_supermarkets(0, 0, 1609.344, 0, 500)
    where osm_identity in ('node/900000000000002', 'node/900000000000003', 'node/900000000000005')
  ) then
    raise exception 'Search returned an out-of-radius, non-supermarket, or empty geometry';
  end if;
  if not exists (
    select 1 from app_locations.find_nearby_supermarkets(0, 0, 1609.344, 0, 500)
    where osm_identity = 'way/900000000000004' and latitude between -0.001 and 0.001
      and longitude between 0.002 and 0.004
  ) then
    raise exception 'Polygon supermarkets must have a representative point';
  end if;
  if (select osm_identity from app_locations.find_nearby_supermarkets(0, 0, 1609.344, 0, 1))
       <> 'node/900000000000001'
     or (select osm_identity from app_locations.find_nearby_supermarkets(0, 0, 1609.344, 1, 1))
       <> 'way/900000000000004' then
    raise exception 'Supermarket pages must use stable ordering';
  end if;
  for invalid in select * from (values
    (91::float8, 0::float8, 1000::float8, 0, 1),
    (0::float8, -181::float8, 1000::float8, 0, 1),
    (0::float8, 0::float8, -1::float8, 0, 1),
    (0::float8, 0::float8, 'Infinity'::float8, 0, 1),
    (0::float8, 0::float8, 1000::float8, -1, 1),
    (0::float8, 0::float8, 1000::float8, 0, 501)
  ) as input(lat, lon, radius, page_offset, page_size)
  loop
    begin
      perform * from app_locations.find_nearby_supermarkets(
        invalid.lat, invalid.lon, invalid.radius, invalid.page_offset, invalid.page_size
      );
      raise exception 'Invalid supermarket search parameters were accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
end;
$test$;
reset role;

rollback;
