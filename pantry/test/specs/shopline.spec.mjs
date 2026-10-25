// The shopping list on three phones, only: ticks, removes and restores of five lines, fast and offline now and then (the
// emulator: demo-pantry, fake accounts; never the live project). The multidevice run's rarest miss was here: a phone left
// showing a line unticked that the server (and the last tick) had ticked. Seeded like multidevice.spec.mjs: SEED=<n>
// npx playwright test shopline runs that seed again.
//
// What must hold when everyone is back online and everything has been sent: each line's done is the last tick (line k is
// ticked only by phone k % 3), a removed line nobody restored stays removed, every phone shows what the server has, and
// every change held for a person (removed here, put back there) was answered.
import { test, expect } from './fixtures.mjs';
import { person, seedFamily, inFamily, drain, net, act, settle, answerHeld } from './sync-lib.mjs';

const STEPS = Number(process.env.STEPS || 60);
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const jitter = (p, R) => p.evaluate(ms => new Promise(r => setTimeout(r, ms)), Math.floor(R() * 40));
const localLine = (p, id) => p.evaluate(id => { const m = window.__pantry.S.shop.get(id); return m && { done: !!m.done, removed: !!m.removedAt }; }, id);

for (const first of [5, 404]) {
  test(`three phones tick, remove and restore shopping lines (seed ${first} + 7919 per repeat)`, async ({ phone, fsAdmin, uid }, info) => {
    test.setTimeout(180_000);
    const seed = process.env.SEED ? Number(process.env.SEED) : first + info.repeatEachIndex * 7919;
    info.annotations.push({ type: 'seed', description: String(seed) });
    const hid = 'hh-' + uid;
    const emails = ['mum', 'dad', 'gran'].map(n => `sl${n}-${uid}@example.com`);
    await seedFamily(fsAdmin, hid, emails);
    const phones = [];
    for (const [k, e] of emails.entries()) phones.push(await person(phone, e, ['mum', 'dad', 'gran'][k]));
    for (const p of phones) await inFamily(p, hid);
    const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
    const lineIds = [0, 1, 2, 3, 4].map(k => `s${seed}-l${k}`);
    for (const [k, lid] of lineIds.entries()) await fsAdmin.put(`households/${hid}/shop/${lid}`, { id: lid, name: 'Line ' + k, done: false, itemId: null, at: '2026-10-16T00:00:00.000Z', by: 'Mum' });
    for (const p of phones) for (const lid of lineIds) await p.waitForFunction(id => window.__pantry.S.shop.has(id), lid);
    const lineDone = Object.fromEntries(lineIds.map(l => [l, false]));
    const removedIssued = new Set(), restoredIssued = new Set();
    const offline = [false, false, false];
    const log = [];
    for (let step = 0; step < STEPS; step++) {
      const i = Math.floor(R() * 3), p = phones[i], r = R();
      if (r < 0.08) {
        // (as multidevice: a phone drops offline only once what it sent is confirmed, and sends everything when back)
        if (!offline[i]) await settle(p);
        offline[i] = !offline[i]; await net(p, !offline[i]); if (!offline[i]) await settle(p);
        log.push(`${step} p${i} ${offline[i] ? 'offline' : 'online'}`);
      } else if (r < 0.2) {
        // tick and untick at once (two saves to one line within a moment: the second must win everywhere)
        const lid = pick(lineIds.filter((_, k) => k % 3 === i));
        await p.evaluate(([id, a]) => { window.__pantry.act.tick(id, a); window.__pantry.act.tick(id, !a); }, [lid, !lineDone[lid]]);
        log.push(`${step} p${i} tick+untick ${lid.split('-')[1]} ${lineDone[lid]}`);
      } else if (r < 0.75) {
        const lid = pick(lineIds.filter((_, k) => k % 3 === i));
        lineDone[lid] = !lineDone[lid]; await act(p, 'tick', lid, lineDone[lid]); log.push(`${step} p${i} tick ${lid.split('-')[1]} ${lineDone[lid]}`);
      } else if (r < 0.88) {
        const lid = pick(lineIds.slice(0, 4)); await act(p, 'removeLine', lid); removedIssued.add(lid); log.push(`${step} p${i} remove ${lid.split('-')[1]}`);
      } else {
        const lid = pick(lineIds.slice(2, 4)); if (!(await localLine(p, lid)).removed) continue;
        await act(p, 'restoreLine', lid); restoredIssued.add(lid); log.push(`${step} p${i} restore ${lid.split('-')[1]}`);
      }
      await jitter(p, R);
    }
    for (let i = 0; i < 3; i++) if (offline[i]) await net(phones[i], true);
    // a line removed on one phone while another put it back (both offline): the later one is held on its phone (app-sync
    // 0.7.1) and answered in its popup, at random; its ticks made meanwhile join that answer, so the last tick still wins
    let held = 0;
    for (let round = 0; round < 6; round++) {
      let any = false;
      for (const p of phones) { await settle(p); const a = await answerHeld(p, () => pick(['mine', 'theirs'])); if (a.length) { any = true; held += a.length; log.push(`answered ${a.map(x => `${x.id.split('-')[1]} ${x.choice}`).join(', ')}`); } }
      if (!any) break;
    }
    for (const p of phones) await drain(p);
    const check = async () => {
      let problem = '';
      for (const [k, lid] of lineIds.entries()) {
        const raw = await fsAdmin.get(`households/${hid}/shop/${lid}`);
        const gone = typeof raw.removedAt === 'string';
        if (raw.done !== lineDone[lid]) problem += `${lid}: done is ${raw.done} on the server, the last tick was ${lineDone[lid]}; `;
        if (k === 4 && gone) problem += `${lid}: hidden but never removed; `;
        if (removedIssued.has(lid) && !restoredIssued.has(lid) && !gone) problem += `${lid}: removed, never restored, but it is back; `;
        for (const [n, p] of phones.entries()) { const l = await localLine(p, lid); if (l.removed !== gone || l.done !== raw.done) problem += `${lid}: phone ${n} has done ${l.done}/removed ${l.removed}, the server ${raw.done}/${gone}; `; }
      }
      for (const p of phones) { const n = await p.evaluate(() => window.__pantry.S.refused.length); if (n) problem += `a phone has ${n} refused change(s); `; }
      for (const p of phones) { const n = await p.evaluate(() => window.__pantry.held().length); if (n) problem += `a phone still holds ${n} change(s); `; }
      return problem;
    };
    try { await expect.poll(check, { timeout: 20_000, intervals: [500], message: `seed ${seed}` }).toBe(''); } catch (e) {
      console.error(`shopline FAILED with seed ${seed} (run it again: SEED=${seed} npx playwright test shopline)\n  ${log.join('\n  ')}`);
      throw e;
    }
  });
}
