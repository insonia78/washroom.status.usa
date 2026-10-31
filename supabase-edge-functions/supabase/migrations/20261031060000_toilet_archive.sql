begin;

alter table app_locations.toilet_submissions
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

grant update (archived_at, archived_by) on app_locations.toilet_submissions to service_role;

create function app_locations.admin_archive_toilet(p_admin_id uuid, p_toilet_id uuid, p_archived boolean)
returns table(id uuid, archived_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
begin
 if not exists (select 1 from app_locations.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_toilet_id is null or p_archived is null then
  raise exception 'Invalid archive request' using errcode='22023';
 end if;
 return query update app_locations.toilet_submissions t set
   archived_at = case when p_archived then coalesce(t.archived_at, now()) else null end,
   archived_by = case when p_archived then coalesce(t.archived_by, p_admin_id) else null end
  where t.id = p_toilet_id returning t.id, t.archived_at;
end;
$$;
revoke all on function app_locations.admin_archive_toilet(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_locations.admin_archive_toilet(uuid,uuid,boolean) to service_role;

commit;
