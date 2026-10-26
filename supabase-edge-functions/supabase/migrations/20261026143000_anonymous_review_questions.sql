begin;

alter table public.reviews alter column user_id drop not null;
alter table public.reviews
  add column if not exists availability text
    check (availability in ('open','closed','temporarily_unavailable','unverified')),
  add column if not exists cleanliness_status text
    check (cleanliness_status in ('excellent','clean','average','poor','very_dirty'));

-- Existing reviews retain unknown answers; new submissions are validated by frontend-api.
-- Keep RLS and approved-only reads unchanged. Only the server service role inserts reviews.

commit;
