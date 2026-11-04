begin;

create or replace function app_locations.owner_archive_reply(
 p_owner_id uuid, p_email text, p_id uuid, p_archived boolean
)
returns table (id uuid, archived_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
 return query
 update app_locations.owner_replies r
 set archived_at = case
   when p_archived then coalesce(r.archived_at, now())
   else null
 end
 where r.id = p_id
  and r.owner_user_id = p_owner_id
  and r.owner_email = lower(p_email)
  and r.status <> 'pending'
 returning r.id, r.archived_at;
end;
$$;

revoke all on function app_locations.owner_archive_reply(uuid,text,uuid,boolean) from public, anon, authenticated;
grant execute on function app_locations.owner_archive_reply(uuid,text,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
