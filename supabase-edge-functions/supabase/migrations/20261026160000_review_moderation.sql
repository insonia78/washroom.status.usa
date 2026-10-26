begin;

create table if not exists public.review_moderators (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table if not exists public.review_moderation_log (
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null references public.reviews(id) on delete cascade,
 moderator_id uuid not null references auth.users(id),
 decision text not null check (decision in ('approved','rejected')),
 note text not null default '' check (char_length(note) <= 2000),
 created_at timestamptz not null default now()
);
alter table public.review_moderators enable row level security;
alter table public.review_moderation_log enable row level security;
revoke all on public.review_moderators, public.review_moderation_log from public, anon, authenticated;
grant select, insert, update, delete on public.review_moderators, public.review_moderation_log to service_role;

create index if not exists reviews_pending_queue on public.reviews(created_at, id) where status = 'pending';

create or replace function public.moderate_review(p_review_id uuid, p_moderator_id uuid, p_decision text, p_note text)
returns table (id uuid, status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
 changed_id uuid;
begin
 if not exists (select 1 from public.review_moderators where user_id = p_moderator_id) then
  raise exception 'Moderator access required' using errcode = '42501';
 end if;
 if p_decision is null or p_decision not in ('approved','rejected') or p_note is null or char_length(p_note) > 2000 then
  raise exception 'Invalid moderation decision' using errcode = '22023';
 end if;
 update public.reviews r set status = p_decision
 where r.id = p_review_id and r.status = 'pending'
 returning r.id into changed_id;
 if changed_id is null then
  return;
 end if;
 insert into public.review_moderation_log(review_id, moderator_id, decision, note)
 values (changed_id, p_moderator_id, p_decision, trim(p_note));
 return query select changed_id, p_decision;
end;
$$;
revoke all on function public.moderate_review(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.moderate_review(uuid, uuid, text, text) to service_role;

commit;
