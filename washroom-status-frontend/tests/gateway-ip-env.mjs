import { beforeEach, afterEach } from 'node:test';

const keys = ['GATEWAY_IP_SIGNING_SECRET', 'VERCEL', 'NODE_ENV'];
let previous;
beforeEach(() => {
  previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.GATEWAY_IP_SIGNING_SECRET = 'test-frontend-ip-signing-secret-at-least-32';
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;
});
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});
