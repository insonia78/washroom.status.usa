import { test, expect } from '@playwright/test';
import { clearQuota, database, preparePage, runtimeState } from '../helpers';

test.beforeEach(async ({ page }) => {
  await clearQuota();
  await preparePage(page);
});

test('location search crosses Next.js, gateway and Places API and persists the review registry/archive', async ({ page }) => {
  const sql = await database();
  const startedAt = new Date();
  try {
    await sql`delete from app_locations.review_locations where osm_type='node' and osm_id=880000001`;
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/restrooms?'));
    await page.goto('/');
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()['ratelimit-limit']).toBe('40');
    await expect(page.getByRole('button', { name: 'View details for E2E Public Restroom' })).toBeVisible();
    await page.getByRole('button', { name: 'View details for E2E Public Restroom' }).click();
    await expect(page.getByRole('dialog')).toContainText('E2E Public Restroom');
    await expect(page.getByRole('dialog')).toContainText('No approved reviews yet');
    const locations = await sql`select latitude,longitude from app_locations.review_locations
      where osm_type='node' and osm_id=880000001`;
    expect(locations).toHaveLength(1);
    expect(locations[0].latitude).toBe(39.9526);
    const archives = await sql`select name from storage.objects where bucket_id='third-party-api-data-lake'
      and name like 'refuge-restrooms/%' and created_at >= ${startedAt}`;
    expect(archives.length).toBeGreaterThan(0);
    const state = await runtimeState();
    const url = `${state.apiUrl}/storage/v1/object/authenticated/third-party-api-data-lake/${archives[0].name}`;
    const denied = await fetch(url, { headers: { apikey: state.anonKey } });
    expect(denied.ok).toBeFalsy();
    const archived = await fetch(url, {
      headers: { apikey: state.serviceKey, Authorization: `Bearer ${state.serviceKey}` },
    });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      provider: 'refuge-restrooms', response: { status: 200, body: '[]' },
    });
  } finally { await sql.end(); }
});
