-- Run against an isolated database after review moderation and both toilet migrations.
begin;
insert into auth.users(id) values
 ('30000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002'),
 ('30000000-0000-4000-8000-000000000003');
insert into public.review_moderators(user_id) values ('30000000-0000-4000-8000-000000000001');

do $test$
declare
 account_id uuid := '30000000-0000-4000-8000-000000000001';
 other_id uuid := '30000000-0000-4000-8000-000000000002';
 fresh_id uuid := '30000000-0000-4000-8000-000000000003';
 saved public.toilet_submissions;
 affected integer;
begin
 if has_table_privilege('anon','public.toilet_submissions','select')
 or has_table_privilege('authenticated','public.toilet_submissions','insert')
 or has_table_privilege('authenticated','public.toilet_submission_daily_counts','update')
 or has_function_privilege('authenticated','public.moderate_toilet_submission(uuid,uuid,text)','execute')
 then raise exception 'Private submission data, quota counters, or moderation RPC exposed'; end if;

 begin
  insert into public.toilet_submissions(name,latitude,longitude) values ('Unsigned',40.7,-74);
  raise exception 'Anonymous submission accepted';
 exception when insufficient_privilege then null;
 end;
 for i in 1..3 loop
  insert into public.toilet_submissions(user_id,name,latitude,longitude,status,created_at)
  values (account_id,'Test toilet',40.7128123,-74.0060123,'approved','2000-01-01')
  returning * into saved;
  if saved.status <> 'pending' or (saved.created_at at time zone 'UTC')::date <> (statement_timestamp() at time zone 'UTC')::date then
   raise exception 'Client bypassed pending status or current UTC day';
  end if;
 end loop;
 begin
  insert into public.toilet_submissions(user_id,name,latitude,longitude) values (account_id,'Fourth',40.7,-74);
  raise exception 'Fourth submission accepted';
 exception when raise_exception then
  if sqlerrm <> 'Daily toilet submission limit reached (3 per UTC day)' then raise; end if;
 end;
 if (select count(*) from public.toilet_submissions where user_id=account_id) <> 3 then
  raise exception 'Limit did not persist exactly three submissions';
 end if;
 if (select insertions from public.toilet_submission_daily_counts where user_id=account_id
  and submission_day=(statement_timestamp() at time zone 'UTC')::date) <> 3 then
  raise exception 'Quota counter exceeded three';
 end if;

 begin
  perform public.moderate_toilet_submission(saved.id,other_id,'approved');
  raise exception 'Non-moderator approved a toilet';
 exception when insufficient_privilege then null;
 end;
 select count(*) into affected from public.moderate_toilet_submission(saved.id,account_id,'approved');
 if affected <> 1 then raise exception 'Moderator decision not saved'; end if;
 if not exists (select 1 from public.toilet_submissions where id=saved.id and moderated_by=account_id and moderated_at is not null) then
  raise exception 'Moderator audit fields missing';
 end if;
 select count(*) into affected from public.moderate_toilet_submission(saved.id,account_id,'rejected');
 if affected <> 0 then raise exception 'Stale moderator overwrote decision'; end if;
 delete from public.toilet_submissions where user_id=account_id;
 begin
  insert into public.toilet_submissions(user_id,name,latitude,longitude) values (account_id,'After deletion',40.7,-74);
  raise exception 'Deletion refunded quota';
 exception when raise_exception then
  if sqlerrm <> 'Daily toilet submission limit reached (3 per UTC day)' then raise; end if;
 end;
 insert into public.toilet_submission_daily_counts(user_id,submission_day,insertions)
 values (other_id,(statement_timestamp() at time zone 'UTC')::date-1,3);
 insert into public.toilet_submissions(user_id,name,latitude,longitude) values (other_id,'Independent account',40.7,-74);
 if (select insertions from public.toilet_submission_daily_counts where user_id=other_id
  and submission_day=(statement_timestamp() at time zone 'UTC')::date) <> 1 then
  raise exception 'Another account or prior UTC day consumed current quota';
 end if;
 begin
  insert into public.toilet_submissions(user_id,name,latitude,longitude) values (fresh_id,'',40.7,-74);
  raise exception 'Invalid submission accepted';
 exception when check_violation then null;
 end;
 if exists (select 1 from public.toilet_submission_daily_counts where user_id=fresh_id) then
  raise exception 'Failed insertion consumed quota';
 end if;
 raise notice 'PASS: exact 3-per-account UTC quota, independent days, no deletion refund, rollback, private data and moderation';
end;
$test$;
rollback;
