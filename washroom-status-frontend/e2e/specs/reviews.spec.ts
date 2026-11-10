import { test, expect } from '@playwright/test';
import { clearQuota, database, preparePage, verifiedSession, installSession, reviewFields } from '../helpers';

test.beforeEach(async ({ page }) => {
  await clearQuota();
  await preparePage(page);
});

test('verified user submits in browser, pending review stays private, moderator publishes it', async ({ page, request }) => {
  const sql = await database();
  const session = await verifiedSession();
  const comment = `Vertical review ${crypto.randomUUID()}`;
  try {
    await installSession(page, session);
    const forbidden = await fetch('http://127.0.0.1:56300/api/backend/moderation/reviews', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    expect(forbidden.status).toBe(403);
    await page.goto('/');
    await page.getByRole('button', { name: 'Add review for E2E Public Restroom' }).click();
    await expect(page).toHaveURL(/\/contribute$/);
    await expect(page.getByText(/Signed in. Your account is linked privately/)).toBeVisible();
    await page.getByRole('radio', { name: 'Open', exact: true }).check();
    await page.getByRole('radio', { name: '5 stars', exact: true }).check();
    await page.getByRole('radio', { name: 'Excellent', exact: true }).check();
    await page.getByLabel('Details (optional)').fill(comment);
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/reviews') &&
      response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit for moderation' }).click();
    expect((await submitted).status()).toBe(201);
    await expect(page.getByText(/Thank you for your review/)).toBeVisible();
    const saved = await sql`select id,user_id,status,rating,comment from app_locations.reviews where comment=${comment}`;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ user_id: session.user.id, status: 'pending', rating: 5, comment });
    const pending = await request.get('/api/reviews?osm_type=node&osm_id=880000001');
    expect(pending.status()).toBe(200);
    expect((await pending.json()).reviews).toEqual([]);
    await sql`insert into app_locations.review_moderators(user_id) values (${session.user.id})`;
    const moderated = await fetch('http://127.0.0.1:56300/api/backend/moderation/reviews', {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: saved[0].id, decision: 'approved', note: 'E2E approval' }),
      signal: AbortSignal.timeout(15_000),
    });
    expect(moderated.status).toBe(200);
    const published = await request.get('/api/reviews?osm_type=node&osm_id=880000001');
    expect(published.status()).toBe(200);
    expect((await published.json()).reviews).toEqual(expect.arrayContaining([expect.objectContaining({ comment })]));
    const audit = await sql`select decision from app_locations.review_moderation_log where review_id=${saved[0].id}`;
    expect(audit[0].decision).toBe('approved');
  } finally {
    await sql`delete from app_locations.review_moderation_log where moderator_id=${session.user.id}`;
    await sql`delete from app_locations.review_moderators where user_id=${session.user.id}`;
    await sql`delete from app_locations.reviews where user_id=${session.user.id}`;
    await session.remove();
    await sql.end();
  }
});

test('missing and invalid sessions cannot write reviews or access moderation', async ({ page, request }) => {
  const sql = await database();
  const comment = `Rejected review ${crypto.randomUUID()}`;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add review for E2E Public Restroom' }).click();
    await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
    const credentials: Record<string, string>[] = [{}, { Authorization: 'Bearer invalid-expired-token' }];
    for (const headers of credentials) {
      const response = await request.post('/api/reviews', { headers, data: { ...reviewFields, comment } });
      expect(response.status()).toBe(401);
    }
    const moderation = await request.get('/api/backend/moderation/reviews');
    expect(moderation.status()).toBe(401);
    const rows = await sql`select id from app_locations.reviews where comment=${comment}`;
    expect(rows).toHaveLength(0);
  } finally { await sql.end(); }
});
