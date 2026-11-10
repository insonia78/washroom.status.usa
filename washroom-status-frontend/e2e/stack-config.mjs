import { mkdtemp, mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const frontend = fileURLToPath(new URL('../', import.meta.url));
export const repository = resolve(frontend, '..');
export const runtime = join(frontend, 'e2e', '.runtime');
export const ports = { app: 56300, edge: 56301, providers: 56302, redisRest: 56443 };

export async function prepareSupabase() {
  const project = await mkdtemp(join(tmpdir(), 'washroom-e2e-'));
  const migrations = join(project, 'supabase', 'migrations');
  await mkdir(migrations, { recursive: true });
  const baseline = [
    await readFile(join(frontend, 'e2e', 'bootstrap.sql'), 'utf8'),
    await readFile(join(frontend, 'supabase', 'schema.sql'), 'utf8'),
  ].join('\n');
  await writeFile(join(migrations, '20260101000000_e2e_prerequisites.sql'), baseline);
  const source = join(repository, 'supabase-edge-functions', 'supabase', 'migrations');
  for (const file of (await readdir(source)).filter(file => file.endsWith('.sql')).sort()) {
    await copyFile(join(source, file), join(migrations, file));
  }
  await writeFile(join(project, 'supabase', 'config.toml'), `
project_id = "washroom-e2e-${randomUUID()}"
[api]
port = 55321
schemas = ["app_accounts", "app_locations"]
extra_search_path = ["public", "extensions"]
[db]
port = 55322
shadow_port = 55320
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
enabled = false
[auth]
site_url = "http://127.0.0.1:${ports.app}"
additional_redirect_urls = ["http://127.0.0.1:${ports.app}/auth/callback"]
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
`);
  return project;
}
