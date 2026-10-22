// Bulk edit (16 Oct 2026, Items list PR; the pattern of the anawj.com logbook's bulk edit, written for the pantry's own fields):
// pick items, choose which fields to change (every field starts "Unchanged"), review what will change, save ONE batch, one Undo.
// This file is the pure part (test/bulk-items.test.mjs runs it in Node): what each choice does to one item, as the same
// instructions (`ops`: logic.js) every other change in the app is, and the words for the review step. app.js draws the screen.
//
// Fields: place (Move to…), category, how it is kept track of (counting, or Plenty / Low / Out), best-before (shift every dated
// batch by some days, or set one date), Add to the shopping list, and Delete. Names stay one at a time.
import * as L from './logic.js';
import { cleanPlace } from './places.js';

// ch: { place: { to } | null, category: { to } | null, mode: 'count' | 'level' | null,
//       expiry: { kind: 'shift', days, dir: 'later' | 'earlier' } | { kind: 'set', date } | null, list: bool, bin: bool }
export const none = () => ({ place: null, category: null, mode: null, expiry: null, list: false, bin: false });
export const isEmpty = ch => !ch || !(ch.place || ch.category || ch.mode || ch.expiry || ch.list || ch.bin);
export const BIG = 20;   // from this many items, a save that replaces things names how many on its button

// Is the choice complete enough to review? -> what is missing, or ''.
export function missing(ch) {
  if (ch.place && !cleanPlace(ch.place.to)) return 'Choose the place';
  if (ch.category && !ch.category.to) return 'Choose the category';
  if (ch.expiry?.kind === 'shift' && !(Number(ch.expiry.days) >= 1 && Number(ch.expiry.days) <= 3650)) return 'Type how many days (1 or more)';
  if (ch.expiry?.kind === 'set' && !/^\d{4}-\d{2}-\d{2}$/.test(ch.expiry.date || '')) return 'Choose the date';
  return '';
}
// Does the change replace what is there (the warning in the review)? Adding to the shopping list, and shifting a date, don't ask.
export const overwrites = ch => !!(ch.place || ch.category || ch.mode || ch.expiry?.kind === 'set' || ch.bin);

const levelFromStock = it => { const q = L.totalQty(it); return q <= 0 ? 'out' : (Number(it.lowAt) > 0 && q <= Number(it.lowAt)) ? 'low' : 'plenty'; };

// One item: { ops, notes, skip } where ops are the instructions (empty: nothing to change in the item itself), `list` says "put it on
// the shopping list", `notes` tags worth a warning, `skip` the reasons a chosen field was left alone for this item. Delete is applied
// alone (every other choice is ignored for it).
// ctx: { onList(id) -> bool, by, placeOps(item, to) -> ops (freezing or thawing on a move; app.js) }
export function planItem(it, ch, ctx = {}) {
  const out = { ops: L.emptyOps(), list: false, notes: [], skip: [] };
  if (ch.bin) { out.ops = L.removeOps(ctx.by || ''); out.bin = true; return out; }
  const set = out.ops.set;
  if (ch.place) { const to = cleanPlace(ch.place.to); if (it.location !== to) set.location = to; }
  if (ch.category && it.category !== ch.category.to) set.category = ch.category.to;
  let staple = L.isStaple(it);
  if (ch.mode === 'level' && !staple) {
    set.measure = 'level'; set.level = levelFromStock(it); staple = true;
    if (L.totalQty(it) > 0) out.notes.push('hidesCounts');   // the batches stay, hidden: switching back brings them back
  } else if (ch.mode === 'count' && staple) {
    out.ops.del.push('measure', 'level'); staple = false;
    if (L.totalQty(it) <= 0) out.notes.push('noStock');       // nothing counted yet: shows "None left"
  }
  if (ch.expiry) {
    const live = L.fefo(it);   // batches with something left
    if (staple) out.skip.push('level');
    else if (!live.length) out.skip.push('noBatches');
    else if (ch.expiry.kind === 'set') { for (const b of live) if (b.expiry !== ch.expiry.date) set[`batches.${b.id}.expiry`] = ch.expiry.date; }
    else {
      const n = (ch.expiry.dir === 'earlier' ? -1 : 1) * Math.round(Number(ch.expiry.days) || 0);
      const dated = live.filter(b => b.expiry);
      if (!dated.length) out.skip.push('noDates');
      for (const b of dated) { const d = L.addDays(b.expiry, n); if (d) set[`batches.${b.id}.expiry`] = d; }
    }
  }
  if (ch.list && !(ctx.onList && ctx.onList(it.id))) out.list = true;
  else if (ch.list) out.skip.push('onList');
  // into or out of a freezer, food freezes or thaws as with Move to… (unless a date is being set here too: that one wins)
  if (set.location && ctx.placeOps && !ch.expiry) out.ops = L.mergeOps(out.ops, ctx.placeOps(it, set.location));
  return out;
}

// Every item: { pairs: [{ id, item, ops, before, after, notes }], addToList: [item], skipped: { <reason>: n }, unchanged: n, deleting }.
// `pairs` are the items whose own fields change; `addToList` the ones that go on the list; an item may be in both.
export function plan(items, ch, ctx = {}) {
  const pairs = [], addToList = [], skipped = {}, notes = {};
  let unchanged = 0;
  for (const it of items) {
    const r = planItem(it, ch, ctx);
    for (const s of r.skip) skipped[s] = (skipped[s] || 0) + 1;
    const changes = !L.opsEmpty(r.ops);
    if (changes) { pairs.push({ id: it.id, item: it, ops: r.ops, before: it, after: L.applyOps(it, r.ops), notes: r.notes }); for (const n of r.notes) notes[n] = (notes[n] || 0) + 1; }
    if (r.list) addToList.push(it);
    if (!changes && !r.list) unchanged++;
  }
  const changing = new Set([...pairs.map(p => p.id), ...addToList.map(i => i.id)]).size;
  return { pairs, addToList, skipped, notes, unchanged, changing, deleting: !!ch.bin, total: items.length };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// One line for an item: what the review shows before and after. (Dates as 'YYYY-MM-DD'; the screen formats nothing here.)
export function summary(it) {
  const staple = L.isStaple(it);
  const stock = staple ? ({ plenty: 'Plenty', low: 'Low', out: 'Out' }[L.levelOf(it)]) : `${L.totalQty(it)} left`;
  const next = staple ? '' : L.nextUseBy(it);
  return [it.name, it.location, it.category, stock, next ? `use by ${next}` : ''].filter(Boolean).join(' · ');
}
// What the chosen fields do, one line each (the review's list). `p` is the plan (for counts).
export function changeLines(ch, p) {
  const out = [];
  if (ch.bin) return [`Delete: ${plural(p.pairs.length, 'item')} go to Recently removed (30 days to put them back)`];
  if (ch.place) out.push(`Place: move to ${cleanPlace(ch.place.to)}`);
  if (ch.category) out.push(`Category: change to ${ch.category.to}`);
  if (ch.mode === 'level') out.push('Kept track of: Plenty, Low, Out');
  if (ch.mode === 'count') out.push('Kept track of: counting');
  if (ch.expiry?.kind === 'shift') out.push(`Best-before: ${plural(Math.round(Number(ch.expiry.days)), 'day')} ${ch.expiry.dir === 'earlier' ? 'earlier' : 'later'}`);
  if (ch.expiry?.kind === 'set') out.push(`Best-before: set to ${ch.expiry.date}`);
  if (ch.list) out.push('Shopping list: add');
  return out;
}
const SKIP_WHY = {
  noBatches: n => `${plural(n, 'item')} skipped for best-before: nothing in stock to change the date of`,
  noDates: n => `${plural(n, 'item')} skipped for best-before: no date on any of its stock to shift`,
  level: n => `${plural(n, 'item')} skipped for best-before: kept as Plenty, Low, Out, so no dates`,
  onList: n => `${plural(n, 'item')} already on the shopping list`,
};
// The sentences under the headline of the review: what was skipped and why, and the warnings.
export function reviewNotes(p, ch) {
  const out = [];
  for (const [k, n] of Object.entries(p.skipped)) if (n && SKIP_WHY[k]) out.push({ kind: 'skip', text: SKIP_WHY[k](n) });
  if (p.notes.hidesCounts) out.push({ kind: 'warn', text: `${plural(p.notes.hidesCounts, 'item')} will stop counting: their numbers and dates are kept, hidden, and come back if you switch back` });
  if (p.notes.noStock) out.push({ kind: 'warn', text: `${plural(p.notes.noStock, 'item')} have no stock counted and will show None left` });
  if (p.unchanged) out.push({ kind: 'skip', text: `${plural(p.unchanged, 'item')} already as chosen` });
  if (overwrites(ch) && !ch.bin) out.push({ kind: 'warn', text: 'This replaces what these items have now. Undo stays in the message after saving.' });
  return out;
}
// The review's headline.
export const headline = p => (p.deleting ? `${plural(p.changing, 'item')} will be deleted` : `${plural(p.changing, 'item')} will change`);
