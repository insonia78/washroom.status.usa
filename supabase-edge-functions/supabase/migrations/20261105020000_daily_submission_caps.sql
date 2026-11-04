begin;

-- Toilet additions: restore the cap of 3 per account per UTC day.
-- The existing 1..10 counter check is kept so today's rows from the old cap stay valid.
create or replace function app_locations.limit_toilet_submissions()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
 accepted smallint;
 submitted_at timestamptz := statement_timestamp();
begin
 if new.user_id is null then
  raise exception 'Sign in to add a toilet' using errcode = '42501';
 end if;
 insert into app_locations.toilet_submission_daily_counts as counts (user_id, submission_day, insertions)
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

-- Reviews: cap of 3 per account per UTC day. The counter is never refunded by
-- rejection or deletion; the UPSERT serializes concurrent submissions.
create table if not exists app_locations.review_submission_daily_counts (
 user_id uuid not null references auth.users(id) on delete cascade,
 submission_day date not null,
 insertions smallint not null check (insertions between 1 and 3),
 primary key (user_id, submission_day)
);
alter table app_locations.review_submission_daily_counts enable row level security;
revoke all on app_locations.review_submission_daily_counts from public, anon, authenticated;
grant select, insert, update on app_locations.review_submission_daily_counts to service_role;

create or replace function app_locations.limit_review_submissions()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
 accepted smallint;
 submitted_at timestamptz := statement_timestamp();
begin
 -- Rows without an account (legacy/seed data) are not user submissions.
 if new.user_id is null then
  return new;
 end if;
 insert into app_locations.review_submission_daily_counts as counts (user_id, submission_day, insertions)
 values (new.user_id, (submitted_at at time zone 'UTC')::date, 1)
 on conflict (user_id, submission_day) do update
 set insertions = counts.insertions + 1 where counts.insertions < 3
 returning insertions into accepted;
 if accepted is null then
  raise exception 'Daily review submission limit reached (3 per UTC day)' using errcode = 'P0001';
 end if;
 return new;
end;
$$;
revoke all on function app_locations.limit_review_submissions() from public, anon, authenticated;
grant execute on function app_locations.limit_review_submissions() to service_role;
drop trigger if exists limit_review_submissions on app_locations.reviews;
create trigger limit_review_submissions before insert on app_locations.reviews
 for each row execute function app_locations.limit_review_submissions();

commit;
