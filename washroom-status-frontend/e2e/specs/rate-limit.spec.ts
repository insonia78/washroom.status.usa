import { test, expect } from '@playwright/test';
import { clearQuota, redisClient, preparePage } from '../helpers';

test.beforeEach(async ({ page }) => {
  await clearQuota();
  await preparePage(page);
});

test('real Redis atomically allows 40, rejects 40, ignores cookies and resets only on expiry', async ({ page, request }) => {
  test.setTimeout(90_000);
  const redis = await redisClient();
  const path = '/api/reviews?osm_type=node&osm_id=880000001';
  try {
    const responses = await Promise.all(Array.from({ length: 80 }, (_, i) => request.get(path, {
      headers: {
        cookie: `washroom_device=${crypto.randomUUID()}`, 'x-forwarded-for': `198.51.100.${i}`,
        'x-vercel-forwarded-for': `198.51.100.${i}`, 'x-washroom-client-ip': 'forged',
      },
    })));
    expect(responses.filter(response => response.status() === 200)).toHaveLength(40);
    expect(responses.filter(response => response.status() === 429)).toHaveLength(40);
    const denied = responses.find(response => response.status() === 429)!;
    expect(Number(denied.headers()['retry-after'])).toBeGreaterThan(0);
    expect(denied.headers()['ratelimit-remaining']).toBe('0');
    await page.goto('/contribute');
    await page.context().clearCookies();
    const browserStatus = await page.evaluate(async url => (await fetch(url)).status, path);
    expect(browserStatus).toBe(429);
    const keys = await redis.keys('washroom:gateway:ip:v1:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^washroom:gateway:ip:v1:[a-f0-9]{64}$/);
    expect(await redis.get(keys[0])).toBe('40');
    const ttl = await redis.pTTL(keys[0]);
    expect(ttl).toBeGreaterThan(45_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    const anotherIp = await request.get(path, { headers: { 'x-e2e-client-ip': '192.0.2.11' } });
    expect(anotherIp.status()).toBe(200);
    expect(anotherIp.headers()['ratelimit-remaining']).toBe('39');
    await expect.poll(() => redis.exists(keys[0]), { timeout: 65_000, intervals: [1000] }).toBe(0);
    const reset = await request.get(path);
    expect(reset.status()).toBe(200);
    expect(reset.headers()['ratelimit-remaining']).toBe('39');
    const direct = await request.get('http://127.0.0.1:56301/functions/v1/gateway/frontend/reviews', {
      headers: { 'x-forwarded-for': '192.0.2.100', 'x-washroom-client-ip': 'forged' },
    });
    expect(direct.status()).toBe(403);
    const internal = await request.get('http://127.0.0.1:56301/functions/v1/frontend-api/reviews');
    expect(internal.status()).toBe(403);
  } finally {
    await redis.quit();
    await clearQuota();
  }
});
