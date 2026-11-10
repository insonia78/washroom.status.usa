begin;
set local lock_timeout = '15s';

do $move$
declare
  dependent_view text;
  dependent_routine text;
begin
  if to_regnamespace('app_locations') is null then
    raise exception 'Apply the private application schemas migration first';
  end if;
  if not has_schema_privilege('service_role', 'app_locations', 'usage') then
    raise exception 'The service role needs usage on app_locations before moving supermarkets';
  end if;
  if to_regclass('public.supermarkets') is not null and to_regclass('app_locations.supermarkets') is not null then
    raise exception 'Both public.supermarkets and app_locations.supermarkets exist; resolve the conflict without discarding data';
  end if;

  if to_regclass('public.supermarkets') is not null then
    select format('%I.%I', n.nspname, c.relname) into dependent_view
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
    join pg_class c on c.oid = r.ev_class
    join pg_namespace n on n.oid = c.relnamespace
    where d.refclassid = 'pg_class'::regclass
      and d.refobjid = to_regclass('public.supermarkets')
      and n.nspname = 'public'
      and c.relkind in ('v', 'm')
    limit 1;
    if dependent_view is not null then
      raise exception 'Public view % depends on supermarkets; migrate its schema and grants first', dependent_view;
    end if;

    select format('%I.%I', n.nspname, p.proname) into dependent_routine
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosrc ~* '(^|[^[:alnum:]_])"?public"?[[:space:]]*\.[[:space:]]*"?supermarkets"?([^[:alnum:]_]|$)'
    limit 1;
    if dependent_routine is not null then
      raise exception 'Routine % refers to public.supermarkets; update it before moving the table', dependent_routine;
    end if;

    alter table public.supermarkets set schema app_locations;
  elsif to_regclass('app_locations.supermarkets') is null then
    raise exception 'The supermarkets table does not exist in public or app_locations';
  end if;
end;
$move$;

commit;
