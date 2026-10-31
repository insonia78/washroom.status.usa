-- Run against an isolated database after the private-schema and review-reply migrations.
begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
insert into app_locations.owner_response_admins(user_id) values ('10000000-0000-4000-8000-000000000001');
insert into app_locations.review_locations(osm_type,osm_id) values ('node',900000009);
insert into app_locations.reviews(id,osm_type,osm_id,rating,status,user_id) values
 ('20000000-0000-4000-8000-000000000001','node',900000009,3,'pending','10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000002','node',900000009,3,'approved',null);

do $test$
declare
 admin_id uuid := '10000000-0000-4000-8000-000000000001';
 reviewer uuid := '10000000-0000-4000-8000-000000000002';
 review_id uuid := '20000000-0000-4000-8000-000000000001';
 reply_id uuid := '30000000-0000-4000-8000-000000000001';
 draft app_locations.review_replies;
 changed app_locations.review_replies;
 affected integer;
begin
 if has_table_privilege('anon','app_locations.review_replies','select')
 or has_table_privilege('authenticated','app_locations.review_replies','select')
 or has_table_privilege('authenticated','app_locations.review_replies','insert')
 or has_function_privilege('authenticated','app_locations.admin_review_reply(uuid,text,uuid,uuid,text,text)','execute')
 then raise exception 'Private replies exposed to ordinary users'; end if;
 if not (select relrowsecurity from pg_class where oid='app_locations.review_replies'::regclass) then
  raise exception 'Replies must have RLS enabled';
 end if;
 begin
  perform app_locations.admin_review_reply(reviewer,'save',reply_id,review_id,'Reply');
  raise exception 'Non-admin unexpectedly saved a reply';
 exception when insufficient_privilege then null;
 end;
 begin
  perform app_locations.admin_review_reply(admin_id,'save',reply_id,'20000000-0000-4000-8000-000000000002','Reply');
  raise exception 'Anonymous review unexpectedly accepted a reply';
 exception when invalid_parameter_value then null;
 end;
 select * into strict draft from app_locations.admin_review_reply(admin_id,'save',reply_id,review_id,' Private reply ');
 if draft.status<>'draft' or draft.body<>'Private reply' or draft.recipient_user_id<>reviewer
 or draft.created_by<>admin_id or draft.first_attempt_at is not null then raise exception 'Invalid saved draft'; end if;
 perform app_locations.admin_review_reply(admin_id,'save',reply_id,review_id,'Private reply');
 select count(*) into affected from app_locations.review_replies where id=reply_id;
 if affected<>1 then raise exception 'Retrying a lost save duplicated the reply'; end if;
 begin
  perform app_locations.admin_review_reply(admin_id,'save',reply_id,review_id,'Different text');
  raise exception 'Saved text unexpectedly mutable';
 exception when invalid_parameter_value then null;
 end;
 select * into strict changed from app_locations.admin_review_reply(admin_id,'claim',reply_id);
 if changed.status<>'sending' or changed.first_attempt_at is null or changed.last_sent_by<>admin_id then raise exception 'Invalid delivery claim'; end if;
 draft := changed;
 select count(*) into affected from app_locations.admin_review_reply(admin_id,'claim',reply_id);
 if affected<>0 then raise exception 'Concurrent claim unexpectedly succeeded'; end if;
 select * into strict changed from app_locations.admin_review_reply(admin_id,'unknown',reply_id);
 if changed.status<>'unknown' or changed.sent_at is not null then raise exception 'Uncertain delivery reported as sent'; end if;
 perform app_locations.admin_review_reply(admin_id,'claim',reply_id);
 perform app_locations.admin_review_reply(admin_id,'failed',reply_id);
 perform app_locations.admin_review_reply(admin_id,'claim',reply_id);
 select * into strict changed from app_locations.admin_review_reply(admin_id,'sent',reply_id,p_provider_id=>'provider-id');
 if changed.status<>'sent' or changed.sent_at is null or changed.provider_id<>'provider-id'
 or changed.first_attempt_at is distinct from draft.first_attempt_at then raise exception 'Missing accepted email audit'; end if;
 select * into strict changed from app_locations.admin_review_reply(admin_id,'claim',reply_id);
 if changed.status<>'sent' then raise exception 'Accepted email became sendable again'; end if;
 perform app_locations.admin_review_reply(admin_id,'failed',reply_id);
 if (select status from app_locations.review_replies where id=reply_id)<>'sent' then raise exception 'Late failure overwrote accepted status'; end if;

 reply_id := '30000000-0000-4000-8000-000000000002';
 perform app_locations.admin_review_reply(admin_id,'save',reply_id,review_id,'Retry test');
 perform app_locations.admin_review_reply(admin_id,'claim',reply_id);
 update app_locations.review_replies set last_attempt_at=now()-interval '61 seconds' where id=reply_id;
 select * into strict changed from app_locations.admin_review_reply(admin_id,'claim',reply_id);
 if changed.status<>'sending' then raise exception 'Abandoned send cannot be recovered'; end if;
 perform app_locations.admin_review_reply(admin_id,'unknown',reply_id);
 update app_locations.review_replies set first_attempt_at=now()-interval '23 hours' where id=reply_id;
 begin
  perform app_locations.admin_review_reply(admin_id,'claim',reply_id);
  raise exception 'Retry outside provider idempotency window unexpectedly allowed';
 exception when invalid_parameter_value then null;
 end;
 update app_locations.review_replies set first_attempt_at=now() where id=reply_id;
 update app_locations.reviews set user_id=null where id=review_id;
 begin
  perform app_locations.admin_review_reply(admin_id,'claim',reply_id);
  raise exception 'Reply to changed reviewer unexpectedly allowed';
 exception when invalid_parameter_value then null;
 end;
 delete from app_locations.owner_response_admins where user_id=admin_id;
 begin
  perform app_locations.admin_review_reply(admin_id,'claim',reply_id);
  raise exception 'Revoked admin unexpectedly allowed to send';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
insert into app_locations.owner_response_admins(user_id) values ('10000000-0000-4000-8000-000000000001');
update app_locations.reviews set user_id='10000000-0000-4000-8000-000000000002'
 where id='20000000-0000-4000-8000-000000000001';
set local role service_role;
do $service_test$
declare
 result app_locations.review_replies;
begin
 select * into strict result from app_locations.admin_review_reply(
  '10000000-0000-4000-8000-000000000001','save','30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001','Service-role reply');
 perform app_locations.admin_review_reply('10000000-0000-4000-8000-000000000001','claim',result.id);
 select * into strict result from app_locations.admin_review_reply(
  '10000000-0000-4000-8000-000000000001','sent',result.id,p_provider_id=>'service-provider-id');
 if result.status<>'sent' then raise exception 'Service-role delivery failed'; end if;
end;
$service_test$;
reset role;
rollback;
