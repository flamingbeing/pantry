// Saving to the family: what the chip says, and the changes the server refused. Pure functions (test/sync.test.mjs
// runs them in Node); the app keeps the list in this phone's localStorage and cloud.js reports each refusal.
//
// A write to the family pantry is kept on the phone and sent when there is signal (Firestore's cache), so a change
// is never lost by going offline. A change the SERVER refuses (the account was removed, the item was deleted on
// another phone, a rule) is dropped by the SDK and the screen quietly goes back: so the app keeps a copy of what was
// refused (a small list, on this phone) and says "Needs attention" until the person retries or discards it.

export const MAX_REFUSED = 30;
const MAX_BYTES = 200000;

// The chip near the top of Home and Settings: Saved, Waiting for signal (N changes), or Needs attention.
// `pending`: changes made here that the server hasn't confirmed; `cache`: the phone is showing its own copy (no
// connection to the server); `recent`: the server was heard from within the last few seconds; `waited`: ms since the oldest unconfirmed change (a normal save is confirmed in well under
// a second, which isn't worth a "waiting" chip).
export function syncState({ refused = 0, pending = 0, cache = false, offline = false, waited = 0, recent = false } = {}) {
  if (refused > 0) return { kind: 'attention', text: refused === 1 ? 'Needs attention' : `Needs attention (${refused})` };
  // (`recent`: a snapshot came from the server a moment ago, so a listener that still says "my own copy" is behind, not the connection)
  if (pending > 0 && ((cache && !recent) || offline || waited >= 1500)) return { kind: 'waiting', text: `Waiting for signal (${pending} ${pending === 1 ? 'change' : 'changes'})` };
  return { kind: 'saved', text: 'Saved' };
}

// Why the server said no, in plain words (never the raw error).
export function refusedReason(code) {
  const c = String(code || '').replace(/^firestore\//, '');
  if (c === 'not-found') return 'It was removed on another phone.';
  if (c === 'permission-denied') return 'The family pantry wouldn’t take it. This account may not be in the pantry any more.';
  if (c === 'resource-exhausted') return 'Too many changes at once. Try again in a minute.';
  if (c === 'unauthenticated') return 'You were signed out. Sign in, then try again.';
  if (c === 'invalid-argument' || c === 'failed-precondition') return 'The pantry couldn’t accept it as it was.';
  return 'The family pantry didn’t take it.';
}

// A short line for a refused change: what it was.
export function describeRefused(r, nameOf = id => id) {
  const what = { items: 'item', events: 'history entry', shop: 'shopping list line', places: 'place', settings: 'setting' }[r.kind] || 'change';
  const name = r.name || (r.kind === 'items' ? nameOf(r.id) : '');
  if (r.op === 'del') return `Removing ${name || `a ${what}`}`;
  if (r.op === 'put') return r.kind === 'items' ? `Saving ${name || 'an item'}` : `Saving a ${what}`;
  return `A change to ${name || `${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}`}`;
}

// The list after a new refusal (newest last): at most MAX_REFUSED, and small enough for localStorage.
export function addRefused(list, rec) {
  const out = [...list, rec].slice(-MAX_REFUSED);
  while (out.length > 1 && JSON.stringify(out).length > MAX_BYTES) out.shift();
  return out;
}
export const dropRefused = (list, n) => list.filter(r => r.n !== n);
// Only this pantry's (a phone can be signed in to another one later).
export const refusedFor = (list, hid) => list.filter(r => r.hid === hid);

// Photos aren't kept in the list (up to 150 KB each); everything else is small.
export const keepable = info => !!info && info.kind !== 'photos';

// ---- Sync now (Settings → Saving to the family): what is waiting, in words, and when the family last answered ----------------
//
// cloud.js keeps a record of every change this phone has sent and the server hasn't acknowledged yet: { kind, id, op, ops | name }
// ('before': left from before the app was last closed, only the document is known). `ctx` hands in what the words need:
// { itemName(id), lineName(id), placeName(id), personName(email) }.

const num = n => (n === 1 ? 'one' : String(n));
// One waiting change as a short line: "Used one Rice", "Name for Jun", "Added place Garage".
export function describeWaiting(r, ctx = {}) {
  const c = { itemName: id => '', lineName: id => '', placeName: id => '', personName: e => e, ...ctx };
  const ops = r.ops || {}, set = ops.set || {}, inc = ops.inc || {}, del = ops.del || [];
  const incs = Object.entries(inc).filter(([p]) => /^batches\.[^.]+\.qty$/.test(p)).map(([, n]) => n);
  if (r.kind === 'items') {
    const name = c.itemName(r.id) || r.name || 'an item';
    if (r.op === 'before') return `A change to ${name} (saved before the app was closed)`;
    if (r.op === 'put') return `Added ${name}`;
    if (r.op === 'del') return `Removing ${name}`;
    if (typeof set.removedAt === 'string') return `Removed ${name}`;
    if (del.includes('removedAt')) return `Put back ${name}`;
    const net = incs.reduce((a, b) => a + b, 0);
    if (incs.length && net < 0) return `Used ${num(-net)} ${name}`;
    if (incs.length && net > 0) return `Added ${num(net)} ${name}`;
    if (typeof set.level === 'string') return `${name}: marked ${set.level}`;
    if (typeof set.location === 'string') return `Moved ${name} to ${set.location}`;
    if (typeof set.order === 'number' && Object.keys(set).every(k => ['order', 'updatedAt', 'updatedBy'].includes(k))) return `Moved ${name} in the list`;
    return `A change to ${name}`;
  }
  if (r.kind === 'shop') {
    const name = c.lineName(r.id) || r.name || 'a line';
    if (r.op === 'before') return `A change to the shopping list: ${name}`;
    if (r.op === 'put') return `Added to the list: ${name}`;
    if (typeof set.removedAt === 'string') return `Removed from the list: ${name}`;
    if (del.includes('removedAt')) return `Put back on the list: ${name}`;
    if ('done' in set) return `${set.done ? 'Ticked' : 'Unticked'}: ${name}`;
    return `A change to the shopping list: ${name}`;
  }
  if (r.kind === 'places') {
    const name = c.placeName(r.id) || r.name || 'a place';
    if (r.op === 'before') return `A change to place ${name}`;
    if (r.op === 'put') return `Added place ${name}`;
    if (typeof set.removedAt === 'string') return `Removed place ${name}`;
    if (del.includes('removedAt')) return `Put back place ${name}`;
    if (typeof set.name === 'string') return `Renamed place to ${set.name}`;
    if (typeof set.order === 'number') return `Moved place ${name}`;
    return `A change to place ${name}`;
  }
  if (r.kind === 'settings') {
    const k = ops.keyed?.names;
    if (k) { const who = Object.keys(k.set || {})[0] || (k.del || [])[0]; if (who) return `Name for ${c.personName(who)}`; }
    return r.op === 'before' ? 'A change to the family’s settings' : 'Names or places for the family';
  }
  return 'A change';
}
// "Last heard from the family: …": just now, at 3:42 pm (today), or 17 Oct, 3:42 pm. Without a time, say so.
export function heardText(ts, now = Date.now(), locale = 'en-SG') {
  if (!ts) return 'Not yet since the app opened';
  const d = new Date(ts), n = new Date(now), age = now - ts;
  if (age < 60000) return 'just now';
  const t = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === n.toDateString() ? `at ${t}` : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${t}`;
}
// What Sync now says. `r` is cloud.syncNow's answer ({ ok, cycled, heard }); `refused` the changes the server wouldn't take.
export function syncNowResult(r, { refused = 0, pending = 0 } = {}) {
  if (refused > 0) return { kind: 'attention', text: `Needs attention: ${refused === 1 ? 'the family pantry wouldn’t take one change' : `the family pantry wouldn’t take ${refused} changes`}. Retry or Discard ${refused === 1 ? 'it' : 'them'} below.` };
  if (r.ok) return { kind: 'saved', text: 'Everything is saved' };
  return { kind: 'waiting', offer: !r.cycled, text: `Still waiting: this phone can’t reach the family right now.${pending ? ` ${pending === 1 ? 'The change is' : 'The changes are'} kept on this phone and sent when there is signal.` : ''}` };
}
