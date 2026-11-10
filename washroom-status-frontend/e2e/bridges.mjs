import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { createClient } from 'redis';
import { join } from 'node:path';
import { ports } from './stack-config.mjs';

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return () => new Promise(resolve => server.close(resolve));
}

export async function startBridges(runtime, token, redisUrl) {
  const redis = createClient({ url: redisUrl, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  redis.on('error', error => console.error(`E2E Redis connection: ${error.message}`));
  await redis.connect();
  if (await redis.dbSize()) {
    await redis.quit();
    throw new Error('E2E requires an empty, dedicated Redis database. Existing data will not be modified.');
  }
  const tls = {
    key: await readFile(join(runtime, 'key.pem')),
    cert: await readFile(join(runtime, 'cert.pem')),
  };
  const rest = httpsServer(tls, async (req, res) => {
    res.setHeader('content-type', 'application/json');
    try {
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const [command, script, keyCount, key] = JSON.parse(body);
      if (command !== 'EVAL' || keyCount !== '1' || !/^washroom:gateway:ip:v1:[a-f0-9]{64}$/.test(key)) {
        res.writeHead(400).end(JSON.stringify({ error: 'Unsupported test command' }));
        return;
      }
      const result = await redis.eval(script, { keys: [key], arguments: [] });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      console.error(`E2E Redis REST bridge: ${error.message}`);
      res.writeHead(503).end(JSON.stringify({ error: 'Redis unavailable' }));
    }
  });
  const providers = httpServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('content-type', 'application/json');
    if (path === '/refuge') return res.end('[]');
    if (path === '/zip') return res.end(JSON.stringify({
      'post code': '19107', country: 'United States', 'country abbreviation': 'US',
      places: [{ 'place name': 'Philadelphia', longitude: '-75.1652', latitude: '39.9526' }],
    }));
    if (path === '/photon') return res.end(JSON.stringify({
      features: [{ geometry: { type: 'Point', coordinates: [-75.1652, 39.9526] },
        properties: { countrycode: 'US', name: 'Philadelphia', state: 'Pennsylvania' } }],
    }));
    if (path === '/boundary') return res.end(JSON.stringify({
      type: 'Feature', properties: { name: 'USA test boundary' },
      geometry: { type: 'Polygon', coordinates: [[[-125, 25], [-66, 25], [-66, 49], [-125, 49], [-125, 25]]] },
    }));
    res.writeHead(404).end(JSON.stringify({ error: 'Unknown provider fixture' }));
  });
  try {
    const closeRest = await listen(rest, ports.redisRest);
    const closeProviders = await listen(providers, ports.providers);
    return async () => {
      await Promise.all([closeRest(), closeProviders()]);
      await redis.quit();
    };
  } catch (error) {
    rest.close();
    providers.close();
    await redis.quit();
    throw error;
  }
}
