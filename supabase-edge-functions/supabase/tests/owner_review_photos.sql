-- Run only against an isolated test database with the private-schema and owner-photo migrations applied.
begin;

insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
insert into app_locations.owner_response_admins(user_id) values ('10000000-0000-4000-8000-000000000001');
insert into app_locations.reviews(id,osm_type,osm_id,rating,status,photo_paths) values (
 '20000000-0000-4000-8000-000000000001','node',900000101,4,'approved',
 array[
  '10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000001.jpg',
  '10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000002.jpg'
 ]
);
insert into app_locations.owner_invites(id,email,review_id,invited_by) values (
 '30000000-0000-4000-8000-000000000001','owner@example.test',
 '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'
);

do $test$
declare
 owner_id uuid := '10000000-0000-4000-8000-000000000002';
 admin_id uuid := '10000000-0000-4000-8000-000000000001';
 v_invite_id uuid := '30000000-0000-4000-8000-000000000001';
 v_review_id uuid := '20000000-0000-4000-8000-000000000001';
 first_photo uuid;
 second_photo uuid;
 review app_locations.reviews;
 photo app_locations.owner_review_photos;
 review_paths text[];
begin
 if has_table_privilege('anon','app_locations.owner_review_photos','select')
 or has_table_privilege('authenticated','app_locations.owner_review_photos','select')
 or has_function_privilege('authenticated','app_locations.owner_submit_review_photos(uuid,text,uuid,text[])','execute')
 or has_function_privilege('authenticated','app_locations.admin_add_owner_review_photo(uuid,uuid)','execute')
 then raise exception 'Owner photo storage or RPC exposed to browser roles'; end if;

 begin
  perform app_locations.owner_submit_review_photos(owner_id,'other@example.test',v_invite_id,
   array['10000000-0000-4000-8000-000000000002/40000000-0000-4000-8000-000000000001.jpg']);
  raise exception 'Wrong owner email unexpectedly uploaded photos';
 exception when insufficient_privilege then null;
 end;

 select id into first_photo from app_locations.owner_submit_review_photos(owner_id,'owner@example.test',v_invite_id,
  array[
   '10000000-0000-4000-8000-000000000002/40000000-0000-4000-8000-000000000001.jpg',
   '10000000-0000-4000-8000-000000000002/40000000-0000-4000-8000-000000000002.jpg'
  ]) order by uploaded_at limit 1;
 select p.id into second_photo from app_locations.owner_review_photos p
  where p.invite_id=v_invite_id and p.id<>first_photo;

 select * into strict review from app_locations.reviews where id=v_review_id;
 if cardinality(review.photo_paths)<>2 then raise exception 'Owner upload became public without admin approval'; end if;
 select * into strict photo from app_locations.owner_review_photos where id=first_photo;
 if photo.status<>'pending' or photo.owner_user_id<>owner_id then raise exception 'Owner upload was not retained privately'; end if;

 select photo_paths into strict review_paths from app_locations.admin_add_owner_review_photo(admin_id,first_photo);
 if cardinality(review_paths)<>3 or not (review_paths @> array[
  '10000000-0000-4000-8000-000000000002/40000000-0000-4000-8000-000000000001.jpg'
 ]) then raise exception 'Administrator did not add the selected photo'; end if;
 select * into strict photo from app_locations.owner_review_photos where id=first_photo;
 if photo.status<>'added' or photo.reviewed_by<>admin_id or photo.reviewed_at is null then
  raise exception 'Admin decision was not recorded'; end if;

 begin
  perform app_locations.admin_add_owner_review_photo(admin_id,second_photo);
  raise exception 'Photo limit unexpectedly exceeded';
 exception when invalid_parameter_value then null;
 end;
 select * into strict photo from app_locations.owner_review_photos where id=second_photo;
 if photo.status<>'pending' then raise exception 'Rejected add changed the pending photo'; end if;

 begin
  perform app_locations.admin_add_owner_review_photo(owner_id,second_photo);
  raise exception 'Non-admin unexpectedly added an owner photo';
 exception when insufficient_privilege then null;
 end;

 raise notice 'PASS: owner photo access, private pending state, administrator approval, and review photo limit';
end;
$test$;

rollback;
