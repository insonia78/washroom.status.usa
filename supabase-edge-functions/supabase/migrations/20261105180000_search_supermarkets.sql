begin;
set local lock_timeout = '15s';

do $setup$
declare extension_schema text;
begin
  select n.nspname into strict extension_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  perform set_config('search_path', format('pg_catalog, app_locations, %I', extension_schema), true);
end;
$setup$;

create index if not exists supermarkets_geography_idx
  on app_locations.supermarkets using gist ((ST_PointOnSurface(geom)::geography))
  where not ST_IsEmpty(geom) and lower(btrim(properties->>'shop')) = 'supermarket';

create or replace function app_locations.find_nearby_supermarkets(
  search_latitude double precision,
  search_longitude double precision,
  radius_meters double precision,
  page_offset integer default 0,
  page_size integer default 500
)
returns table (osm_identity text, latitude double precision, longitude double precision, tags jsonb)
language plpgsql stable security invoker
as $function$
begin
  if search_latitude is null or not (search_latitude between -90 and 90)
     or search_longitude is null or not (search_longitude between -180 and 180)
     or radius_meters is null or not (radius_meters >= 0 and radius_meters < 'Infinity'::float8)
     or page_offset is null or page_offset < 0
     or page_size is null or page_size not between 1 and 500 then
    raise exception 'Invalid nearby supermarket search parameters' using errcode = '22023';
  end if;

  return query
  select nullif(btrim(s.properties->>'@id'), ''),
         ST_Y(location.point), ST_X(location.point),
         jsonb_strip_nulls(jsonb_build_object(
           'shop', s.properties->>'shop',
           'name', coalesce(nullif(btrim(s.properties->>'name'), ''), nullif(btrim(s.name), 'Unnamed Feature')),
           'brand', s.properties->>'brand',
           'operator', s.properties->>'operator',
           'toilets', s.properties->>'toilets',
           'toilets:access', s.properties->>'toilets:access',
           'toilets:wheelchair', s.properties->>'toilets:wheelchair',
           'toilets:fee', s.properties->>'toilets:fee',
           'toilets:unisex', s.properties->>'toilets:unisex',
           'toilets:changing_table', s.properties->>'toilets:changing_table',
           'toilets:opening_hours', s.properties->>'toilets:opening_hours',
           'opening_hours', s.properties->>'opening_hours'
         ))
  from app_locations.supermarkets s
  cross join lateral (select ST_PointOnSurface(s.geom) as point) location
  where not ST_IsEmpty(s.geom)
    and lower(btrim(s.properties->>'shop')) = 'supermarket'
    and ST_X(location.point) between -180 and 180
    and ST_Y(location.point) between -90 and 90
    and ST_DWithin(
      location.point::geography,
      ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography,
      radius_meters
    )
  order by s.id
  limit page_size offset page_offset;
end;
$function$;

do $permissions$
declare extension_schema text;
begin
  select n.nspname into strict extension_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  execute format(
    'alter function app_locations.find_nearby_supermarkets(double precision, double precision, double precision, integer, integer) set search_path = pg_catalog, app_locations, %I',
    extension_schema
  );
end;
$permissions$;

revoke all on function app_locations.find_nearby_supermarkets(double precision, double precision, double precision, integer, integer)
  from public, anon, authenticated;
grant execute on function app_locations.find_nearby_supermarkets(double precision, double precision, double precision, integer, integer)
  to service_role;
grant select on table app_locations.supermarkets to service_role;

notify pgrst, 'reload schema';
commit;
