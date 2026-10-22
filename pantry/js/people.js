// Names for the family (16 Oct 2026, owner; ported from Kaki Home): whoever is in the family pantry can give each
// member a name ("Mum", "Ah Mei") that everyone sees instead of their Gmail. Stored with the family's data, never in
// the repo: settings/people = { id: 'people', names: { email: name }, updatedAt } (rules in firestore.rules: members
// only, at most 20 names of 1 to 40 characters, no new lines). The name the family gives you is also what your changes
// are signed with ("added by", history, the shopping list). Pure functions only, so the unit tests run them in Node.

export const PEOPLE_ID = 'people';
export const MAX_PEOPLE = 20;   // the household rules allow at most 20 members, and so 20 names
export const NAME_MAX = 40;

// A name as it is saved: one line, spaces tidied, at most NAME_MAX characters.
export const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const lc = s => String(s ?? '').trim().toLowerCase();

// The names map from the settings document ({} when there is none or it is unreadable). Only string names survive.
export function namesOf(doc) {
  const n = doc && typeof doc.names === 'object' && !Array.isArray(doc.names) ? doc.names : {};
  return Object.fromEntries(Object.entries(n).filter(([e, v]) => e && typeof v === 'string' && cleanName(v)).map(([e, v]) => [lc(e), cleanName(v)]));
}
// A new names map with one person's name set (or removed, when the name is empty).
export function setName(names, email, name) {
  const out = { ...names }, n = cleanName(name), e = lc(email);
  if (n) out[e] = n; else delete out[e];
  return out;
}
// Only the names of people still in the family (someone removed takes their name with them), at most MAX_PEOPLE.
export function keepMembers(names, members = []) {
  const m = new Set(members.map(lc));
  return Object.fromEntries(Object.entries(names).filter(([e]) => m.has(e)).slice(0, MAX_PEOPLE));
}
// ONE person's name as an instruction (never the whole map written from a copy that may be a moment old): set it, or clear
// it when the name is empty (`names.<email>`: a keyed instruction, so the email's dots are never read as a path; cloud.js
// sends it as a FieldPath update). `orphans`: emails of names to drop in the same write (people no longer in the family),
// only needed to stay under the 20 names the rules allow. Two people naming themselves, or one naming while another removes
// someone, each change their own field, so nothing is lost.
export function nameOps(email, name, { at = new Date().toISOString(), orphans = [] } = {}) {
  const e = lc(email), n = cleanName(name), gone = orphans.map(lc).filter(x => x && x !== e);
  return { set: { updatedAt: at }, inc: {}, del: [], keyed: { names: n ? { set: { [e]: n }, del: gone } : { set: {}, del: [e, ...gone] } } };
}
// The emails whose names to drop to make room for one more: none while there is room; otherwise those who are not members.
export function orphanNames(names, members = [], email = '') {
  if (names[lc(email)] !== undefined || Object.keys(names).length < MAX_PEOPLE) return [];
  const m = new Set(members.map(lc));
  return Object.keys(names).filter(e => !m.has(e));
}
export const peopleDoc = (names, at = new Date().toISOString()) => ({ id: PEOPLE_ID, names: { ...names }, updatedAt: at });
export const isPeopleDoc = o => !!o && o.id === PEOPLE_ID && !!o.names && typeof o.names === 'object' && !Array.isArray(o.names);

// How someone shows: the family's name for them, else what was saved (an older change is signed with a name already;
// an email is looked up). `by` may be an email or a name.
export const label = (names, by) => (by && names[lc(by)]) || by || '';
