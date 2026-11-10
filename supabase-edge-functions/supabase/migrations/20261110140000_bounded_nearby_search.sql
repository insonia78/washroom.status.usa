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

create index if not exists restrooms_search_geography_idx on app_locations.restrooms
  using gist ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography));

create or replace function app_locations.find_nearby_restrooms(
  search_latitude double precision, search_longitude double precision,
  radius_meters double precision, result_limit integer default 201
)
returns setof app_locations.restrooms
language plpgsql stable security invoker
as $function$
begin
  if search_latitude is null or not (search_latitude between -90 and 90)
    or search_longitude is null or not (search_longitude between -180 and 180)
    or radius_meters is null or not (radius_meters >= 0 and radius_meters < 'Infinity'::float8)
    or result_limit is null or result_limit not between 1 and 201 then
    raise exception 'Invalid nearby restroom search parameters' using errcode = '22023';
  end if;
  return query
  select r.* from app_locations.restrooms r
  where ST_DWithin(
    ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography,
    ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography,
    radius_meters, false
  )
  order by ST_Distance(
    ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography,
    ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, false
  ), r.osm_type, r.osm_id
  limit result_limit;
end;
$function$;

create or replace function app_locations.find_nearby_businesses(
  search_latitude double precision, search_longitude double precision,
  radius_meters double precision, business_kind text, result_limit integer default 201
)
returns table (osm_identity text, latitude double precision, longitude double precision, tags jsonb)
language plpgsql stable security invoker
as $function$
begin
  if search_latitude is null or not (search_latitude between -90 and 90)
    or search_longitude is null or not (search_longitude between -180 and 180)
    or radius_meters is null or not (radius_meters >= 0 and radius_meters < 'Infinity'::float8)
    or result_limit is null or result_limit not between 1 and 201
    or business_kind is null or business_kind not in ('fuel', 'supermarket') then
    raise exception 'Invalid nearby business search parameters' using errcode = '22023';
  end if;
  if business_kind = 'fuel' then
    return query
    select coalesce(nullif(btrim(f."@id"), ''), nullif(btrim(f.id), ''))::text,
      ST_Y(f.wkb_geometry), ST_X(f.wkb_geometry),
      jsonb_strip_nulls(jsonb_build_object(
        'amenity', f.amenity, 'name', f.name, 'brand', f.brand,
        'operator', f.operator, 'toilets', f.toilets,
        'toilets:access', f."toilets:access", 'toilets:wheelchair', f."toilets:wheelchair",
        'toilets:opening_hours', f."toilets:opening_hours",
        'toilets:unisex', f."toilets:unisex", 'opening_hours', f.opening_hours
      ))
    from (
      select distinct on (coalesce(nullif(btrim(raw."@id"), ''), nullif(btrim(raw.id), ''))) raw.*
      from app_locations.export_fuel raw
      where lower(btrim(raw.amenity)) = 'fuel'
        and ST_DWithin(raw.wkb_geometry::geography,
          ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, radius_meters, false)
      order by coalesce(nullif(btrim(raw."@id"), ''), nullif(btrim(raw.id), '')),
        ST_Distance(raw.wkb_geometry::geography,
          ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, false), raw.ogc_fid
    ) f
    where lower(btrim(f.amenity)) = 'fuel'
      and ST_DWithin(f.wkb_geometry::geography,
        ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography,
        radius_meters, false)
    order by ST_Distance(f.wkb_geometry::geography,
      ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, false),
      f.ogc_fid
    limit result_limit;
  else
    return query
    select nullif(btrim(s.properties->>'@id'), ''),
      ST_Y(location.point), ST_X(location.point),
      jsonb_strip_nulls(jsonb_build_object(
        'shop', s.properties->>'shop',
        'name', coalesce(nullif(btrim(s.properties->>'name'), ''), nullif(btrim(s.name), 'Unnamed Feature')),
        'brand', s.properties->>'brand', 'operator', s.properties->>'operator',
        'toilets', s.properties->>'toilets', 'toilets:access', s.properties->>'toilets:access',
        'toilets:wheelchair', s.properties->>'toilets:wheelchair',
        'toilets:fee', s.properties->>'toilets:fee',
        'toilets:unisex', s.properties->>'toilets:unisex',
        'toilets:changing_table', s.properties->>'toilets:changing_table',
        'toilets:opening_hours', s.properties->>'toilets:opening_hours',
        'opening_hours', s.properties->>'opening_hours'
      ))
    from (
      select distinct on (nullif(btrim(raw.properties->>'@id'), '')) raw.*
      from app_locations.supermarkets raw
      where not ST_IsEmpty(raw.geom)
        and lower(btrim(raw.properties->>'shop')) = 'supermarket'
        and ST_DWithin(ST_PointOnSurface(raw.geom)::geography,
          ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, radius_meters, false)
      order by nullif(btrim(raw.properties->>'@id'), ''),
        ST_Distance(ST_PointOnSurface(raw.geom)::geography,
          ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, false), raw.id
    ) s
    cross join lateral (select ST_PointOnSurface(s.geom) as point) location
    where not ST_IsEmpty(s.geom)
      and lower(btrim(s.properties->>'shop')) = 'supermarket'
      and ST_X(location.point) between -180 and 180
      and ST_Y(location.point) between -90 and 90
      and ST_DWithin(location.point::geography,
        ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography,
        radius_meters, false)
    order by ST_Distance(location.point::geography,
      ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography, false), s.id
    limit result_limit;
  end if;
end;
$function$;

do $permissions$
declare extension_schema text; signature text;
begin
  select n.nspname into strict extension_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  foreach signature in array array[
    'app_locations.find_nearby_restrooms(double precision, double precision, double precision, integer)',
    'app_locations.find_nearby_businesses(double precision, double precision, double precision, text, integer)'
  ] loop
    execute format('alter function %s set search_path = pg_catalog, app_locations, %I', signature, extension_schema);
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$permissions$;

notify pgrst, 'reload schema';
commit;
