# Washroom Status USA

A US-focused restroom finder with genuine imported location data, moderated
reviews, photos, and owner responses. Listed hours and visit reports are not
verified live availability. Business listings without explicit restroom tags
remain unconfirmed.

## Current implementation

- Next.js/TypeScript frontend with MapLibre/OpenFreeMap, browser geolocation,
  address/ZIP search, distance display, and accessibility/fee filters.
- Searches combine stored restrooms, imported gas stations and supermarkets,
  and live Refuge Restrooms results. Stored results remain available with an
  explicit warning when Refuge is unavailable.
- Public searches and approved review reads do not require account sign-in.
  Reviews and toilet submissions require a verified, non-anonymous Supabase
  account; email magic links open the contribution questionnaire.
- Contributions are pending by default. Each account can submit at most
  **3 reviews and 3 toilets per UTC day**, with a separate duplicate
  account/listing review restriction.
- Review and toilet questionnaires accept photos. Private Storage and
  authorized signed URLs protect unpublished images.
- Allowlisted moderation and administration dashboards handle decisions,
  publication, workflow history, owner responses, and private emailed replies.
  Invited owners can respond and attach improvement photos.
- The gateway enforces **200 requests per IP per 60-second window** in Redis.
  Next.js signs the trusted client IP; unsigned direct gateway calls are denied.
- Provider exchanges are archived in private Storage. A monthly Python ETL
  upserts valid Refuge records and deletes only successfully committed archives.
  Failed files and ZIP-provider archives are retained; database rows are not deleted.

## Architecture and setup

```text
Browser -> Next.js adapters -> Supabase gateway -> Places / frontend APIs
                                              -> Python account API / JWT functions
Backends -> Supabase PostgreSQL/PostGIS, Auth and private Storage
Gateway -> Upstash Redis
Monthly Python ETL -> private Refuge archives -> app_locations.restrooms
```

Application data resides in private `app_locations` and `app_accounts` schemas;
Supabase-managed identities remain in `auth`. Keep service-role credentials,
database URLs, and gateway secrets server-only.

- [Frontend behavior and local setup](washroom-status-frontend/README.md)
- [Deployment checklist](washroom-status-frontend/DEPLOYMENT.md)
- [Edge functions and schema migration](supabase-edge-functions/README.md)
- [API contracts and IP quotas](API.md)
- [Python registration API](registration-api-python/README.md)
- [Monthly ETL setup and retry semantics](registration-api-python/etl/README.md)

Migrations, secrets, allowlists, and service deployments must be configured
explicitly. Checked-in functionality does not establish that it is enabled in a
particular production environment. Historical public-schema bootstrap SQL must
not be rerun after the private-schema cutover.

## Validation and remaining work

The [CI workflow](.github/workflows/ci.yml) checks frontend types, tests and build,
Deno functions, Python registration, real PostgreSQL ETL integration, and vertical
Chromium journeys through an isolated Supabase/Redis stack. External providers
are substituted; these tests do not certify hosted production configuration.

Public best/worst rankings, automated trend scoring, edit-review workflows, and
automated moderation are not implemented. Further production work includes load
testing, provider capacity planning, privacy/retention policies, monitoring,
backup recovery validation, and deployment hardening.

## Source file size

Keep every source file at **200 physical lines or fewer**, including comments
and blank lines. Split cohesive helpers, components and tests instead of
compressing code. Generated files, dependency lockfiles and documentation are
not source-code modules. The frontend test suite checks this repository-wide:

```powershell
cd washroom-status-frontend
node --experimental-strip-types --test tests\source-line-limit.test.mjs
```

## Product principles

- Use real location data; never fabricate public listings or ratings.
- Make timestamps and review counts visible; do not imply verified live availability.
- Prioritize mobile access, accessibility, privacy, and fair moderation.
- Every page must display **Powered by Codyza.com**, linking to https://codyza.com.
