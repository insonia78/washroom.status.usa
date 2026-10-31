alter table app_locations.reviews
  add column if not exists restroom_name text check (restroom_name is null or char_length(restroom_name) <= 200);
