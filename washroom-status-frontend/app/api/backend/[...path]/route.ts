import { proxyGateway } from '../../../../lib/gateway.ts';

export const dynamic = 'force-dynamic';

async function handle(req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  if (!/^(geocode|map-boundary|auth\/v1\/(otp|verify|token|user|logout))$/.test(route)) {
    return Response.json({ error: 'Gateway route not exposed.' }, { status: 404 });
  }
  return proxyGateway(req, `/frontend/${route}${new URL(req.url).search}`);
}

export { handle as GET, handle as POST, handle as PUT };
