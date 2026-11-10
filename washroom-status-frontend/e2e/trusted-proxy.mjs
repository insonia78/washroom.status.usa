import { createServer, request } from 'node:http';
import { isIP } from 'node:net';

const server = createServer((incoming, outgoing) => {
  const headers = { ...incoming.headers };
  // The test runner may select an IP, but this listener is never exposed beyond
  // loopback or used in production. Arbitrary forwarded headers are discarded.
  const ip = headers['x-e2e-client-ip'] ?? '192.0.2.10';
  if (typeof ip !== 'string' || !isIP(ip)) {
    outgoing.writeHead(400).end('Invalid test IP');
    return;
  }
  delete headers['x-e2e-client-ip'];
  delete headers['x-washroom-client-ip'];
  delete headers['x-forwarded-for'];
  headers['x-vercel-forwarded-for'] = ip;
  const backend = request({
    hostname: '127.0.0.1', port: 56303, path: incoming.url,
    method: incoming.method, headers,
  }, response => {
    outgoing.writeHead(response.statusCode, response.headers);
    response.pipe(outgoing);
  });
  backend.on('error', error => {
    console.error(`E2E trusted proxy: ${error.message}`);
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end('Test upstream unavailable');
  });
  incoming.pipe(backend);
});
server.listen(56300, '127.0.0.1');
process.once('SIGTERM', () => { server.close(() => process.exit(0)); });
