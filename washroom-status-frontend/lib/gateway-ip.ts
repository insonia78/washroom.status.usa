import { clientIpHeader, signClientIp } from '../../supabase-edge-functions/supabase/functions/_shared/gateway-client-ip.ts';

export class GatewayIpConfigurationError extends Error {}

export async function gatewayIpHeaders(req: Request): Promise<Headers> {
  const secret = process.env.GATEWAY_IP_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new GatewayIpConfigurationError('Configure a server-only GATEWAY_IP_SIGNING_SECRET of at least 32 characters.');
  }
  let ip: string;
  if (process.env.VERCEL === '1') {
    const forwarded = req.headers.get('x-vercel-forwarded-for');
    if (!forwarded) throw new GatewayIpConfigurationError('Vercel client IP header is missing.');
    ip = forwarded;
  } else if (process.env.NODE_ENV !== 'production' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(req.url).hostname)) {
    ip = '127.0.0.1';
  } else {
    throw new GatewayIpConfigurationError('IP forwarding requires the trusted Vercel proxy.');
  }
  try {
    return new Headers({ [clientIpHeader]: await signClientIp(ip, secret) });
  } catch (error) {
    throw new GatewayIpConfigurationError(error instanceof Error ? error.message : 'Invalid client IP.');
  }
}

export function gatewayRateResponseHeaders(response: Response): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}
