import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareSupabase, repository } from '../e2e/stack-config.mjs';
import { capture, launch, waitFor, stop, assertPortsAvailable } from '../e2e/processes.mjs';

test('E2E projects are unique and apply the actual production migrations after prerequisites', async () => {
  const projects = [];
  try {
    projects.push(await prepareSupabase());
    projects.push(await prepareSupabase());
    const configs = await Promise.all(projects.map(path => readFile(join(path, 'supabase', 'config.toml'), 'utf8')));
    const ids = configs.map(config => config.match(/project_id = "([^"]+)"/)[1]);
    assert.notEqual(ids[0], ids[1]);
    assert.match(configs[0], /schemas = \["app_accounts", "app_locations"\]/);
    const source = join(repository, 'supabase-edge-functions', 'supabase', 'migrations');
    const target = join(projects[0], 'supabase', 'migrations');
    const files = (await readdir(source)).filter(file => file.endsWith('.sql'));
    assert.equal((await readdir(target)).length, files.length + 1);
    for (const file of files) {
      assert.equal(await readFile(join(target, file), 'utf8'), await readFile(join(source, file), 'utf8'));
    }
    const bootstrap = await readFile(join(target, '20260101000000_e2e_prerequisites.sql'), 'utf8');
    assert.match(bootstrap, /create extension if not exists postgis/);
    assert.match(bootstrap, /create table if not exists public\.reviews/);
  } finally {
    for (const project of projects) await rm(project, { recursive: true, force: true });
  }
});

test('E2E subprocess failures include their real exit status and diagnostics', async () => {
  assert.equal(await capture(process.execPath, ['-e', 'process.stdout.write("ready")']), 'ready');
  await assert.rejects(capture(process.execPath, ['-e', 'console.error("fixture failure");process.exit(7)']),
    /failed \(7\): fixture failure/);
});

test('E2E readiness checks HTTP status rather than just a listening process', async () => {
  let ready = false;
  const server = createServer((_req, res) => res.writeHead(ready ? 200 : 503).end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(assertPortsAvailable([server.address().port]), /E2E port .* is unavailable/);
    await assert.rejects(waitFor(url, undefined, 50), /Readiness timed out/);
    ready = true;
    await waitFor(url, undefined, 1000);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('E2E shutdown terminates only its owned subprocess and tolerates repeated cleanup', async () => {
  const child = launch(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  await stop(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await stop(child);
});
