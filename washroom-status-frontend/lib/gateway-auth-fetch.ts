export const gatewayAuthFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!/^\/auth\/v1\/(otp|verify|token|user|logout)$/.test(url.pathname)) {
    throw new Error('Only gateway-backed Supabase authentication requests are supported.');
  }
  return fetch(`/api/backend${url.pathname}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    signal: request.signal,
    redirect: 'manual',
  });
};
