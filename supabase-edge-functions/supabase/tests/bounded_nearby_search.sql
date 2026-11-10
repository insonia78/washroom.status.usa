-- Isolated database only; fixtures are rolled back. Run after the bounded-search migration.
begin;
set local search_path = pg_catalog, app_locations, extensions;

do $permissions$
declare signature text;
begin
  foreach signature in array array[
    'app_locations.find_nearby_restrooms(double precision,double precision,double precision,integer)',
    'app_locations.find_nearby_businesses(double precision,double precision,double precision,text,integer)'
  ] loop
    if has_function_privilege('anon', signature, 'execute')
      or has_function_privilege('authenticated', signature, 'execute')
      or not has_function_privilege('service_role', signature, 'execute') then
      raise exception 'Nearby search must be service-role only';
    end if;
  end loop;
end;
$permissions$;

insert into app_locations.restrooms(osm_type, osm_id, name, latitude, longitude)
select 'node', 900000000000000 + i, 'Bounded fixture', (251 - i)::float8 / 100000, 0
from generate_series(1, 250) i;
insert into app_locations.export_fuel("@id", amenity, wkb_geometry)
select 'node/' || (900000000000000 + i), 'fuel',
  ST_SetSRID(ST_MakePoint(0, (251 - i)::float8 / 100000), 4326)
from generate_series(1, 250) i;
insert into app_locations.supermarkets(name, properties, geom)
select 'Bounded fixture', jsonb_build_object('@id', 'node/' || (900000000000000 + i), 'shop', 'supermarket'),
  ST_SetSRID(ST_MakePoint(0, (251 - i)::float8 / 100000), 4326)
from generate_series(1, 250) i;
-- Duplicates must not exhaust the candidate limit before other nearby identities.
insert into app_locations.export_fuel("@id", amenity, wkb_geometry)
select 'node/900000000000250', 'fuel', ST_SetSRID(ST_MakePoint(0, 0.00001), 4326)
from generate_series(1, 250);
insert into app_locations.supermarkets(name, properties, geom)
select 'Duplicate', '{"@id":"node/900000000000250","shop":"supermarket"}',
  ST_SetSRID(ST_MakePoint(0, 0.00001), 4326)
from generate_series(1, 250);

set local role service_role;
do $test$
declare kind text; result_count integer; first_id text;
begin
  select count(*) into result_count from app_locations.find_nearby_restrooms(0, 0, 1000, 201);
  if result_count <> 201 then raise exception 'Restroom candidate limit not enforced'; end if;
  select osm_id::text into first_id from app_locations.find_nearby_restrooms(0, 0, 1000, 1);
  if first_id <> '900000000000250' then raise exception 'Restrooms must use distance, not ID order'; end if;
  if exists(select 1 from app_locations.find_nearby_restrooms(0, 0, 0, 201)) then
    raise exception 'Out-of-radius restrooms returned';
  end if;
  foreach kind in array array['fuel', 'supermarket'] loop
    select count(*) into result_count from app_locations.find_nearby_businesses(0, 0, 1000, kind, 201);
    if result_count <> 201 then raise exception 'Business candidate limit/dedup failed for %', kind; end if;
    select osm_identity into first_id from app_locations.find_nearby_businesses(0, 0, 1000, kind, 1);
    if first_id <> 'node/900000000000250' then raise exception 'Business distance order failed for %', kind; end if;
    if exists(select 1 from app_locations.find_nearby_businesses(0, 0, 0, kind, 201)) then
      raise exception 'Out-of-radius businesses returned';
    end if;
  end loop;
  begin
    perform * from app_locations.find_nearby_restrooms(0, 0, 1000, 202);
    raise exception 'Unbounded restroom limit accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from app_locations.find_nearby_businesses(0, 0, 1000, 'fuel', 202);
    raise exception 'Unbounded business limit accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$test$;
reset role;
rollback;
