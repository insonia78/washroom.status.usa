begin;

create table app_locations.review_replies (
 id uuid primary key,
 review_id uuid not null references app_locations.reviews(id) on delete cascade,
 recipient_user_id uuid references auth.users(id) on delete set null,
 body text not null check (char_length(btrim(body)) between 1 and 4000),
 status text not null default 'draft' check (status in ('draft','sending','sent','failed','unknown')),
 created_by uuid references auth.users(id) on delete set null,
 last_sent_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 first_attempt_at timestamptz,
 last_attempt_at timestamptz,
 sent_at timestamptz,
 provider_id text,
 check ((status = 'sent') = (sent_at is not null)),
 check (status = 'draft' or (first_attempt_at is not null and last_attempt_at is not null))
);
create index review_replies_review_lookup on app_locations.review_replies(review_id,created_at desc,id desc);
alter table app_locations.review_replies enable row level security;
revoke all on app_locations.review_replies from public, anon, authenticated;
grant select,insert,update on app_locations.review_replies to service_role;

create function app_locations.admin_review_reply(
 p_admin_id uuid, p_action text, p_id uuid, p_review_id uuid default null,
 p_body text default null, p_provider_id text default null
)
returns setof app_locations.review_replies
language plpgsql security invoker set search_path = ''
as $$
declare
 recipient uuid;
 existing app_locations.review_replies;
begin
 if not exists (select 1 from app_locations.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_id is null or p_action is null or p_action not in ('save','claim','sent','failed','unknown') then
  raise exception 'Invalid reply action' using errcode='22023';
 end if;
 if p_action='save' then
  if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then
   raise exception 'Reply must contain 1 to 4000 characters' using errcode='22023';
  end if;
  select user_id into recipient from app_locations.reviews where id=p_review_id for share;
  if not found or recipient is null then
   raise exception 'This review has no account to reply to' using errcode='22023';
  end if;
  insert into app_locations.review_replies(id,review_id,recipient_user_id,body,created_by)
   values(p_id,p_review_id,recipient,btrim(p_body),p_admin_id) on conflict(id) do nothing;
  select * into strict existing from app_locations.review_replies where id=p_id;
  if existing.review_id <> p_review_id or existing.body <> btrim(p_body)
   or existing.created_by is distinct from p_admin_id then
   raise exception 'Reply identity already used' using errcode='22023';
  end if;
  return next existing;
  return;
 end if;
 select * into existing from app_locations.review_replies where id=p_id for update;
 if not found then return; end if;
 if p_action='claim' then
  if existing.status='sent' then return next existing; return; end if;
  if existing.recipient_user_id is null or not exists (
   select 1 from app_locations.reviews where id=existing.review_id and user_id=existing.recipient_user_id
  ) then
   raise exception 'The recipient account is no longer available' using errcode='22023';
  end if;
  -- Resend retains idempotency keys for 24 hours; stop before that safety window expires.
  if existing.first_attempt_at <= now()-interval '23 hours' then
   raise exception 'Retry window expired. Check delivery with the email provider before creating another reply' using errcode='22023';
  end if;
  if existing.status='sending' and existing.last_attempt_at > now()-interval '60 seconds' then return; end if;
  return query update app_locations.review_replies set status='sending',
   first_attempt_at=coalesce(first_attempt_at,now()), last_attempt_at=now(),last_sent_by=p_admin_id
   where id=p_id returning *;
 else
  if existing.status='sent' then return next existing; return; end if;
  if existing.status<>'sending' or existing.last_sent_by is distinct from p_admin_id then return; end if;
  if p_action='sent' and (p_provider_id is null or char_length(p_provider_id) not between 1 and 200) then
   raise exception 'Missing email provider confirmation' using errcode='22023';
  end if;
  return query update app_locations.review_replies set status=p_action,
   provider_id=case when p_action='sent' then p_provider_id else null end,
   sent_at=case when p_action='sent' then now() else null end where id=p_id returning *;
 end if;
end;
$$;
revoke all on function app_locations.admin_review_reply(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function app_locations.admin_review_reply(uuid,text,uuid,uuid,text,text) to service_role;
commit;
