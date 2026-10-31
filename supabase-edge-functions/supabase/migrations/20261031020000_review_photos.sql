begin;

alter table app_locations.reviews
  add column if not exists photo_paths text[] not null default '{}';

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_locations.reviews'::regclass
      and conname = 'reviews_photo_paths_limit'
  ) then
    alter table app_locations.reviews
      add constraint reviews_photo_paths_limit check (cardinality(photo_paths) <= 3);
  end if;
end;
$constraint$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
