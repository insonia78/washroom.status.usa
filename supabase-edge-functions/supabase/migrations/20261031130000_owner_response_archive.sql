begin;

alter table app_locations.owner_responses add column if not exists archived_at timestamptz;

drop function if exists public.admin_archive_owner_response(uuid, uuid, boolean);

create or replace function app_locations.admin_archive_owner_response(p_admin_id uuid, p_id uuid, p_archived boolean)
returns table (id uuid, archived_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from app_locations.owner_response_admins where user_id = p_admin_id) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return query
    update app_locations.owner_responses r
    set archived_at = case when p_archived then now() else null end
    where r.id = p_id
    returning r.id, r.archived_at;
end;
$$;

revoke all on function app_locations.admin_archive_owner_response(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function app_locations.admin_archive_owner_response(uuid, uuid, boolean) to service_role;

grant select, update on app_locations.owner_responses to service_role;

notify pgrst, 'reload schema';

commit;
