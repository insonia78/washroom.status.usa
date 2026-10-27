-- Run only against an isolated test database with the review and owner-response migrations applied.
begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
insert into public.owner_response_admins(user_id) values ('10000000-0000-4000-8000-000000000001');
insert into public.review_locations(osm_type,osm_id) values ('node',900000001),('refuge',900000001);
insert into public.reviews(id,osm_type,osm_id,rating,status) values
 ('20000000-0000-4000-8000-000000000001','node',900000001,3,'approved'),
 ('20000000-0000-4000-8000-000000000002','refuge',900000001,2,'pending');

do $test$
declare
 admin_id uuid := '10000000-0000-4000-8000-000000000001';
 fields jsonb := jsonb_build_object('osm_type','node','osm_id',900000001,'review_id',null,
  'business_name',' Test business ','body',' Restocked supplies ','completed_on','2026-01-01',
  'evidence_url','https://example.com/evidence','verification_note',' Verified owner offline ');
 draft public.owner_responses;
 changed public.owner_responses;
 affected integer;
begin
 if has_table_privilege('anon','public.owner_responses','select')
 or has_table_privilege('authenticated','public.owner_responses','select')
 or has_table_privilege('authenticated','public.owner_responses','insert')
 or has_function_privilege('authenticated','public.save_owner_response(uuid,text,uuid,integer,jsonb)','execute')
 then raise exception 'Private drafts/notes or write RPC exposed to ordinary users'; end if;

 begin
  perform public.save_owner_response('10000000-0000-4000-8000-000000000002','save',null,null,fields);
  raise exception 'Non-admin write unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.save_owner_response(admin_id,'save',null,null,fields || '{"osm_id":900000002}');
  raise exception 'Unknown listing unexpectedly succeeded';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.save_owner_response(admin_id,'save',null,null,fields ||
   '{"osm_type":"refuge","review_id":"20000000-0000-4000-8000-000000000001"}');
  raise exception 'Cross-source review reply unexpectedly succeeded';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.save_owner_response(admin_id,'save',null,null,fields ||
   '{"osm_type":"refuge","review_id":"20000000-0000-4000-8000-000000000002"}');
  raise exception 'Pending review reply unexpectedly succeeded';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.save_owner_response(admin_id,'publish',null,null,null);
  raise exception 'Publish without saved draft unexpectedly succeeded';
 exception when invalid_parameter_value then null;
 end;

 select * into strict draft from public.save_owner_response(admin_id,'save',null,null,fields);
 if draft.status <> 'draft' or draft.published_at is not null or draft.version <> 1
 or draft.business_name <> 'Test business' or draft.verification_note <> 'Verified owner offline'
 or draft.created_by <> admin_id then raise exception 'Invalid saved draft'; end if;
 select count(*) into affected from public.save_owner_response(admin_id,'publish',draft.id,0,null);
 if affected <> 0 then raise exception 'Stale publish unexpectedly succeeded'; end if;
 select * into strict changed from public.save_owner_response(admin_id,'save',draft.id,1,fields || '{"body":"Fixed fixtures"}');
 if changed.version <> 2 or changed.status <> 'draft' then raise exception 'Invalid draft update'; end if;
 select count(*) into affected from public.save_owner_response(admin_id,'save',draft.id,1,fields);
 if affected <> 0 then raise exception 'Stale edit unexpectedly succeeded'; end if;
 select * into strict changed from public.save_owner_response(admin_id,'publish',draft.id,2,null);
 if changed.version <> 3 or changed.status <> 'published' or changed.published_at is null
 or changed.body <> 'Fixed fixtures' then raise exception 'Invalid published response'; end if;
 select count(*) into affected from public.save_owner_response(admin_id,'publish',draft.id,3,null);
 if affected <> 0 then raise exception 'Second publish unexpectedly succeeded'; end if;
 select count(*) into affected from public.save_owner_response(admin_id,'save',draft.id,3,fields);
 if affected <> 0 then raise exception 'Published response unexpectedly editable'; end if;

 select * into strict draft from public.save_owner_response(admin_id,'save',null,null,
  fields || '{"review_id":"20000000-0000-4000-8000-000000000001"}');
 update public.reviews set status='rejected' where id='20000000-0000-4000-8000-000000000001';
 begin
  perform public.save_owner_response(admin_id,'publish',draft.id,1,null);
  raise exception 'Publishing reply to newly rejected review unexpectedly succeeded';
 exception when invalid_parameter_value then null;
 end;
 delete from public.owner_response_admins where user_id=admin_id;
 begin
  perform public.save_owner_response(admin_id,'publish',draft.id,1,null);
  raise exception 'Revoked admin unexpectedly published';
 exception when insufficient_privilege then null;
 end;
 raise notice 'PASS: owner-response SQL privileges, targets, drafts, publication, version conflicts and admin revocation';
end;
$test$;
rollback;
