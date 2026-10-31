begin;

-- Replace the "between 1 and 3" check on the daily counter with "between 1 and 10".
do $$
declare c record;
begin
 for c in select conname from pg_constraint
  where conrelid = 'app_locations.toilet_submission_daily_counts'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%insertions%' loop
  execute format('alter table app_locations.toilet_submission_daily_counts drop constraint %I', c.conname);
 end loop;
end $$;
alter table app_locations.toilet_submission_daily_counts
 add constraint toilet_submission_daily_counts_insertions_check check (insertions between 1 and 10);

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
 set insertions = counts.insertions + 1 where counts.insertions < 10
 returning insertions into accepted;
 if accepted is null then
  raise exception 'Daily toilet submission limit reached (10 per UTC day)' using errcode = 'P0001';
 end if;
 new.created_at := submitted_at;
 new.status := 'pending';
 return new;
end;
$$;

commit;
