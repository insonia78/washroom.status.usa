begin;

alter table app_locations.reviews
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists reviews_active_admin_list
  on app_locations.reviews(created_at desc, id desc) where archived_at is null;

grant update (archived_at, archived_by) on app_locations.reviews to service_role;

create function app_locations.admin_archive_review(p_admin_id uuid, p_review_id uuid, p_archived boolean)
returns table(id uuid, archived_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
begin
 if not exists (select 1 from app_locations.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_review_id is null or p_archived is null then
  raise exception 'Invalid archive request' using errcode='22023';
 end if;
 -- Archiving is idempotent: repeating it keeps the original archive time and actor.
 return query update app_locations.reviews r set
   archived_at = case when p_archived then coalesce(r.archived_at, now()) else null end,
   archived_by = case when p_archived then coalesce(r.archived_by, p_admin_id) else null end
  where r.id = p_review_id returning r.id, r.archived_at;
end;
$$;
revoke all on function app_locations.admin_archive_review(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_locations.admin_archive_review(uuid,uuid,boolean) to service_role;

commit;
