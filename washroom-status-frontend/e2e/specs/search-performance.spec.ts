import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test, expect} from '@playwright/test';
import {database, preparePage} from '../helpers';

test('database bounds nearest candidates before returning rows', async () => {
  const sql = await database();
  try {
    const source = await readFile(resolve('..', 'supabase-edge-functions', 'supabase', 'tests', 'bounded_nearby_search.sql'), 'utf8');
    await sql.unsafe(source);
  } finally {await sql.end();}
});

test('offscreen cards defer reviews until scrolled into view', async ({page}) => {
  await preparePage(page);
  const requested = new Set<number>();
  const rows = Array.from({length: 200}, (_, index) => ({
    id: index + 1, osm_type: 'node', name: `Performance restroom ${index + 1}`,
    lat: 39.9526 + index / 100000, lon: -75.1652, wheelchair: 'yes', fee: 'no',
  }));
  await page.route('**/api/restrooms?**', route => route.fulfill({
    json: {restrooms: rows, warning: 'Showing up to the nearest 200 locations.'},
  }));
  await page.route('**/api/reviews?**', async route => {
    requested.add(Number(new URL(route.request().url()).searchParams.get('osm_id')));
    await route.fulfill({json: {reviews: [], average: null, review_count: 0}});
  });
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'View details for Performance restroom 200', exact: true})).toBeAttached();
  await expect(page.getByText('Showing up to the nearest 200 locations.')).toBeVisible();
  await expect.poll(() => requested.size).toBeGreaterThan(0);
  expect(requested.size).toBeLessThan(30);
  expect(requested.has(200)).toBe(false);
  const last = page.getByRole('button', {name: 'View details for Performance restroom 200', exact: true});
  await last.locator('..').getByText('Latest approved review', {exact: true}).scrollIntoViewIfNeeded();
  await expect.poll(() => requested.has(200)).toBe(true);
  expect(requested.size).toBeLessThan(50);
});
