import { proxyGateway } from '../../../lib/gateway.ts';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return proxyGateway(req, `/frontend/reviews${new URL(req.url).search}`);
}

export function POST(req: Request) {
  return proxyGateway(req, '/frontend/reviews');
}
