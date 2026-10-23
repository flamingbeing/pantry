// Family sharing, the way a family does it (local Firebase emulators, fake accounts; never the live project): Mum starts
// the pantry and adds Dad, invites him by mail, names him; his phone shows the name and Kaya, his use shows on hers, and
// the history says who. Run: npx playwright test sync-family
import { test, expect } from './fixtures.mjs';
import { person, go } from './sync-lib.mjs';

const sub = (p, name) => p.locator('#pa-items-list .ha-row', { hasText: name }).locator('.ha-row-sub');

test('Mum starts the pantry, invites and names Dad; his use of the Kaya shows on her phone and in the history', async ({ phone, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`;
  const mum = await person(phone, mumE, 'mum');
  await mum.click('[data-act="hh-create"]');
  await expect(mum.locator('#main .ha-row-title', { hasText: 'Our pantry' })).toBeVisible();
  await mum.fill('#pa-member-email', dadE.replace('dad-', 'Dad-').replace('@example', '@Example'));
  await mum.click('#pa-member-add button[type=submit]');
  await expect(mum.locator('#main .ha-row-title', { hasText: dadE })).toBeVisible();
  // an invite from Mum's own mail app: the toast offers it, and Dad's contact sheet keeps it for later
  await expect(mum.locator('.ha-toast-action', { hasText: 'Email invite' })).toBeVisible();
  await mum.click(`[data-act="person"][data-v="${dadE}"]`);
  const card = mum.locator('dialog.ha-sheet[open]');
  await expect(card.locator('.ha-sheet-title')).toHaveText('Family member');
  await expect(card.locator('[data-pp="remove"]'), 'Stop sharing on someone else').toHaveCount(1);
  const invite = await card.locator('a', { hasText: 'Email an invite' }).getAttribute('href');
  expect(invite.startsWith(`mailto:${encodeURIComponent(dadE)}?subject=Our%20family%20pantry&body=`)).toBe(true);
  expect(decodeURIComponent(invite)).toContain(`Continue with Google (or Use email instead), using this email address (${dadE})`);
  // name him: the list shows the name with the email underneath
  await mum.fill('#pa-person-name', '  Dad  ');
  await card.locator('button[type=submit]').click();
  const dadRow = mum.locator(`[data-act="person"][data-v="${dadE}"]`);
  await expect(dadRow.locator('.ha-row-title')).toHaveText('Dad');
  await expect(dadRow.locator('.ha-row-sub')).toContainText(dadE);
  // the owner's own card: no Stop sharing
  await mum.click(`[data-act="person"][data-v="${mumE}"]`);
  await expect(mum.locator('dialog.ha-sheet[open] .ha-sheet-title')).toBeVisible();
  await expect(mum.locator('dialog.ha-sheet[open] [data-pp="remove"]'), 'the owner can’t be removed').toHaveCount(0);
  await mum.click('dialog.ha-sheet[open] [data-ha-close]');
  await expect(mum.locator('dialog.ha-sheet[open]')).toHaveCount(0);
  await expect(mum.locator('#pa-member-email')).toHaveValue('');
  await mum.click('[data-act="sample"]');

  const dad = await person(phone, dadE, 'dad');
  await expect(dad.locator('#main .ha-row-title', { hasText: 'Our pantry' })).toBeVisible();
  // the name reached Dad's phone too, and his changes now carry it
  await expect(dad.locator(`[data-act="person"][data-v="${dadE}"] .ha-row-title`)).toHaveText('Dad');
  await go(dad, '#/items');
  await expect(dad.locator('#pa-items-list .ha-row', { hasText: 'Kaya' })).toBeVisible();
  // dad uses up the kaya; mum's screen follows
  await go(mum, '#/items');
  await expect(sub(mum, 'Kaya').filter({ hasText: '1 left' })).toBeVisible();
  await dad.locator('#pa-items-list a.ha-row', { hasText: 'Kaya' }).click();
  await dad.locator('[data-act="use"]').first().click();
  await expect(sub(mum, 'Kaya').filter({ hasText: 'None left' })).toBeVisible();
  // and the history says who
  const kaya = await mum.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Kaya').id);
  await go(mum, '#/item/' + kaya);
  await expect(mum.locator('#main .ha-row-sub', { hasText: 'Dad' }).first()).toBeVisible();
});

// owner report: after saving a name "the list of my family members disappeared"
test('names never hide anyone: three members name themselves, and a stray one-person pantry takes nothing over', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, granE = `gran-${uid}@example.com`, hid = 'hh-' + uid;
  await fsAdmin.put(`households/${hid}`, { name: 'Our pantry', owner: mumE, members: [mumE, dadE, granE], createdAt: '2026-10-16T00:00:00.000Z' });
  const mum = await person(phone, mumE, 'mum'), dad = await person(phone, dadE, 'dad'), gran = await person(phone, granE, 'gran');
  const listed = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => b.dataset.v));
  const rowsOf = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => `${b.dataset.v}=${b.querySelector('.ha-row-title').textContent}`));
  const everyone = [mumE, dadE, granE];
  await expect(gran.locator(`#main [data-act="person"][data-v="${mumE}"]`)).toBeVisible();
  const nameSelf = async (p, email, n) => {
    await p.click(`#main [data-act="person"][data-v="${email}"]`);
    await p.fill('#pa-person-name', n);
    await p.locator('dialog.ha-sheet[open] button[type=submit]').click();
    await expect(p.locator('.ha-toast', { hasText: `Saved: ${n}` })).toBeVisible();
  };
  await nameSelf(mum, mumE, 'Jun');
  expect(await listed(mum), 'mum still lists everyone right after saving her own name').toEqual(everyone);
  await nameSelf(dad, dadE, 'Dad');
  await nameSelf(gran, granE, 'Gran');
  for (const [who, p] of [['mum', mum], ['dad', dad], ['gran', gran]]) {
    await go(p, '#/settings');
    await expect(p.locator(`#main [data-act="person"][data-v="${granE}"] .ha-row-title`).first()).toHaveText('Gran');
    await expect.poll(() => rowsOf(p), { message: `${who} lists everyone with names` }).toEqual([`${mumE}=Jun`, `${dadE}=Dad`, `${granE}=Gran`]);
    await p.reload();
    await p.waitForFunction(() => window.__pantry?.S.household?.members?.length === 3);
    await go(p, '#/settings');
    await expect(p.locator(`#main [data-act="person"][data-v="${granE}"] .ha-row-title`)).toHaveText('Gran');
    expect(await listed(p), `${who} lists everyone after a reload`).toEqual(everyone);
  }
  // a second, one-person pantry for Mum (what a second "Start our family pantry" leaves behind) that sorts first must
  // not hide the family: the phone keeps its own, and starting a pantry again opens the existing one
  await fsAdmin.put(`households/0000stray-${uid}`, { name: 'Our pantry', owner: mumE, members: [mumE] });
  await mum.reload();
  await mum.waitForFunction(() => window.__pantry?.S.household);
  await go(mum, '#/settings');
  expect(await mum.evaluate(() => window.__pantry.S.household.id), 'a stray pantry did not take over').toBe(hid);
  await expect.poll(() => listed(mum), { message: 'mum still lists everyone with a stray pantry around' }).toEqual(everyone);
  await mum.evaluate(() => { localStorage.removeItem('pantry:household'); });
  await mum.reload();
  await mum.waitForFunction(() => window.__pantry?.S.household);
  expect(await mum.evaluate(() => window.__pantry.S.household.id), 'with nothing remembered, the pantry with the most people wins').toBe(hid);
});
