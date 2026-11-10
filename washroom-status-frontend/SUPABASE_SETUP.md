# Private-schema migration notice

The legacy setup below is a bootstrap prerequisite only. Once it is complete,
apply outstanding versioned migrations in order, including
`20261030230000_private_application_schemas.sql`, which relocates existing data into
`app_accounts` and `app_locations`, with managed Auth unchanged. Continue through
later migrations for photos, workflows, quotas, supermarket search and Refuge ETL;
the cutover is not the final migration. Do not rerun legacy public-schema SQL
after cutover. Follow the
[coordinated deployment guide](../supabase-edge-functions/README.md#data-preserving-private-schema-migration).

## Current gateway prerequisites

Set a dedicated random `GATEWAY_IP_SIGNING_SECRET` (at least 32 characters) in
both Next.js and the gateway. Configure gateway-only `UPSTASH_REDIS_REST_URL`
and `UPSTASH_REDIS_REST_TOKEN` with a read/write REST token. Without these
settings, application requests fail closed with 503. Unsigned direct gateway
calls return 403; browser clients use the Next.js adapters. All clients behind
one IP share 200 requests per 60 seconds. See [the deployment checklist](./DEPLOYMENT.md)
for Vercel proxy trust and the separate backend-only `GATEWAY_INTERNAL_SECRET`.

## Historical Philadelphia bootstrap

These steps describe the original imported dataset, not a guarantee of current
hosted row counts. Preserve existing imported records; do not reimport them just
to deploy application updates. Public-schema SQL applies only before cutover.

1. In Supabase SQL Editor run `supabase/phase3-migration.sql` (safe for your existing records).
2. Copy `.env.example` to `.env.local` at the project root.
3. From Supabase Dashboard > Project Settings > API / Connect, paste the **Project URL** into `NEXT_PUBLIC_SUPABASE_URL` and the **publishable/anon key** into `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Do not paste either key in chat.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` in the edge-function environment only, not Next.js or Vercel. **Never** expose it in a `NEXT_PUBLIC_` variable, Git, screenshots, or chat.
5. Deploy `frontend-api`, `places-api`, and the updated `gateway` with the checked-in Supabase configuration. Set `PLACES_API_URL` and `FRONTEND_API_URL` on the gateway to the corresponding function URLs, and configure the same `GATEWAY_INTERNAL_SECRET` for all three. The backend uses `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; hosted Supabase supplies its standard project values. These edge-function secrets must not be sent by the frontend.
6. With the current schema and gateway prerequisites configured, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run dev` using Node.js 24 as in CI. Visit `http://localhost:3000/api/restrooms?lat=39.9526&lon=-75.1652` and expect a JSON `restrooms` array. Requests follow `browser -> /api/restrooms -> gateway -> places-api`. The gateway URL is derived from the project URL; optionally set server-only `WASHROOM_GATEWAY_URL` to override it.
7. Open `http://localhost:3000` and check map pins. Searches default to a 5-mile radius (8,046.72 meters) around the selected location; the manual selector also offers 1, 2, and 10 miles and immediately reloads results through the gateway. Places API combines stored restrooms (including ETL-imported Refuge records), imported gas stations and supermarkets, and live Refuge Restrooms. Live Overpass searches and the `/places/overpass` route have been removed. Imported businesses have unconfirmed restroom availability when no toilets tag exists. Searches outside Philadelphia are not intentionally empty.
8. For Vercel, add the same frontend environment variables in Project Settings > Environment Variables, then redeploy. Do not upload `.env.local`.

### Imported fuel search

After importing `public.export_fuel`, apply
`supabase-edge-functions/supabase/migrations/20261022153000_search_fuel_locations.sql`
before deploying the updated Places API. It adds an indexed, meter-radius
`find_nearby_fuel` RPC and grants only `service_role` execution and table read
access. Browser roles remain blocked. All coordinate and ZIP searches merge
normalized stored stations with stored restroom and Refuge results; no database
credentials or direct database calls are added to the frontend. Missing toilets
tags mean unconfirmed availability, never a confirmed public restroom.

If the API returns an error, inspect the Next.js terminal, gateway and Places API logs, backend URL configuration, and the shared internal secret. If it returns an empty list inside Philadelphia, check that imported records have latitude/longitude in the expected columns and fall within the search radius.

Notes: Ratings stay unrated until approved reviews exist; opening hours and visit
reports are not live availability. Review/toilet writes require verified Supabase
accounts and remain pending for moderation. Account daily caps, duplicate-review
checks and gateway IP quotas are implemented; configure migrations, secrets and
allowlists before relying on them. Existing records are preserved by the versioned
migrations. [The monthly ETL](../registration-api-python/etl/README.md) requires its
own GitHub environment and database credentials; it never deletes restroom rows.
