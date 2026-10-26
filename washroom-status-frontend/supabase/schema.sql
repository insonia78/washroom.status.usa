-- Run in Supabase SQL editor. Reviews are not publicly visible until approved.
create table if not exists public.reviews (
 id uuid primary key default gen_random_uuid(),
 osm_type text not null check (osm_type in ('node','way','relation','refuge')),
 osm_id bigint not null check (osm_id > 0),
 user_id uuid references auth.users(id) on delete cascade,
 rating smallint not null check (rating between 1 and 5),
 availability text check (availability in ('open','closed','temporarily_unavailable','unverified')),
 cleanliness_status text check (cleanliness_status in ('excellent','clean','average','poor','very_dirty')),
 issues text[] not null default '{}',
 comment text not null default '' check (char_length(comment)<=1000),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 unique (osm_type,osm_id,user_id)
);
create index if not exists reviews_public_lookup on public.reviews(osm_type,osm_id,created_at desc) where status='approved';
alter table public.reviews enable row level security;
-- Only approved reviews are visible to ordinary users. Service role handles submissions/moderation.
drop policy if exists "Read approved reviews" on public.reviews;
create policy "Read approved reviews" on public.reviews for select to anon,authenticated using (status='approved');
-- No direct insert/update/delete policies: anonymous submissions pass through server-side validation.
-- Moderation: approve/reject through Supabase dashboard initially, never expose service role key to browser.

create or replace function public.approved_review_summary(p_osm_type text, p_osm_id bigint)
returns table (review_count bigint, average double precision)
language sql stable security invoker set search_path = ''
as $$
 select count(*), avg(rating)::double precision from public.reviews
 where osm_type = p_osm_type and osm_id = p_osm_id and status = 'approved';
$$;
revoke all on function public.approved_review_summary(text, bigint) from public, anon, authenticated;
grant execute on function public.approved_review_summary(text, bigint) to service_role;

-- Server-verified search listings, including Refuge and imported businesses.
create table if not exists public.review_locations (
 osm_type text not null check (osm_type in ('node','way','relation','refuge')),
 osm_id bigint not null check (osm_id > 0),
 primary key (osm_type, osm_id)
);
alter table public.review_locations enable row level security;
revoke all on table public.review_locations from public, anon, authenticated;
grant select, insert on table public.review_locations to service_role;
