import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { createClient } from 'redis';
import { expect, type Page } from '@playwright/test';

type RuntimeState = { apiUrl: string; dbUrl: string; anonKey: string; serviceKey: string; redisUrl: string };
export async function runtimeState(): Promise<RuntimeState> {
  const value = JSON.parse(await readFile(resolve('e2e', '.runtime', 'state.json'), 'utf8'));
  for (const key of ['apiUrl', 'dbUrl', 'anonKey', 'serviceKey', 'redisUrl']) {
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Missing E2E runtime field: ${key}`);
  }
  return value;
}

export async function database() {
  return postgres((await runtimeState()).dbUrl, { max: 1 });
}

export async function redisClient() {
  const redis = createClient({
    url: (await runtimeState()).redisUrl, socket: { connectTimeout: 5000, reconnectStrategy: false },
  });
  redis.on('error', error => console.error(`E2E Redis: ${error.message}`));
  await redis.connect();
  return redis;
}

export async function clearQuota() {
  const redis = await redisClient();
  try {
    for await (const keys of redis.scanIterator({ MATCH: 'washroom:gateway:ip:v1:*' })) {
      if (keys.length) await redis.del(keys);
    }
  } finally { await redis.quit(); }
}

export async function preparePage(page: Page) {
  // Map tile rendering is an external-provider concern, not a local app contract.
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
}

export const reviewFields = {
  osm_type: 'node', osm_id: 880000001, rating: 5, availability: 'open',
  cleanliness_status: 'excellent', issues: [], comment: 'E2E verified review',
  current_location: true, user_latitude: 39.9526, user_longitude: -75.1652,
  restroom_latitude: 39.9526, restroom_longitude: -75.1652,
};

export async function verifiedSession() {
  const state = await runtimeState();
  const email = `review-${crypto.randomUUID()}@example.test`;
  const headers = { apikey: state.serviceKey, Authorization: `Bearer ${state.serviceKey}` };
  const created = await fetch(`${state.apiUrl}/auth/v1/admin/users`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }), signal: AbortSignal.timeout(15_000),
  });
  expect(created.status).toBe(200);
  const user = await created.json();
  const link = await fetch(`${state.apiUrl}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }), signal: AbortSignal.timeout(15_000),
  });
  expect(link.status).toBe(200);
  const data = await link.json();
  const tokenHash = data.hashed_token ?? data.properties?.hashed_token;
  expect(typeof tokenHash).toBe('string');
  const verified = await fetch('http://127.0.0.1:56300/api/backend/auth/v1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }), signal: AbortSignal.timeout(15_000),
  });
  expect(verified.status).toBe(200);
  const session = await verified.json();
  expect(session.user.id).toBe(user.id);
  expect(session.user.email_confirmed_at).toBeTruthy();
  return {
    ...session, expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
    async remove() {
      const deleted = await fetch(`${state.apiUrl}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE', headers, signal: AbortSignal.timeout(15_000),
      });
      expect(deleted.ok).toBeTruthy();
    },
  };
}

export async function installSession(page: Page, session: Record<string, unknown>) {
  const state = await runtimeState();
  const storageKey = `sb-${new URL(state.apiUrl).hostname.split('.')[0]}-auth-token`;
  const serialized = JSON.stringify(session);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: serialized });
}
