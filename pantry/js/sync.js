// Saving to the family: what the sync button says, and the changes the server refused. Pure functions (test/sync.test.mjs
// runs them in Node); the app keeps the list in this phone's localStorage and cloud.js reports each refusal.
//
// A write to the family pantry is kept on the phone and sent when there is signal (Firestore's cache), so a change
// is never lost by going offline. A change the SERVER refuses (the account was removed, the item was deleted on
// another phone, a rule) is dropped by the SDK and the screen quietly goes back: so the app keeps a copy of what was
// refused (a small list, on this phone) and says "Needs attention" until the person retries or discards it.

export const MAX_REFUSED = 30;
const MAX_BYTES = 200000;

// The sync button in the top bar (the kit's syncButton): Saved, Waiting for signal (N changes), or Needs attention, in
// `text`; `state` and `count` are the kit's (synced, pending, offline, at-risk, attention, unknown).
// `pending`: changes made here that the server hasn't confirmed; `cache`: the phone is showing its own copy (no
// connection to the server); `recent`: the server was heard from within the last few seconds; `waited`: ms since the oldest unconfirmed change (a normal save is confirmed in well under
// a second, which isn’t worth "waiting").
// `persisted`: false when the browser may clear this site's storage (app-sync persistGuard), so changes still unsent after
// are at risk only while the phone is offline (online they are on their way; most browsers say false to an ordinary site);
// `stale`: the listener watchdog says the server isn't being heard, so what shows may be old; `confirmed`: the server has answered once since
// the app opened (false: not "Saved" yet). `status`: app-sync's syncStatus answer for the same facts (cloud.status); without it the same rules run here.
export function syncState({ refused = 0, pending = 0, cache = false, offline = false, waited = 0, recent = false, persisted = true, stale = false, confirmed = true, status = null } = {}) {
  const st = status || statusRules({ online: !offline, pending, attention: refused, persisted, confirmed });
  const n = `${pending} ${pending === 1 ? 'change' : 'changes'}`;
  if (refused > 0) return { kind: 'attention', state: 'attention', count: refused, text: refused === 1 ? 'Needs attention' : `Needs attention (${refused})` };
  if (st.state === 'at-risk') return { kind: 'waiting', state: 'at-risk', count: pending, text: `Only on this phone (${n})` };
  // (`recent`: a snapshot came from the server a moment ago, so a listener that still says "my own copy" is behind, not the connection)
  if (pending > 0 && ((cache && !recent) || offline || waited >= 1500)) return { kind: 'waiting', state: 'offline', count: pending, text: `Waiting for signal (${n})` };
  if (pending === 0 && stale && !offline) return { kind: 'waiting', state: 'unknown', count: 0, text: 'May be out of date' };
  if (st.state === 'unknown') return { kind: 'waiting', state: 'unknown', count: 0, text: 'Not checked with the family yet' };
  // (a change on its way, not yet waited for: the button lifts its arrow, the words still say Saved)
  return { kind: 'saved', state: pending > 0 ? 'pending' : 'synced', count: pending, text: 'Saved' };
}
// app-sync's syncStatus rules for the states the button tells apart (at-risk only while offline; unknown until the server has answered).
const statusRules = ({ online, pending, attention, persisted, confirmed }) =>
  attention > 0 ? { state: 'attention' } : pending > 0 && !persisted && !online ? { state: 'at-risk' } : pending === 0 && confirmed === false ? { state: 'unknown' } : { state: 'other' };

// The page may reload for a new version (app-update's canReload) only with nothing open and nothing sending.
export const reloadAllowed = ({ pending = 0, sheet = false, draft = false, typing = false, dragging = false } = {}) => !(pending > 0 || sheet || draft || typing || dragging);

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

// ---- the sync button's tap: send what is waiting, then say how it went (a toast) ----------------------------------------

// What Sync now says. `r` is cloud.syncNow's answer ({ ok, cycled, heard }); `refused` the changes the server wouldn't take.
export function syncNowResult(r, { refused = 0, pending = 0 } = {}) {
  if (refused > 0) return { kind: 'attention', text: `Needs attention: ${refused === 1 ? 'the family pantry wouldn’t take one change' : `the family pantry wouldn’t take ${refused} changes`}. Try again or Discard ${refused === 1 ? 'it' : 'them'} on Home.` };
  if (r.ok) return { kind: 'saved', text: 'Everything is saved' };
  return { kind: 'waiting', offer: !r.cycled, text: `Still waiting: this phone can’t reach the family right now.${pending ? ` ${pending === 1 ? 'The change is' : 'The changes are'} kept on this phone and sent when there is signal.` : ''}` };
}
