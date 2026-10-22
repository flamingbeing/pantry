// Merging duplicate family pantries (16 Oct 2026, owner: "we should merge duplicate emails into 1 pantry"). An account
// can end up in two households (a second "Start our family pantry"); this is the pure part of moving one into the
// other: who may do it, which members and settings result. cloud.js does the copying. Plain Node, so tests run it.

import { isPlacesDoc } from './places.js';
import { keepLive } from './logic.js';
import { PEOPLE_ID, isPeopleDoc, namesOf, keepMembers, peopleDoc, MAX_PEOPLE } from './people.js';

export const MAX_MEMBERS = 20;   // the rules allow at most 20 members
const lc = s => String(s ?? '').trim().toLowerCase();

// The kept pantry's members plus everyone in the others, in that order, without repeats. `over` when more than 20.
export function unionMembers(keep = [], others = []) {
  const out = [];
  for (const m of [...keep, ...others.flat()]) { const e = lc(m); if (e && !out.includes(e)) out.push(e); }
  return { members: out.slice(0, MAX_MEMBERS), over: out.length > MAX_MEMBERS, total: out.length };
}
// Only the owner of a pantry may delete it (the rules). `me` is this account's email.
export function plan(pantries, keepId, me) {
  const keep = pantries.find(h => h.id === keepId) || null;
  const others = pantries.filter(h => h.id !== keepId);
  const notMine = others.filter(h => lc(h.owner) !== lc(me));
  const u = unionMembers(keep?.members, others.map(h => h.members || []));
  return { keep, others, notMine, canMerge: !!keep && others.length > 0 && !notMine.length && !u.over, ...u };
}
// The settings documents to write into the kept pantry after copying `other`'s: names joined (the kept pantry's name wins).
// Only what changes is returned. (Places are documents of their own now: places.js mergeInto, with `legacyPlaces` below.)
export function mergeSettings(keepDocs = [], otherDocs = [], members = []) {
  const find = (docs, id) => docs.find(d => d && d.id === id);
  const out = [];
  const kn = find(keepDocs, PEOPLE_ID), on = find(otherDocs, PEOPLE_ID);
  if (isPeopleDoc(on)) {
    const mine = isPeopleDoc(kn) ? namesOf(kn) : {};
    const joined = keepMembers({ ...namesOf(on), ...mine }, members);
    if (JSON.stringify(joined) !== JSON.stringify(mine)) out.push(peopleDoc(joined));
  }
  return out;
}
// The old single list of places among a pantry's settings documents (null when it has none): what mergeInto reads
// when a pantry has no place documents yet.
export const legacyPlaces = (settings = []) => settings.find(isPlacesDoc) || null;
// What copying one pantry into another carries (16 Oct 2026, soft deletes): everything, with the Recently removed markers
// as they are, except items and shopping lines removed more than 30 days ago, and those items' history and photos.
export const carryOver = (lists, now = Date.now()) => keepLive(lists, now);
export { MAX_PEOPLE };
