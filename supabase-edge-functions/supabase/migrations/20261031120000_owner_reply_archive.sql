begin;

alter table app_locations.owner_replies add column if not exists archived_at timestamptz;

create or replace function public.admin_archive_owner_reply(p_admin_id uuid, p_id uuid, p_archived boolean)
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
    update app_locations.owner_replies r
    set archived_at = case when p_archived then now() else null end
    where r.id = p_id and r.status <> 'pending'
    returning r.id, r.archived_at;
end;
$$;

revoke all on function public.admin_archive_owner_reply(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_archive_owner_reply(uuid, uuid, boolean) to service_role;

commit;
