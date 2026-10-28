// Names for the family (settings/people, one field per person) on two phones (local emulators, fake accounts; never the
// live project): names saved at once, with one phone offline, for a dotted email, and while someone is being removed are
// all kept. Each test has its own family and seeds the names it starts from. Run: npx playwright test sync-names
import { test, expect } from './fixtures.mjs';
import { pair, go, net, drain, act } from './sync-lib.mjs';

const serverNames = (fsAdmin, hid) => fsAdmin.get(`households/${hid}/settings/people`).then(d => d?.names);
async function named(phone, fsAdmin, uid, names) {
  const t = await pair(phone, fsAdmin, uid, [`gran-${uid}@example.com`]);
  const n = names(t);
  await fsAdmin.put(`households/${t.hid}/settings/people`, { id: 'people', names: n, updatedAt: String(Math.random()) });
  for (const p of [t.mum, t.dad]) await p.waitForFunction(m => Object.keys(m).every(k => window.__pantry.S.settings.get('people')?.names?.[k] === m[k]), n);
  return { ...t, granE: `gran-${uid}@example.com` };
}
const names0 = ({ mumE, dadE, granE }) => ({ [mumE]: 'Jun', [dadE]: 'Dad', [granE]: 'Gran' });
const withGran = f => t => f({ ...t, granE: t.hid.replace('hh-', 'gran-') + '@example.com' });

test('both name themselves at once: both kept, and Gran’s name too', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, mumE, dadE, granE, hid } = await named(phone, fsAdmin, uid, withGran(names0));
  await Promise.all([act(mum, 'namePerson', mumE, 'Mummy'), act(dad, 'namePerson', dadE, 'Daddy')]);
  await drain(mum); await drain(dad);
  expect(await serverNames(fsAdmin, hid), 'both names kept, the third untouched').toEqual({ [mumE]: 'Mummy', [dadE]: 'Daddy', [granE]: 'Gran' });
});

test('the same with Dad offline: his name goes up when the signal returns, Mum’s was already there', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, mumE, dadE, granE, hid } = await named(phone, fsAdmin, uid, withGran(t => ({ [t.mumE]: 'Mummy', [t.dadE]: 'Daddy', [t.granE]: 'Gran' })));
  await net(dad, false);
  await act(dad, 'namePerson', dadE, 'Dad again');
  await act(mum, 'namePerson', mumE, 'Mum again'); await drain(mum);
  expect((await serverNames(fsAdmin, hid))[mumE]).toBe('Mum again'); expect((await serverNames(fsAdmin, hid))[dadE], 'Dad’s is still waiting').toBe('Daddy');
  await net(dad, true); await drain(dad);
  expect(await serverNames(fsAdmin, hid), 'offline name kept, Mum’s too').toEqual({ [mumE]: 'Mum again', [dadE]: 'Dad again', [granE]: 'Gran' });
  for (const p of [mum, dad]) await p.waitForFunction(([m, d]) => window.__pantry.S.settings.get('people').names[d] === 'Dad again' && window.__pantry.S.settings.get('people').names[m] === 'Mum again', [mumE, dadE]);
});

test('the name of a person whose email has dots is one field, and clearing it touches nothing else', async ({ phone, fsAdmin, uid }) => {
  const { mum, dadE, hid } = await named(phone, fsAdmin, uid, withGran(t => ({ [t.mumE]: 'Mum again', [t.dadE]: 'Dad again' })));
  const ann = `ann.lee-${uid}@example.com`;
  await act(mum, 'namePerson', ann, 'Ann'); await drain(mum);
  expect((await serverNames(fsAdmin, hid))[ann], 'a dotted email is one field').toBe('Ann');
  await act(mum, 'namePerson', ann, ''); await drain(mum);
  const after = await serverNames(fsAdmin, hid);
  expect(ann in after, 'cleared by itself').toBe(false); expect(after[dadE]).toBe('Dad again');
  expect(Object.keys(await fsAdmin.get(`households/${hid}/settings/people`)).sort()).toEqual(['_saves', 'id', 'names', 'serverAt', 'updatedAt']);
});

test('Mum names Gran while Dad, offline, stops sharing with her: Gran’s name goes, the other names stay', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, mumE, dadE, granE, hid } = await named(phone, fsAdmin, uid, withGran(t => ({ [t.mumE]: 'Mum again', [t.dadE]: 'Dad again', [t.granE]: 'Gran' })));
  await go(dad, '#/settings');
  await net(dad, false);
  await dad.click(`#main [data-act="person"][data-v="${granE}"]`);
  await dad.click('dialog.ui-sheet[open] [data-pp="remove"]');
  await dad.locator('dialog[open] button', { hasText: /^Stop sharing$/ }).last().click();   // (the app waits for the server: it can't, offline)
  await act(mum, 'namePerson', granE, 'Granny'); await drain(mum);
  expect((await serverNames(fsAdmin, hid))[granE], 'Mum’s save arrived while Dad was offline').toBe('Granny');
  await net(dad, true);
  await expect.poll(async () => granE in await serverNames(fsAdmin, hid), { message: 'Gran’s name went with her' }).toBe(false);
  expect((await fsAdmin.get(`households/${hid}`)).members.includes(granE), 'and she is out of the family').toBe(false);
  expect(await serverNames(fsAdmin, hid), 'the others stay').toEqual({ [mumE]: 'Mum again', [dadE]: 'Dad again' });
  await expect(dad.locator('.toast', { hasText: 'Stopped sharing' })).toBeVisible();
});
