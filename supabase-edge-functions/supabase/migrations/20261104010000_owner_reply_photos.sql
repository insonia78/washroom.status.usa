begin;

create table app_locations.owner_reply_photos (
 id uuid primary key default gen_random_uuid(),
 reply_id uuid not null references app_locations.owner_replies(id) on delete cascade,
 owner_user_id uuid not null references auth.users(id),
 photo_path text not null unique check (
  photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
 ),
 status text not null default 'pending' check (status in ('pending','moderated','published','rejected')),
 uploaded_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz
);
create index owner_reply_photos_reply on app_locations.owner_reply_photos(reply_id, uploaded_at);
alter table app_locations.owner_reply_photos enable row level security;
revoke all on app_locations.owner_reply_photos from public, anon, authenticated;
grant select, insert, update on app_locations.owner_reply_photos to service_role;

alter table app_locations.owner_responses
 add column photo_paths text[] not null default '{}',
 add constraint owner_responses_photo_paths_limit check (cardinality(photo_paths) <= 3);

drop function app_locations.owner_submit_reply(uuid, text, uuid, text, text);

create function app_locations.owner_submit_reply(
 p_user_id uuid, p_email text, p_invite_id uuid, p_business_name text, p_body text, p_photo_paths text[]
)
returns table(id uuid, status text)
language plpgsql security invoker set search_path = ''
as $$
declare
 inv app_locations.owner_invites;
 rev app_locations.reviews;
 new_reply_id uuid;
begin
 select * into inv from app_locations.owner_invites i where i.id=p_invite_id and i.email=lower(p_email);
 if not found then
  raise exception 'Invite not found for this account' using errcode='42501';
 end if;
 select * into rev from app_locations.reviews r where r.id=inv.review_id and r.status='approved';
 if not found then
  raise exception 'This review is no longer available' using errcode='22023';
 end if;
 if p_business_name is null or char_length(btrim(p_business_name)) not between 1 and 200
  or p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then
  raise exception 'Enter a business name and a reply up to 4000 characters' using errcode='22023';
 end if;
 if exists (select 1 from app_locations.owner_replies o where o.invite_id=inv.id and o.status in ('pending','moderated')) then
  raise exception 'A reply is already awaiting review' using errcode='22023';
 end if;
 if p_photo_paths is null or cardinality(p_photo_paths) > 3 or exists (
  select 1 from unnest(p_photo_paths) as uploaded(photo_path)
  where uploaded.photo_path !~ ('^' || p_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
 ) then
  raise exception 'Choose up to 3 valid photo files' using errcode='22023';
 end if;
 insert into app_locations.owner_replies as o
  (invite_id, review_id, osm_type, osm_id, owner_user_id, owner_email, business_name, body)
  values (inv.id, rev.id, rev.osm_type, rev.osm_id, p_user_id, inv.email, btrim(p_business_name), btrim(p_body))
  returning o.id into new_reply_id;
 if cardinality(p_photo_paths) > 0 then
  insert into app_locations.owner_reply_photos (reply_id, owner_user_id, photo_path)
   select new_reply_id, p_user_id, uploaded.photo_path from unnest(p_photo_paths) as uploaded(photo_path);
 end if;
 return query select new_reply_id, 'pending'::text;
end;
$$;

create or replace function app_locations.owner_reply_decide(p_actor_id uuid, p_id uuid, p_stage text, p_approve boolean)
returns table(id uuid, status text)
language plpgsql security invoker set search_path = ''
as $$
declare
 rep app_locations.owner_replies;
 reply_status text;
begin
 if p_stage = 'moderate' then
  if not exists (select 1 from app_locations.review_moderators where user_id=p_actor_id) then
   raise exception 'Moderator access required' using errcode='42501';
  end if;
  update app_locations.owner_replies o set
    status = case when p_approve then 'moderated' else 'rejected' end,
    moderated_by = p_actor_id, moderated_at = now()
   where o.id=p_id and o.status='pending'
   returning o.status into reply_status;
  if not found then return; end if;
  update app_locations.owner_reply_photos p set
   status = case when p_approve then 'moderated' else 'rejected' end,
   reviewed_by=p_actor_id, reviewed_at=now()
   where p.reply_id=p_id and p.status='pending';
  return query select p_id, reply_status;
 elsif p_stage = 'publish' then
  if not exists (select 1 from app_locations.owner_response_admins where user_id=p_actor_id) then
   raise exception 'Administrator access required' using errcode='42501';
  end if;
  select * into rep from app_locations.owner_replies o where o.id=p_id and o.status='moderated' for update;
  if not found then return; end if;
  if p_approve then
   insert into app_locations.owner_responses
    (osm_type, osm_id, review_id, business_name, body, verification_note, photo_paths,
     status, created_by, updated_by, published_at)
   values (rep.osm_type, rep.osm_id, rep.review_id, rep.business_name, rep.body,
    'Submitted by invited owner ' || rep.owner_email,
    coalesce((select array_agg(p.photo_path order by p.uploaded_at)
     from app_locations.owner_reply_photos p where p.reply_id=rep.id and p.status='moderated'), '{}'::text[]),
    'published', p_actor_id, p_actor_id, now());
  end if;
  update app_locations.owner_replies o set
    status = case when p_approve then 'published' else 'rejected' end,
    published_by = p_actor_id, published_at = now()
   where o.id=rep.id returning o.status into reply_status;
  update app_locations.owner_reply_photos p set
   status = case when p_approve then 'published' else 'rejected' end,
   reviewed_by=p_actor_id, reviewed_at=now()
   where p.reply_id=rep.id and p.status='moderated';
  return query select rep.id, reply_status;
 else
  raise exception 'Invalid owner reply stage' using errcode='22023';
 end if;
end;
$$;

revoke all on function app_locations.owner_submit_reply(uuid,text,uuid,text,text,text[]) from public, anon, authenticated;
grant execute on function app_locations.owner_submit_reply(uuid,text,uuid,text,text,text[]) to service_role;
revoke all on function app_locations.owner_reply_decide(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function app_locations.owner_reply_decide(uuid,uuid,text,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
