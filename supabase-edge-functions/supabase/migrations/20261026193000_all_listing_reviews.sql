begin;

alter table public.reviews drop constraint if exists reviews_osm_type_check;
alter table public.reviews add constraint reviews_osm_type_check
 check (osm_type in ('node', 'way', 'relation', 'refuge'));

-- Only server-verified search results can establish a reviewable listing.
create table if not exists public.review_locations (
 osm_type text not null check (osm_type in ('node', 'way', 'relation', 'refuge')),
 osm_id bigint not null check (osm_id > 0),
 primary key (osm_type, osm_id)
);
alter table public.review_locations enable row level security;
revoke all on table public.review_locations from public, anon, authenticated;
grant select, insert on table public.review_locations to service_role;

notify pgrst, 'reload schema';
commit;
