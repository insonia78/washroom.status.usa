create or replace function public.approved_review_summary(p_osm_type text, p_osm_id bigint)
returns table (review_count bigint, average double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*), avg(rating)::double precision
  from public.reviews
  where osm_type = p_osm_type and osm_id = p_osm_id and status = 'approved';
$$;

revoke all on function public.approved_review_summary(text, bigint) from public, anon, authenticated;
grant execute on function public.approved_review_summary(text, bigint) to service_role;
