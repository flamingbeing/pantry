// Three phones on one family pantry, doing random things while going offline and coming back (the emulator: demo-pantry,
// fake accounts; never the live project). Each action is the app's own code (window.__pantry.act: the same functions the
// buttons call), so a run makes dozens of real changes in seconds. Seeded, so a failure can be run again.
//
// What must hold when everyone is back online and everything has been sent:
//   - for every batch of every item: the server's quantity = what it started with + every add - every use the phones
//     issued (undo is the opposite instruction). Instructions add up, so no use or add is lost or counted twice, whoever
//     was offline. (The screen shows max(0, that): stock never below 0.)
//   - all three phones show what the server has (quantities and names); a name is one of the names someone saved;
//   - the history (events) on the server is exactly the lines created and not undone;
//   - no change was refused and left in "Needs attention";
//   - deletes are markers (removedAt): Rice is only ever deleted, Milk deleted and restored (a phone restores only what it sees
//     removed, as the button does), Eggs never; at the end a deleted item nobody restored is still removed on the server and on
//     every phone (nothing brings it back: not a use, an add, an undo or an edit that landed on it, online or not), Eggs is
//     never hidden, and the stock still adds up for hidden items too;
//   - five shopping lines: ticks are fields, each line ticked by one phone only (so the last tick it made is the final state),
//     lines 0-1 only removed, 2-3 removed and restored, 4 never removed: the final done of every line is that last tick,
//     whatever else happened to it (a tick and a remove never undo each other), a removed line nobody restored stays removed,
//     and every phone shows what the server has.
//   - names and places (PR-C): each phone names itself (set, now and then cleared) as a field of settings/people, so the last name
//     each phone set (or cleared) is the one on the server and on every phone, whoever was offline; places are one document
//     each: every place a phone added exists once, live unless removed; one removed and not restored is still removed (and
//     stays hidden on every phone: a rename or a move landing on it brings nothing back); a place's name is one some phone gave
//     it; the eleven default places made from the old list by whichever phone changed places first exist once, however many
//     phones tried at once (some offline); and every phone's list of places is the server's, in the same order.
//   - the Items list (this PR): phones put items in My order (one field on one item, or the whole category numbered when there is
//     no room) and move several items to a place in one batch, at random, offline or not: every `order` and place on the server is
//     a number / place some phone gave it, every phone shows exactly the server's `order` and place for every item (so every phone
//     shows the same order), nothing is refused, and after one phone tidies the numbers (a renumber) every live item in the
//     category has its own number and the sequence is exactly what it was before.
// Run by pantry/test/run-sync.sh; one seed: SEED=7 node test/multidevice.e2e.mjs (inside the emulators), more: SEEDS=1,2,3.
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
import * as Lg from '../js/logic.js';
import * as Ord from '../js/order.js';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');

const SEEDS = (process.env.SEEDS || process.env.SEED || '11,2026').split(',').map(Number);
const STEPS = Number(process.env.STEPS || 36);
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const FSJS = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'}/v1/projects/demo-pantry/databases/(default)/documents/`;
const val = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const unval = v => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(unval) : 'mapValue' in v ? unfields(v.mapValue.fields || {}) : undefined;
const unfields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unval(v)]));
const admin = {
  async put(path, o) { const r = await fetch(FS + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(o) }) }); assert.ok(r.ok, 'seed ' + path); },
  async list(path) {   // every page
    const out = []; let token = '';
    do {
      const r = await fetch(FS + path + '?pageSize=300' + (token ? '&pageToken=' + token : ''), { headers: { Authorization: 'Bearer owner' } });
      const j = r.ok ? await r.json() : {};
      out.push(...(j.documents || []).map(d => unfields(d.fields || {}))); token = j.nextPageToken || '';
    } while (token);
    return out;
  },
  async get(path) { const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } }); return r.ok ? unfields((await r.json()).fields || {}) : null; },
};

const srv = await serve();
const browser = await chromium.launch();
const errors = [];
const url = srv.url + '/pantry/?emulator';
async function person(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.who = email;
  page.on('pageerror', e => errors.push(email + ': ' + e.message));
  page.on('crash', () => console.error(email, 'PAGE CRASHED')); page.on('pageerror', e => console.error(email, 'pageerror', e.message.slice(0, 200)));
  if (process.env.MD_DEBUG) { page.on('framenavigated', f => console.log(email, 'navigated', f.url())); page.on('console', m => console.log(email, m.type(), m.text())); }
  await page.goto(url + '#/settings');
  await page.waitForFunction(() => window.__pantry?.signIn);
  await page.evaluate(e => window.__pantry.signIn(e), email);
  await page.locator('#main', { hasText: email }).waitFor();
  return page;
}
const net = async (p, on) => { try { await p.evaluate(async ([on, u]) => { const F = await import(u); const db = F.getFirestore(); await (on ? F.enableNetwork(db) : F.disableNetwork(db)); }, [on, FSJS]); } catch (e) { console.error('network switch failed on', p.who, on, e.message); throw e; } };
const drain = async p => { try { await p.evaluate(async u => { const F = await import(u); await F.waitForPendingWrites(F.getFirestore()); }, FSJS); } catch (e) { console.error('drain failed on', p.who, e.message); throw e; } };
const act = (p, name, ...args) => p.evaluate(([n, a]) => window.__pantry.act[n](...a), [name, args]);
const local = (p, id) => p.evaluate(id => { const it = window.__pantry.S.items.get(id); return it && { name: it.name, removed: !!it.removedAt, batches: it.batches.map(b => [b.id, b.qty]) }; }, id);
const localPlaces = (p, ids) => p.evaluate(ids => [...window.__pantry.S.places.values()].filter(d => ids.includes(d.id)).map(d => ({ id: d.id, name: d.name, removed: !!d.removedAt })), ids);
const localLine = (p, id) => p.evaluate(id => { const m = window.__pantry.S.shop.get(id); return m && { done: !!m.done, removed: !!m.removedAt }; }, id);

let seedNow = null;
try {
  const mum = await person('mdmum@example.com');
  await mum.click('[data-act="hh-create"]');
  await mum.locator('#main .ha-row-title', { hasText: 'Our pantry' }).waitFor();
  for (const e of ['mddad@example.com', 'mdgran@example.com']) { await mum.waitForTimeout(600); await mum.fill('#pa-member-email', e); await mum.click('#pa-member-add button[type=submit]'); await mum.locator('#main [data-act="person"]', { hasText: e }).waitFor(); }
  const phones = [mum, await person('mddad@example.com'), await person('mdgran@example.com')];
  for (const p of phones) await p.waitForFunction(() => window.__pantry.S.household?.members?.length === 3);
  const hid = await mum.evaluate(() => window.__pantry.S.household.id);
  const base = { category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'Mum' };

  for (const seed of SEEDS) {
    seedNow = seed;
    const t0 = Date.now();
    const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
    // two items stored as maps and one as the old array (the first change to it converts it)
    const tag = 's' + seed;
    const ids = [`${tag}-rice`, `${tag}-milk`, `${tag}-eggs`];
    const start = {};
    let events0 = null;
    const seedItem = async (id, name, batches, asArray) => {
      start[id] = Object.fromEntries(batches.map(b => [b.id, b.qty]));
      const stored = asArray ? batches.map(b => ({ ...b })) : Object.fromEntries(batches.map(({ id, ...b }) => [id, b]));
      await admin.put(`households/${hid}/items/${id}`, { id, name, ...base, batches: stored });
    };
    const mk = (id, qty, expiry) => ({ id, qty, expiry, openedAt: null, addedAt: '2026-01-01' });
    await seedItem(ids[0], 'Rice', [mk('r1', 6, '2027-01-01'), mk('r2', 6, '2027-03-01'), mk('r3', 6, null)], false);
    await seedItem(ids[1], 'Milk', [mk('m1', 5, '2026-12-01'), mk('m2', 5, '2027-02-01')], false);
    await seedItem(ids[2], 'Eggs', [mk('e1', 6, '2027-01-01'), mk('e2', 6, '2027-04-01')], true);
    for (const p of phones) for (const id of ids) await p.waitForFunction(id => window.__pantry.S.items.has(id), id);
    // the old array item is converted by one change from one phone first (NOTES.md: while an item is still an array, a phone
    // with a stale copy converting it can overwrite another's change: a window that closes for each item once, and that the
    // test doesn't try to hit)
    { const res = await act(phones[0], 'use', ids[2], 'e1'); start[ids[2]].e1 -= 1; await drain(phones[0]); for (const p of phones) await p.waitForFunction(id => !window.__pantry.S.items.get(id)._arr, ids[2]); events0 = res.event.id; }
    // five shopping lines (line k is ticked only by phone k % 3)
    const lineIds = [0, 1, 2, 3, 4].map(k => `${tag}-l${k}`);
    for (const [k, lid] of lineIds.entries()) await admin.put(`households/${hid}/shop/${lid}`, { id: lid, name: 'Line ' + k, done: false, itemId: null, at: '2026-10-16T00:00:00.000Z', by: 'Mum' });
    for (const p of phones) for (const lid of lineIds) await p.waitForFunction(id => window.__pantry.S.shop.has(id), lid);
    const lineDone = Object.fromEntries(lineIds.map(l => [l, false]));
    const removedIssued = new Set(), restoredIssued = new Set();
    const expected = Object.fromEntries(ids.map(id => [id, { ...start[id] }]));
    const names = Object.fromEntries(ids.map(id => [id, new Set([Object.keys(start).length && null])]));
    for (const id of ids) names[id] = new Set();
    const events = new Set([events0]);
    const offline = [false, false, false];
    const history = {};
    let nowStep = 0, nowWho = 0, nowKind = '';
    const tally = (id, ops) => { for (const [path, d] of Object.entries(ops?.inc || {})) { const b = path.split('.')[1]; expected[id][b] = (expected[id][b] || 0) + d; (history[`${id}/${b}`] ||= []).push(`step ${nowStep} phone ${nowWho} ${nowKind} ${d > 0 ? '+' : ''}${d}`); } };
    // names: phone i names only itself, so the last set (or clear) is what must be everywhere; places: ids this seed added
    const emails = phones.map(p => p.who);
    const names0 = (await admin.get(`households/${hid}/settings/people`))?.names || {};   // (what earlier seeds left)
    const nameLast = emails.map(e => names0[e] ?? ''), nameEver = emails.map(() => new Set());
    const placeIds = [], placeNameEver = {}, placeRemoved = new Set(), placeRestored = new Set();
    const locs = Object.fromEntries(ids.map(id => [id, new Set(['Fridge'])])), orderEver = Object.fromEntries(ids.map(id => [id, new Set()]));
    const counts = { reorder: 0, 'bulk move': 0, use: 0, add: 0, open: 0, rename: 0, undo: 0, delete: 0, restore: 0, tick: 0, 'remove line': 0, 'restore line': 0, 'name myself': 0, 'add place': 0, 'rename place': 0, 'move place': 0, 'remove place': 0, 'restore place': 0, toggles: 0 };

    for (let step = 0; step < STEPS; step++) {
      const i = Math.floor(R() * 3), p = phones[i], id = pick(ids);
      nowStep = step; nowWho = i;
      const r = R();
      if (R() < 0.15) {
        // the Items list: put one item after another (or first) in its category, or move several to a place in one batch
        if (R() < 0.55) {
          const after = pick([null, ...ids.filter(x => x !== id)]);
          const res = await act(p, 'reorder', id, after);
          if (res) { counts.reorder++; for (const x of res.sets) if (ids.includes(x.id)) orderEver[x.id].add(x.order); }
        } else {
          const sub = ids.filter(() => R() < 0.6), place = pick(['Fridge', 'Garage', 'Laundry']);
          if (sub.length) { await act(p, 'bulkMove', sub, place); for (const x of sub) locs[x].add(place); counts['bulk move']++; }
        }
        await p.waitForTimeout(Math.floor(R() * 60));
        continue;
      }
      if (R() < 0.34) {
        // names and places (a third of the steps)
        const q = R();
        if (q < 0.2) {
          const v = R() < 0.15 ? '' : `n${seed}-${i}-${step}`;
          await act(p, 'namePerson', emails[i], v); nameLast[i] = v; if (v) nameEver[i].add(v); counts['name myself']++;
        } else if (q < 0.5) {
          const name = `Pl${seed}-${step}`;
          const pid = await act(p, 'addPlace', name); placeIds.push(pid); placeNameEver[pid] = new Set([name]); counts['add place']++;
        } else if (q < 0.9 || !placeIds.length) {
          const mine = (await localPlaces(p, placeIds)).filter(x => !x.removed);
          if (!mine.length) continue;
          const t = pick(mine), q2 = R();
          if (q2 < 0.35) { const name = `Pl${seed}-${step}r`; if (await act(p, 'renamePlace', t.id, name)) { placeNameEver[t.id].add(name); counts['rename place']++; } }
          else if (q2 < 0.75) { await act(p, 'reorderPlace', t.id, R() < 0.5 ? -1 : 1); counts['move place']++; }
          else { await act(p, 'removePlace', t.id); placeRemoved.add(t.id); counts['remove place']++; }
        } else {
          const gone = (await localPlaces(p, placeIds)).filter(x => x.removed);
          if (!gone.length) continue;
          const t = pick(gone); await act(p, 'restorePlace', t.id); placeRestored.add(t.id); counts['restore place']++;
        }
        await p.waitForTimeout(Math.floor(R() * 60));
        continue;
      }
      if (process.env.MD_DEBUG) console.log('STEP', step, 'phone', i, 'id', id.split('-')[1], 'r', r.toFixed(2), 'offline', offline.join());
      if (r < 0.10 && !process.env.NOTOGGLE) {
        // (a phone that comes back online sends everything it has before it may drop offline again: toggling the SDK's
        // network switch faster than its write stream can settle trips an internal assertion in Firestore 10.14.1 that
        // real phones, whose connectivity the SDK watches itself, don't hit)
        // (and a phone drops offline only once what it has sent is confirmed: cutting the line between the server applying a
        // write and the phone hearing so makes the phone send that write again, and an increment applied twice counts
        // twice. That is how Firestore's `increment` works; NOTES.md says so. It needs a connection lost within a
        // fraction of a second of a save, and the test can't make it come out right, so it avoids it.)
        if (!offline[i]) await drain(p);
        offline[i] = !offline[i]; await net(p, !offline[i]); if (!offline[i]) await drain(p); counts.toggles++;
      }
      else if (r < 0.32) {
        const mine = (await local(p, id)).batches.filter(([, q]) => q > 0);
        if (!mine.length) continue;
        nowKind = 'use'; const res = await act(p, 'use', id, pick(mine)[0]);
        if (res) { tally(id, res.ops); events.add(res.event.id); counts.use++; }
      } else if (r < 0.44) {
        nowKind = 'add'; const res = await act(p, 'add', id, 1 + Math.floor(R() * 3), '2027-0' + (1 + Math.floor(R() * 9)) + '-15', `a${step}`);
        if (res) { tally(id, res.ops); events.add(res.event.id); counts.add++; }
      } else if (r < 0.50) {
        nowKind = 'open'; const res = await act(p, 'open', id);
        if (res) { tally(id, res.ops); events.add(res.event.id); counts.open++; }
      } else if (r < 0.56) {
        const name = `${id.split('-')[1]}-${step}`;
        await act(p, 'set', id, 'name', name); names[id].add(name); counts.rename++;
      } else if (r < 0.62) {
        nowKind = 'undo'; const res = await act(p, 'undo');
        if (res?.ops) { /* the opposite instructions */ for (const idd of ids) if (res.event.itemId === idd) tally(idd, res.ops); events.delete(res.event.id); counts.undo++; }
      } else if (r < 0.68) {
        // delete Rice or Milk (a marker: the item stays, hidden; later uses and adds still land on it)
        const did = pick([ids[0], ids[1]]); await act(p, 'remove', did); removedIssued.add(did); counts.delete++;
      } else if (r < 0.73) {
        // restore Milk, from a phone that sees it removed (that is when the button is there)
        if (!(await local(p, ids[1])).removed) continue;
        await act(p, 'restore', ids[1]); restoredIssued.add(ids[1]); counts.restore++;
      } else if (r < 0.84) {
        // tick or untick a line: only by its own phone
        const mine = lineIds.filter((_, k) => k % 3 === i); const lid = pick(mine);
        lineDone[lid] = !lineDone[lid]; await act(p, 'tick', lid, lineDone[lid]); counts.tick++;
      } else if (r < 0.92) {
        const lid = pick(lineIds.slice(0, 4)); await act(p, 'removeLine', lid); removedIssued.add(lid); counts['remove line']++;
      } else {
        const lid = pick(lineIds.slice(2, 4)); if (!(await localLine(p, lid)).removed) continue;
        await act(p, 'restoreLine', lid); restoredIssued.add(lid); counts['restore line']++;
      }
      await p.waitForTimeout(Math.floor(R() * 60));
    }
    // everyone back online; everything sent; then every phone and the server must agree
    for (let i = 0; i < 3; i++) if (offline[i]) await net(phones[i], true);   // (switching the network on when it is already on trips an assertion in Firestore 10.14.1)
    let problem = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      for (const p of phones) await drain(p);
      problem = '';
      for (const id of ids) {
        const raw = await admin.get(`households/${hid}/items/${id}`);
        const rawQty = Array.isArray(raw.batches) ? Object.fromEntries(raw.batches.map(b => [b.id, b.qty])) : Object.fromEntries(Object.entries(raw.batches).map(([k, v]) => [k, v.qty]));
        // batches that were tidied away count as 0 on the server
        const want = Object.fromEntries(Object.entries(expected[id]));
        for (const b of new Set([...Object.keys(want), ...Object.keys(rawQty)])) if ((rawQty[b] ?? 0) !== (want[b] ?? 0)) problem += `${id}/${b}: server ${rawQty[b] ?? 0}, expected ${want[b] ?? 0}; `;
        for (const [n, p] of phones.entries()) {
          const l = await local(p, id);
          const shown = Object.fromEntries(l.batches.filter(([, q]) => q > 0));
          const should = Object.fromEntries(Object.entries(rawQty).filter(([, q]) => q > 0));
          if (JSON.stringify(Object.entries(shown).sort()) !== JSON.stringify(Object.entries(should).sort())) problem += `${id}: phone ${n} shows ${JSON.stringify(shown)} but the server has ${JSON.stringify(should)}; `;
          if (l.name !== raw.name) problem += `${id}: phone ${n} name ${l.name} vs server ${raw.name}; `;
        }
        if (names[id].size && !names[id].has(raw.name) && raw.name !== { [ids[0]]: 'Rice', [ids[1]]: 'Milk', [ids[2]]: 'Eggs' }[id]) problem += `${id}: name ${raw.name} was never saved; `;
      }
      // removing: a deleted item nobody restored is still removed everywhere; Eggs was never touched; phones agree with the server
      const mustBeRemoved = x => removedIssued.has(x) && !restoredIssued.has(x);
      for (const id of ids) {
        const raw = await admin.get(`households/${hid}/items/${id}`);
        const gone = typeof raw.removedAt === 'string';
        if (id === ids[2] && gone) problem += `${id}: hidden but never deleted; `;
        if (mustBeRemoved(id) && !gone) problem += `${id}: deleted, never restored, but the server shows it again; `;
        if (!gone && ('removedBy' in raw)) problem += `${id}: removedBy left behind; `;
        for (const [n, p] of phones.entries()) { const l = await local(p, id); if (l.removed !== gone) problem += `${id}: phone ${n} ${l.removed ? 'hides' : 'shows'} it but the server ${gone ? 'has it removed' : 'has it live'}; `; }
      }
      for (const [k, lid] of lineIds.entries()) {
        const raw = await admin.get(`households/${hid}/shop/${lid}`);
        const gone = typeof raw.removedAt === 'string';
        if (raw.done !== lineDone[lid]) problem += `${lid}: done is ${raw.done} on the server, the last tick was ${lineDone[lid]}; `;
        if (k === 4 && gone) problem += `${lid}: hidden but never removed; `;
        if (mustBeRemoved(lid) && !gone) problem += `${lid}: removed, never restored, but it is back; `;
        for (const [n, p] of phones.entries()) { const l = await localLine(p, lid); if (l.removed !== gone || l.done !== raw.done) problem += `${lid}: phone ${n} has done ${l.done}/removed ${l.removed}, the server ${raw.done}/${gone}; `; }
      }
      // the Items list: the server's `order` is a number inside the rules' limit, one some phone wrote (or none); its place is one
      // some phone moved it to (or where it started); every phone shows exactly the server's order and place
      for (const id of ids) {
        const raw = await admin.get(`households/${hid}/items/${id}`);
        if ('order' in raw && !(typeof raw.order === 'number' && Math.abs(raw.order) < 1000000)) problem += `${id}: order ${JSON.stringify(raw.order)} is not a number inside the limit; `;
        if (typeof raw.order === 'number' && !orderEver[id].has(raw.order)) problem += `${id}: order ${raw.order} was never written by a phone; `;
        if (!locs[id].has(raw.location)) problem += `${id}: place ${raw.location} was never chosen; `;
        for (const [n, ph] of phones.entries()) {
          const got = await ph.evaluate(i => { const it = window.__pantry.S.items.get(i); return [it.order ?? null, it.location]; }, id);
          if (got[0] !== (raw.order ?? null) || got[1] !== raw.location) problem += `${id}: phone ${n} shows order ${got[0]} in ${got[1]}, the server ${raw.order ?? null} in ${raw.location}; `;
        }
      }
      // names: the last name each phone set (or cleared) for itself, on the server and on every phone
      const srvPeople = (await admin.get(`households/${hid}/settings/people`))?.names || {};
      for (const [k, email] of emails.entries()) {
        if ((srvPeople[email] ?? '') !== nameLast[k]) problem += `name of phone ${k}: server has ${JSON.stringify(srvPeople[email] ?? '')}, the last it saved was ${JSON.stringify(nameLast[k])}; `;
        for (const [n, ph] of phones.entries()) { const got = (await ph.evaluate(() => window.__pantry.S.settings.get('people')?.names) || {})[email] ?? ''; if (got !== nameLast[k]) problem += `name of phone ${k}: phone ${n} shows ${JSON.stringify(got)}, expected ${JSON.stringify(nameLast[k])}; `; }
      }
      // places: every place added exists once on the server, live unless removed; removed and never restored: still removed; a
      // name someone gave it; the default places once; every phone shows the server's list, in order
      const placeDocs = await admin.list(`households/${hid}/places`);
      const byId = new Map();
      for (const d of placeDocs) byId.set(d.id, [...(byId.get(d.id) || []), d]);
      for (const id of placeIds) {
        const d = byId.get(id) || [];
        if (d.length !== 1) { problem += `place ${id}: ${d.length} documents on the server; `; continue; }
        const gone = typeof d[0].removedAt === 'string';
        if (!placeNameEver[id].has(d[0].name)) problem += `place ${id}: name ${d[0].name} was never given to it; `;
        if (placeRemoved.has(id) && !placeRestored.has(id) && !gone) problem += `place ${id}: removed, never restored, but it is back; `;
        if (!placeRemoved.has(id) && gone) problem += `place ${id}: hidden but never removed; `;
        if (!gone && ('removedBy' in d[0])) problem += `place ${id}: removedBy left behind; `;
      }
      const seeded = placeDocs.filter(d => /^p-/.test(d.id));
      if (seeded.length && seeded.length !== 11) problem += `${seeded.length} default places on the server, expected 11; `;
      const wantList = placeDocs.filter(d => !d.removedAt).sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1)).map(d => d.name);
      if (new Set(wantList.map(x => x.toLowerCase())).size !== wantList.length) problem += `the server has the same place name twice; `;
      if (placeDocs.length) for (const [n, ph] of phones.entries()) { const got = await ph.evaluate(() => window.__pantry.places()); if (JSON.stringify(got) !== JSON.stringify(wantList)) problem += `phone ${n} lists places ${JSON.stringify(got)} but the server has ${JSON.stringify(wantList)}; `; if (new Set(got).size !== got.length) problem += `phone ${n} lists a place twice; `; }
      const onServer = new Set((await admin.list(`households/${hid}/events`)).map(e => e.id).filter(x => [...events].includes(x) || true));
      const mineOnServer = [...onServer].filter(x => x);
      for (const e of events) if (!onServer.has(e)) problem += `event ${e} missing; `;
      for (const p of phones) { const n = await p.evaluate(() => window.__pantry.S.refused.length); if (n) problem += `a phone has ${n} refused change(s); `; }
      if (!problem) break;
      await mum.waitForTimeout(500);
    }
    if (problem) for (const [n, p] of phones.entries()) console.error('  phone', n, JSON.stringify(await p.evaluate(() => ({ sync: window.__pantry.S.sync, refused: window.__pantry.S.refused.length, mode: window.__pantry.S.mode }))));
    if (problem) for (const id of ids) console.error('  server', id, JSON.stringify((await admin.get(`households/${hid}/items/${id}`)).batches));
    if (problem) for (const m of problem.matchAll(/(s\d+-\w+\/[\w-]+):/g)) console.error('  history', m[1], JSON.stringify(history[m[1]] || []));
    assert.equal(problem, '', problem);
    // tidy the numbers: one phone renumbers the category; the sequence is unchanged and every live item has its own number
    {
      const live = async () => (await admin.list(`households/${hid}/items`)).filter(i => i.category === 'Other' && typeof i.removedAt !== 'string');
      const before = Ord.sortByOrder(await live()).map(i => i.id).join(',');
      await act(phones[0], 'renumber', 'Other');
      for (const p of phones) await drain(p);
      let after = '', orders = [];
      for (let a = 0; a < 20; a++) { const l = await live(); after = Ord.sortByOrder(l).map(i => i.id).join(','); orders = l.map(i => i.order); if (after === before && new Set(orders).size === l.length) break; await mum.waitForTimeout(300); }
      assert.equal(after, before, 'renumbering never changes the sequence');
      assert.equal(new Set(orders).size, orders.length, 'every live item in the category has its own number after a renumber: ' + orders.join(','));
      assert.ok(orders.every(o => typeof o === 'number' && Number.isInteger(o)), 'whole numbers 1, 2, 3 …');
      for (const [n, ph] of phones.entries()) {
        const mine = await ph.evaluate(() => [...window.__pantry.S.items.values()].filter(i => i.category === 'Other' && !i.removedAt).map(i => ({ id: i.id, name: i.name, order: i.order })));
        assert.equal(Ord.sortByOrder(mine).map(i => i.id).join(','), before, `phone ${n} shows the same sequence`);
      }
    }
    // events of this seed on the server are exactly those not undone
    const evOnServer = (await admin.list(`households/${hid}/events`)).filter(e => ids.includes(e.itemId)).map(e => e.id).sort();
    assert.deepEqual(evOnServer, [...events].sort(), 'history on the server = lines created and not undone');
    console.log(`  seed ${seed}: ok (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}; ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  assert.deepEqual(errors, []);
  console.log('pantry multidevice e2e: ok');
} catch (e) {
  console.error(`pantry multidevice e2e FAILED with seed ${seedNow} (re-run: SEEDS=${seedNow} node test/multidevice.e2e.mjs inside the emulators)`);
  throw e;
} finally {
  await browser.close();
  srv.close();
}
