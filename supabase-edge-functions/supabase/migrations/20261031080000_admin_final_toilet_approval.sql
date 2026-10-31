begin;

alter table app_locations.toilet_submissions
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id) on delete set null;

grant update (published_at, published_by) on app_locations.toilet_submissions to service_role;

-- Map publication now requires final administrator approval after moderation.
create or replace function app_locations.sync_toilet_to_map()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
 v_osm_id bigint := 9000000000000000 + new.map_seq;
begin
 delete from app_locations.restrooms where osm_type = 'node' and osm_id = v_osm_id;
 if new.status = 'approved' and new.published_at is not null and new.archived_at is null then
  insert into app_locations.restrooms
   (osm_type, osm_id, name, latitude, longitude, wheelchair, fee)
  values
   ('node', v_osm_id, new.name, new.latitude, new.longitude, new.wheelchair, new.fee);
 end if;
 return new;
end;
$$;
revoke all on function app_locations.sync_toilet_to_map() from public, anon, authenticated;

drop trigger if exists sync_toilet_to_map on app_locations.toilet_submissions;
create trigger sync_toilet_to_map
  after update of status, archived_at, published_at on app_locations.toilet_submissions
  for each row execute function app_locations.sync_toilet_to_map();

-- Remove community toilets that were published before the admin step existed.
delete from app_locations.restrooms where osm_type = 'node' and osm_id >= 9000000000000000;

create function app_locations.admin_publish_toilet(p_admin_id uuid, p_toilet_id uuid, p_publish boolean)
returns table(id uuid, published_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
begin
 if not exists (select 1 from app_locations.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_toilet_id is null or p_publish is null then
  raise exception 'Invalid publish request' using errcode='22023';
 end if;
 return query update app_locations.toilet_submissions t set
   published_at = case when p_publish then coalesce(t.published_at, now()) else null end,
   published_by = case when p_publish then coalesce(t.published_by, p_admin_id) else null end
  where t.id = p_toilet_id and t.status = 'approved' returning t.id, t.published_at;
end;
$$;
revoke all on function app_locations.admin_publish_toilet(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_locations.admin_publish_toilet(uuid,uuid,boolean) to service_role;

commit;
