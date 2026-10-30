begin;
set local lock_timeout = '15s';

create schema if not exists app_accounts;
create schema if not exists app_locations;
revoke all on schema app_accounts, app_locations from public, anon, authenticated;
grant usage on schema app_accounts, app_locations to service_role;

-- Refuse an incomplete cutover if locally unmanaged public views depend on
-- application tables: their grants could otherwise expose the moved data.
do $views$
declare dependent_view text;
begin
 select format('%I.%I',view_namespace.nspname,view_relation.relname) into dependent_view
 from pg_depend d
 join pg_rewrite r on r.oid=d.objid and d.classid='pg_rewrite'::regclass
 join pg_class view_relation on view_relation.oid=r.ev_class
 join pg_namespace view_namespace on view_namespace.oid=view_relation.relnamespace
 join pg_class source_relation on source_relation.oid=d.refobjid and d.refclassid='pg_class'::regclass
 join pg_namespace source_namespace on source_namespace.oid=source_relation.relnamespace
 where view_namespace.nspname='public' and source_namespace.nspname='public'
  and view_relation.relkind in ('v','m')
  and source_relation.relname in ('restrooms','export_fuel','reviews','review_locations',
   'review_moderators','review_moderation_log','owner_response_admins','owner_responses',
   'toilet_submissions','toilet_submission_daily_counts',
   'accounts','password_reset_tokens','jwt_tokens')
 limit 1;
 if dependent_view is not null then
  raise exception 'Unmanaged public view % depends on application data; migrate its schema and grants explicitly before cutover',dependent_view;
 end if;
end;
$views$;

-- SET SCHEMA retains table OIDs, rows, FK targets, indexes, owned sequences,
-- triggers and RLS policies. Never copy or drop production tables.
do $move$
declare
 item record;
 target text;
 source_oid regclass;
begin
 for item in select * from (values
  ('accounts','app_accounts'), ('password_reset_tokens','app_accounts'),
  ('jwt_tokens','app_accounts'),
  ('restrooms','app_locations'), ('export_fuel','app_locations'),
  ('reviews','app_locations'), ('review_locations','app_locations'),
  ('review_moderators','app_locations'), ('review_moderation_log','app_locations'),
  ('owner_response_admins','app_locations'), ('owner_responses','app_locations'),
  ('toilet_submissions','app_locations'), ('toilet_submission_daily_counts','app_locations')
 ) as objects(name, destination)
 loop
  target := format('%I.%I', item.destination, item.name);
  source_oid := to_regclass(format('public.%I', item.name));
  if source_oid is not null and to_regclass(target) is not null then
   raise exception 'Both public.% and % exist; resolve the conflict without discarding data', item.name, target;
  end if;
  if source_oid is not null then
   execute format('alter table public.%I set schema %I', item.name, item.destination);
  end if;
 end loop;
 if to_regclass('app_locations.restrooms') is null or to_regclass('app_locations.reviews') is null
 or to_regclass('app_locations.toilet_submissions') is null then
  raise exception 'Apply the existing restroom/review setup and all preceding migrations first';
 end if;
end;
$move$;

-- SQL/plpgsql string bodies retain literal schema names when routines move.
-- Rebuild the allowlisted app routines from their installed definitions so
-- their existing validation and business logic remain intact.
do $routines$
declare
 routine record;
 object_name text;
 definition text;
 destination text;
begin
 for routine in
  select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
   ('find_nearby_fuel','approved_review_summary','moderate_review',
    'save_owner_response','limit_toilet_submissions','moderate_toilet_submission')
 loop
  destination := 'app_locations';
  execute format('alter function %I.%I(%s) set schema %I',
   routine.nspname,routine.proname,routine.arguments,destination);
  definition := pg_get_functiondef(routine.oid);
  foreach object_name in array array[
   'restrooms','export_fuel','reviews','review_locations','review_moderators',
   'review_moderation_log','owner_response_admins','owner_responses',
   'toilet_submissions','toilet_submission_daily_counts',
   'find_nearby_fuel','approved_review_summary','moderate_review',
   'save_owner_response','limit_toilet_submissions','moderate_toilet_submission'
  ] loop
   definition := regexp_replace(definition,
    '\mpublic\.' || object_name || '\M', 'app_locations.' || object_name, 'g');
  end loop;
  execute definition;
 end loop;
end;
$routines$;

-- PostGIS stays in its extension-owned schema; only the application RPC moves.
do $spatial$
declare extension_schema text;
begin
 if to_regprocedure('app_locations.find_nearby_fuel(double precision,double precision,double precision,integer,integer)') is not null then
  select n.nspname into strict extension_schema from pg_extension e
   join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis';
  execute format('alter function app_locations.find_nearby_fuel(double precision,double precision,double precision,integer,integer) set search_path = pg_catalog, app_locations, %I',extension_schema);
 end if;
end;
$spatial$;

do $permissions$
declare item record;
begin
 for item in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='app_locations' and c.relkind in ('r','p')
 loop
  execute format('alter table %I.%I enable row level security',item.nspname,item.relname);
 end loop;
end;
$permissions$;

-- Direct PostgreSQL account consumers may use a custom trusted role instead
-- of service_role. Retain their existing ACLs and RLS state and add only schema
-- USAGE; owners still own their tables and can run existing startup ALTERs.
do $account_roles$
declare role_name text;
begin
 for role_name in
  select distinct r.rolname from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  join pg_roles r on r.oid=a.grantee
  where n.nspname='app_accounts' and r.rolname not in ('anon','authenticated')
 loop
  execute format('grant usage on schema app_accounts to %I',role_name);
 end loop;
 for role_name in select distinct r.rolname from pg_class c
  join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner
  where n.nspname='app_accounts' and r.rolname not in ('anon','authenticated')
 loop
  execute format('grant usage on schema app_accounts to %I',role_name);
 end loop;
end;
$account_roles$;
revoke all on all tables in schema app_accounts, app_locations from public, anon, authenticated;
revoke all on all sequences in schema app_accounts, app_locations from public, anon, authenticated;
revoke all on all functions in schema app_accounts, app_locations from public, anon, authenticated;
grant select on all tables in schema app_locations to service_role;
grant select, insert, update, delete on all tables in schema app_accounts to service_role;
grant usage, select on all sequences in schema app_accounts, app_locations to service_role;
grant execute on all functions in schema app_accounts, app_locations to service_role;
alter default privileges in schema app_accounts revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_locations revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_accounts revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app_locations revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app_accounts revoke all on functions from public, anon, authenticated;
alter default privileges in schema app_locations revoke all on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
