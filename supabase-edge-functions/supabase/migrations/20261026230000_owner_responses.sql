begin;

create table public.owner_response_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.owner_response_admins enable row level security;
revoke all on public.owner_response_admins from public, anon, authenticated;
grant select on public.owner_response_admins to service_role;

create table public.owner_responses (
 id uuid primary key default gen_random_uuid(),
 osm_type text not null check (osm_type in ('node','way','relation','refuge')),
 osm_id bigint not null check (osm_id > 0),
 review_id uuid references public.reviews(id),
 business_name text not null check (char_length(btrim(business_name)) between 1 and 200),
 body text not null check (char_length(btrim(body)) between 1 and 4000),
 completed_on date check (completed_on <= current_date),
 evidence_url text check (char_length(evidence_url) <= 2000 and evidence_url ~ '^https://[^[:space:]]+$'),
 verification_note text not null check (char_length(btrim(verification_note)) between 1 and 2000),
 status text not null default 'draft' check (status in ('draft','published')),
 version integer not null default 1,
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 published_at timestamptz,
 check ((status = 'draft' and published_at is null) or (status = 'published' and published_at is not null))
);
create index owner_responses_public_lookup on public.owner_responses(osm_type,osm_id,published_at desc) where status='published';
alter table public.owner_responses enable row level security;
-- Reads, writes and private verification notes are only exposed through the backend.
revoke all on public.owner_responses from public, anon, authenticated;
grant select, insert, update on public.owner_responses to service_role;

create function public.save_owner_response(
 p_admin_id uuid, p_action text, p_id uuid, p_version integer, p_fields jsonb
)
returns setof public.owner_responses
language plpgsql security invoker set search_path = ''
as $$
declare
 existing public.owner_responses;
 target_type text;
 target_id bigint;
 target_review uuid;
begin
 if not exists (select 1 from public.owner_response_admins where user_id=p_admin_id) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_action not in ('save','publish') or p_action is null then
  raise exception 'Invalid owner response action' using errcode='22023';
 end if;
 if p_id is not null then
  select * into existing from public.owner_responses where id=p_id for update;
  if not found or existing.status <> 'draft' or existing.version is distinct from p_version then
   return;
  end if;
 end if;
 if p_action='publish' then
  if p_id is null then
   raise exception 'Save a draft before publishing' using errcode='22023';
  end if;
  target_type := existing.osm_type;
  target_id := existing.osm_id;
  target_review := existing.review_id;
 else
  target_type := p_fields->>'osm_type';
  target_id := (p_fields->>'osm_id')::bigint;
  target_review := (p_fields->>'review_id')::uuid;
 end if;
 if not exists (select 1 from public.review_locations where osm_type=target_type and osm_id=target_id)
 and not exists (select 1 from public.restrooms where osm_type=target_type and osm_id=target_id) then
  raise exception 'Unknown restroom. Run a location search first.' using errcode='22023';
 end if;
 if target_review is not null then
  -- Lock against concurrent review moderation while validating the target.
  perform 1 from public.reviews where id=target_review and osm_type=target_type
   and osm_id=target_id and status='approved' for share;
  if not found then
   raise exception 'Reply must refer to an approved review for this restroom' using errcode='22023';
  end if;
 end if;
 if p_action='publish' then
  return query update public.owner_responses set status='published', published_at=now(),
   updated_at=now(), updated_by=p_admin_id, version=version+1 where id=p_id returning *;
 elsif p_id is null then
  return query insert into public.owner_responses
   (osm_type,osm_id,review_id,business_name,body,completed_on,evidence_url,verification_note,created_by,updated_by)
   values (target_type,target_id,target_review,btrim(p_fields->>'business_name'),btrim(p_fields->>'body'),
    (p_fields->>'completed_on')::date,p_fields->>'evidence_url',btrim(p_fields->>'verification_note'),p_admin_id,p_admin_id)
   returning *;
 else
  return query update public.owner_responses set
   osm_type=target_type,osm_id=target_id,review_id=target_review,
   business_name=btrim(p_fields->>'business_name'),body=btrim(p_fields->>'body'),
   completed_on=(p_fields->>'completed_on')::date,evidence_url=p_fields->>'evidence_url',
   verification_note=btrim(p_fields->>'verification_note'),updated_at=now(),updated_by=p_admin_id,version=version+1
   where id=p_id returning *;
 end if;
end;
$$;
revoke all on function public.save_owner_response(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_owner_response(uuid,text,uuid,integer,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
