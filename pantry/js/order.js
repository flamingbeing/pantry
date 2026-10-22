// My order (16 Oct 2026, Items list PR; owner: "per category only, one `order` field"): the order the family wants items in under
// their category on Items. Each item may carry one number, `order`; the list is sorted by it, with ties broken by name and then
// by id, so every phone shows the same order whatever happened at once. Putting an item between two others sets ONE field on ONE
// item (the midpoint of its new neighbours); only when there is no room left (two neighbours with the same number, or too close
// to tell apart) is the whole group renumbered 1, 2, 3 … in one batch. Items without an order (every item to begin with, and any
// added later) come after the ordered ones, by name, so a new item lands at the bottom of its category.
// Pure functions: test/order.test.mjs runs them in Node. The rules (firestore.rules) accept `order` absent or a number within
// plus or minus ORDER_LIMIT.

export const ORDER_LIMIT = 1000000;   // the rules: order is a number, > -1000000 and < 1000000
const SAFE = 900000;                  // stay well inside it: past this the group is renumbered instead
export const MIN_GAP = 1e-6;          // two orders closer than this can't be told apart reliably: renumber

export const hasOrder = x => typeof x?.order === 'number' && Number.isFinite(x.order) && Math.abs(x.order) < ORDER_LIMIT;
const nameOf = x => String(x?.name ?? '');
// Sort comparator: ordered items first by number, then those without (by name); ties by name, then id.
export function compareOrder(a, b) {
  const ha = hasOrder(a), hb = hasOrder(b);
  if (ha !== hb) return ha ? -1 : 1;
  if (ha && a.order !== b.order) return a.order - b.order;
  const n = nameOf(a).localeCompare(nameOf(b));
  return n || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
}
export const sortByOrder = list => [...list].sort(compareOrder);

// The order for an item put between `a` and `b` (either may be missing): the midpoint; after the last: last + 1; before the first:
// first - 1; nothing there at all: 1.
export function orderBetween(a, b) {
  const ha = typeof a === 'number', hb = typeof b === 'number';
  if (ha && hb) return (a + b) / 2;
  if (ha) return a + 1;
  if (hb) return b - 1;
  return 1;
}
// Is there no room between two neighbours (same number, wrong way round, or too close to tell apart)?
export const noRoom = (a, b) => typeof a === 'number' && typeof b === 'number' && !(b - a > MIN_GAP);

// 1, 2, 3 … for a list already in the order wanted: [{ id, order }] for the items whose number would change.
export function renumber(list) {
  const out = [];
  list.forEach((x, i) => { if (x.order !== i + 1) out.push({ id: x.id, order: i + 1 }); });
  return out;
}

// Move item `id` to just after `afterId` (null: to the top) in `list` (every item of the group, any order: they are sorted here).
// Returns { sets: [{ id, order }], renumbered, to } where `sets` is what to write (normally ONE entry), `renumbered` says the
// whole group was renumbered (no room, or neighbours without a number), `to` the item's new place (0 is first). Nothing to write
// when it would stay where it is.
export function planMove(list, id, afterId = null) {
  const sorted = sortByOrder(list), moving = sorted.find(x => x.id === id);
  if (!moving) return { sets: [], renumbered: false, to: -1 };
  if (afterId === id) return { sets: [], renumbered: false, to: sorted.indexOf(moving) };
  const rest = sorted.filter(x => x.id !== id);
  let i = afterId == null ? 0 : rest.findIndex(x => x.id === afterId) + 1;
  if (afterId != null && i === 0) i = rest.length;   // not found: the end
  const before = sorted.indexOf(moving);
  if (i === before) return { sets: [], renumbered: false, to: i };
  const prev = i > 0 ? rest[i - 1] : null, next = rest[i] || null;
  // One field is enough when the neighbour before it has a number (or there is none) and there is room before the one after. A
  // neighbour without a number before the item would sort it ahead of that neighbour (numbers come first), so then everything
  // is numbered.
  // (A neighbour AFTER it without a number is fine: numbers sort first, so the item still comes before it.)
  const pOk = !prev || hasOrder(prev), nNum = hasOrder(next) ? next.order : undefined;
  if (pOk && !noRoom(prev?.order, nNum)) {
    const n = orderBetween(prev?.order, nNum);
    if (Math.abs(n) < SAFE && (nNum === undefined || n < nNum) && (!prev || n > prev.order)) return { sets: [{ id, order: n }], renumbered: false, to: i };
  }
  const all = [...rest.slice(0, i), moving, ...rest.slice(i)].map(x => ({ id: x.id, order: x.order }));
  return { sets: renumber(all), renumbered: true, to: i };
}
// Where `id` stands among `list` sorted: { index, count } (index from 0).
export function positionOf(list, id) {
  const s = sortByOrder(list);
  return { index: s.findIndex(x => x.id === id), count: s.length };
}
// The id to put `id` after to move it one step ('up' or 'down') in the sorted list, or undefined at the end.
export function stepTarget(list, id, dir) {
  const rest = sortByOrder(list).filter(x => x.id !== id), sorted = sortByOrder(list);
  const i = sorted.findIndex(x => x.id === id), to = i + dir;
  if (i < 0 || to < 0 || to > rest.length) return undefined;
  return to === 0 ? null : rest[to - 1].id;
}
