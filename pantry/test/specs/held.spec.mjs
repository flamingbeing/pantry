// Held conflicts (app-sync 0.7.1): two phones changing the SAME field to different values. The later one is held on that
// phone, never overwriting the other, and its person chooses in a popup (both versions, when in Singapore time, who): Keep
// mine, Keep theirs, or field by field. Everything else (uses and adds, different fields, the same tick or removal on both
// phones, a change made after hearing the other's) goes through as before and is never held. The local emulators only
// (demo-pantry, made-up people). SHOTS=<dir> saves the popup at 390 px.
// Run: npx playwright test held
import { test, expect } from './fixtures.mjs';
import { pair, net, drain, act, BASE_ITEM } from './sync-lib.mjs';

const held = p => p.evaluate(() => window.__pantry.held().length);
const item = (id, name) => ({ id, name, ...BASE_ITEM, batches: { b1: { qty: 5, expiry: '2027-01-01' } } });
const shown = (p, id) => p.evaluate(id => { const it = window.__pantry.S.items.get(id); return it && { name: it.name, category: it.category, location: it.location, removed: !!it.removedAt, qty: it.batches.reduce((a, b) => a + b.qty, 0) }; }, id);

test('ordinary saves on two phones are never held: uses, different fields, the same tick and removal, one after another', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/r1`, item('r1', 'Rice'));
  await fsAdmin.put(`households/${hid}/items/m1`, item('m1', 'Milk'));
  await fsAdmin.put(`households/${hid}/shop/l1`, { id: 'l1', name: 'Eggs', done: false, itemId: null, at: '2026-10-16T00:00:00.000Z', by: 'Mum' });
  for (const p of [mum, dad]) await p.waitForFunction(() => ['r1', 'm1'].every(id => window.__pantry.S.items.has(id)) && window.__pantry.S.shop.has('l1'));
  // at the same time (Dad offline): both use Rice, Dad renames it while Mum moves it, both tick the line and both remove Milk
  await net(dad, false);
  await act(dad, 'use', 'r1', 'b1'); await act(dad, 'set', 'r1', 'name', 'Basmati'); await act(dad, 'tick', 'l1', true); await act(dad, 'remove', 'm1');
  await act(mum, 'use', 'r1', 'b1'); await act(mum, 'set', 'r1', 'location', 'Pantry'); await act(mum, 'tick', 'l1', true); await act(mum, 'remove', 'm1');
  await drain(mum);
  await net(dad, true); await drain(dad);
  // one after another (each has heard the other's): the same field twice is just two saves
  await act(mum, 'set', 'r1', 'category', 'Grains'); await drain(mum);
  await dad.waitForFunction(() => window.__pantry.S.items.get('r1').category === 'Grains');
  await act(dad, 'set', 'r1', 'category', 'Rice and grains'); await drain(dad);
  await mum.waitForFunction(() => window.__pantry.S.items.get('r1').category === 'Rice and grains');
  expect([await held(mum), await held(dad)], 'nothing held on either phone').toEqual([0, 0]);
  const r = await fsAdmin.get(`households/${hid}/items/r1`);
  expect([r.name, r.location, r.category, r.batches.b1.qty]).toEqual(['Basmati', 'Pantry', 'Rice and grains', 3]);
  expect(Object.keys(r._edits).sort(), 'who changed what').toEqual(expect.arrayContaining(['batches', 'category', 'location', 'name']));
  expect(r._edits.name).toEqual({ by: expect.any(String), device: expect.any(String), at: expect.any(Number) });
  expect(typeof (await fsAdmin.get(`households/${hid}/items/m1`)).removedAt, 'removed on both: removed').toBe('string');
  expect((await fsAdmin.get(`households/${hid}/shop/l1`)).done).toBe(true);
  for (const p of [mum, dad]) {
    await expect.poll(() => shown(p, 'r1')).toEqual({ name: 'Basmati', category: 'Rice and grains', location: 'Pantry', removed: false, qty: 3 });
    await expect(p.locator('[data-sync] .ha-badge').first()).toHaveText('Saved');
  }
  expect(await dad.locator('[data-held-key]').count(), 'no popup').toBe(0);
});

test('the same field changed on two phones: the later is held on its phone; Keep what I picked, field by field; its use made meanwhile still counts', async ({ phone, fsAdmin, uid }, info) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/r1`, item('r1', 'Rice'));
  for (const p of [mum, dad]) await p.waitForFunction(() => window.__pantry.S.items.has('r1'));
  await net(dad, false);
  await act(dad, 'set', 'r1', 'name', 'Rice (Dad)'); await act(dad, 'set', 'r1', 'category', 'Dad’s shelf');
  await act(mum, 'set', 'r1', 'name', 'Rice (Mum)'); await act(mum, 'set', 'r1', 'category', 'Grains'); await drain(mum);
  await net(dad, true);
  await dad.waitForFunction(() => window.__pantry.held().length === 1);
  // nothing of Dad's reached the server; Mum is never asked
  expect((await fsAdmin.get(`households/${hid}/items/r1`)).name).toBe('Rice (Mum)');
  expect(await held(mum)).toBe(0);
  // a use made while it waits joins the choice
  await act(dad, 'use', 'r1', 'b1');
  // the popup opened by itself, on Dad's phone only: both versions, when (Singapore time) and who
  const sheet = dad.locator('.ha-sheet-body').filter({ has: dad.locator('[data-held-key]') });
  await expect(dad.locator('[data-held-key]')).toBeVisible();
  await expect(dad.getByText('Changed on two phones')).toBeVisible();
  for (const t of ['Rice (Dad)', 'Rice (Mum)', 'Dad’s shelf', 'Grains', 'Yours', 'Theirs', 'this phone']) await expect(sheet).toContainText(t);
  await expect(sheet).toContainText(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}/);
  await expect(dad.locator('[data-sync] .ha-badge').first()).toContainText('Needs attention');
  expect(await mum.locator('[data-held-key]').count()).toBe(0);
  if (process.env.SHOTS) await dad.screenshot({ path: `${process.env.SHOTS}/held-popup-390.png` });
  await info.attach('held popup (390 px)', { body: await dad.screenshot(), contentType: 'image/png' });
  // field by field: Dad's name, Mum's category
  const order = await dad.locator('.pa-held-legend').allTextContents();   // (fields in the popup's order)
  await dad.locator(`input[name="f${order.indexOf('Name')}"][value="mine"]`).check();
  await dad.locator(`input[name="f${order.indexOf('Category')}"][value="theirs"]`).check();
  await dad.locator('[data-held="each"]').click();
  await expect(dad.locator('[data-held-key]')).toHaveCount(0);
  await drain(dad);
  const r = await fsAdmin.get(`households/${hid}/items/r1`);
  expect([r.name, r.category, r.batches.b1.qty], 'the server has what Dad chose, and his use').toEqual(['Rice (Dad)', 'Grains', 4]);
  for (const p of [mum, dad]) await expect.poll(() => shown(p, 'r1')).toMatchObject({ name: 'Rice (Dad)', category: 'Grains', qty: 4 });
  expect([await held(mum), await held(dad)]).toEqual([0, 0]);
  await expect(dad.locator('[data-sync] .ha-badge').first()).toHaveText('Saved');
});

test('Keep theirs (a place renamed on both) and Keep mine (a line removed here, put back there), from Settings', async ({ phone, fsAdmin, uid }, info) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/places/pl1`, { id: 'pl1', name: 'Shed', order: 1, updatedAt: '2026-10-16T00:00:00.000Z' });
  await fsAdmin.put(`households/${hid}/shop/l1`, { id: 'l1', name: 'Eggs', done: false, itemId: null, at: '2026-10-16T00:00:00.000Z', by: 'Mum', removedAt: '2026-10-20T00:00:00.000Z', removedBy: 'Mum' });
  for (const p of [mum, dad]) await p.waitForFunction(() => window.__pantry.S.places.has('pl1') && window.__pantry.S.shop.has('l1'));
  await net(dad, false);
  await act(dad, 'renamePlace', 'pl1', 'Garden shed'); await act(dad, 'restoreLine', 'l1');
  await act(mum, 'renamePlace', 'pl1', 'Store room');
  await act(mum, 'removeLine', 'l1');   // (already removed: Mum removes it again, a new time)
  await drain(mum);
  await net(dad, true);
  await dad.waitForFunction(() => window.__pantry.held().length === 2);
  // later from Settings: the list says what waits
  await dad.locator('[data-held-key]').waitFor();
  await dad.getByRole('button', { name: 'Later' }).click();
  await expect(dad.locator('[data-held-key]')).toHaveCount(0);
  await dad.evaluate(() => { location.hash = '#/settings'; });
  await expect(dad.locator('[data-act="held-open"]')).toHaveCount(2);
  if (process.env.SHOTS) { await dad.locator('.pa-held-list').scrollIntoViewIfNeeded(); await dad.screenshot({ path: `${process.env.SHOTS}/held-settings-390.png` }); }
  // the first from the list; the next one opens by itself once that is answered
  await dad.locator('[data-act="held-open"]').first().click();
  for (let n = 2, was = ''; n > 0; n--) {
    await expect.poll(() => held(dad)).toBe(n);
    const shown = dad.locator(`[data-held-key]:not([data-held-key="${was}"])`);   // (not the one closing)
    await shown.waitFor();
    was = await shown.getAttribute('data-held-key');
    const what = await shown.textContent();
    await dad.locator(`.ha-sheet:has([data-held-key="${was}"]) [data-held="${/Place/.test(what) ? 'theirs' : 'mine'}"]`).click();
  }
  await expect.poll(() => held(dad)).toBe(0);
  await expect(dad.locator('[data-held-key]')).toHaveCount(0);
  await expect(dad.locator('[data-act="held-open"]')).toHaveCount(0);
  await drain(dad);
  expect((await fsAdmin.get(`households/${hid}/places/pl1`)).name, 'Keep theirs: Mum’s name').toBe('Store room');
  expect('removedAt' in (await fsAdmin.get(`households/${hid}/shop/l1`)), 'Keep mine: Dad’s putting back').toBe(false);
  for (const p of [mum, dad]) await expect.poll(() => p.evaluate(() => [window.__pantry.S.places.get('pl1').name, !!window.__pantry.S.shop.get('l1').removedAt])).toEqual(['Store room', false]);
  expect([await held(mum), await held(dad)]).toEqual([0, 0]);
});

// Settings (app-sync 0.7.4): the names are keyed by email, whose dots app-sync escapes in a clash's path, so Keep theirs
// and Keep mine write the right name and the popup reads "Name for <person>".
for (const choice of ['theirs', 'mine']) {
  test(`a name given to the same person on two phones (dotted email): Keep ${choice}`, async ({ phone, fsAdmin, uid }, info) => {
    const { mum, dad, mumE, dadE, hid } = await pair(phone, fsAdmin, uid, [`gran.${uid}@example.com`]);
    const granE = `gran.${uid}@example.com`;
    const names = { [mumE]: 'Jun', [dadE]: 'Dad', [granE]: 'Gran' };
    await fsAdmin.put(`households/${hid}/settings/people`, { id: 'people', names, updatedAt: String(Math.random()) });
    for (const p of [mum, dad]) await p.waitForFunction(m => Object.keys(m).every(k => window.__pantry.S.settings.get('people')?.names?.[k] === m[k]), names);
    await net(dad, false);
    await act(dad, 'namePerson', granE, 'Grandma'); await act(dad, 'namePerson', dadE, 'Daddy');
    await act(mum, 'namePerson', granE, 'Granny'); await drain(mum);
    await net(dad, true);
    await dad.waitForFunction(() => window.__pantry.held().length === 1);
    expect(await held(mum), 'Mum is never asked').toBe(0);
    expect((await fsAdmin.get(`households/${hid}/settings/people`)).names[granE], 'nothing of Dad’s overwrote Mum’s').toBe('Granny');
    const sheet = dad.locator('[data-held-key]');
    await sheet.waitFor();
    await expect(dad.locator('.pa-held-legend')).toContainText('Name for');
    await expect(dad.locator('.pa-held-side').filter({ hasText: 'Grandma' })).toHaveCount(1);
    await expect(dad.locator('.pa-held-side').filter({ hasText: 'Granny' })).toHaveCount(1);
    if (process.env.SHOTS && choice === 'theirs') await dad.screenshot({ path: `${process.env.SHOTS}/held-names-390.png` });
    await dad.locator(`[data-held="${choice}"]`).click();
    await expect.poll(() => held(dad)).toBe(0);
    await drain(dad);
    const got = (await fsAdmin.get(`households/${hid}/settings/people`)).names;
    expect(got[granE], `Keep ${choice}`).toBe(choice === 'mine' ? 'Grandma' : 'Granny');
    expect(got[dadE], 'the other name, made meanwhile, went through').toBe('Daddy');
    expect(Object.keys(got).sort(), 'no broken keys from the dots').toEqual([mumE, dadE, granE].sort());
    for (const p of [mum, dad]) await expect.poll(() => p.evaluate(g => window.__pantry.S.settings.get('people').names[g], granE)).toBe(choice === 'mine' ? 'Grandma' : 'Granny');
  });
}
