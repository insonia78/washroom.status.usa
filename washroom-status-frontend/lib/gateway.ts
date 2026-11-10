import { apiFailureMessage } from './user-messages.ts';
import { gatewayIpHeaders, gatewayRateResponseHeaders, GatewayIpConfigurationError } from './gateway-ip.ts';

export class GatewayConfigurationError extends Error {}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const baseUrl = process.env.WASHROOM_GATEWAY_URL ||
    (projectUrl ? `${projectUrl.replace(/\/+$/, '')}/functions/v1/gateway` : undefined);
  if (!baseUrl) throw new GatewayConfigurationError('Restroom gateway is not configured. Set NEXT_PUBLIC_SUPABASE_URL or WASHROOM_GATEWAY_URL.');
  const headers = new Headers(init.headers);
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (apiKey) headers.set('apikey', apiKey);
  return fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    ...init, headers, cache: 'no-store', redirect: 'manual',
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
}

export async function proxyGateway(req: Request, path: string): Promise<Response> {
  try {
    const headers = await gatewayIpHeaders(req);
    for (const name of ['accept', 'content-type', 'authorization', 'apikey', 'x-client-info', 'x-supabase-api-version']) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await gatewayFetch(path, {
      method: req.method, headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    });
    const responseHeaders = gatewayRateResponseHeaders(response);
    for (const name of ['content-type', 'retry-after', 'www-authenticate']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    console.error('Gateway proxy failed:', error);
    const status = error instanceof GatewayConfigurationError || error instanceof GatewayIpConfigurationError ? 503 :
      error instanceof Error && error.name === 'TimeoutError' ? 504 : 502;
    return Response.json({ error: apiFailureMessage(null, 'Gateway API') }, { status });
  }
}
