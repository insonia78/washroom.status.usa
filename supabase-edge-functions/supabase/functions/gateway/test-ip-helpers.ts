import { clientIpHeader, signClientIp } from "../_shared/gateway-client-ip.ts";

export const testIpSecret = "gateway-tests-dedicated-ip-secret-at-least-32";

export function withTestClientIp(gateway: { fetch: (req: Request) => Promise<Response> }) {
  return {
    async fetch(req: Request): Promise<Response> {
      const headers = new Headers(req.headers);
      headers.set(clientIpHeader, await signClientIp("192.0.2.1", testIpSecret));
      return await gateway.fetch(new Request(req, { headers }));
    },
  };
}
