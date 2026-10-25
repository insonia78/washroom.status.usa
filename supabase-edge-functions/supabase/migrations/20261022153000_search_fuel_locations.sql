BEGIN;

-- Use the PostGIS extension's installed schema, not a hard-coded search path.
DO $setup$
DECLARE extension_schema text;
BEGIN
    SELECT n.nspname INTO STRICT extension_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'postgis';
    PERFORM set_config('search_path', format('pg_catalog, public, %I', extension_schema), true);
END
$setup$;

CREATE INDEX IF NOT EXISTS export_fuel_geography_idx
ON public.export_fuel USING gist ((wkb_geometry::geography));

CREATE OR REPLACE FUNCTION public.find_nearby_fuel(
    search_latitude double precision,
    search_longitude double precision,
    radius_meters double precision,
    page_offset integer DEFAULT 0,
    page_size integer DEFAULT 500
)
RETURNS TABLE (
    osm_identity text,
    latitude double precision,
    longitude double precision,
    tags jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $function$
BEGIN
    IF search_latitude IS NULL OR NOT (search_latitude BETWEEN -90 AND 90)
       OR search_longitude IS NULL OR NOT (search_longitude BETWEEN -180 AND 180)
       OR radius_meters IS NULL OR NOT (radius_meters >= 0 AND radius_meters < 'Infinity'::float8)
       OR page_offset IS NULL OR page_offset < 0
       OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Invalid nearby fuel search parameters' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT coalesce(nullif(btrim(f."@id"), ''), nullif(btrim(f.id), ''))::text,
           ST_Y(f.wkb_geometry), ST_X(f.wkb_geometry),
           jsonb_strip_nulls(jsonb_build_object(
               'amenity', f.amenity, 'name', f.name, 'brand', f.brand,
               'operator', f.operator, 'toilets', f.toilets,
               'toilets:access', f."toilets:access",
               'toilets:wheelchair', f."toilets:wheelchair",
               'toilets:opening_hours', f."toilets:opening_hours",
               'toilets:unisex', f."toilets:unisex",
               'opening_hours', f.opening_hours
           ))
    FROM public.export_fuel f
    WHERE lower(btrim(f.amenity)) = 'fuel'
      AND ST_DWithin(
          f.wkb_geometry::geography,
          ST_SetSRID(ST_MakePoint(search_longitude, search_latitude), 4326)::geography,
          radius_meters
      )
    ORDER BY f.ogc_fid
    LIMIT page_size OFFSET page_offset;
END
$function$;

DO $permissions$
DECLARE extension_schema text;
BEGIN
    SELECT n.nspname INTO STRICT extension_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'postgis';
    EXECUTE format(
        'ALTER FUNCTION public.find_nearby_fuel(double precision, double precision, double precision, integer, integer) SET search_path = pg_catalog, public, %I',
        extension_schema
    );
END
$permissions$;

REVOKE ALL ON FUNCTION public.find_nearby_fuel(double precision, double precision, double precision, integer, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_nearby_fuel(double precision, double precision, double precision, integer, integer)
TO service_role;
GRANT SELECT ON TABLE public.export_fuel TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
