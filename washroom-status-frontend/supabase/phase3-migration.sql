-- Run in Supabase SQL Editor AFTER the existing restrooms and reviews tables exist.
-- Allows OSM relations in reviews and speeds up bounding-box location queries.
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_osm_type_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_osm_type_check CHECK (osm_type IN ('node', 'way', 'relation'));
CREATE INDEX IF NOT EXISTS restrooms_lat_lon_idx ON public.restrooms (latitude, longitude);
ALTER TABLE public.restrooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can view restrooms" ON public.restrooms;
CREATE POLICY "Public can view restrooms" ON public.restrooms FOR SELECT TO anon, authenticated USING (true);
