import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import postgres from 'postgres';
import { prepareSupabase, frontend, repository, runtime, ports } from './stack-config.mjs';
import { run, capture, launch, waitFor, stop, assertPortsAvailable } from './processes.mjs';
import { startBridges } from './bridges.mjs';

const require = createRequire(import.meta.url);
const children = [];
let project;
let closeBridges;
let shuttingDown = false;
let ownsRuntime = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    for (const child of children.reverse()) await stop(child);
    if (closeBridges) await closeBridges();
    if (project) {
      await run('supabase', ['stop', '--workdir', project, '--no-backup'], { stdio: 'ignore' });
      await rm(project, { recursive: true, force: true });
    }
    if (ownsRuntime) await rm(runtime, { recursive: true, force: true });
  } catch (error) {
    console.error(`E2E cleanup failed: ${error.message}`);
    code = 1;
  }
  process.exit(code);
}
process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });

try {
  await capture('docker', ['info']);
  await capture('deno', ['--version']);
  await assertPortsAvailable([...Object.values(ports), 56303, 55320, 55321, 55322]);
  await mkdir(runtime, { mode: 0o700 });
  ownsRuntime = true;
  project = await prepareSupabase();
  await capture('supabase', ['start', '--workdir', project, '--exclude',
    'studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta']);
  const status = JSON.parse(await capture('supabase', ['status', '--workdir', project, '--output', 'json']));
  if (!status.API_URL || !status.DB_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase status is missing API/database/auth configuration.');
  }
  const ipSecret = randomBytes(32).toString('hex');
  const redisToken = randomBytes(32).toString('hex');
  const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:56379/15';
  const redisAddress = new URL(redisUrl);
  if (!['localhost', '127.0.0.1'].includes(redisAddress.hostname)) {
    throw new Error('E2E Redis must be isolated on loopback; remote databases are forbidden.');
  }
  await run(process.env.OPENSSL_BIN ?? 'openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', join(runtime, 'key.pem'), '-out', join(runtime, 'cert.pem'),
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { stdio: 'ignore' });
  closeBridges = await startBridges(runtime, redisToken, redisUrl);
  const sql = postgres(status.DB_URL, { max: 1 });
  try {
    await sql`insert into app_locations.restrooms
      (osm_type,osm_id,name,latitude,longitude,wheelchair,fee,opening_hours)
      values ('node',880000001,'E2E Public Restroom',39.9526,-75.1652,'yes','no','24/7')`;
    await sql`notify pgrst, 'reload schema'`;
  } finally { await sql.end(); }
  const env = {
    ...process.env, NODE_ENV: 'production',
    SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    GATEWAY_INTERNAL_SECRET: randomBytes(32).toString('hex'), GATEWAY_IP_SIGNING_SECRET: ipSecret,
    UPSTASH_REDIS_REST_URL: `https://127.0.0.1:${ports.redisRest}`, UPSTASH_REDIS_REST_TOKEN: redisToken,
    PLACES_API_URL: `http://127.0.0.1:${ports.edge}/functions/v1/places-api`,
    FRONTEND_API_URL: `http://127.0.0.1:${ports.edge}/functions/v1/frontend-api`,
    WASHROOM_GATEWAY_URL: `http://127.0.0.1:${ports.edge}/functions/v1/gateway`,
  };
  const edge = launch('deno', ['run', '--allow-env', '--allow-net', '--allow-read',
    '--unsafely-ignore-certificate-errors=127.0.0.1', join(frontend, 'e2e', 'edge-server.ts')], { env, cwd: repository });
  children.push(edge);
  await waitFor(`http://127.0.0.1:${ports.edge}/__e2e/health`, edge);
  await writeFile(join(runtime, 'state.json'), JSON.stringify({
    apiUrl: status.API_URL, dbUrl: status.DB_URL, anonKey: status.ANON_KEY,
    serviceKey: status.SERVICE_ROLE_KEY, redisUrl,
  }), { mode: 0o600 });
  // Production Next.js needs a trusted Vercel header. A loopback-only test proxy
  // supplies it, exactly where the deployed Vercel platform normally would.
  const nextEnv = {
    ...process.env, NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    WASHROOM_GATEWAY_URL: env.WASHROOM_GATEWAY_URL, GATEWAY_IP_SIGNING_SECRET: ipSecret,
  };
  await run(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], { env: nextEnv, cwd: frontend });
  const next = launch(process.execPath, [require.resolve('next/dist/bin/next'), 'start',
    '--hostname', '127.0.0.1', '--port', '56303'], { env: { ...nextEnv, VERCEL: '1' }, cwd: frontend });
  children.push(next);
  await waitFor('http://127.0.0.1:56303', next);
  const proxy = launch(process.execPath, [join(frontend, 'e2e', 'trusted-proxy.mjs')], { env });
  children.push(proxy);
  await waitFor(`http://127.0.0.1:${ports.app}`, proxy);
  for (const child of children) child.once('exit', () => { if (!shuttingDown) void shutdown(1); });
  console.log('E2E stack ready: browser -> Next.js -> gateway -> Supabase / Redis');
} catch (error) {
  console.error(`E2E startup failed: ${error.message}`);
  await shutdown(1);
}
