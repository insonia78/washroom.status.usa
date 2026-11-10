import gateway from '../../supabase-edge-functions/supabase/functions/gateway/index.ts';
import places from '../../supabase-edge-functions/supabase/functions/places-api/index.ts';
import frontend from '../../supabase-edge-functions/supabase/functions/frontend-api/index.ts';

const originalFetch = globalThis.fetch;
const providers: Record<string, string> = {
  'www.refugerestrooms.org': '/refuge',
  'api.zippopotam.us': '/zip',
  'photon.komoot.io': '/photon',
  'raw.githubusercontent.com': '/boundary',
};

// Only external-provider contracts are substituted; internal services use HTTP.
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const fixture = providers[url.hostname];
  if (fixture) {
    return originalFetch(`http://127.0.0.1:56302${fixture}${url.search}`, {
      method: request.method, signal: request.signal,
    });
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    return Promise.reject(new Error(`Unexpected external E2E dependency: ${url.hostname}`));
  }
  return originalFetch(request);
};

Deno.serve({ hostname: '127.0.0.1', port: 56301 }, async req => {
  const path = new URL(req.url).pathname;
  if (path === '/__e2e/health') return Response.json({ ready: true });
  if (path.startsWith('/functions/v1/gateway')) return await gateway.fetch(req);
  if (path.startsWith('/functions/v1/places-api')) return await places.fetch(req);
  if (path.startsWith('/functions/v1/frontend-api')) return await frontend.fetch(req);
  return Response.json({ error: 'Unknown test service' }, { status: 404 });
});
