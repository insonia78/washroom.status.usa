import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export async function assertPortsAvailable(ports) {
  for (const port of ports) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', error => reject(new Error(`E2E port ${port} is unavailable: ${error.message}`)));
      server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
    });
  }
}

export function launch(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.on('error', error => console.error(`Could not start ${command}: ${error.message}`));
  return child;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = launch(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

export function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) :
      reject(new Error(`${command} failed (${code}): ${error}`)));
  });
}

export async function waitFor(url, child, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && (!child.pid || child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Service exited before becoming ready: ${url}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Readiness timed out: ${url}`);
}

export async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
