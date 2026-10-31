begin;

alter table app_locations.toilet_submissions
  add column if not exists photo_paths text[] not null default '{}';

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_locations.toilet_submissions'::regclass
      and conname = 'toilet_submissions_photo_paths_limit'
  ) then
    alter table app_locations.toilet_submissions
      add constraint toilet_submissions_photo_paths_limit check (cardinality(photo_paths) <= 3);
  end if;
end;
$constraint$;

commit;
