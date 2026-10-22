// Selecting items (16 Oct 2026, Items list PR): the selection as plain state (by item id, so it survives redraws from other
// phones' changes), and the press-and-hold that starts selecting, written ONCE. The state functions are pure (test/select.test.mjs
// runs them in Node, with a fake pointer for the hold); app.js draws the rows, the bar and the actions.
//
// Selecting starts three ways, so nobody is ever stuck behind a gesture: the Select button above the list, a press and hold on a
// row (half a second, finger still), and, once selecting, a tap on any row. Everything has a button and a keyboard path.

// ---- the selection ---------------------------------------------------------------------------------------------------------

export const newSel = () => ({ on: false, ids: new Set() });
// Start selecting (with `id` already ticked, when it comes from a press and hold).
export function startSel(sel, id = '') { sel.on = true; sel.ids = new Set(id ? [id] : []); return sel; }
export function endSel(sel) { sel.on = false; sel.ids = new Set(); return sel; }
export const isSel = (sel, id) => sel.ids.has(id);
// Tick or untick one; returns whether it is ticked now.
export function toggleSel(sel, id) { if (sel.ids.has(id)) { sel.ids.delete(id); return false; } sel.ids.add(id); return true; }
// Tick (on) or untick (off) many at once: a heading's "Select these 4". Returns how many changed.
export function setMany(sel, ids, on = true) {
  let n = 0;
  for (const id of ids) { if (on && !sel.ids.has(id)) { sel.ids.add(id); n++; } else if (!on && sel.ids.delete(id)) n++; }
  return n;
}
// Select all: exactly the ids given (the whole filtered result, not just the rows drawn); Select none keeps selecting.
export function selectAll(sel, ids) { sel.ids = new Set(ids); return sel.ids.size; }
export function selectNone(sel) { sel.ids = new Set(); return sel; }
// Drop what no longer exists (another phone deleted it); returns how many were dropped.
export function pruneSel(sel, valid) {
  const ok = valid instanceof Set ? valid : new Set(valid);
  let n = 0;
  for (const id of [...sel.ids]) if (!ok.has(id)) { sel.ids.delete(id); n++; }
  return n;
}
// For a heading: 'all' of its ids ticked, 'some', or 'none'.
export function groupState(sel, ids) {
  let n = 0;
  for (const id of ids) if (sel.ids.has(id)) n++;
  return !ids.length || n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}
// "3 selected", "None selected"; `hidden` ticked items that the current filter doesn't show.
export function selText(n, hidden = 0) {
  const base = n === 0 ? 'None selected' : `${n} selected`;
  return hidden > 0 && n > 0 ? `${base} (${hidden} not shown)` : base;
}
// The selected items that still exist, in the order of `all` (what an action works on).
export const chosen = (sel, all) => all.filter(x => sel.ids.has(x.id));

// ---- press and hold ----------------------------------------------------------------------------------------------------------

const CAPTURE = { capture: true };   // (an options object, not `true`: Node's EventTarget only matches a capture listener removed the same way)
export const HOLD_MS = 500;      // half a second, finger still
export const HOLD_SLOP = 10;     // more than this many px of movement is a swipe or a scroll, not a hold

// Press and hold a row to start selecting. `root` is the list (events are delegated, so rows drawn later work too).
// opts: {
//   row: selector of a row (default '.pa-item'): the row's own link is NOT excluded (a row is an <a>); only `guard` is,
//   guard: selector of things inside a row that keep their own press (default the grip, buttons, inputs),
//   start(rowEl, e): called once when the hold completes; returns nothing,
//   cue(rowEl): the visible cue (a class), haptic(): the buzz (Android only; the kit's haHaptic), announce(text),
//   ms, slop, win: for tests }
// It cancels if the finger moves more than HOLD_SLOP, the page scrolls, or the pointer is cancelled (a scroll starting on a
// touch screen, a call, a gesture), swallows the click that follows lifting the finger (so the row's link does not open), and
// copes with Android's long press, which sends `contextmenu` at about the same time. Returns { destroy }.
export function holdToSelect(root, opts = {}) {
  const { row = '.pa-item', guard = '.pa-grip, button, input, select, textarea', start, cue, haptic, ms = HOLD_MS, slop = HOLD_SLOP, win = globalThis } = opts;
  let timer = 0, x = 0, y = 0, el = null, heldAt = 0, startEvent = null;
  const stop = () => { clearTimeout(timer); timer = 0; el?.classList?.remove('is-holding'); el = null; };
  const fire = () => {
    const target = el, e = startEvent; timer = 0;
    target?.classList?.remove('is-holding');
    el = null; heldAt = Date.now();
    // the click that comes with lifting the finger would open the row's link: swallow it (and drop the trap if none comes)
    const eat = ev => { ev.stopPropagation(); ev.preventDefault(); win.removeEventListener('click', eat, CAPTURE); };
    win.addEventListener('click', eat, CAPTURE);
    setTimeout(() => win.removeEventListener('click', eat, CAPTURE), 700);
    try { haptic?.(); } catch { /* not allowed */ }
    if (target) { cue?.(target); start?.(target, e); }
  };
  const down = e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.isPrimary === false) return;
    const t = e.target?.closest ? e.target : null;
    const r = t?.closest?.(row);
    if (!r || !root.contains(r) || t.closest(guard)) return;
    stop();
    x = e.clientX; y = e.clientY; el = r; startEvent = e;
    r.classList?.add('is-holding');
    timer = setTimeout(fire, ms);
  };
  const move = e => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > slop) stop(); };
  const ctx = e => {
    const r = e.target?.closest?.(row);
    if (!r || !root.contains(r)) return;
    if (timer) { e.preventDefault(); clearTimeout(timer); fire(); }          // Android long press: it is the hold
    else if (Date.now() - heldAt < 1000) e.preventDefault();               // the menu right after a hold
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(ev, stop);
  root.addEventListener('contextmenu', ctx);
  const onScroll = () => { if (timer) stop(); };
  win.addEventListener?.('scroll', onScroll, { capture: true, passive: true });
  return {
    destroy() {
      stop();
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) root.removeEventListener(ev, stop);
      root.removeEventListener('contextmenu', ctx);
      win.removeEventListener?.('scroll', onScroll, { capture: true });
    },
  };
}
