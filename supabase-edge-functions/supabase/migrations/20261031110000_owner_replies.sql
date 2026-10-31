begin;

create table app_locations.owner_invites (
 id uuid primary key default gen_random_uuid(),
 email text not null check (email = lower(email) and char_length(email) between 3 and 320),
 review_id uuid not null references app_locations.reviews(id) on delete cascade,
 invited_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (email, review_id)
);

create table app_locations.owner_replies (
 id uuid primary key default gen_random_uuid(),
 invite_id uuid not null references app_locations.owner_invites(id) on delete cascade,
 review_id uuid not null references app_locations.reviews(id) on delete cascade,
 osm_type text not null,
 osm_id bigint not null,
 owner_user_id uuid not null references auth.users(id),
 owner_email text not null,
 business_name text not null check (char_length(btrim(business_name)) between 1 and 200),
 body text not null check (char_length(btrim(body)) between 1 and 4000),
 status text not null default 'pending' check (status in ('pending','moderated','published','rejected')),
 created_at timestamptz not null default now(),
 moderated_by uuid references auth.users(id),
 moderated_at timestamptz,
 published_by uuid references auth.users(id),
 published_at timestamptz
);
create index owner_replies_status on app_locations.owner_replies(status, created_at);

alter table app_locations.owner_invites enable row level security;
alter table app_locations.owner_replies enable row level security;
revoke all on app_locations.owner_invites, app_locations.owner_replies from public, anon, authenticated;
grant select, insert, update on app_locations.owner_invites, app_locations.owner_replies to service_role;
grant select on app_locations.reviews, app_locations.review_moderators, app_locations.owner_response_admins to service_role;

create function app_locations.admin_create_owner_invite(p_admin_id uuid, p_email text, p_review_id uuid)
returns table(id uuid, email text, review_id uuid, created_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
begin
 if not exists (select 1 from app_locations.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(p_email) > 320 then
  raise exception 'Enter a valid owner email' using errcode='22023';
 end if;
 if not exists (select 1 from app_locations.reviews r where r.id=p_review_id and r.status='approved') then
  raise exception 'Invites can only be sent for approved reviews' using errcode='22023';
 end if;
 return query insert into app_locations.owner_invites as i (email, review_id, invited_by)
  values (lower(btrim(p_email)), p_review_id, p_admin_id)
  on conflict on constraint owner_invites_email_review_id_key do update set invited_by = excluded.invited_by
  returning i.id, i.email, i.review_id, i.created_at;
end;
$$;

create function app_locations.owner_submit_reply(
 p_user_id uuid, p_email text, p_invite_id uuid, p_business_name text, p_body text
)
returns table(id uuid, status text)
language plpgsql security invoker set search_path = ''
as $$
declare
 inv app_locations.owner_invites;
 rev app_locations.reviews;
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
 return query insert into app_locations.owner_replies as o
  (invite_id, review_id, osm_type, osm_id, owner_user_id, owner_email, business_name, body)
  values (inv.id, rev.id, rev.osm_type, rev.osm_id, p_user_id, inv.email, btrim(p_business_name), btrim(p_body))
  returning o.id, o.status;
end;
$$;

create function app_locations.owner_reply_decide(p_actor_id uuid, p_id uuid, p_stage text, p_approve boolean)
returns table(id uuid, status text)
language plpgsql security invoker set search_path = ''
as $$
declare
 rep app_locations.owner_replies;
begin
 if p_stage = 'moderate' then
  if not exists (select 1 from app_locations.review_moderators where user_id=p_actor_id) then
   raise exception 'Moderator access required' using errcode='42501';
  end if;
  return query update app_locations.owner_replies o set
    status = case when p_approve then 'moderated' else 'rejected' end,
    moderated_by = p_actor_id, moderated_at = now()
   where o.id=p_id and o.status='pending' returning o.id, o.status;
 elsif p_stage = 'publish' then
  if not exists (select 1 from app_locations.owner_response_admins where user_id=p_actor_id) then
   raise exception 'Administrator access required' using errcode='42501';
  end if;
  select * into rep from app_locations.owner_replies o where o.id=p_id and o.status='moderated' for update;
  if not found then return; end if;
  if p_approve then
   insert into app_locations.owner_responses
    (osm_type, osm_id, review_id, business_name, body, verification_note, status, created_by, updated_by, published_at)
   values (rep.osm_type, rep.osm_id, rep.review_id, rep.business_name, rep.body,
    'Submitted by invited owner ' || rep.owner_email, 'published', p_actor_id, p_actor_id, now());
  end if;
  return query update app_locations.owner_replies o set
    status = case when p_approve then 'published' else 'rejected' end,
    published_by = p_actor_id, published_at = now()
   where o.id=rep.id returning o.id, o.status;
 else
  raise exception 'Invalid stage' using errcode='22023';
 end if;
end;
$$;

revoke all on function app_locations.admin_create_owner_invite(uuid,text,uuid) from public,anon,authenticated;
revoke all on function app_locations.owner_submit_reply(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function app_locations.owner_reply_decide(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function app_locations.admin_create_owner_invite(uuid,text,uuid) to service_role;
grant execute on function app_locations.owner_submit_reply(uuid,text,uuid,text,text) to service_role;
grant execute on function app_locations.owner_reply_decide(uuid,uuid,text,boolean) to service_role;
grant insert on app_locations.owner_responses to service_role;
notify pgrst, 'reload schema';

commit;
