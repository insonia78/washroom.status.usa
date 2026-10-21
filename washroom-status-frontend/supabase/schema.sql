-- Run in Supabase SQL editor. Reviews are not publicly visible until approved.
create table if not exists public.reviews (
 id uuid primary key default gen_random_uuid(),
 osm_type text not null check (osm_type in ('node','way','relation')),
 osm_id bigint not null check (osm_id > 0),
 user_id uuid not null references auth.users(id) on delete cascade,
 rating smallint not null check (rating between 1 and 5),
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
-- No direct insert/update/delete policies: all submissions pass through authenticated API verification.
-- Moderation: approve/reject through Supabase dashboard initially, never expose service role key to browser.
