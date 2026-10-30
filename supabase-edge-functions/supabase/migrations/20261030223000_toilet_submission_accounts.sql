begin;
alter table public.toilet_submissions
 add column if not exists user_id uuid references auth.users(id) on delete set null,
 add column if not exists moderated_by uuid references auth.users(id) on delete set null,
 add column if not exists moderated_at timestamptz;

-- A separate counter is never refunded by rejection or deletion. The UPSERT
-- serializes concurrent submissions for the same account and UTC calendar day.
create table if not exists public.toilet_submission_daily_counts (
 user_id uuid not null references auth.users(id) on delete cascade,
 submission_day date not null,
 insertions smallint not null check (insertions between 1 and 3),
 primary key (user_id, submission_day)
);
alter table public.toilet_submission_daily_counts enable row level security;
revoke all on public.toilet_submission_daily_counts from public, anon, authenticated;
grant select, insert, update on public.toilet_submission_daily_counts to service_role;

create or replace function public.limit_toilet_submissions()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
 accepted smallint;
 submitted_at timestamptz := statement_timestamp();
begin
 if new.user_id is null then
  raise exception 'Sign in to add a toilet' using errcode = '42501';
 end if;
 insert into public.toilet_submission_daily_counts as counts (user_id, submission_day, insertions)
 values (new.user_id, (submitted_at at time zone 'UTC')::date, 1)
 on conflict (user_id, submission_day) do update
 set insertions = counts.insertions + 1 where counts.insertions < 3
 returning insertions into accepted;
 if accepted is null then
  raise exception 'Daily toilet submission limit reached (3 per UTC day)' using errcode = 'P0001';
 end if;
 new.created_at := submitted_at;
 new.status := 'pending';
 return new;
end;
$$;
revoke all on function public.limit_toilet_submissions() from public, anon, authenticated;
grant execute on function public.limit_toilet_submissions() to service_role;
drop trigger if exists limit_toilet_submissions on public.toilet_submissions;
create trigger limit_toilet_submissions before insert on public.toilet_submissions
 for each row execute function public.limit_toilet_submissions();

create or replace function public.moderate_toilet_submission(p_id uuid, p_moderator_id uuid, p_decision text)
returns table (id uuid, status text)
language plpgsql security invoker set search_path = ''
as $$
begin
 if not exists (select 1 from public.review_moderators where user_id = p_moderator_id) then
  raise exception 'Moderator access required' using errcode = '42501';
 end if;
 if p_decision is null or p_decision not in ('approved','rejected') then
  raise exception 'Invalid moderation decision' using errcode = '22023';
 end if;
 return query update public.toilet_submissions s
 set status = p_decision, moderated_by = p_moderator_id, moderated_at = statement_timestamp()
 where s.id = p_id and s.status = 'pending'
 returning s.id, s.status;
end;
$$;
revoke all on function public.moderate_toilet_submission(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.moderate_toilet_submission(uuid,uuid,text) to service_role;
commit;
