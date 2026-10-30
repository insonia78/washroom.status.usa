create table if not exists public.toilet_submissions (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(btrim(name)) between 1 and 120),
 latitude double precision not null check (latitude between 17 and 72),
 longitude double precision not null check (longitude between -179 and -65),
 wheelchair text not null default 'unknown' check (wheelchair in ('yes','no','unknown')),
 fee text not null default 'unknown' check (fee in ('yes','no','unknown')),
 notes text not null default '' check (char_length(notes) <= 1000),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
alter table public.toilet_submissions enable row level security;
revoke all on table public.toilet_submissions from public, anon, authenticated;
grant select, insert, update on table public.toilet_submissions to service_role;
create index if not exists toilet_submissions_moderation
 on public.toilet_submissions (status, created_at);
