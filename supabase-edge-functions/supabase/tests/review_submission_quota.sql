-- Run against an isolated database after 20261105020000_daily_submission_caps.sql.
begin;
insert into auth.users(id) values
 ('31000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000002');

do $test$
declare
 account_id uuid := '31000000-0000-4000-8000-000000000001';
 other_id uuid := '31000000-0000-4000-8000-000000000002';
begin
 if has_table_privilege('authenticated','app_locations.review_submission_daily_counts','update')
 or has_table_privilege('anon','app_locations.review_submission_daily_counts','select')
 then raise exception 'Review quota counters exposed'; end if;

 for i in 1..3 loop
  insert into app_locations.reviews(osm_type,osm_id,rating,status,user_id)
  values ('node',900000 + i,4,'pending',account_id);
 end loop;
 begin
  insert into app_locations.reviews(osm_type,osm_id,rating,status,user_id)
  values ('node',900004,4,'pending',account_id);
  raise exception 'Fourth review accepted';
 exception when raise_exception then
  if sqlerrm <> 'Daily review submission limit reached (3 per UTC day)' then raise; end if;
 end;
 if (select count(*) from app_locations.reviews where user_id=account_id) <> 3 then
  raise exception 'Limit did not persist exactly three reviews';
 end if;

 delete from app_locations.reviews where user_id=account_id;
 begin
  insert into app_locations.reviews(osm_type,osm_id,rating,status,user_id)
  values ('node',900005,4,'pending',account_id);
  raise exception 'Deletion refunded review quota';
 exception when raise_exception then
  if sqlerrm <> 'Daily review submission limit reached (3 per UTC day)' then raise; end if;
 end;

 insert into app_locations.review_submission_daily_counts(user_id,submission_day,insertions)
 values (other_id,(statement_timestamp() at time zone 'UTC')::date-1,3);
 insert into app_locations.reviews(osm_type,osm_id,rating,status,user_id)
 values ('node',900006,4,'pending',other_id);
 if (select insertions from app_locations.review_submission_daily_counts where user_id=other_id
  and submission_day=(statement_timestamp() at time zone 'UTC')::date) <> 1 then
  raise exception 'Another account or prior UTC day consumed current review quota';
 end if;
 raise notice 'PASS: 3 reviews per account per UTC day, independent days/accounts, no deletion refund';
end;
$test$;
rollback;
