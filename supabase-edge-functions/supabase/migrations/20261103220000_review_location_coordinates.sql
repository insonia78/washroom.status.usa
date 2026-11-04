begin;

alter table app_locations.review_locations
 add column latitude double precision,
 add column longitude double precision,
 add constraint review_locations_coordinate_pair check (
  (latitude is null and longitude is null) or
  (latitude is not null and longitude is not null and
   latitude between -90 and 90 and longitude between -180 and 180)
 );

update app_locations.review_locations as location
set latitude = restroom.latitude, longitude = restroom.longitude
from app_locations.restrooms as restroom
where location.osm_type = restroom.osm_type
 and location.osm_id = restroom.osm_id
 and location.latitude is null;

grant update (osm_type, osm_id, latitude, longitude) on app_locations.review_locations to service_role;

notify pgrst, 'reload schema';
commit;
