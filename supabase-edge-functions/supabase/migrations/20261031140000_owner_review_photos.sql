begin;

create table app_locations.owner_review_photos (
 id uuid primary key default gen_random_uuid(),
 invite_id uuid not null references app_locations.owner_invites(id) on delete cascade,
 review_id uuid not null references app_locations.reviews(id) on delete cascade,
 owner_user_id uuid not null references auth.users(id),
 photo_path text not null unique check (
  photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
 ),
 status text not null default 'pending' check (status in ('pending','added')),
 uploaded_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz
);
create index owner_review_photos_invite on app_locations.owner_review_photos(invite_id, uploaded_at);
create index owner_review_photos_review on app_locations.owner_review_photos(review_id, status);

alter table app_locations.owner_review_photos enable row level security;
revoke all on app_locations.owner_review_photos from public, anon, authenticated;
grant select, insert, update on app_locations.owner_review_photos to service_role;
grant update on app_locations.reviews to service_role;

create function app_locations.owner_submit_review_photos(
 p_user_id uuid, p_email text, p_invite_id uuid, p_photo_paths text[]
)
returns table(id uuid, invite_id uuid, review_id uuid, photo_path text, status text, uploaded_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare
 inv app_locations.owner_invites;
 rev app_locations.reviews;
 current_count integer;
begin
 select * into inv from app_locations.owner_invites i
  where i.id=p_invite_id and i.email=lower(p_email);
 if not found then
  raise exception 'Invite not found for this account' using errcode='42501';
 end if;
 select * into rev from app_locations.reviews r where r.id=inv.review_id and r.status='approved' for update;
 if not found then
  raise exception 'This review is no longer available' using errcode='22023';
 end if;
 if p_photo_paths is null or cardinality(p_photo_paths) not between 1 and 3
  or exists (
   select 1 from unnest(p_photo_paths) as uploaded(photo_path)
   where uploaded.photo_path !~ ('^' || p_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  ) then
  raise exception 'Choose up to 3 valid photo files' using errcode='22023';
 end if;
 select count(*) into current_count from app_locations.owner_review_photos p where p.invite_id=inv.id;
 if current_count + cardinality(p_photo_paths) > 3 then
  raise exception 'You can upload up to 3 photos for this review' using errcode='22023';
 end if;
 return query insert into app_locations.owner_review_photos as p
  (invite_id, review_id, owner_user_id, photo_path)
  select inv.id, rev.id, p_user_id, uploaded.photo_path from unnest(p_photo_paths) as uploaded(photo_path)
  returning p.id, p.invite_id, p.review_id, p.photo_path, p.status, p.uploaded_at;
end;
$$;

create function app_locations.admin_add_owner_review_photo(p_admin_id uuid, p_photo_id uuid)
returns table(id uuid, photo_paths text[])
language plpgsql security invoker set search_path = ''
as $$
declare
 submitted app_locations.owner_review_photos;
 rev app_locations.reviews;
begin
 if not exists (select 1 from app_locations.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 select * into submitted from app_locations.owner_review_photos p where p.id=p_photo_id for update;
 if not found or submitted.status <> 'pending' then return; end if;
 select * into rev from app_locations.reviews r where r.id=submitted.review_id for update;
 if not found or rev.status <> 'approved' then return; end if;
 if cardinality(rev.photo_paths) >= 3 then
  raise exception 'This review already has the maximum of 3 photos' using errcode='22023';
 end if;
 update app_locations.reviews r set photo_paths=array_append(r.photo_paths,submitted.photo_path)
  where r.id=rev.id returning r.photo_paths into rev.photo_paths;
 update app_locations.owner_review_photos p set status='added', reviewed_by=p_admin_id, reviewed_at=now()
  where p.id=submitted.id;
 return query select rev.id, rev.photo_paths;
end;
$$;

revoke all on function app_locations.owner_submit_review_photos(uuid,text,uuid,text[]) from public,anon,authenticated;
revoke all on function app_locations.admin_add_owner_review_photo(uuid,uuid) from public,anon,authenticated;
grant execute on function app_locations.owner_submit_review_photos(uuid,text,uuid,text[]) to service_role;
grant execute on function app_locations.admin_add_owner_review_photo(uuid,uuid) to service_role;
notify pgrst, 'reload schema';

commit;
