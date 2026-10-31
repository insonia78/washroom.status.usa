begin;

-- Archiving only tidies the admin list; a published toilet stays on the map.
create or replace function app_locations.sync_toilet_to_map()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
 v_osm_id bigint := 9000000000000000 + new.map_seq;
begin
 delete from app_locations.restrooms where osm_type = 'node' and osm_id = v_osm_id;
 if new.status = 'approved' and new.published_at is not null then
  insert into app_locations.restrooms
   (osm_type, osm_id, name, latitude, longitude, wheelchair, fee)
  values
   ('node', v_osm_id, new.name, new.latitude, new.longitude, new.wheelchair, new.fee);
 end if;
 return new;
end;
$$;
revoke all on function app_locations.sync_toilet_to_map() from public, anon, authenticated;

-- Re-publish toilets that were removed from the map only because they were archived.
insert into app_locations.restrooms (osm_type, osm_id, name, latitude, longitude, wheelchair, fee)
select 'node', 9000000000000000 + t.map_seq, t.name, t.latitude, t.longitude, t.wheelchair, t.fee
from app_locations.toilet_submissions t
where t.status = 'approved' and t.published_at is not null and t.archived_at is not null
  and not exists (
    select 1 from app_locations.restrooms r
    where r.osm_type = 'node' and r.osm_id = 9000000000000000 + t.map_seq
  );

commit;
