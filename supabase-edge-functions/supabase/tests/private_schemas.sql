-- Run against an isolated database after all migrations.
begin;
do $test$
declare item text;
begin
 foreach item in array array['restrooms','reviews','review_locations','review_moderators',
  'review_moderation_log','owner_response_admins','owner_responses','toilet_submissions','toilet_submission_daily_counts']
 loop
  if to_regclass('public.' || item) is not null or to_regclass('app_locations.' || item) is null then
   raise exception 'Location relation not moved: %',item;
  end if;
  if has_table_privilege('anon','app_locations.' || item,'select')
   or has_table_privilege('authenticated','app_locations.' || item,'select')
   or has_table_privilege('authenticated','app_locations.' || item,'insert') then
   raise exception 'Location data exposed to browser roles: %',item;
  end if;
 end loop;
 foreach item in array array['accounts','password_reset_tokens','jwt_tokens']
 loop
  if to_regclass('public.' || item) is not null then
   raise exception 'Account relation remains in public: %',item;
  end if;
  if to_regclass('app_accounts.' || item) is not null and
   (has_table_privilege('anon','app_accounts.' || item,'select')
   or has_table_privilege('authenticated','app_accounts.' || item,'select')) then
   raise exception 'Account data exposed to browser roles: %',item;
  end if;
 end loop;
 if has_schema_privilege('anon','app_accounts','usage')
  or has_schema_privilege('authenticated','app_locations','usage') then
  raise exception 'Private schemas exposed to client roles';
 end if;
 if not has_schema_privilege('service_role','app_accounts','usage')
  or not has_schema_privilege('service_role','app_locations','usage') then
  raise exception 'Backend cannot access private schemas';
 end if;
 if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_locations' and p.prosrc ~ '\mpublic\.(restrooms|reviews|review_locations|review_moderators|review_moderation_log|owner_response_admins|owner_responses|toilet_submissions|toilet_submission_daily_counts)\M') then
  raise exception 'Application routine still references old public tables';
 end if;
 if to_regclass('auth.users') is null then raise exception 'Managed auth schema changed'; end if;
 raise notice 'PASS: private schema placement, routine references, managed auth, and role permissions';
end;
$test$;
rollback;

begin;
insert into auth.users(id) values ('50000000-0000-4000-8000-000000000001');
insert into app_locations.review_moderators(user_id) values ('50000000-0000-4000-8000-000000000001');
do $behavior$
declare
 account_id uuid := '50000000-0000-4000-8000-000000000001';
 saved app_locations.toilet_submissions;
 affected integer;
begin
 for i in 1..3 loop
  insert into app_locations.toilet_submissions(user_id,name,latitude,longitude)
  values(account_id,'Private-schema test',40.7,-74) returning * into saved;
 end loop;
 begin
  insert into app_locations.toilet_submissions(user_id,name,latitude,longitude)
  values(account_id,'Fourth submission',40.7,-74);
  raise exception 'Relocation broke the quota trigger';
 exception when raise_exception then
  if sqlerrm <> 'Daily toilet submission limit reached (3 per UTC day)' then raise; end if;
 end;
 select count(*) into affected from app_locations.moderate_toilet_submission(saved.id,account_id,'approved');
 if affected <> 1 then raise exception 'Relocation broke moderation RPC'; end if;
 if not exists(select 1 from app_locations.toilet_submissions where id=saved.id and moderated_by=account_id) then
  raise exception 'Relocation broke moderator audit/FK';
 end if;
 if (select count(*) from app_locations.approved_review_summary('node',999999999)) <> 1 then
  raise exception 'Relocation broke review summary RPC';
 end if;
 raise notice 'PASS: moved quota trigger, moderator RPC/audit and review summary execute successfully';
end;
$behavior$;
rollback;
