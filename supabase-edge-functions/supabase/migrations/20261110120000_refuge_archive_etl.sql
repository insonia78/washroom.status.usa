begin;

-- Provider identity stays separate from OSM node/way/relation IDs.
alter table app_locations.restrooms drop constraint if exists restrooms_osm_type_check;
alter table app_locations.restrooms add constraint restrooms_osm_type_check
 check (osm_type in ('node','way','relation','refuge'));
alter table app_locations.restrooms
 add column if not exists refuge_updated_at timestamptz,
 add column if not exists refuge_captured_at timestamptz;

commit;
