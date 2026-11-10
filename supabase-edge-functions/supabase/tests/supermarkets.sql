-- Run against an isolated database after both supermarkets migrations.
begin;
set local search_path = pg_catalog, public, extensions;

do $test$
begin
  if to_regclass('public.supermarkets') is not null then
    raise exception 'The old public supermarkets table must not remain';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'app_locations.supermarkets'::regclass) then
    raise exception 'Supermarkets must have row level security enabled';
  end if;
  if has_table_privilege('anon', 'app_locations.supermarkets', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'app_locations.supermarkets', 'select, insert, update, delete') then
    raise exception 'Supermarkets must not be accessible to client roles';
  end if;
  if not has_schema_privilege('service_role', 'app_locations', 'usage')
     or not has_table_privilege('service_role', 'app_locations.supermarkets', 'select')
     or not has_table_privilege('service_role', 'app_locations.supermarkets', 'insert') then
    raise exception 'The service role must be able to read and insert supermarkets';
  end if;
  if to_regclass('app_locations.supermarkets_id_seq') is null
     or to_regclass(pg_get_serial_sequence('app_locations.supermarkets', 'id'))
       is distinct from to_regclass('app_locations.supermarkets_id_seq')
     or not has_sequence_privilege('service_role', 'app_locations.supermarkets_id_seq', 'usage') then
    raise exception 'The supermarket identity sequence must remain owned and accessible';
  end if;
  if not exists (
    select 1 from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_am am on am.oid = idx.relam
    where i.indrelid = 'app_locations.supermarkets'::regclass
      and idx.relname = 'supermarkets_geom_idx'
      and idx.relnamespace = 'app_locations'::regnamespace
      and am.amname = 'gist'
      and i.indisvalid
  ) then
    raise exception 'Supermarkets must have a valid GiST geometry index';
  end if;
end;
$test$;

set local role service_role;
do $test$
declare
  feature app_locations.supermarkets%rowtype;
begin
  insert into app_locations.supermarkets (id, name, properties, geom)
  values (-9223372036854775807, 'Importer test', '{"test":true}'::jsonb, ST_GeomFromText('POINT(-98.5 39.5)', 4326))
  returning * into feature;
  if feature.id <> -9223372036854775807
     or feature.name <> 'Importer test'
     or feature.properties <> '{"test":true}'::jsonb
     or ST_SRID(feature.geom) <> 4326
     or ST_AsText(feature.geom) <> 'POINT(-98.5 39.5)' then
    raise exception 'Point import did not preserve the expected values';
  end if;

  insert into app_locations.supermarkets (id, name, properties, geom)
  values (-9223372036854775806, 'Line test', '{}'::jsonb, ST_GeomFromText('LINESTRING(-98.5 39.5,-98.6 39.6)', 4326))
  returning * into feature;
  if ST_GeometryType(feature.geom) <> 'ST_LineString' or ST_SRID(feature.geom) <> 4326 then
    raise exception 'Other WGS84 geometry types must also be supported';
  end if;
end;
$test$;
reset role;

rollback;
